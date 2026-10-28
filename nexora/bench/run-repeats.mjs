#!/usr/bin/env node
/**
 * Median of N runs for the normal-input cases, before vs after.
 * Usage: node run-repeats.mjs <fixtureDir> <v04RepoRoot> <out.json> [N]
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { measure } from "./measure.mjs";

const [dataDir, v04, outFile, nArg] = process.argv.slice(2);
const N = Number(nArg ?? 3);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(dataDir, "out-repeat.json");
const cases = [
  ["v0.4 rea-session-report session-1m", join(v04, "scripts/rea-session-report.mjs"), [join(dataDir, "session-1m.jsonl"), tmp]],
  ["phase1 rea-session-report session-1m", join(repo, "scripts/rea-session-report.mjs"), [join(dataDir, "session-1m.jsonl"), tmp]],
  ["v0.4 nexora-backend-map session-1m", join(v04, "scripts/nexora-backend-map.mjs"), [join(dataDir, "session-1m.jsonl"), tmp]],
  ["phase1 nexora-backend-map session-1m", join(repo, "scripts/nexora-backend-map.mjs"), [join(dataDir, "session-1m.jsonl"), tmp]],
  ["naive whole-file scan bundle-300mb", join(here, "baseline-naive-bundle-scan.mjs"), [join(dataDir, "bundle-300mb.js")]],
  ["phase1 streaming scan bundle-300mb", join(repo, "nexora/bin/nexora.mjs"), ["scan-bundle", join(dataDir, "bundle-300mb.js"), "--out", tmp]],
];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (const [label, script, args] of cases) {
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(await measure({ label, script, args }));
  const r = { label, runs: N, outcomes: runs.map((x) => x.outcome), medianWallMs: median(runs.map((x) => x.wallMs)), medianPeakRssMb: median(runs.map((x) => x.peakRssMb)) };
  results.push(r);
  process.stderr.write(JSON.stringify(r) + "\n");
}
writeFileSync(outFile, JSON.stringify({ when: new Date().toISOString(), node: process.version, results }, null, 2) + "\n");
