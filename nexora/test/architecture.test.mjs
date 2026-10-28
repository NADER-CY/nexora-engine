import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTempDir, runNode } from './helpers.mjs';
import { analyzeProject } from '../lib/project-analysis.mjs';
import { summarizeArchitecture } from '../lib/architecture-analysis.mjs';

test('project CLI: dependency cycles preserve import evidence and file degrees', async () => withTempDir(async dir => {
  const source = 'import "./b.js"; import "./b.js";';
  await writeFile(join(dir, 'a.js'), source);
  await writeFile(join(dir, 'b.js'), 'import "./a.js";');
  await writeFile(join(dir, 'self.js'), 'import "./self.js";');
  const result = await runNode(['nexora/bin/nexora.mjs', 'analyze-project', dir]);
  assert.equal(result.code, 0, result.stderr);
  const graph = JSON.parse(result.stdout).architecture;
  assert.equal(graph.coverage.complete, true);
  assert.deepEqual(graph.cycles.map(c => c.members).sort(), [['a.js', 'b.js'], ['self.js']]);
  assert.equal(graph.edges.length, 4);
  assert.deepEqual(graph.nodes.find(n => n.file === 'a.js'), { file: 'a.js', incomingFiles: 1, outgoingFiles: 1 });
  for (const e of graph.edges.filter(e => e.from === 'a.js')) {
    assert.equal(Buffer.from(source).subarray(e.evidence.byteOffset, e.evidence.byteOffset + e.evidence.byteLength).toString().includes('./b.js'), true);
  }
}));

test('project: unresolved, external, ambiguous and truncated evidence cannot claim completeness', async () => withTempDir(async dir => {
  await writeFile(join(dir, 'a.js'), 'import "./missing"; import "pkg"; import "./b";');
  await writeFile(join(dir, 'b.js'), '');
  await writeFile(join(dir, 'b.ts'), '');
  const r = await analyzeProject(dir);
  assert.deepEqual(r.architecture.coverage.unresolved, { ambiguous: 1, unresolved: 1, externalOrLanguagePath: 1, unavailableTarget: 0 });
  assert.equal(r.architecture.coverage.complete, false);
  assert.equal(r.architecture.edges.length, 0);
  const limited = await analyzeProject(dir, { limits: { maxInventoryItems: 1 } });
  assert.equal(limited.architecture.coverage.sourceIncomplete, true);
  assert.equal(limited.architecture.coverage.complete, false);
  await writeFile(join(dir, 'a.js'), '/* unterminated');
  assert.equal((await analyzeProject(dir)).architecture.coverage.sourceIncomplete, true);
}));

test('architecture: long chains avoid recursion, omitted graph output is explicit and budgets are checked', () => {
  const files = Array.from({ length: 12000 }, (_, i) => ({ path: String(i) }));
  const deps = files.slice(1).map((f, i) => ({ file: String(i), target: f.path, name: './' + f.path, resolution: 'local-path-candidate' }));
  let checks = 0;
  const opts = { limits: { maxInventoryItems: 20000 }, retained: { remaining: 20_000_000 }, check: () => checks++ };
  const graph = summarizeArchitecture(files, deps, opts);
  assert.equal(graph.nodes.length, 12000); assert.equal(graph.edges.length, 11999);
  assert.equal(graph.cycles.length, 0); assert.equal(graph.coverage.complete, true); assert.ok(checks > files.length);
  const capped = summarizeArchitecture(files.slice(0, 2), deps.slice(0, 1), { ...opts, retained: { remaining: 0 } });
  assert.deepEqual(capped.coverage.dropped, { nodes: 2, edges: 1, cycles: 0 });
  assert.equal(capped.coverage.complete, false);
  assert.throws(() => summarizeArchitecture(files, deps, { ...opts, check() { throw new Error('cancelled'); } }), /cancelled/);
});
