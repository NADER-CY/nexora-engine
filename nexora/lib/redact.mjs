/**
 * Allowlist-driven redaction applied BEFORE anything is persisted.
 *
 * Principles
 *  - Default deny: structured data is reduced to an explicit allowlist of
 *    fields; payloads are reduced to value-free shapes (see shape.mjs).
 *  - URLs keep scheme, host and path. Query values are dropped unless the
 *    parameter is an allowlisted public market parameter with a safe value.
 *    Fragments and userinfo are always dropped. Identifier-like path
 *    segments are masked.
 *  - Free text (labels, console messages) is scrubbed of credential and
 *    identifier patterns and truncated.
 *  - Headers are kept only when their NAME is allowlisted; only a few
 *    non-identifying values are kept.
 */

/** Query parameters whose values are public market metadata. */
export const PUBLIC_QUERY_PARAMS = new Set([
  "symbol", "symbols", "pair", "instid", "instrument", "contract", "market", "category",
  "interval", "granularity", "period", "resolution", "timeframe", "limit", "depth",
  "size", "level", "type", "lang", "locale", "page", "pagesize", "sort", "precision", "step",
]);
const SAFE_QUERY_VALUE = /^[A-Za-z0-9_.\-]{1,32}$/;

/** Header names that may be recorded (lower-case). */
export const HEADER_ALLOWLIST = new Set([
  "content-type", "content-length", "content-encoding", "cache-control", "retry-after", "vary", "age",
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset",
  "access-control-allow-origin", "upgrade", "sec-websocket-protocol", "sec-websocket-extensions",
]);
/** Of the allowlisted headers, only these keep their values; others keep presence only. */
const HEADER_VALUE_ALLOWLIST = new Set(["content-type", "content-encoding", "cache-control", "retry-after", "upgrade", "sec-websocket-protocol", "sec-websocket-extensions"]);

/** Field/parameter names that always denote secrets or private data. */
export const SENSITIVE_NAME =
  /pass(word|wd|phrase)?|^pwd$|secret|token|auth|cookie|session|^sid$|jwt|bearer|api[-_]?key|apikey|signature|^sign$|private|priv[-_]?key|mnemonic|seed|otp|totp|2fa|^pin$|ssn|e-?mail|phone|mobile|account|^uid$|user[-_]?id|member[-_]?id|wallet|address|balance|equity|available|frozen|pnl|credential|recv[-_]?window|nonce|timestamp|^ts$|client[-_]?order|order[-_]?id|orderid|trade[-_]?id|^id$/i;

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[jwt]"],
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, "$1 [credential]"],
  [/\b0x[a-fA-F0-9]{40,64}\b/g, "[address]"],
  [/\b(bc1|tb1)[a-z0-9]{25,62}\b/g, "[address]"],
  [/\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g, "[address]"],
  [/\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/g, "[address]"],
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g, "[email]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[hex]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[token]"],
  [/\b\d{8,}\b/g, "[number]"],
  // key=value / key: value pairs whose key is sensitive
  [/\b([A-Za-z_][\w-]{0,40})(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/g, (m, k, sep) => (SENSITIVE_NAME.test(k) ? `${k}${sep}[redacted]` : m)],
];

/** Scrub credential- and identifier-like substrings from free text and cap its length. */
export function redactText(input, maxLength = 200) {
  if (input === null || input === undefined) return input;
  let s = String(input);
  if (s.length > maxLength * 4) s = s.slice(0, maxLength * 4);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > maxLength ? s.slice(0, maxLength) + "…" : s;
}

const ID_SEGMENT =
  /^(?:\d{5,}|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|0x[0-9a-f]{20,}|[A-Za-z0-9_-]{24,}|.*@.*)$/i;

/** Mask a single path segment if it looks like an identifier. */
export function maskSegment(segment) {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return ":redacted";
  }
  if (ID_SEGMENT.test(decoded)) return ":id";
  if (decoded.length > 64) return ":redacted";
  return segment;
}

/**
 * Reduce a URL to a privacy-safe form.
 * @returns {{url: string, origin: string|null, path: string, query: Record<string,string>, queryKeys: string[]}|null}
 */
export function sanitizeUrl(input, { base = "https://local.invalid" } = {}) {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input.startsWith("data:")) return { url: "data:[omitted]", origin: null, path: "", query: {}, queryKeys: [] };
  if (input.startsWith("blob:")) return { url: "blob:[omitted]", origin: null, path: "", query: {}, queryKeys: [] };
  let u;
  try {
    u = new URL(input.slice(0, 8192), base);
  } catch {
    return null;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return { url: `${u.protocol}[omitted]`, origin: null, path: "", query: {}, queryKeys: [] };
  const segments = u.pathname.split("/").filter(Boolean).slice(0, 24).map(maskSegment);
  const path = "/" + segments.join("/");
  const query = {};
  const queryKeys = [];
  for (const [rawKey, value] of u.searchParams) {
    const key = rawKey.slice(0, 40);
    if (queryKeys.length >= 32) break;
    if (!/^[\w.\-\[\]]{1,40}$/.test(key) || SENSITIVE_NAME.test(key)) {
      queryKeys.push(SENSITIVE_NAME.test(key) && /^[\w.\-]{1,40}$/.test(key) ? key : "[param]");
      continue;
    }
    queryKeys.push(key);
    if (PUBLIC_QUERY_PARAMS.has(key.toLowerCase()) && SAFE_QUERY_VALUE.test(value) && !ID_SEGMENT.test(value)) query[key] = value;
  }
  const isLocal = base === "https://local.invalid" && u.origin === "https://local.invalid";
  const origin = isLocal ? null : `${u.protocol}//${u.host}`;
  const qs = Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return { url: (origin ?? "") + path + qs, origin, path, query, queryKeys: [...new Set(queryKeys)] };
}

/** Keep only allowlisted headers; most keep presence only. */
export function sanitizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [name, value] of Object.entries(headers)) {
    const n = name.toLowerCase();
    if (!HEADER_ALLOWLIST.has(n)) continue;
    out[n] = HEADER_VALUE_ALLOWLIST.has(n) ? redactText(String(value), 120) : "[present]";
  }
  return out;
}

/** Last-line-of-defense detector used by tests and the writer's self-check. */
export function findSecretLikeContent(text) {
  const s = String(text);
  const hits = [];
  const checks = [
    ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
    ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["evm-address", /\b0x[a-fA-F0-9]{40}\b/],
    ["bearer", /\bbearer\s+[A-Za-z0-9._~+\/=-]{12,}/i],
    ["cookie-header", /"(set-)?cookie"\s*:/i],
    ["authorization-header", /"authorization"\s*:/i],
    ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ];
  for (const [name, re] of checks) if (re.test(s)) hits.push(name);
  return hits;
}
