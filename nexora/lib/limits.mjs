/**
 * Configurable resource limits, cancellation, timeouts and concurrency control.
 *
 * Every limit can be overridden per call or via environment variables
 * (NEXORA_<NAME> in SCREAMING_SNAKE_CASE). Values are validated; nonsensical
 * values are rejected rather than silently clamped.
 */
import { NexoraError, ErrorCodes } from "./errors.mjs";

const MB = 1024 * 1024;

export const DEFAULT_LIMITS = Object.freeze({
  /** Largest input file any analyzer will open. */
  maxFileBytes: 2048 * MB,
  /** Longest single JSONL line; longer lines are skipped (and counted) without being buffered. */
  maxLineBytes: 1 * MB,
  /** Maximum JSONL records processed per run. */
  maxRecords: 50_000_000,
  /** Soft heap budget checked during long loops. */
  maxHeapBytes: 768 * MB,
  /** Wall-clock budget for one tool invocation. */
  timeoutMs: 10 * 60 * 1000,
  /** Concurrent tool executions inside one MCP server. */
  concurrency: 2,
  /** Queued invocations waiting for a slot before new ones are rejected. */
  maxQueue: 16,
  /** Largest report/output file written. */
  maxOutputBytes: 64 * MB,
  /** Distinct items retained in any one inventory (endpoints, routes, ...). */
  maxInventoryItems: 5_000,
  /** Bundle scanner read chunk. */
  chunkBytes: 1 * MB,
  /** Longest literal the bundle scanner will capture. */
  maxLiteralBytes: 2048,
});

const POSITIVE_INT_KEYS = Object.keys(DEFAULT_LIMITS);

function envName(key) {
  return "NEXORA_" + key.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase();
}

/** Resolve limits: defaults < environment < explicit overrides. */
export function resolveLimits(overrides = {}, env = process.env) {
  const out = { ...DEFAULT_LIMITS };
  for (const key of POSITIVE_INT_KEYS) {
    const raw = env[envName(key)];
    if (raw !== undefined && raw !== "") out[key] = parsePositive(key, raw);
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) continue;
    if (!POSITIVE_INT_KEYS.includes(key))
      throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `Unknown limit "${key}"`, { hint: `Known limits: ${POSITIVE_INT_KEYS.join(", ")}` });
    out[key] = parsePositive(key, value);
  }
  return Object.freeze(out);
}

function parsePositive(key, value) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
    throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, `Limit "${key}" must be a positive integer`, { details: { key } });
  return n;
}

/** Throw if the signal has been aborted, translating the reason into a NexoraError. */
export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof NexoraError) throw reason;
  throw new NexoraError(ErrorCodes.CANCELLED, "Operation cancelled", { cause: reason });
}

/**
 * Run `fn(signal)` with a deadline. The returned promise rejects with a
 * `timeout` error when the deadline passes and aborts the signal passed to
 * `fn`, so cooperative work stops instead of running on in the background.
 */
export async function withTimeout(fn, { timeoutMs, signal, label = "operation" } = {}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onParentAbort, { once: true });
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    if (!timeoutMs) return;
    timer = setTimeout(() => {
      const err = new NexoraError(ErrorCodes.TIMEOUT, `${label} exceeded ${timeoutMs} ms`, {
        hint: "Increase timeoutMs or reduce the input (e.g. a smaller time window or file).",
        retryable: true,
      });
      controller.abort(err);
      reject(err);
    }, timeoutMs);
    // Not unref'd: the deadline must keep the process alive until it fires or
    // is cleared in `finally`, otherwise a stalled operation never settles.
  });
  const cancelled = new Promise((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        const r = controller.signal.reason;
        reject(r instanceof NexoraError ? r : new NexoraError(ErrorCodes.CANCELLED, `${label} cancelled`, { cause: r }));
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), deadline, cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
    // Release anything still listening on our private signal.
    if (!controller.signal.aborted) controller.abort(new NexoraError(ErrorCodes.CANCELLED, "settled"));
  }
}

/**
 * Bounded concurrency gate with a bounded wait queue. When the queue is full
 * new work is rejected immediately (backpressure) instead of accumulating.
 */
export class ConcurrencyGate {
  constructor({ concurrency, maxQueue }) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.queue = [];
  }

  get stats() {
    return { active: this.active, queued: this.queue.length, concurrency: this.concurrency, maxQueue: this.maxQueue };
  }

  async run(fn, signal) {
    throwIfAborted(signal);
    if (this.active < this.concurrency) this.active++;
    else {
      if (this.queue.length >= this.maxQueue)
        throw new NexoraError(ErrorCodes.LIMIT_EXCEEDED, "Too many concurrent requests", { retryable: true, details: this.stats });
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          const i = this.queue.indexOf(entry);
          if (i >= 0) { this.queue.splice(i, 1); reject(new NexoraError(ErrorCodes.CANCELLED, "Cancelled while queued")); }
        };
        const entry = { resolve: () => { signal?.removeEventListener("abort", onAbort); resolve(); } };
        this.queue.push(entry);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    try {
      // A reserved permit may be cancelled between handoff and continuation.
      throwIfAborted(signal);
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next.resolve(); // Transfer the permit before any new request can acquire it.
      else this.active--;
    }
  }
}

/**
 * Cheap periodic heap check for long loops. Call `tick()` per item; the heap
 * is sampled every `every` calls so the overhead stays negligible.
 */
export function heapGuard(maxHeapBytes, every = 4096) {
  let n = 0;
  return {
    tick() {
      if (++n % every !== 0) return;
      const used = process.memoryUsage().heapUsed;
      if (used > maxHeapBytes)
        throw new NexoraError(ErrorCodes.LIMIT_EXCEEDED, "Heap budget exceeded", {
          hint: "Lower maxInventoryItems, analyze a smaller input, or raise NEXORA_MAX_HEAP_BYTES.",
          details: { heapUsedMb: Math.round(used / 1048576), budgetMb: Math.round(maxHeapBytes / 1048576) },
        });
    },
  };
}

/** A Set/Map wrapper that stops growing at `max` and counts what it dropped. */
export class BoundedCounter {
  constructor(max) {
    this.max = max;
    this.map = new Map();
    this.dropped = 0;
  }
  add(key, n = 1) {
    const cur = this.map.get(key);
    if (cur !== undefined) this.map.set(key, cur + n);
    else if (this.map.size < this.max) this.map.set(key, n);
    else this.dropped++;
  }
  has(key) {
    return this.map.has(key);
  }
  get size() {
    return this.map.size;
  }
  entries() {
    return [...this.map.entries()];
  }
  sorted() {
    return this.entries().sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  }
}
