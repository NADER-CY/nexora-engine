#!/usr/bin/env node
/**
 * Measure wall time, peak RSS and outcome of one child Node process.
 *
 * Peak RSS comes from two independent sources:
 *  - process.resourceUsage().maxRSS reported by a preload hook at exit, and
 *  - polling VmHWM in /proc/<pid>/status (Linux only), which still works when
 *    the child is killed by an out-of-memory abort.
 *
 * Usage: node measure.mjs --label X [--heap MB] [--timeout ms] -- script.mjs args...
 * Prints a single JSON line with the measurement.
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function measure({ label, script, args = [], heapMb, timeoutMs = 600_000, env = {} }) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "nexora-measure-"));
    const rssFile = join(dir, "rss.json");
    const nodeArgs = ["--import", join(here, "rss-reporter.mjs")];
    if (heapMb) nodeArgs.push(`--max-old-space-size=${heapMb}`);
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [...nodeArgs, script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, NEXORA_RSS_FILE: rssFile },
    });
    let stderr = "";
    let stdoutBytes = 0;
    child.stdout.on("data", (b) => {
      stdoutBytes += b.length;
    });
    child.stderr.on("data", (b) => {
      if (stderr.length < 8192) stderr += b.toString();
    });
    let polledKb = 0;
    const poll = setInterval(() => {
      try {
        const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
        const m = /VmHWM:\s+(\d+)/.exec(status);
        if (m) polledKb = Math.max(polledKb, Number(m[1]));
      } catch {
        /* process gone or not Linux */
      }
    }, 10);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearInterval(poll);
      clearTimeout(timer);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      let reportedKb = null;
      try {
        reportedKb = JSON.parse(readFileSync(rssFile, "utf8")).maxRssKb;
      } catch {
        /* crashed before exit hook */
      }
      rmSync(dir, { recursive: true, force: true });
      const oom = /heap out of memory|Allocation failed|Invalid string length|Cannot create a string longer/i.test(stderr);
      resolve({
        label,
        exitCode: code,
        signal,
        outcome: code === 0 ? "ok" : oom ? "oom-or-string-limit" : "failed",
        wallMs: Math.round(ms),
        peakRssMb: Math.round((Math.max(reportedKb ?? 0, polledKb) / 1024) * 10) / 10,
        heapLimitMb: heapMb ?? null,
        stdoutBytes,
        stderrTail: code === 0 ? undefined : stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const opts = argv.slice(0, sep);
  const [script, ...args] = argv.slice(sep + 1);
  const get = (k) => {
    const i = opts.indexOf(k);
    return i >= 0 ? opts[i + 1] : undefined;
  };
  const result = await measure({
    label: get("--label") ?? script,
    script,
    args,
    heapMb: get("--heap") ? Number(get("--heap")) : undefined,
    timeoutMs: get("--timeout") ? Number(get("--timeout")) : undefined,
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}
