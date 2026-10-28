/**
 * Static ZIP inspection without extraction.
 *
 * Reads only the End-Of-Central-Directory record and the central directory
 * (bounded reads, never the whole archive) and reports entries that would be
 * dangerous to extract:
 *   - path traversal ("..") and absolute / drive-letter / UNC paths
 *   - NUL or control characters, backslash separators
 *   - symbolic links (Unix mode in external attributes)
 *   - duplicate names (case-insensitively, as on Windows/macOS)
 *   - zip-bomb indicators (per-entry and total expansion ratio, total size)
 *   - entry-count floods and encrypted entries
 *
 * ZIP64 archives are detected and reported as unsupported rather than
 * guessed at.
 */
import { open } from "node:fs/promises";
import { checkedInputFile } from "./fs-safe.mjs";
import { NexoraError, ErrorCodes } from "./errors.mjs";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export const ARCHIVE_DEFAULTS = Object.freeze({
  maxArchiveBytes: 4 * 1024 * 1024 * 1024,
  maxEntries: 100_000,
  maxCentralDirectoryBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 8 * 1024 * 1024 * 1024,
  maxEntryRatio: 200,
  maxNameBytes: 1024,
});

/**
 * @param {string} file
 * @param {Partial<typeof ARCHIVE_DEFAULTS>} [opts]
 */
export async function inspectZip(file, opts = {}) {
  const o = { ...ARCHIVE_DEFAULTS, ...opts };
  const { path, size } = await checkedInputFile(file, { maxBytes: o.maxArchiveBytes });
  const fh = await open(path, "r");
  try {
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, "Not a ZIP archive (no end-of-central-directory record)");
    const entries = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const findings = [];
    const add = (severity, rule, name, detail) => findings.push({ severity, rule, entry: name, ...(detail ? { detail } : {}) });
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      add("high", "zip64-unsupported", null, "ZIP64 archive; inspect with a ZIP64-aware tool before extracting");
      return summarize(path, size, entries, [], findings);
    }
    if (entries > o.maxEntries) add("high", "entry-flood", null, `${entries} entries > ${o.maxEntries}`);
    if (cdSize > o.maxCentralDirectoryBytes || cdOffset + cdSize > size)
      throw new NexoraError(ErrorCodes.LIMIT_EXCEEDED, "Central directory is oversized or out of bounds");
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const seen = new Map();
    const list = [];
    let totalUncompressed = 0;
    let p = 0;
    for (let n = 0; n < Math.min(entries, o.maxEntries); n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) {
        add("high", "corrupt-central-directory", null, `entry ${n}`);
        break;
      }
      const madeBy = cd.readUInt16LE(p + 4);
      const flags = cd.readUInt16LE(p + 8);
      const compressed = cd.readUInt32LE(p + 20);
      const uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      const raw = cd.subarray(p + 46, p + 46 + nameLen);
      const name = raw.toString(flags & 0x800 ? "utf8" : "latin1");
      p += 46 + nameLen + extraLen + commentLen;
      list.push({ name, compressed, uncompressed });
      totalUncompressed += uncompressed;

      if (nameLen > o.maxNameBytes) add("medium", "long-name", name.slice(0, 80));
      if (/[\x00-\x1f]/.test(name)) add("high", "control-character", JSON.stringify(name).slice(0, 120));
      if (name.includes("\\")) add("high", "backslash-separator", name, "may become a traversal on Windows");
      const segments = name.split(/[\\/]/);
      if (segments.includes("..")) add("critical", "path-traversal", name);
      if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.startsWith("\\\\") || name.startsWith("//"))
        add("critical", "absolute-path", name);
      const hostOs = madeBy >> 8;
      const unixMode = external >>> 16;
      if (hostOs === 3 && (unixMode & 0o170000) === 0o120000) add("high", "symlink", name, "symlinks can redirect later writes outside the target");
      if (flags & 0x1) add("medium", "encrypted", name);
      if (compressed > 0 && uncompressed / compressed > o.maxEntryRatio && uncompressed > 1024 * 1024)
        add("high", "compression-ratio", name, `${Math.round(uncompressed / compressed)}:1`);
      const key = name.toLowerCase().replace(/\\/g, "/");
      if (seen.has(key)) add("high", "duplicate-name", name, `also ${seen.get(key)}`);
      else seen.set(key, name);
    }
    if (totalUncompressed > o.maxTotalUncompressedBytes)
      add("critical", "total-size", null, `${Math.round(totalUncompressed / 1048576)} MB uncompressed`);
    return summarize(path, size, entries, list, findings, totalUncompressed);
  } finally {
    await fh.close();
  }
}

function summarize(path, size, entries, list, findings, totalUncompressed = null) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    schema: "nexora-archive-check/v1",
    archive: { name: path.split(/[\\/]/).pop(), bytes: size, entries, totalUncompressedBytes: totalUncompressed },
    safeToExtract: !findings.some((f) => f.severity === "critical" || f.severity === "high"),
    findings: findings.slice(0, 500),
    findingsTruncated: findings.length > 500,
  };
}
