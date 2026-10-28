import { inventory } from './analysis-io.mjs';

// Consume project-owned resolution facts; do not reinterpret source or bind calls.
export function summarizeArchitecture(files, dependencies, { limits, retained, check, incomplete = false }) {
  const names = files.filter(f => !f.failed).map(f => f.path).sort();
  const known = new Set(names), forward = new Map(names.map(n => [n, new Set()]));
  const reverse = new Map(names.map(n => [n, new Set()]));
  const edges = inventory(limits.maxInventoryItems, retained);
  const nodes = inventory(limits.maxInventoryItems, retained);
  const cycles = inventory(limits.maxInventoryItems, retained);
  const unresolved = { ambiguous: 0, unresolved: 0, externalOrLanguagePath: 0, unavailableTarget: 0 };
  for (const d of dependencies) {
    check();
    if (d.resolution !== 'local-path-candidate' || !d.target || !known.has(d.file) || !known.has(d.target)) {
      if (d.resolution === 'ambiguous') unresolved.ambiguous++;
      else if (d.resolution === 'external-or-language-path') unresolved.externalOrLanguagePath++;
      else if (d.target) unresolved.unavailableTarget++;
      else unresolved.unresolved++;
      continue;
    }
    // Keep each import site and its evidence, while graph topology deduplicates pairs.
    const edge = edges.add({ from: d.file, to: d.target, specifier: d.name, evidence: d.evidence, resolution: d.resolution });
    if (edge) { forward.get(d.file).add(d.target); reverse.get(d.target).add(d.file); }
  }
  // Iterative Kosaraju avoids call-stack growth on long dependency chains.
  const visited = new Set(), order = [];
  for (const name of names) {
    check(); if (visited.has(name)) continue;
    visited.add(name);
    const stack = [{ name, next: forward.get(name).values() }];
    while (stack.length) {
      check(); const top = stack.at(-1), next = top.next.next();
      if (next.done) { order.push(top.name); stack.pop(); }
      else if (!visited.has(next.value)) { visited.add(next.value); stack.push({ name: next.value, next: forward.get(next.value).values() }); }
    }
  }
  visited.clear();
  for (let i = order.length - 1; i >= 0; i--) {
    check(); const name = order[i]; if (visited.has(name)) continue;
    const members = [], stack = [name]; visited.add(name);
    while (stack.length) {
      check(); const current = stack.pop(); members.push(current);
      for (const prior of reverse.get(current)) if (!visited.has(prior)) { visited.add(prior); stack.push(prior); }
    }
    if (members.length > 1 || forward.get(name).has(name)) cycles.add({ members: members.sort(), kind: 'strongly-connected-dependency-candidates' });
  }
  for (const name of names) {
    check(); nodes.add({ file: name, incomingFiles: reverse.get(name).size, outgoingFiles: forward.get(name).size });
  }
  return { schema: 'nexora-architecture/v1', nodes: nodes.items, edges: edges.items, cycles: cycles.items,
    coverage: { complete: !incomplete && !edges.dropped && !nodes.dropped && !cycles.dropped && !Object.values(unresolved).some(Boolean),
      sourceIncomplete: incomplete, unresolved, dropped: { nodes: nodes.dropped, edges: edges.dropped, cycles: cycles.dropped } },
    limitations: ['Static relative-path candidates only; cycles describe file dependencies, not runtime calls.',
      'Missing, external, ambiguous, failed or dropped facts prevent complete architecture coverage. Degrees and cycles use retained edges only.'] };
}
