#!/usr/bin/env node
/**
 * BEFORE measurements: v0.4 add-on scripts (as received) and the naive
 * whole-file bundle reader, on the synthetic fixtures.
 * Usage: node run-baseline.mjs <fixtureDir> <v04RepoRoot> <out.json>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { measure } from "./measure.mjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const [dataDir, v04, outFile] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const tmpOut = join(dataDir, "out-baseline.json");
const runs = [];
const add = async (spec) => {
  const r = await measure(spec);
  runs.push(r);
  process.stderr.write(JSON.stringify(r) + "\n");
};

for (const heap of [undefined, 256]) {
  await add({ label: `v0.4 rea-session-report | session-1m (200MB) | heap ${heap ?? "default"}`, script: join(v04, "scripts/rea-session-report.mjs"), args: [join(dataDir, "session-1m.jsonl"), tmpOut], heapMb: heap });
  await add({ label: `v0.4 nexora-backend-map | session-1m (200MB) | heap ${heap ?? "default"}`, script: join(v04, "scripts/nexora-backend-map.mjs"), args: [join(dataDir, "session-1m.jsonl"), tmpOut], heapMb: heap });
  await add({ label: `v0.4 rea-session-report | hugeline (600MB single line) | heap ${heap ?? "default"}`, script: join(v04, "scripts/rea-session-report.mjs"), args: [join(dataDir, "session-hugeline-600mb.jsonl"), tmpOut], heapMb: heap });
  await add({ label: `v0.4 nexora-backend-map | hugeline (600MB single line) | heap ${heap ?? "default"}`, script: join(v04, "scripts/nexora-backend-map.mjs"), args: [join(dataDir, "session-hugeline-600mb.jsonl"), tmpOut], heapMb: heap });
}
for (const [name, heap] of [["bundle-50mb.js", undefined], ["bundle-300mb.js", undefined], ["bundle-600mb.js", undefined], ["bundle-300mb.js", 256], ["bundle-300mb-multiline.js", undefined]]) {
  await add({ label: `naive whole-file scan | ${name} | heap ${heap ?? "default"}`, script: join(here, "baseline-naive-bundle-scan.mjs"), args: [join(dataDir, name)], heapMb: heap });
}
writeFileSync(outFile, JSON.stringify({ when: new Date().toISOString(), node: process.version, runs }, null, 2) + "\n");
