/**
 * Cross-platform "is this module the program entry point?" check.
 *
 * The v0.4 scripts compared `new URL(import.meta.url).pathname` with
 * `process.argv[1]`. On Windows the URL pathname is "/C:/dir/x.mjs" (leading
 * slash, forward slashes, percent-encoding) while argv[1] is "C:\\dir\\x.mjs",
 * so the comparison never matched and the CLI silently did nothing.
 *
 * This uses fileURLToPath + realpath and compares case-insensitively on
 * Windows/macOS-style case-insensitive volumes where appropriate.
 */
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve, win32, posix } from "node:path";

function canonical(p, platform) {
  let out = p;
  try {
    out = realpathSync.native(p);
  } catch {
    out = resolve(p);
  }
  return platform === "win32" ? win32.normalize(out).toLowerCase() : out;
}

/**
 * @param {string} moduleUrl import.meta.url of the calling module
 * @param {{argv1?: string, platform?: NodeJS.Platform}} [opts] injectable for tests
 */
export function isMainModule(moduleUrl, opts = {}) {
  const argv1 = opts.argv1 ?? process.argv[1];
  const platform = opts.platform ?? process.platform;
  if (!argv1) return false;
  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl, { windows: platform === "win32" });
  } catch {
    return false;
  }
  if (opts.platform && opts.platform !== process.platform) {
    // Pure string comparison for cross-platform unit tests (no filesystem access).
    const p = platform === "win32" ? win32 : posix;
    const a = p.normalize(p.resolve(argv1));
    const b = p.normalize(modulePath);
    return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  return canonical(argv1, platform) === canonical(modulePath, platform);
}
