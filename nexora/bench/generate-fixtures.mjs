#!/usr/bin/env node
/**
 * Deterministic synthetic fixtures for NEXORA benchmarks and stress tests.
 * No real site data: every host, symbol and value is synthetic.
 *
 * Usage: node generate-fixtures.mjs <outDir> [--small]
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function writeLines(file, count, makeLine) {
  const out = createWriteStream(file);
  for (let i = 0; i < count; i++) {
    if (!out.write(makeLine(i) + "\n")) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
}

const SYMBOLS = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "MX_USDT", "XRP_USDT"];
const SECTIONS = ["spot", "futures", "chart", "orderbook"];

export function sessionEvent(i, r) {
  const at = new Date(Date.UTC(2026, 9, 22, 1, 0, 0) + i * 50).toISOString();
  const sym = SYMBOLS[Math.floor(r() * SYMBOLS.length)];
  const section = SECTIONS[Math.floor(r() * SECTIONS.length)];
  const k = r();
  if (k < 0.05)
    return { v: 1, seq: i, at, kind: "page", tabId: "T1", section, path: `/${section === "futures" ? "futures" : "exchange"}/${sym}`, url: `https://www.example-exchange.test/exchange/${sym}?token=SYNTHETIC_SECRET_${i}` };
  if (k < 0.25) return { v: 1, seq: i, at, kind: "click", tabId: "T1", section, control: ["tab", "button", "menu-item"][i % 3], label: ["Limit", "Market", "TP/SL", "Buy", "Sell"][i % 5] };
  if (k < 0.4) return { v: 1, seq: i, at, kind: "chart-wheel", tabId: "T1", section: "chart", deltaY: Math.round(r() * 200 - 100) };
  if (k < 0.7)
    return {
      v: 1, seq: i, at, kind: "network", tabId: "T1", method: r() < 0.8 ? "GET" : "POST", url: `https://api.example-exchange.test/api/v3/${["depth", "trades", "klines", "order", "openOrders"][i % 5]}?symbol=${sym}&signature=SYNTHETIC_SIG_${i}`, status: r() < 0.97 ? 200 : 429, mimeType: "application/json", durationMs: Math.round(r() * 300),
    };
  if (k < 0.9) return { v: 1, seq: i, at, kind: "ws-frame", tabId: "T1", direction: "in", url: "wss://stream.example-exchange.test/ws", size: 400, shape: { channel: "string", data: { p: "string", q: "string" } }, messageType: "depth.update" };
  return { kind: "ui-summary", at, section, summary: { tabs: [{ label: "Order Book" }, { label: "Limit" }, { label: "Market" }, { label: "TP/SL" }] } };
}

async function sessionFile(file, count, seed) {
  const r = rng(seed);
  await writeLines(file, count, (i) => JSON.stringify(sessionEvent(i, r)));
}

/** Normal events followed by one enormous single line (e.g. an unbounded raw payload). */
async function hugeLineFile(file, hugeMb) {
  const r = rng(7);
  const out = createWriteStream(file);
  for (let i = 0; i < 1000; i++) out.write(JSON.stringify(sessionEvent(i, r)) + "\n");
  out.write('{"kind":"network","body":"');
  const chunk = "A".repeat(1024 * 1024);
  for (let i = 0; i < hugeMb; i++) if (!out.write(chunk)) await once(out, "drain");
  out.write('"}\n');
  for (let i = 1000; i < 2000; i++) out.write(JSON.stringify(sessionEvent(i, r)) + "\n");
  out.end();
  await once(out, "finish");
}

/** Minified single-line bundle with embedded endpoints, routes and WebSocket URLs. */
async function bundleFile(file, mb, { lines = 1 } = {}) {
  const r = rng(mb);
  const out = createWriteStream(file);
  const target = mb * 1024 * 1024;
  let written = 0;
  let n = 0;
  const perLine = Math.ceil(target / lines);
  let lineBytes = 0;
  out.write("(()=>{");
  while (written < target) {
    n++;
    let s;
    const k = r();
    if (k < 0.002) s = `fetch("/api/v${1 + (n % 3)}/${["market/depth", "market/trades", "order/place", "order/cancel", "account/positions"][n % 5]}?x="+e);`;
    else if (k < 0.003) s = `new WebSocket("wss://stream.example-exchange.test/ws/${["depth", "kline", "trade"][n % 3]}");`;
    else if (k < 0.004) s = `{path:"/${["exchange", "futures", "markets", "assets"][n % 4]}/:symbol",component:R${n}},`;
    else if (k < 0.0045) s = `axios.post("https://api.example-exchange.test/api/v3/order/test",t);`;
    else s = `function a${n}(e,t){var n=e[${n % 97}]||t;return n*${n % 13}+${(n % 7) + 1}}`;
    if (lines > 1 && lineBytes + s.length > perLine) {
      s += "\n";
      lineBytes = 0;
    }
    lineBytes += s.length;
    written += s.length;
    if (!out.write(s)) await once(out, "drain");
  }
  out.write("})();\n//# sourceMappingURL=app.bundle.js.map\n");
  out.end();
  await once(out, "finish");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "bench-data";
  const small = process.argv.includes("--small");
  mkdirSync(dir, { recursive: true });
  const t = Date.now();
  if (small) {
    await sessionFile(join(dir, "session-small.jsonl"), 20_000, 1);
    await hugeLineFile(join(dir, "session-hugeline-small.jsonl"), 8);
    await bundleFile(join(dir, "bundle-8mb.js"), 8);
  } else {
    await sessionFile(join(dir, "session-1m.jsonl"), 1_000_000, 1);
    await hugeLineFile(join(dir, "session-hugeline-600mb.jsonl"), 600);
    await bundleFile(join(dir, "bundle-50mb.js"), 50);
    await bundleFile(join(dir, "bundle-300mb.js"), 300);
    await bundleFile(join(dir, "bundle-600mb.js"), 600);
    await bundleFile(join(dir, "bundle-300mb-multiline.js"), 300, { lines: 5000 });
  }
  process.stdout.write(`fixtures written to ${dir} in ${Date.now() - t} ms\n`);
}
