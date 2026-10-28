// Bundle scanner, session analyzers, CLI and v0.4 compatibility wrappers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { scanBundle } from "../lib/bundle-scan.mjs";
import { summarize } from "../lib/session-report.mjs";
import { mapSession } from "../lib/backend-map.mjs";
import { withTempDir, runNode } from "./helpers.mjs";

test("scanBundle: finds literals across chunk boundaries exactly once", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "b.js");
    const filler = "var a=1;".repeat(3000);
    await writeFile(
      f,
      filler + 'fetch("/api/v1/market/depth");' + filler + 'new WebSocket("wss://stream.example.test/ws/kline");' + filler + '{path:"/futures/:symbol"}' + "\n//# sourceMappingURL=app.js.map\n",
    );
    for (const chunkBytes of [997, 4096, 65536]) {
      const r = await scanBundle(f, { limits: { chunkBytes } });
      assert.deepEqual(r.apiPaths, [{ value: "/api/v1/market/depth", count: 1 }], `chunk ${chunkBytes}`);
      assert.deepEqual(r.webSocketUrls, [{ value: "wss://stream.example.test/ws/kline", count: 1 }]);
      assert.deepEqual(r.clientRoutes, [{ value: "/futures/:symbol", count: 1 }]);
      assert.deepEqual(r.sourceMaps, [{ value: "/app.js.map", count: 1 }]);
    }
  });
});

test("scanBundle: strips secrets from URL literals and reports credential-like literals by type only", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "s.js");
    const awsKey = "AKIA" + "ABCDEFGHIJKLMNOP";
    await writeFile(f, `fetch("https://api.example.test/api/v2/order?signature=SECRETSIG&symbol=BTC_USDT");const k="${awsKey}";`);
    const r = await scanBundle(f);
    const json = JSON.stringify(r);
    assert.ok(!json.includes("SECRETSIG"));
    assert.ok(!json.includes(awsKey));
    assert.equal(r.apiPaths[0].value, "https://api.example.test/api/v2/order?symbol=BTC_USDT");
    assert.equal(r.credentialLikeLiterals[0].type, "aws-access-key");
    assert.equal(typeof r.credentialLikeLiterals[0].charOffset, "number");
  });
});

test("scanBundle: inventories are capped and drops reported", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "many.js");
    await writeFile(f, Array.from({ length: 50 }, (_, i) => `fetch("/api/v1/item${i}");`).join(""));
    const r = await scanBundle(f, { limits: { maxInventoryItems: 10 } });
    assert.equal(r.apiPaths.length, 10);
    assert.equal(r.droppedBecauseOfLimits.apiPaths, 40);
  });
});

test("scanBundle: file-size limit, timeout and cancellation", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "big.js");
    await writeFile(f, "x".repeat(3 * 1024 * 1024));
    await assert.rejects(scanBundle(f, { limits: { maxFileBytes: 1024 * 1024 } }), (e) => e.code === "limit_exceeded");
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(scanBundle(f, { signal: ac.signal, limits: { chunkBytes: 65536 } }), (e) => e.code === "cancelled");
    await assert.rejects(scanBundle(f, { limits: { timeoutMs: 1, chunkBytes: 1024 } }), (e) => e.code === "timeout");
  });
});

test("session summary and backend map: oversized line skipped, output unchanged otherwise", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "s.jsonl");
    await writeFile(
      f,
      [
        JSON.stringify({ kind: "page", section: "spot", path: "/exchange/MX_USDT?token=secret", at: "2026-10-22T01:00:00Z" }),
        JSON.stringify({ kind: "network", body: "A".repeat(3000) }),
        JSON.stringify({ kind: "ui-summary", section: "spot", summary: { tabs: [{ label: "Limit" }] } }),
      ].join("\n"),
    );
    const s = await summarize(f, { limits: { maxLineBytes: 1000 } });
    assert.equal(s.oversizedLines, 1);
    assert.equal(s.invalidLines, 1);
    assert.deepEqual(s.eventCounts, { page: 1, "ui-summary": 1 });
    const m = await mapSession(f, { limits: { maxLineBytes: 1000 } });
    assert.equal(m.stats.events, 2);
    assert.equal(m.stats.oversizedLines, 1);
    assert.deepEqual(m.stats.normalizedRoutes, ["/exchange/:symbol"]);
    assert.ok(!JSON.stringify(m).includes("secret"));
    assert.equal(m.project, "NEXORA ENGINE");
  });
});

test("CLI: summary to file (owner-only), usage errors, limits, help", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "s.jsonl");
    await writeFile(f, JSON.stringify({ kind: "click", url: "/a" }) + "\n");
    const out = join(dir, "out", "r.json");
    const r = await runNode(["nexora/bin/nexora.mjs", "summary", f, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(await readFile(out, "utf8")).eventCounts.click, 1);
    if (process.platform !== "win32") assert.equal((await stat(out)).mode & 0o777, 0o600);
    assert.equal((await runNode(["nexora/bin/nexora.mjs"])).code, 2);
    assert.equal((await runNode(["nexora/bin/nexora.mjs", "bogus", f])).code, 2);
    assert.equal((await runNode(["nexora/bin/nexora.mjs", "summary", f, "--max-line-kb", "-1"])).code, 2);
    const lim = await runNode(["nexora/bin/nexora.mjs", "limits", "--timeout-s", "5"]);
    assert.equal(JSON.parse(lim.stdout).timeoutMs, 5000);
    assert.match((await runNode(["nexora/bin/nexora.mjs", "--help"])).stdout, /NEXORA ENGINE/);
  });
});

test("CLI: per-command timeout produces a structured error and exit 1", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "big.js");
    await writeFile(f, "x".repeat(8 * 1024 * 1024));
    const r = await runNode(["nexora/bin/nexora.mjs", "scan-bundle", f], { env: { NEXORA_TIMEOUT_MS: "1", NEXORA_CHUNK_BYTES: "1024" } });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /nexora: timeout:/);
  });
});

test("CLI: SIGINT cancels cleanly with exit 130", { skip: process.platform === "win32" }, async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "big.js");
    await writeFile(f, "x".repeat(64 * 1024 * 1024));
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["nexora/bin/nexora.mjs", "scan-bundle", f], { env: { ...process.env, NEXORA_CHUNK_BYTES: "4096" }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    await new Promise((r) => setTimeout(r, 300));
    child.kill("SIGINT");
    const code = await new Promise((r) => child.on("close", r));
    assert.equal(code, 130, stderr);
    assert.match(stderr, /cancel/i);
  });
});

test("v0.4 command lines still work through compatibility wrappers", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "s.jsonl");
    await writeFile(f, JSON.stringify({ kind: "page", section: "futures", path: "/futures/BTC_USDT" }) + "\n");
    const out = join(dir, "summary.json");
    const a = await runNode(["scripts/rea-session-report.mjs", f, out]);
    assert.equal(a.code, 0, a.stderr);
    assert.match(a.stdout, /Summary created \(1 lines/);
    const b = await runNode(["scripts/nexora-backend-map.mjs", f]);
    assert.equal(b.code, 0, b.stderr);
    assert.deepEqual(JSON.parse(b.stdout).stats.normalizedRoutes, ["/futures/:symbol"]);
    assert.equal((await runNode(["scripts/rea-session-report.mjs"])).code, 2);
  });
});
