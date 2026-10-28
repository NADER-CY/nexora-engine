#!/usr/bin/env node
/**
 * Compatibility entry point (v0.4 command line preserved):
 *   node scripts/nexora-backend-map.mjs <session.jsonl> [output.json]
 * Implementation: nexora/lib/backend-map.mjs (bounded streaming reader).
 * Prefer: nexora backend-map <session.jsonl> --out <output.json>
 */
import { isMainModule } from "../nexora/lib/entry.mjs";
import { runBounded, runCli } from "../nexora/lib/run.mjs";
import { writeFileAtomic, allowedRootsFromEnv } from "../nexora/lib/fs-safe.mjs";
import { resolveLimits } from "../nexora/lib/limits.mjs";
import { NexoraError, ErrorCodes } from "../nexora/lib/errors.mjs";
import { mapSession } from "../nexora/lib/backend-map.mjs";

export { mapSession } from "../nexora/lib/backend-map.mjs";

if (isMainModule(import.meta.url)) {
  await runCli(async (signal) => {
    const [infile, outfile] = process.argv.slice(2);
    if (!infile) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, "Usage: node scripts/nexora-backend-map.mjs <session.jsonl> [output.json]");
    const roots = allowedRootsFromEnv();
    const report = await runBounded("backend-map", ({ signal: s, limits }) => mapSession(infile, { limits, signal: s, roots }), { signal });
    const json = JSON.stringify(report, null, 2) + "\n";
    if (outfile) await writeFileAtomic(outfile, json, { maxBytes: resolveLimits().maxOutputBytes, roots });
    else process.stdout.write(json);
  });
}
