import { NexoraError } from './errors.mjs';
import { extname } from 'node:path';
import { withInput, inventory, evidence, invalid } from './analysis-io.mjs';
const LANG = { '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.go': 'go', '.rs': 'rust', '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp' };
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'sizeof', 'alignof', 'decltype', 'return', 'match', 'select', 'func', 'function']);
// Byte lexer: comments are discarded and tokens bounded even on minified lines.
export function lexer(emit, maxToken = 2048) {
  let mode = 'code', start = 0, line = 1, startLine = 1, value = [], length = 0, quote = 0, escape = false, previous = 0;
  const append = c => { length++; if (value.length < maxToken) value.push(c); };
  const begin = (m, c, at) => { mode = m; start = at; startLine = line; value = []; length = 0; if (c !== null) append(c); };
  const flush = (end, kind = mode) => { emit({ kind, value: Buffer.from(value).toString('utf8'), start, end, line: startLine, truncated: length > maxToken }); value = []; length = 0; mode = 'code'; };
  const id = c => c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95 || c === 36 || c >= 128;
  const digit = c => c >= 48 && c <= 57;
  function byte(c, at) {
    if (mode === 'lineComment') { if (c === 10) mode = 'code'; }
    else if (mode === 'blockComment') { if (previous === 42 && c === 47) { mode = 'code'; c = 0; } }
    else if (mode === 'slash') {
      if (c === 47) mode = 'lineComment'; else if (c === 42) { mode = 'blockComment'; c = 0; }
      else { flush(at, 'punct'); byte(c, at); return; }
    } else if (mode === 'string') {
      if (c === quote && !escape) flush(at + 1, 'string');
      else { append(c); if (escape) escape = false; else if (c === 92 && quote !== 96) escape = true; }
    } else if (mode === 'id' || mode === 'number') {
      if (id(c) || digit(c) || mode === 'number' && c === 46) append(c);
      else { flush(at); byte(c, at); return; }
    } else if (c === 47) begin('slash', c, at);
    else if (c === 34 || c === 39 || c === 96) { begin('string', null, at); quote = c; escape = false; }
    else if (id(c)) begin('id', c, at);
    else if (digit(c)) begin('number', c, at);
    else if (c > 32) { begin('punct', c, at); flush(at + 1); }
    if (c === 10) line++; previous = c;
  }
  return { chunk(buf, offset) { for (let i = 0; i < buf.length; i++) byte(buf[i], offset + i); }, end(offset) { if (['id', 'number', 'slash'].includes(mode)) flush(offset); return { unterminated: mode === 'string' || mode === 'blockComment' }; } };
}
export async function analyzeSource(file, opts = {}) {
  const language = opts.language ?? LANG[extname(file).toLowerCase()];
  if (!Object.values(LANG).includes(language)) throw invalid('Unsupported source extension or language');
  return withInput(file, opts, async ({ limits, eachChunk, size, check }) => {
    const retained = { remaining: limits.maxOutputBytes };
    const symbols = inventory(limits.maxInventoryItems, retained), calls = inventory(limits.maxInventoryItems, retained), dependencies = inventory(limits.maxInventoryItems, retained);
    const scopes = []; let depth = 0, tokens = 0, droppedTokens = 0, longHeaders = 0;
    let header = [], importMode = false, pendingCalls = [];
    const flushCalls = () => { for (const c of pendingCalls) calls.add(c); pendingCalls = []; };
    const current = () => scopes.at(-1)?.id ?? null;
    const lex = lexer(t => {
      if (++tokens > limits.maxRecords) throw new NexoraError('limit_exceeded', 'Source token budget exceeded');
      if (tokens % 4096 === 0) check();
      if (t.truncated) { droppedTokens++; header = []; return; }
      const prev = header.at(-1);
      if (t.kind === 'id' && ['import', 'from', 'require', 'include', 'use', 'mod'].includes(t.value)) importMode = true;
      if (importMode && ['c', 'cpp'].includes(language) && t.value === '>') {
        const left = header.findIndex(x => x.value === '<');
        if (left >= 0) { dependencies.add({ name: header.slice(left + 1).map(x => x.value).join(''), relation: 'system-include', evidence: evidence(header[left].start, t.end - header[left].start) }); importMode = false; }
      }
      if (importMode && t.kind === 'string') dependencies.add({ name: t.value, evidence: evidence(t.start, t.end - t.start), relation: 'literal-import' });
      if (t.kind === 'string') { if (header.length === 256) { header.shift(); longHeaders++; } header.push(t); return; }
      if (t.value === ';' || t.value === '}') {
        if (importMode && language === 'rust') {
          const at = header.findIndex(x => x.value === 'use' || x.value === 'mod');
          if (at >= 0) dependencies.add({ name: header.slice(at + 1).map(x => x.value).join(''), relation: 'module-path', evidence: evidence(header[at].start, t.end - header[at].start) });
        }
        importMode = false;
      }
      if (t.value === '(' && prev?.kind === 'id' && !CONTROL.has(prev.value)) {
        const qualifier = header.at(-2)?.value;
        if (pendingCalls.length === 256) calls.add(pendingCalls.shift());
        pendingCalls.push({ name: prev.value, caller: current(), resolution: qualifier === '.' || qualifier === ':' ? 'qualified-unknown' : 'pending', evidence: evidence(prev.start, prev.end - prev.start, 'inferred', 'medium') });
      }
      if (t.value === '{') {
        depth++;
        const texts = header.map(x => x.kind === 'string' ? '[literal]' : x.value); let nameToken;
        const keyword = texts.findIndex(x => ['function', 'fn', 'func'].includes(x));
        if (keyword >= 0) {
          let after = header.slice(keyword + 1);
          if (language === 'go' && after[0]?.value === '(') { const close = after.findIndex(x => x.value === ')'); after = after.slice(close + 1); }
          // Anonymous functions do not inherit a parameter's name.
          if (after[0]?.kind === 'id') nameToken = after[0];
        } else if (texts.at(-1) === '>' && texts.at(-2) === '=') {
          const equal = texts.indexOf('='); nameToken = header.slice(0, equal).reverse().find(x => x.kind === 'id');
        } else {
          const paren = texts.indexOf('('), candidate = header[paren - 1];
          if (paren > 0 && texts.includes(')') && candidate?.kind === 'id' && !CONTROL.has(candidate.value) && !texts.slice(0, paren).some(x => ['=', '.', 'return', 'new'].includes(x))) nameToken = candidate;
        }
        if (nameToken && !CONTROL.has(nameToken.value)) {
          const id = `function@${nameToken.start}`;
          const symbol = symbols.add({ id, name: nameToken.value, kind: 'function', parent: current(), line: nameToken.line, evidence: evidence(nameToken.start, nameToken.end - nameToken.start, 'inferred', 'medium'), body: { byteOffset: t.start, byteLength: null } });
          pendingCalls = pendingCalls.filter(c => c.evidence.byteOffset !== nameToken.start);
          if (scopes.length < 1024) scopes.push({ depth, id: symbol?.id ?? null, symbol }); else throw new NexoraError('limit_exceeded', 'Function nesting exceeds 1024 levels');
        }
        flushCalls(); importMode = false; header = [];
      } else if (t.value === '}') {
        flushCalls();
        if (scopes.at(-1)?.depth === depth) { const s = scopes.pop().symbol; if (s) s.body.byteLength = t.end - s.body.byteOffset; }
        depth = Math.max(0, depth - 1); header = [];
      } else if (t.value === ';') { flushCalls(); header = []; }
      else { if (header.length === 256) { header.shift(); longHeaders++; } header.push(t); }
    }, Math.min(limits.maxLiteralBytes, 8192));
    await eachChunk((chunk, at) => lex.chunk(chunk, at));
    const lexical = lex.end(size); flushCalls(); const byName = new Map();
    for (const s of symbols.items) { const a = byName.get(s.name) ?? []; a.push(s.id); byName.set(s.name, a); }
    for (const c of calls.items) {
      const matches = byName.get(c.name) ?? [];
      if (c.resolution === 'pending' && symbols.dropped) c.resolution = 'truncated-symbol-inventory';
      c.callee = c.resolution === 'pending' && matches.length === 1 ? matches[0] : null;
      if (c.resolution === 'pending') c.resolution = c.callee ? 'unique-name-candidate' : matches.length ? 'ambiguous' : 'unresolved';
    }
    const symbolIndex = new Map(symbols.items.map(s => { s.incomingCalls = []; s.outgoingCalls = []; return [s.id, s]; }));
    for (const c of calls.items) { c.id = `call@${c.evidence.byteOffset}`; symbolIndex.get(c.caller)?.outgoingCalls.push(c.id); symbolIndex.get(c.callee)?.incomingCalls.push(c.id); }
    return { schema: 'nexora-source-analysis/v1', language, symbols: symbols.items, calls: calls.items, dependencies: dependencies.items,
      coverage: { tokens, droppedTokens, longHeaders, unterminatedLexeme: lexical.unterminated, unclosedFunctions: scopes.length, dropped: { symbols: symbols.dropped, calls: calls.dropped, dependencies: dependencies.dropped } },
      limitations: ['Lexical candidates, not compiler name binding or runtime calls.', 'Macros, templates, regex literals, interpolated/raw strings, closures, overloads, indirect calls and conditional compilation may be incomplete.', 'Imports are literal/module references; no dependency fetching or package execution.'] };
  });
}
