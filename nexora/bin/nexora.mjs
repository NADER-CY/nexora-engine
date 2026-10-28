#!/usr/bin/env node
/**
 * NEXORA ENGINE offline analysis CLI.
 *
 *   nexora summary      <session.jsonl> [--out file.json]
 *   nexora backend-map  <session.jsonl> [--out file.json]
 *   nexora scan-bundle  <bundle.js>     [--out file.json]
 *   nexora check-archive <file.zip>      unsafe-entry report, no extraction
 *   nexora audit-lifecycle [dir]         install-time script audit
 *   nexora limits                        print effective limits
 *
 * Common options:
 *   --max-file-mb N   --max-line-kb N   --max-records N   --timeout-s N
 *   --max-output-mb N --max-heap-mb N
 *
 * All commands are offline (no network) and read inputs in bounded chunks.
 * Ctrl+C cancels cleanly. The upstream engine remains available as `rea`.
 */
import { isMainModule } from "../lib/entry.mjs";
import { runBounded, runCli } from "../lib/run.mjs";
import { resolveLimits } from "../lib/limits.mjs";
import { writeFileAtomic, allowedRootsFromEnv } from "../lib/fs-safe.mjs";
import { NexoraError, ErrorCodes } from "../lib/errors.mjs";

export const USAGE = `NEXORA ENGINE offline analysis

Usage:
  nexora summary      <session.jsonl> [--out file.json]
  nexora backend-map  <session.jsonl> [--out file.json]
  nexora scan-bundle  <bundle.js>     [--out file.json]
  nexora check-archive <file.zip>     inspect a ZIP for unsafe entries (no extraction)
  nexora audit-lifecycle [projectDir] compare install-time scripts with the reviewed allowlist
  nexora analyze-source <file>       lexical functions, calls and imports
  nexora analyze-project <directory> bounded source/dependency map
  nexora analyze-binary <file>       ELF, PE and thin Mach-O metadata
  nexora ghidra-report <export.jsonl> structured Ghidra export report
  nexora limits

Options:
  --out FILE          write JSON to FILE (owner-only, atomic) instead of stdout
  --max-file-mb N     largest input file (default 2048)
  --max-line-kb N     longest JSONL line; longer lines are skipped (default 1024)
  --max-records N     stop after N records (default 50,000,000)
  --timeout-s N       wall-clock limit per command (default 600)
  --max-output-mb N   largest output file (default 64)
  --max-heap-mb N     soft heap budget (default 768)
  -h, --help          show this help

Environment overrides: NEXORA_MAX_FILE_BYTES, NEXORA_TIMEOUT_MS, NEXORA_CONCURRENCY,
NEXORA_ALLOWED_ROOTS (restrict readable/writable paths), and others (see docs).
`;

const NUMERIC = {
  "--max-file-mb": ["maxFileBytes", 1024 * 1024],
  "--max-line-kb": ["maxLineBytes", 1024],
  "--max-records": ["maxRecords", 1],
  "--timeout-s": ["timeoutMs", 1000],
  "--max-output-mb": ["maxOutputBytes", 1024 * 1024],
  "--max-heap-mb": ["maxHeapBytes", 1024 * 1024],
};

export function parseArgs(argv) {
  const out = { command: undefined, input: undefined, outFile: undefined, limits: {}, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--out") out.outFile = need(argv, ++i, a);
    else if (a in NUMERIC) {
      const [key, mult] = NUMERIC[a];
      const n = Number(need(argv, ++i, a));
      if (!Number.isFinite(n) || n <= 0) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `${a} expects a positive number`);
      out.limits[key] = Math.round(n * mult);
    } else if (a.startsWith("-")) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `Unknown option ${a}`, { hint: "Run nexora --help" });
    else if (!out.command) out.command = a;
    else if (!out.input) out.input = a;
    else throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `Unexpected argument ${a}`);
  }
  return out;
}

function need(argv, i, flag) {
  if (i >= argv.length) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `${flag} needs a value`);
  return argv[i];
}

const COMMANDS = {
  "analyze-source": async (input, ctx) => (await import("../lib/source-analysis.mjs")).analyzeSource(input, ctx),
  "analyze-project": async (input, ctx) => (await import("../lib/project-analysis.mjs")).analyzeProject(input, ctx),
  "analyze-binary": async (input, ctx) => (await import("../lib/binary-analysis.mjs")).analyzeBinary(input, ctx),
  "ghidra-report": async (input, ctx) => (await import("../lib/ghidra-report.mjs")).ghidraReport(input, ctx),
  summary: async (input, ctx) => (await import("../lib/session-report.mjs")).summarize(input, ctx),
  "backend-map": async (input, ctx) => (await import("../lib/backend-map.mjs")).mapSession(input, ctx),
  "scan-bundle": async (input, ctx) => (await import("../lib/bundle-scan.mjs")).scanBundle(input, ctx),
  "check-archive": async (input, ctx) => {
    const { inspectZip } = await import("../lib/archive-check.mjs");
    return inspectZip(input, { maxArchiveBytes: ctx.limits.maxFileBytes });
  },
  "audit-lifecycle": async (input) => (await import("../lib/lifecycle-check.mjs")).auditLifecycleScripts(input ?? "."),
};
/** Commands whose input argument is optional. */
const OPTIONAL_INPUT = new Set(["audit-lifecycle"]);
/** Commands whose result decides the exit status (1 when the check fails). */
const CHECKS = { "check-archive": (r) => r.safeToExtract, "audit-lifecycle": (r) => r.ok };

export async function main(argv, signal) {
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    process.stdout.write(USAGE);
    if (!args.help) process.exitCode = 2;
    return;
  }
  if (args.command === "limits") {
    process.stdout.write(JSON.stringify(resolveLimits(args.limits), null, 2) + "\n");
    return;
  }
  const command = COMMANDS[args.command];
  if (!command) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `Unknown command "${args.command}"`, { hint: "Run nexora --help" });
  if (!args.input && !OPTIONAL_INPUT.has(args.command))
    throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `${args.command} needs an input file`);
  const roots = allowedRootsFromEnv();
  const result = await runBounded(args.command, ({ signal: s, limits }) => command(args.input, { limits, signal: s, roots }), {
    limits: args.limits,
    signal,
  });
  const json = JSON.stringify(result, null, 2) + "\n";
  if (Buffer.byteLength(json) > resolveLimits(args.limits).maxOutputBytes) throw new NexoraError(ErrorCodes.LIMIT_EXCEEDED, "Output exceeds configured byte budget");
  if (args.outFile) {
    const limits = resolveLimits(args.limits);
    const path = await writeFileAtomic(args.outFile, json, { maxBytes: limits.maxOutputBytes, roots });
    process.stderr.write(`Wrote ${Buffer.byteLength(json)} bytes to ${path}\n`);
  } else process.stdout.write(json);
  if (CHECKS[args.command] && !CHECKS[args.command](result)) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) await runCli((signal) => main(process.argv.slice(2), signal));
