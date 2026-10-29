import { withInput, inventory, evidence, invalid, budget } from './analysis-io.mjs';
// Consumes the JSONL producer below, not arbitrary decompiler stdout.
export async function ghidraReport(file, opts = {}) {
  const overall = budget(opts);
  const report = await withInput(file, opts, async ({ eachChunk, limits, check }) => {
    const retained = { remaining: limits.maxOutputBytes };
    const functions = inventory(limits.maxInventoryItems, retained), references = inventory(limits.maxInventoryItems, retained), failures = inventory(limits.maxInventoryItems, retained);
    let functionRecords = 0;
    let header, footer, pending = Buffer.alloc(0), offset = 0, records = 0, oversized = 0, dropping = false;
    function line(buf, at) {
      check(); if (++records > limits.maxRecords) throw invalid('Ghidra record budget exceeded');
      let r; try { r = JSON.parse(buf.toString('utf8')); } catch { throw invalid('Invalid Ghidra JSONL record'); }
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw invalid('Invalid Ghidra record shape');
      if (!header) {
        if (r.kind !== 'header' || r.schema !== 'nexora-ghidra-export/v1' || !/^[a-f0-9]{64}$/i.test(r.binarySha256 ?? '')) throw invalid('Ghidra header must bind the original binary SHA-256');
        header = r; return;
      }
      if (footer) throw invalid('Records after Ghidra footer');
      const ev = evidence(at, buf.length, 'provider-reported', 'medium');
      if (r.kind === 'function') {
        functionRecords++;
        if (typeof r.address !== 'string' || r.address.length > 128 || typeof r.name !== 'string' || r.name.length > 2048 || typeof r.status !== 'string' || !['ok','failed'].includes(r.status) || (r.pseudocode !== undefined && typeof r.pseudocode !== 'string')) throw invalid('Invalid Ghidra function record');
        functions.add({ address: r.address, name: r.name, status: r.status, pseudocode: r.pseudocode ?? null, message: typeof r.message === 'string' ? r.message.slice(0, 2048) : null, evidence: ev });
        if (r.status !== 'ok') failures.add({ address: r.address, reason: 'decompilation-failed', evidence: ev });
      } else if (r.kind === 'reference') {
        if (![r.from,r.to,r.type].every(x => typeof x === 'string' && x.length <= 128)) throw invalid('Invalid Ghidra reference record');
        references.add({ from: r.from, to: r.to, type: r.type, evidence: ev });
      } else if (r.kind === 'footer') {
        if (!Number.isSafeInteger(r.functions) || r.functions < 0 || typeof r.complete !== 'boolean') throw invalid('Invalid Ghidra footer');
        footer = r;
      } else throw invalid('Unknown Ghidra record kind');
    }
    await eachChunk((chunk, base) => {
      let start = 0;
      for (let i = 0; i <= chunk.length; i++) {
        if (i !== chunk.length && chunk[i] !== 10) continue;
        const part = chunk.subarray(start, i);
        if (!dropping && pending.length + part.length > limits.maxLineBytes) { dropping = true; oversized++; pending = Buffer.alloc(0); }
        if (!dropping) pending = pending.length ? Buffer.concat([pending, part]) : Buffer.from(part);
        if (i < chunk.length) { if (!dropping && pending.length) line(pending, offset); pending = Buffer.alloc(0); dropping = false; offset = base + i + 1; }
        start = i + 1;
      }
    });
    if (!dropping && pending.length) line(pending, offset);
    if (!header) throw invalid('Missing Ghidra header');
    return { schema: 'nexora-ghidra-report/v1', binarySha256: header.binarySha256, provider: { name: 'Ghidra', version: typeof header.version === 'string' ? header.version.slice(0,128) : 'unknown' }, functions: functions.items, references: references.items, failures: failures.items,
      coverage: { records, oversizedRecords: oversized, producerComplete: footer?.complete ?? false, reportComplete: !!footer?.complete && footer.functions === functionRecords && !oversized && !functions.dropped && !references.dropped && !failures.dropped, footerPresent: !!footer, declaredFunctions: footer?.functions ?? null, dropped: { functions: functions.dropped, references: references.dropped, failures: failures.dropped } },
      limitations: ['Offline provider export; binary digest is producer-reported, not independently verified against binary bytes by this command.', 'Decompiler output is derived pseudocode, not original source. Missing footer or oversized/dropped records means incomplete coverage.'] };
  });
  report.binaryIdentity = { status: 'provider-claimed', sha256: report.binarySha256.toLowerCase() };
  if (opts.binaryFile) {
    const observed = await withInput(opts.binaryFile, { ...opts, limits: { ...overall.limits, timeoutMs: overall.remaining() } }, async io => { await io.eachChunk(); return {}; });
    overall.check();
    if (observed.input.sha256 !== report.binarySha256.toLowerCase()) throw invalid('Ghidra binary SHA-256 does not match the supplied binary');
    report.binaryIdentity = { status: 'matched-supplied-binary', ...observed.input };
    report.limitations[0] = 'Export header digest matches independently hashed supplied bytes; this does not authenticate the producer or pseudocode.';
  }
  return report;
}
