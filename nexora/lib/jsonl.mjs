/**
 * Bounded-memory JSONL reading and writing.
 *
 * Reader: splits raw byte chunks on '\n' itself instead of using readline, so
 * a line longer than `maxLineBytes` is skipped as it streams past rather than
 * being accumulated into one giant string (the failure mode of readline-based
 * readers, which buffer the whole line before any length check can run).
 *
 * Writer: owner-only file, honours stream backpressure, enforces a total byte
 * cap and a bounded in-memory queue for producers that cannot be slowed down
 * (e.g. browser events). Dropped records are counted, never silent.
 */
import { createReadStream, createWriteStream, promises as fsp } from "node:fs";
import { once } from "node:events";
import { dirname } from "node:path";
import { NexoraError, ErrorCodes } from "./errors.mjs";
import { throwIfAborted, heapGuard } from "./limits.mjs";

const NL = 0x0a;

/**
 * Iterate JSON records of a JSONL file.
 * Yields `{ record, line }` for each valid object. Statistics are written to
 * `stats` (pass an object to receive them, even when iteration stops early).
 *
 * @param {string} path
 * @param {{maxLineBytes?: number, maxRecords?: number, chunkBytes?: number,
 *          maxHeapBytes?: number, signal?: AbortSignal, stats?: object}} [opts]
 */
export async function* readJsonl(path, opts = {}) {
  const maxLine = opts.maxLineBytes ?? 1024 * 1024;
  const maxRecords = opts.maxRecords ?? Infinity;
  const stats = Object.assign(opts.stats ?? {}, {
    lines: 0,
    records: 0,
    blank: 0,
    invalidJson: 0,
    nonObject: 0,
    oversizedLines: 0,
    bytesRead: 0,
    truncatedAtMaxRecords: false,
  });
  const guard = opts.maxHeapBytes ? heapGuard(opts.maxHeapBytes) : null;
  const stream = createReadStream(path, { highWaterMark: opts.chunkBytes ?? 1024 * 1024 });
  /** @type {Buffer[]} */
  let parts = [];
  let partLen = 0;
  let skipping = false;

  function* finishLine(buf) {
    stats.lines++;
    // Fast blank check without decoding.
    let blank = true;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c !== 0x20 && c !== 0x09 && c !== 0x0d) {
        blank = false;
        break;
      }
    }
    if (blank) {
      stats.blank++;
      return;
    }
    let value;
    try {
      value = JSON.parse(buf.toString("utf8"));
    } catch {
      stats.invalidJson++;
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      stats.nonObject++;
      return;
    }
    stats.records++;
    yield { record: value, line: stats.lines };
  }

  try {
    for await (const chunk of stream) {
      throwIfAborted(opts.signal);
      stats.bytesRead += chunk.length;
      let start = 0;
      while (start < chunk.length) {
        const nl = chunk.indexOf(NL, start);
        const end = nl === -1 ? chunk.length : nl;
        if (skipping) {
          if (nl !== -1) {
            skipping = false;
            stats.lines++;
          }
        } else {
          const piece = chunk.subarray(start, end);
          if (partLen + piece.length > maxLine) {
            // Oversized: drop what we have and skip to the next newline.
            parts = [];
            partLen = 0;
            stats.oversizedLines++;
            if (nl === -1) skipping = true;
            else stats.lines++;
          } else if (nl === -1) {
            // Copy: the chunk buffer may be reused by the stream.
            parts.push(Buffer.from(piece));
            partLen += piece.length;
          } else {
            const line = partLen === 0 ? piece : Buffer.concat([...parts, piece], partLen + piece.length);
            parts = [];
            partLen = 0;
            for (const item of finishLine(line)) {
              guard?.tick();
              yield item;
              if (stats.records >= maxRecords) {
                stats.truncatedAtMaxRecords = true;
                return;
              }
            }
          }
        }
        if (nl === -1) break;
        start = nl + 1;
      }
    }
    if (!skipping && partLen > 0) {
      for (const item of finishLine(Buffer.concat(parts, partLen))) yield item;
    } else if (skipping) stats.lines++;
  } finally {
    stream.destroy();
  }
}

/**
 * Append-only JSONL writer with a byte cap and bounded queue.
 */
export class BoundedJsonlWriter {
  /**
   * @param {string} path
   * @param {{maxBytes?: number, maxQueue?: number, mode?: number}} [opts]
   */
  constructor(path, opts = {}) {
    this.path = path;
    this.maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
    this.maxQueue = opts.maxQueue ?? 10_000;
    this.mode = opts.mode ?? 0o600;
    this.bytes = 0;
    this.written = 0;
    this.dropped = { queueFull: 0, byteCap: 0, oversized: 0 };
    this.truncated = false;
    this.queue = [];
    this.pumping = null;
    this.stream = null;
    this.closed = false;
  }

  async open() {
    await fsp.mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    this.stream = createWriteStream(this.path, { flags: "a", mode: this.mode });
    await once(this.stream, "open");
    try {
      this.bytes = (await fsp.stat(this.path)).size;
    } catch {
      this.bytes = 0;
    }
    return this;
  }

  /** Queue one record. Never throws for capacity reasons; returns false if dropped. */
  write(record) {
    if (this.closed) return false;
    if (this.truncated) {
      this.dropped.byteCap++;
      return false;
    }
    if (this.queue.length >= this.maxQueue) {
      this.dropped.queueFull++;
      return false;
    }
    let line;
    try {
      line = JSON.stringify(record) + "\n";
    } catch {
      this.dropped.oversized++;
      return false;
    }
    if (line.length > 4 * 1024 * 1024) {
      this.dropped.oversized++;
      return false;
    }
    this.queue.push(line);
    if (!this.pumping) this.pumping = this.#pump();
    return true;
  }

  async #pump() {
    // Yield first: if the queue drained synchronously, `finally` would clear
    // `pumping` before the caller assigns the returned promise, leaving a
    // settled promise in place so later writes never restart the pump.
    await null;
    try {
      while (this.queue.length) {
        const line = this.queue.shift();
        const len = Buffer.byteLength(line);
        if (this.bytes + len > this.maxBytes) {
          this.truncated = true;
          this.dropped.byteCap += 1 + this.queue.length;
          this.queue = [];
          break;
        }
        this.bytes += len;
        this.written++;
        if (!this.stream.write(line)) await once(this.stream, "drain");
      }
    } finally {
      this.pumping = null;
    }
  }

  async flush() {
    while (this.pumping) await this.pumping;
  }

  async close() {
    if (this.closed) return this.summary();
    await this.flush();
    this.closed = true;
    if (this.stream) {
      this.stream.end();
      await once(this.stream, "finish").catch(() => {});
    }
    return this.summary();
  }

  summary() {
    return { path: this.path, bytes: this.bytes, records: this.written, truncated: this.truncated, dropped: { ...this.dropped } };
  }
}

export function assertJsonlWritable(writer) {
  if (!writer?.stream) throw new NexoraError(ErrorCodes.STATE, "JSONL writer is not open");
}
