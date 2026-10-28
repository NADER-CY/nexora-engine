import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { checkedInputFile } from './fs-safe.mjs';
import { resolveLimits, throwIfAborted } from './limits.mjs';
import { NexoraError } from './errors.mjs';
export const invalid = message => new NexoraError('invalid_argument', message);
export function budget(opts = {}) {
  const limits = resolveLimits(opts.limits), started = performance.now();
  return { limits, remaining: () => Math.max(1, Math.floor(limits.timeoutMs - (performance.now() - started))), check() {
    throwIfAborted(opts.signal);
    if (performance.now() - started > limits.timeoutMs) throw new NexoraError('timeout', 'Analysis deadline exceeded');
    if (process.memoryUsage().heapUsed > limits.maxHeapBytes) throw new NexoraError('limit_exceeded', 'Analysis heap budget exceeded');
  } };
}
// Hash and parse through one descriptor; concurrent changes invalidate the report.
export async function withInput(file, opts, operation) {
  const b = budget(opts); b.check();
  const input = await checkedInputFile(file, { maxBytes: b.limits.maxFileBytes, roots: opts.roots });
  const handle = await open(input.path, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > b.limits.maxFileBytes) throw invalid('Expected a size-bounded regular file');
    let readBytes = 0;
    const read = async (offset, length) => {
      b.check();
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > 1048576 || offset > before.size - length) throw invalid('Invalid or truncated file range');
      const out = Buffer.alloc(length); let n = 0;
      while (n < length) { b.check(); const r = await handle.read(out, n, length - n, offset + n); if (!r.bytesRead) throw invalid('Unexpected end of file'); n += r.bytesRead; }
      readBytes += length; return out;
    };
    const hash = createHash('sha256'), chunkBytes = Math.min(b.limits.chunkBytes, 1048576);
    const eachChunk = async (consume = () => {}) => {
      // Reuse the slab: allocating one Buffer per chunk allowed external memory
      // to accumulate until V8's next GC, despite a bounded lexical working set.
      const slab = Buffer.alloc(Math.min(chunkBytes, before.size));
      for (let offset = 0; offset < before.size; offset += chunkBytes) {
        b.check(); const length = Math.min(chunkBytes, before.size - offset); let filled = 0;
        while (filled < length) {
          b.check(); const r = await handle.read(slab, filled, length - filled, offset + filled);
          if (!r.bytesRead) throw invalid('Unexpected end of file'); filled += r.bytesRead;
        }
        readBytes += length; const chunk = slab.subarray(0, length);
        hash.update(chunk); consume(chunk, offset);
        await opts.onProgress?.({ bytes: offset + chunk.length, total: before.size });
      }
      b.check();
    };
    const result = await operation({ ...b, read, eachChunk, size: before.size });
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw invalid('Input changed during analysis');
    b.check();
    return { ...result, input: { sha256: hash.digest('hex'), bytes: before.size }, profile: { analyzer: 'nexora-phase3a/1', limits: b.limits }, io: { readBytes } };
  } finally { await handle.close(); }
}
export function inventory(max, retained) {
  const items = []; let dropped = 0;
  return { items, add(item) { if (items.length < max) {
    const bytes = retained ? Buffer.byteLength(JSON.stringify(item)) : 0;
    if (!retained || bytes <= retained.remaining) { if (retained) retained.remaining -= bytes; items.push(item); return item; }
  } dropped++; return null; }, get dropped() { return dropped; } };
}
export function evidence(start, length, kind = 'observed', confidence = 'high') { return { byteOffset: start, byteLength: length, kind, confidence }; }
