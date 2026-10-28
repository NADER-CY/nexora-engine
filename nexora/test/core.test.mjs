// Unit tests: limits, cancellation, concurrency, JSONL, entry detection, redaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveLimits, withTimeout, ConcurrencyGate, heapGuard, BoundedCounter, DEFAULT_LIMITS } from "../lib/limits.mjs";
import { readJsonl, BoundedJsonlWriter } from "../lib/jsonl.mjs";
import { isMainModule } from "../lib/entry.mjs";
import { sanitizeUrl, redactText, sanitizeHeaders } from "../lib/redact.mjs";
import { NexoraError, toErrorObject } from "../lib/errors.mjs";
import { withTempDir } from "./helpers.mjs";

test("limits: defaults, env overrides, explicit overrides, validation", () => {
  assert.equal(resolveLimits({}, {}).maxLineBytes, DEFAULT_LIMITS.maxLineBytes);
  assert.equal(resolveLimits({}, { NEXORA_MAX_LINE_BYTES: "4096" }).maxLineBytes, 4096);
  assert.equal(resolveLimits({ maxLineBytes: 10 }, { NEXORA_MAX_LINE_BYTES: "4096" }).maxLineBytes, 10);
  assert.equal(resolveLimits({}, { NEXORA_TIMEOUT_MS: "1500" }).timeoutMs, 1500);
  for (const bad of [0, -1, 1.5, "abc", NaN])
    assert.throws(() => resolveLimits({ timeoutMs: bad }, {}), (e) => e.code === "invalid_argument");
  assert.throws(() => resolveLimits({ bogus: 1 }, {}), /Unknown limit/);
  assert.throws(() => resolveLimits({}, { NEXORA_CONCURRENCY: "0" }), /positive integer/);
});

test("withTimeout: rejects with timeout and aborts the work signal", async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve("late");
          });
        }),
      { timeoutMs: 50, label: "slow" },
    ),
    (e) => e instanceof NexoraError && e.code === "timeout" && e.retryable,
  );
  assert.equal(aborted, true);
});

test("withTimeout: parent cancellation propagates as cancelled", async () => {
  const parent = new AbortController();
  const p = withTimeout((signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), { timeoutMs: 10_000, signal: parent.signal });
  parent.abort();
  await assert.rejects(p, (e) => e.code === "cancelled");
});

test("withTimeout: returns the value on success", async () => {
  assert.equal(await withTimeout(async () => 42, { timeoutMs: 1000 }), 42);
});

test("ConcurrencyGate: bounds concurrency and rejects when the queue is full", async () => {
  const gate = new ConcurrencyGate({ concurrency: 2, maxQueue: 1 });
  let running = 0;
  let peak = 0;
  const release = [];
  const job = () =>
    gate.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => release.push(r));
      running--;
    });
  const a = job();
  const b = job();
  const c = job(); // queued
  await new Promise((r) => setImmediate(r));
  await assert.rejects(job(), (e) => e.code === "limit_exceeded" && e.retryable);
  assert.deepEqual(gate.stats, { active: 2, queued: 1, concurrency: 2, maxQueue: 1 });
  while (release.length || gate.stats.active) {
    release.shift()?.();
    await new Promise((r) => setImmediate(r));
  }
  await Promise.all([a, b, c]);
  assert.equal(peak, 2);
});

test("ConcurrencyGate: queued work can be cancelled", async () => {
  const gate = new ConcurrencyGate({ concurrency: 1, maxQueue: 5 });
  let release;
  const first = gate.run(() => new Promise((r) => (release = r)));
  const ac = new AbortController();
  const queued = gate.run(async () => "never", ac.signal);
  ac.abort();
  await assert.rejects(queued, (e) => e.code === "cancelled");
  release();
  await first;
  assert.equal(gate.stats.queued, 0);
});

test("heapGuard and BoundedCounter", () => {
  const g = heapGuard(1, 1);
  assert.throws(() => g.tick(), (e) => e.code === "limit_exceeded");
  const c = new BoundedCounter(2);
  c.add("a");
  c.add("b");
  c.add("c");
  c.add("a");
  assert.equal(c.size, 2);
  assert.equal(c.dropped, 1);
  assert.deepEqual(c.sorted()[0], ["a", 2]);
});

test("readJsonl: skips oversized, invalid, non-object and blank lines; handles CRLF and no trailing newline", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "x.jsonl");
    const big = JSON.stringify({ kind: "big", body: "A".repeat(5000) });
    await writeFile(f, ['{"a":1}', "", "not json", "[1,2]", big, '{"b":2}\r', "   ", '{"c":3}'].join("\n"));
    const stats = {};
    const out = [];
    for await (const { record } of readJsonl(f, { maxLineBytes: 1000, chunkBytes: 7, stats })) out.push(record);
    assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
    assert.equal(stats.oversizedLines, 1);
    assert.equal(stats.invalidJson, 1);
    assert.equal(stats.nonObject, 1);
    assert.equal(stats.blank, 2);
    assert.equal(stats.lines, 8);
  });
});

test("readJsonl: multibyte UTF-8 split across chunk boundaries", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "u.jsonl");
    const value = "سلام 你好 😀".repeat(50);
    await writeFile(f, JSON.stringify({ v: value }) + "\n" + JSON.stringify({ v: "end" }) + "\n");
    for (const chunkBytes of [1, 2, 3, 5, 64]) {
      const out = [];
      for await (const { record } of readJsonl(f, { chunkBytes })) out.push(record.v);
      assert.deepEqual(out, [value, "end"], `chunk ${chunkBytes}`);
    }
  });
});

test("readJsonl: maxRecords stops early and cancellation aborts", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "m.jsonl");
    await writeFile(f, Array.from({ length: 100 }, (_, i) => JSON.stringify({ i })).join("\n"));
    const stats = {};
    let n = 0;
    for await (const _ of readJsonl(f, { maxRecords: 10, stats })) n++;
    assert.equal(n, 10);
    assert.equal(stats.truncatedAtMaxRecords, true);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(async () => {
      for await (const _ of readJsonl(f, { signal: ac.signal, chunkBytes: 16 }));
    }, (e) => e.code === "cancelled");
  });
});

test("BoundedJsonlWriter: byte cap, queue cap, oversized records are counted not thrown", async () => {
  await withTempDir(async (dir) => {
    const w = await new BoundedJsonlWriter(join(dir, "o.jsonl"), { maxBytes: 200, maxQueue: 1000 }).open();
    for (let i = 0; i < 50; i++) w.write({ i, pad: "x".repeat(10) });
    w.write({ big: "y".repeat(5 * 1024 * 1024) });
    const s = await w.close();
    assert.ok(s.bytes <= 200);
    assert.equal(s.truncated, true);
    assert.ok(s.dropped.byteCap > 0);
    assert.equal(s.dropped.oversized + s.dropped.byteCap > 0, true);
    assert.equal(w.write({ after: 1 }), false);
  });
});

test("isMainModule: Windows paths match (v0.4 regression) and mismatches are rejected", () => {
  const url = "file:///C:/Users/me/nexora/scripts/rea-session-report.mjs";
  assert.equal(isMainModule(url, { argv1: "C:\\Users\\me\\nexora\\scripts\\rea-session-report.mjs", platform: "win32" }), true);
  assert.equal(isMainModule(url, { argv1: "c:\\users\\ME\\nexora\\scripts\\rea-session-report.mjs", platform: "win32" }), true);
  const spaced = "file:///C:/My%20Projects/nexora/x.mjs";
  assert.equal(isMainModule(spaced, { argv1: "C:\\My Projects\\nexora\\x.mjs", platform: "win32" }), true);
  assert.equal(isMainModule(url, { argv1: "C:\\Users\\me\\other.mjs", platform: "win32" }), false);
  assert.equal(isMainModule(url, { argv1: undefined, platform: "win32" }), false);
  // The v0.4 comparison that failed on Windows:
  assert.notEqual(new URL(url).pathname, "C:\\Users\\me\\nexora\\scripts\\rea-session-report.mjs");
});

test("isMainModule: POSIX real paths", async () => {
  await withTempDir(async (dir) => {
    const f = join(dir, "m.mjs");
    await writeFile(f, "");
    assert.equal(isMainModule(pathToFileURL(f).href, { argv1: f }), true);
    assert.equal(isMainModule(pathToFileURL(f).href, { argv1: join(dir, "other.mjs") }), false);
  });
});

test("redaction: URLs drop secrets, keep public market parameters, mask identifiers", () => {
  const s = sanitizeUrl("https://user:pw@api.example.test/api/v3/order/123456789?symbol=BTC_USDT&signature=abcd&token=t&limit=5#frag");
  assert.equal(s.url, "https://api.example.test/api/v3/order/:id?symbol=BTC_USDT&limit=5");
  assert.ok(s.queryKeys.includes("signature"));
  assert.ok(!JSON.stringify(s).includes("abcd"));
  assert.ok(!JSON.stringify(s).includes("pw"));
  assert.equal(sanitizeUrl("data:text/plain,secret").url, "data:[omitted]");
  assert.equal(sanitizeUrl("javascript:alert(1)").url, "javascript:[omitted]");
});

test("redaction: free text and headers", () => {
  // Public jwt.io sample token, assembled at runtime so secret scanners do not flag the source.
  const sampleJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join(".");
  const t = redactText(
    "Bearer abcdefghijklmnop123 jwt " + sampleJwt + " 0x52908400098527886E0F7030069857D2E4169EE7 me@example.com password=hunter2 acct 123456789012",
  );
  for (const leaked of ["abcdefghijklmnop123", "eyJhbGci", "0x5290", "me@example.com", "hunter2", "123456789012"]) assert.ok(!t.includes(leaked), leaked);
  assert.deepEqual(sanitizeHeaders({ Authorization: "Bearer x", Cookie: "a=b", "Content-Type": "application/json", "X-RateLimit-Remaining": "9" }), {
    "content-type": "application/json",
    "x-ratelimit-remaining": "[present]",
  });
});

test("errors: structured and bounded", () => {
  assert.deepEqual(new NexoraError("timeout", "t", { hint: "h", retryable: true }).toJSON(), { code: "timeout", message: "t", hint: "h", retryable: true });
  const e = toErrorObject(Object.assign(new Error("x".repeat(2000)), { code: "ENOENT" }));
  assert.equal(e.code, "system_enoent");
  assert.ok(e.message.length <= 500);
});
