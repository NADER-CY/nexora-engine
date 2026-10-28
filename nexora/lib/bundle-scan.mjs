/**
 * Streaming, bounded-memory scanner for very large JavaScript bundles.
 *
 * Reads the file in fixed-size chunks (never the whole file), decodes UTF-8
 * across chunk boundaries, and keeps a small overlap window so string
 * literals that straddle a boundary are still found exactly once. Every
 * inventory is capped (BoundedCounter) and dropped items are reported.
 *
 * It extracts engineering facts that are useful for frontend/backend
 * architecture work: API path literals, WebSocket URLs, external hosts,
 * client-side route declarations, HTTP call styles, GraphQL operations,
 * framework/chart-library signals, source-map references, and hard-coded
 * credential-like literals (reported by type and offset only, never value).
 *
 * This is lexical analysis: it reports what literally appears in the
 * bundle. It does not prove an endpoint is called at runtime.
 */
import { createReadStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { checkedInputFile } from "./fs-safe.mjs";
import { resolveLimits, throwIfAborted, BoundedCounter } from "./limits.mjs";
import { sanitizeUrl } from "./redact.mjs";
import { NexoraError, ErrorCodes } from "./errors.mjs";

const Q = `["'\`]`;
const NQ = `[^"'\`\\s]`;

function build(maxLit) {
  return {
    apiPath: new RegExp(`${Q}((?:https?:\\/\\/${NQ}{1,200})?\\/(?:api|apis|v[1-9]\\d?|gateway|rest|open|public|private|graphql|rpc|ws|stream|socket)(?:\\/${NQ}{0,${maxLit}})?)${Q}`, "g"),
    wsUrl: new RegExp(`${Q}(wss?:\\/\\/${NQ}{3,${maxLit}})${Q}`, "g"),
    httpUrl: new RegExp(`${Q}(https?:\\/\\/[A-Za-z0-9.\\-]{3,253}(?::\\d{2,5})?)(?:\\/${NQ}{0,${maxLit}})?${Q}`, "g"),
    route: new RegExp(`(?:path|route|to|href)\\s*:\\s*${Q}(\\/[A-Za-z0-9_\\-:\\/.*?]{0,200})${Q}`, "g"),
    callStyle: /\b(fetch|axios(?:\.(?:get|post|put|patch|delete|request))?|XMLHttpRequest|navigator\.sendBeacon|EventSource|new\s+WebSocket|io\()\s*\(?/g,
    graphql: /\b(query|mutation|subscription)\s+([A-Z][A-Za-z0-9_]{2,60})\s*[({]/g,
    sourceMap: /[#@]\s*sourceMappingURL=([^\s'"]{1,500})/g,
    secret: [
      ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
      ["google-api-key", /\bAIza[0-9A-Za-z_\-]{35}\b/g],
      ["stripe-live-key", /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g],
      ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
      ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
      ["slack-token", /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g],
    ],
  };
}

const SIGNALS = {
  framework: [
    ["react", /\b__SECRET_INTERNALS_DO_NOT_USE|react\.production\.min|createElement\(|useState\b/g],
    ["vue", /\b__VUE__|createVNode|_createElementVNode/g],
    ["angular", /\bɵɵdefineComponent|ngDevMode/g],
    ["next.js", /__NEXT_DATA__|next\/router/g],
    ["webpack", /__webpack_require__|webpackChunk/g],
    ["vite", /import\.meta\.env|__vite__/g],
    ["redux", /\b__REDUX_DEVTOOLS_EXTENSION__|createStore\(/g],
    ["socket.io", /socket\.io|engine\.io/g],
  ],
  charting: [
    ["tradingview-charting-library", /TradingView\.widget|charting_library|tv-chart/gi],
    ["lightweight-charts", /lightweight-charts|createChart\(/g],
    ["echarts", /\becharts\b/g],
    ["highcharts", /\bHighcharts\b/g],
    ["d3", /\bd3\.(select|scale)/g],
    ["klinecharts", /klinecharts/gi],
  ],
};

/**
 * @param {string} file
 * @param {{limits?: object, signal?: AbortSignal, roots?: string[], onProgress?: (p:{bytes:number,total:number})=>void}} [opts]
 */
export async function scanBundle(file, opts = {}) {
  const limits = resolveLimits(opts.limits);
  const { path, size } = await checkedInputFile(file, { maxBytes: limits.maxFileBytes, roots: opts.roots });
  const maxLit = Math.min(limits.maxLiteralBytes, 8192);
  const re = build(maxLit);
  const cap = limits.maxInventoryItems;
  const inv = {
    apiPaths: new BoundedCounter(cap),
    wsUrls: new BoundedCounter(cap),
    hosts: new BoundedCounter(cap),
    routes: new BoundedCounter(cap),
    callStyles: new BoundedCounter(64),
    graphql: new BoundedCounter(cap),
    sourceMaps: new BoundedCounter(16),
    framework: new BoundedCounter(32),
    charting: new BoundedCounter(32),
  };
  const secrets = [];
  const overlap = maxLit + 512;
  const decoder = new StringDecoder("utf8");
  let tail = "";
  let consumed = 0; // characters before `tail` in the decoded stream
  let bytes = 0;
  let lines = 1;
  let longestLine = 0;
  let currentLine = 0;
  const started = Date.now();

  const stream = createReadStream(path, { highWaterMark: limits.chunkBytes });
  try {
    for await (const chunk of stream) {
      throwIfAborted(opts.signal);
      if (Date.now() - started > limits.timeoutMs) {
        throw new NexoraError(ErrorCodes.TIMEOUT, `Bundle scan exceeded ${limits.timeoutMs} ms`, { retryable: true });
      }
      bytes += chunk.length;
      // Line statistics on raw bytes.
      let from = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, from);
        if (nl === -1) {
          currentLine += chunk.length - from;
          break;
        }
        currentLine += nl - from;
        if (currentLine > longestLine) longestLine = currentLine;
        currentLine = 0;
        lines++;
        from = nl + 1;
      }
      const text = tail + decoder.write(chunk);
      const commit = Math.max(0, text.length - overlap);
      scanText(text, commit, consumed, re, inv, secrets);
      consumed += commit;
      tail = text.slice(commit);
      opts.onProgress?.({ bytes, total: size });
    }
    const rest = decoder.end();
    scanText(tail + rest, tail.length + rest.length, consumed, re, inv, secrets);
    if (currentLine > longestLine) longestLine = currentLine;
  } finally {
    stream.destroy();
  }

  const list = (c, limit = cap) => c.sorted().slice(0, limit).map(([value, count]) => ({ value, count }));
  const dropped = Object.fromEntries(Object.entries(inv).map(([k, c]) => [k, c.dropped]).filter(([, n]) => n > 0));
  return {
    schema: "nexora-bundle-scan/v1",
    file: { name: path.split(/[\\/]/).pop(), bytes: size, lines, longestLineBytes: longestLine, minified: longestLine > 50_000 },
    evidenceKind: "OBSERVED-LEXICAL",
    note: "Literals present in the bundle. Presence does not prove runtime use; correlate with a recorded session.",
    apiPaths: list(inv.apiPaths),
    webSocketUrls: list(inv.wsUrls),
    externalHosts: list(inv.hosts),
    clientRoutes: list(inv.routes),
    httpCallStyles: list(inv.callStyles),
    graphqlOperations: list(inv.graphql),
    sourceMaps: list(inv.sourceMaps),
    frameworkSignals: list(inv.framework),
    chartingSignals: list(inv.charting),
    credentialLikeLiterals: secrets.slice(0, 200),
    droppedBecauseOfLimits: dropped,
    elapsedMs: Date.now() - started,
  };
}

function scanText(text, newFrom, base, re, inv, secrets) {
  // Commit by match START after sufficient lookahead. End-based ownership
  // counted a partial call-style match again when the next chunk extended it.
  const take = (regex, fn) => {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) if (m.index < newFrom) fn(m);
  };
  take(re.apiPath, (m) => {
    const s = sanitizeUrl(m[1]);
    if (s) inv.apiPaths.add(s.origin ? s.url : s.path);
  });
  take(re.wsUrl, (m) => {
    const s = sanitizeUrl(m[1]);
    if (s) inv.wsUrls.add(s.url);
  });
  take(re.httpUrl, (m) => {
    try {
      inv.hosts.add(new URL(m[1]).host.toLowerCase());
    } catch {
      /* not a URL */
    }
  });
  take(re.route, (m) => inv.routes.add(m[1].replace(/\/[0-9a-f]{16,}|\/\d{5,}/gi, "/:id")));
  take(re.callStyle, (m) => inv.callStyles.add(m[1].replace(/\s+/g, " ")));
  take(re.graphql, (m) => inv.graphql.add(`${m[1]} ${m[2]}`));
  take(re.sourceMap, (m) => inv.sourceMaps.add(m[1].startsWith("data:") ? "data:[inline]" : sanitizeUrl(m[1])?.path ?? "[unparsed]"));
  for (const [type, regex] of re.secret) take(regex, (m) => secrets.length < 200 && secrets.push({ type, charOffset: base + m.index }));
  for (const group of ["framework", "charting"])
    for (const [name, regex] of SIGNALS[group]) {
      regex.lastIndex = 0;
      let n = 0;
      for (const m of text.matchAll(regex)) if (m.index < newFrom) n++;
      if (n) inv[group].add(name, n);
    }
}
