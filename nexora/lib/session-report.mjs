/**
 * Offline aggregate summary of a JSONL session file (schema
 * rea-session-summary/v1, unchanged from v0.4). Now built on the bounded
 * JSONL reader: oversized lines are skipped without being buffered, the
 * input size is checked up front, and the run honours limits/cancellation.
 */
import { readJsonl } from "./jsonl.mjs";
import { checkedInputFile } from "./fs-safe.mjs";
import { resolveLimits } from "./limits.mjs";

export function sanitizePath(input) {
  if (typeof input !== "string" || !input) return null;
  try {
    const url = new URL(input, "https://local.invalid");
    // Do not record query, fragment, credentials, account IDs or amounts.
    return url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        if (/^(?:\d{5,}|[0-9a-f]{16,}|[a-zA-Z0-9_-]{32,})$/i.test(segment)) return ":redacted";
        return segment.slice(0, 80);
      })
      .join("/")
      .replace(/^/, "/")
      .slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * @param {string} input path to JSONL
 * @param {{limits?: object, signal?: AbortSignal, roots?: string[]}} [opts]
 */
export async function summarize(input, opts = {}) {
  const limits = resolveLimits(opts.limits);
  const { path } = await checkedInputFile(input, { maxBytes: limits.maxFileBytes, roots: opts.roots });
  const counts = Object.create(null);
  const paths = new Set();
  let first = null;
  let last = null;
  const stats = {};
  for await (const { record: event } of readJsonl(path, {
    maxLineBytes: limits.maxLineBytes,
    maxRecords: limits.maxRecords,
    chunkBytes: limits.chunkBytes,
    maxHeapBytes: limits.maxHeapBytes,
    signal: opts.signal,
    stats,
  })) {
    const kind = String(event.kind ?? event.type ?? event.event ?? "unknown").slice(0, 64);
    if (/^[\w.:-]{1,64}$/.test(kind)) counts[kind] = (counts[kind] ?? 0) + 1;
    const url = event.url ?? event.path ?? event.page?.path ?? event.page?.url ?? event.target?.url;
    const sanitized = sanitizePath(url);
    if (sanitized && paths.size < 200) paths.add(sanitized);
    const time = event.observedAt ?? event.timestamp ?? event.time ?? event.ts;
    if (typeof time === "string" && /^\d{4}-\d\d-\d\dT/.test(time)) {
      if (!first) first = time;
      last = time;
    }
  }
  const nonBlank = stats.lines - stats.blank;
  return {
    schema: "rea-session-summary/v1",
    totalLines: nonBlank,
    invalidLines: stats.invalidJson + stats.nonObject + stats.oversizedLines,
    oversizedLines: stats.oversizedLines,
    truncatedAtMaxRecords: stats.truncatedAtMaxRecords,
    firstObservedAt: first,
    lastObservedAt: last,
    eventCounts: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
    pagePaths: [...paths].sort(),
    privacy: "Only event categories and sanitized paths; no raw events, form contents, tokens, or network data.",
  };
}
