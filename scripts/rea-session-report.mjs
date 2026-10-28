#!/usr/bin/env node
/**
 * Compatibility entry point (v0.4 command line preserved):
 *   node scripts/rea-session-report.mjs <input.jsonl> <summary.json>
 * Implementation: nexora/lib/session-report.mjs (bounded streaming reader).
 * Prefer: nexora summary <input.jsonl> --out <summary.json>
 */
import { isMainModule } from "../nexora/lib/entry.mjs";
import { runBounded, runCli } from "../nexora/lib/run.mjs";
import { writeFileAtomic, allowedRootsFromEnv } from "../nexora/lib/fs-safe.mjs";
import { resolveLimits } from "../nexora/lib/limits.mjs";
import { NexoraError, ErrorCodes } from "../nexora/lib/errors.mjs";
import { summarize } from "../nexora/lib/session-report.mjs";

export { sanitizePath, summarize } from "../nexora/lib/session-report.mjs";

if (isMainModule(import.meta.url)) {
  await runCli(async (signal) => {
    const [input, output] = process.argv.slice(2);
    if (!input || !output)
      throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, "Usage: node scripts/rea-session-report.mjs <input.jsonl> <summary.json>");
    const roots = allowedRootsFromEnv();
    const result = await runBounded("summary", ({ signal: s, limits }) => summarize(input, { limits, signal: s, roots }), { signal });
    await writeFileAtomic(output, JSON.stringify(result, null, 2) + "\n", { maxBytes: resolveLimits().maxOutputBytes, roots });
    console.log(`Summary created (${result.totalLines} lines, ${result.pagePaths.length} paths): ${output}`);
  });
}
