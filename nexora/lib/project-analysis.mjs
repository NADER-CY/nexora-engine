import { opendir } from 'node:fs/promises';
import { relative, resolve, dirname, extname, join } from 'node:path';
import { safePath } from './fs-safe.mjs';
import { analyzeSource } from './source-analysis.mjs';
import { budget, inventory } from './analysis-io.mjs';
import { summarizeArchitecture } from './architecture-analysis.mjs';
const EXT = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.go','.rs','.c','.h','.cpp','.cc','.cxx','.hpp']);
const SKIP = new Set(['.git','node_modules','target','dist','.cache']);
export async function analyzeProject(root, opts = {}) {
  const b = budget(opts), base = await safePath(root, { roots: opts.roots, mustExist: true, kind: 'dir' });
  const retained = { remaining: b.limits.maxOutputBytes };
  const files = inventory(b.limits.maxInventoryItems, retained), symbols = inventory(b.limits.maxInventoryItems, retained), calls = inventory(b.limits.maxInventoryItems, retained), dependencies = inventory(b.limits.maxInventoryItems, retained), failures = inventory(b.limits.maxInventoryItems, retained);
  let visited = 0, truncated = false;
  async function walk(dir, depth = 0) {
    if (depth > 64) { truncated = true; return; }
    const entries = await opendir(dir);
    for await (const entry of entries) {
      b.check(); if (++visited > b.limits.maxRecords) { truncated = true; break; }
      if (entry.isDirectory() && !SKIP.has(entry.name)) await walk(join(dir, entry.name), depth + 1);
      else if (entry.isFile() && EXT.has(extname(entry.name).toLowerCase())) {
        if (files.items.length >= b.limits.maxInventoryItems) { truncated = true; break; }
        const path = join(dir, entry.name), name = relative(base, path).replaceAll('\\', '/');
        try {
          const report = await analyzeSource(path, { ...opts, limits: { ...b.limits, timeoutMs: b.remaining() } });
          if (!files.add({ path: name, input: report.input, coverage: report.coverage })) { truncated = true; return; }
          for (const s of report.symbols) symbols.add({ ...s, file: name, id: `${name}#${s.id}`, parent: s.parent ? `${name}#${s.parent}` : null, incomingCalls: s.incomingCalls.map(id => `${name}#${id}`), outgoingCalls: s.outgoingCalls.map(id => `${name}#${id}`) });
          for (const c of report.calls) calls.add({ ...c, id: `${name}#${c.id}`, file: name, caller: c.caller ? `${name}#${c.caller}` : null, callee: c.callee ? `${name}#${c.callee}` : null });
          for (const d of report.dependencies) dependencies.add({ ...d, file: name });
        } catch (e) {
          if (['cancelled','timeout','limit_exceeded'].includes(e.code)) throw e;
          files.add({ path: name, failed: true }); failures.add({ file: name, code: e.code ?? 'analysis_failed', message: String(e.message).slice(0, 200) });
        }
      }
      if (files.items.length >= b.limits.maxInventoryItems || truncated) { truncated = true; break; }
    }
  }
  await walk(base); b.check();
  const names = new Set(files.items.map(f => f.path));
  for (const d of dependencies.items) {
    if (!d.name.startsWith('.')) { d.target = null; d.resolution = 'external-or-language-path'; continue; }
    const stem = relative(base, resolve(base, dirname(d.file), d.name)).replaceAll('\\', '/');
    const candidates = [stem, ...[...EXT].map(e => stem + e), ...['.js','.ts'].map(e => stem + '/index' + e)].filter(x => names.has(x));
    d.target = candidates.length === 1 ? candidates[0] : null; d.resolution = d.target ? 'local-path-candidate' : candidates.length ? 'ambiguous' : 'unresolved';
  }
  const architecture = summarizeArchitecture(files.items, dependencies.items, { limits: b.limits, retained, check: () => b.check(),
    incomplete: truncated || !!files.dropped || !!dependencies.dropped || !!failures.items.length || !!failures.dropped || files.items.some(f => f.coverage && (f.coverage.unterminatedLexeme || f.coverage.unclosedFunctions || f.coverage.longHeaders || Object.values(f.coverage.dropped ?? {}).some(Boolean) || f.coverage.droppedTokens)) });
  return { schema: 'nexora-project-analysis/v1', architecture, files: files.items, symbols: symbols.items, calls: calls.items, dependencies: dependencies.items, failures: failures.items,
    coverage: { visitedEntries: visited, traversalTruncated: truncated, skippedDirectories: [...SKIP], symlinks: 'not followed', dropped: { files: files.dropped, symbols: symbols.dropped, calls: calls.dropped, dependencies: dependencies.dropped, failures: failures.dropped } },
    profile: { analyzer: 'nexora-phase3a/1', limits: b.limits }, limitations: ['Sequential bounded file analysis; lexical candidates only.', 'Relative dependency paths are candidates, without package-manager, compiler or tsconfig resolution.', 'Calls remain bound within each file; cross-file name-only binding is deliberately unresolved.'] };
}
