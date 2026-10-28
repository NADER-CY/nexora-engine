/**
 * Checksum lookup and extraction for the official Node.js headers tarball
 * (node-vX.Y.Z-headers.tar.gz), implemented with Node built-ins so the build
 * does not depend on the host `tar`. (MSYS2's GNU tar treats "C:\..." as a
 * remote host:path, and Windows bsdtar differs in flags.)
 *
 * Only regular files under `node-vX.Y.Z/include/node/` are written. Any entry
 * whose normalized path would leave the output directory, and any link or
 * device entry in that subtree, aborts extraction. Sizes are bounded.
 */
import { gunzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** Expected SHA-256 for `name` from a SHASUMS256.txt body, or undefined. */
export function expectedSha256(shasums, name) {
  for (const line of shasums.split(/\r?\n/u)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/u.exec(line.trim());
    if (m && m[2] === name) return m[1];
  }
  return undefined;
}

function field(buf, start, length) {
  const raw = buf.subarray(start, start + length);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString("utf8");
}

function octal(buf, start, length) {
  const text = field(buf, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) throw new Error("Invalid tar numeric field");
  return Number.parseInt(text, 8);
}

/** Parse pax extended header records (key=value). */
function paxRecords(body) {
  const out = {};
  let i = 0;
  while (i < body.length) {
    const space = body.indexOf(0x20, i);
    if (space === -1) break;
    const len = Number.parseInt(body.toString("utf8", i, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = body.toString("utf8", space + 1, i + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Extract `node-v<version>/include/node/**` from a gzipped headers tarball.
 * @param {Buffer} gzipped
 * @param {string} version e.g. "22.19.0"
 * @param {string} outDir destination root; files land in outDir/node-v<version>/include/node
 * @returns {Promise<{headersDir: string, files: number}>}
 */
export async function extractNodeHeaders(gzipped, version, outDir) {
  if (gzipped.length > MAX_ARCHIVE_BYTES) throw new Error("Node headers archive is unexpectedly large");
  const tar = gunzipSync(gzipped, { maxOutputLength: MAX_ARCHIVE_BYTES * 4 });
  const prefix = `node-v${version}/include/node/`;
  const root = resolve(outDir);
  let offset = 0;
  let files = 0;
  let pending = {};
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const ustarPrefix = field(header, 257, 6).startsWith("ustar") ? field(header, 345, 155) : "";
    let name = field(header, 0, 100);
    if (ustarPrefix) name = `${ustarPrefix}/${name}`;
    const bodyStart = offset + 512;
    const body = tar.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / 512) * 512;

    if (type === "x") {
      pending = paxRecords(body);
      continue;
    }
    if (type === "g") continue; // global pax header
    if (type === "L") {
      pending = { path: body.toString("utf8").replace(/\0+$/u, "") };
      continue;
    }
    if (pending.path) name = pending.path;
    pending = {};

    const normalized = posix.normalize(name.replace(/\\/gu, "/"));
    if (!normalized.startsWith(prefix)) continue; // only the include/node subtree is used
    if (normalized.split("/").includes("..") || posix.isAbsolute(normalized))
      throw new Error(`Node headers archive entry escapes its directory: ${name}`);
    if (type === "5") continue; // directory; created on demand
    if (type !== "0" && type !== "\0" && type !== "7")
      throw new Error(`Node headers archive has a non-regular entry in include/node: ${name} (type ${JSON.stringify(type)})`);
    if (size > MAX_FILE_BYTES) throw new Error(`Node headers archive entry too large: ${name}`);
    const target = resolve(root, ...normalized.split("/"));
    if (!target.startsWith(root + sep)) throw new Error(`Node headers archive entry escapes its directory: ${name}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    files++;
  }
  if (files === 0) throw new Error(`Node headers archive has no ${prefix} files`);
  return { headersDir: join(root, `node-v${version}`, "include", "node"), files };
}
