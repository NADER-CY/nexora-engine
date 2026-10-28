#!/usr/bin/env node
/**
 * BASELINE REFERENCE ONLY — the whole-file buffering pattern that NEXORA's
 * streaming scanner replaces: read the entire bundle into one string, then
 * run global regexes over it. Kept solely for before/after benchmarking.
 */
import { readFileSync } from "node:fs";

const text = readFileSync(process.argv[2], "utf8");
const found = new Set();
for (const m of text.matchAll(/["'`]((?:https?:\/\/[^"'`\s]+)?\/api\/[^"'`\s?]+)/g)) found.add(m[1]);
for (const m of text.matchAll(/["'`](wss?:\/\/[^"'`\s]+)/g)) found.add(m[1]);
for (const m of text.matchAll(/path:\s*["'`](\/[^"'`]+)/g)) found.add(m[1]);
process.stdout.write(JSON.stringify({ count: found.size }) + "\n");
