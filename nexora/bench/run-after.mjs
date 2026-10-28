#!/usr/bin/env node
/**
 * AFTER measurements: Phase 1 implementations on the same fixtures and heap
 * settings as run-baseline.mjs.
 * Usage: node run-after.mjs <fixtureDir> <out.json>
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { measure } from "./measure.mjs";

const [dataDir, outFile] = process.argv.slice(2);
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repo, "nexora", "bin", "nexora.mjs");
const tmpOut = join(dataDir, "out-after.json");
const runs = [];
const add = async (spec) => {
  const r = await measure(spec);
  runs.push(r);
  process.stderr.write(JSON.stringify(r) + "\n");
};

for (const heap of [undefined, 256]) {
  await add({ label: `phase1 rea-session-report | session-1m (200MB) | heap ${heap ?? "default"}`, script: join(repo, "scripts/rea-session-report.mjs"), args: [join(dataDir, "session-1m.jsonl"), tmpOut], heapMb: heap });
  await add({ label: `phase1 nexora-backend-map | session-1m (200MB) | heap ${heap ?? "default"}`, script: join(repo, "scripts/nexora-backend-map.mjs"), args: [join(dataDir, "session-1m.jsonl"), tmpOut], heapMb: heap });
  await add({ label: `phase1 rea-session-report | hugeline (600MB single line) | heap ${heap ?? "default"}`, script: join(repo, "scripts/rea-session-report.mjs"), args: [join(dataDir, "session-hugeline-600mb.jsonl"), tmpOut], heapMb: heap });
  await add({ label: `phase1 nexora-backend-map | hugeline (600MB single line) | heap ${heap ?? "default"}`, script: join(repo, "scripts/nexora-backend-map.mjs"), args: [join(dataDir, "session-hugeline-600mb.jsonl"), tmpOut], heapMb: heap });
}
for (const [name, heap] of [["bundle-50mb.js", undefined], ["bundle-300mb.js", undefined], ["bundle-600mb.js", undefined], ["bundle-300mb.js", 256], ["bundle-300mb-multiline.js", undefined]]) {
  await add({ label: `phase1 streaming scan-bundle | ${name} | heap ${heap ?? "default"}`, script: cli, args: ["scan-bundle", join(dataDir, name), "--out", tmpOut], heapMb: heap });
}
writeFileSync(outFile, JSON.stringify({ when: new Date().toISOString(), node: process.version, runs }, null, 2) + "\n");
