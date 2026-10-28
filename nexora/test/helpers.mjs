// Test helpers: temp dirs, a minimal ZIP writer able to craft hostile entries,
// and a child-process runner for CLI tests.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Dynamically import a module by filesystem path. ESM `import()` takes URLs,
 * not OS paths: on Windows "C:\\repo\\x.ts" parses as a URL with scheme "c:"
 * and fails with ERR_UNSUPPORTED_ESM_URL_SCHEME. Always convert first.
 */
export function importPath(path) {
  return import(pathToFileURL(path).href);
}

/** Import a repository file given repo-relative segments, e.g. importRepo("nexora", "lib", "entry.mjs"). */
export function importRepo(...segments) {
  return importPath(join(REPO, ...segments));
}

/**
 * Import a TypeScript module from the repository's `src/` (or `scripts/lib/`)
 * with plain Node, no tsx: uses the upstream verifier loader
 * (scripts/lib/verifier-source-loader.mjs), which strips types with
 * node:module stripTypeScriptTypes and maps "./x.js" imports to "./x.ts".
 * Requires Node.js >= 22.15 (module.registerHooks). The path is passed as a
 * file:// URL, so it also works with Windows drive-letter paths.
 */
export async function importRepoSource(...segments) {
  const { importVerifierSource } = await importRepo("scripts", "lib", "verifier-source-loader.mjs");
  return importVerifierSource(pathToFileURL(join(REPO, ...segments)).href, import.meta.url);
}

export async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexora-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Build a ZIP (stored, no compression) from entry specs. Sizes in the
 * central directory can be overridden to simulate zip-bomb metadata.
 * @param {{name: string, data?: string|Buffer, symlink?: boolean, claimUncompressed?: number, claimCompressed?: number, utf8?: boolean}[]} entries
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "x");
    const name = Buffer.from(e.name, e.utf8 === false ? "latin1" : "utf8");
    const flags = e.utf8 === false ? 0 : 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(flags, 8);
    cen.writeUInt32LE(e.claimCompressed ?? data.length, 20);
    cen.writeUInt32LE(e.claimUncompressed ?? data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    const mode = e.symlink ? 0o120777 : 0o100644;
    cen.writeUInt32LE((mode << 16) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export async function writeZip(path, entries) {
  await writeFile(path, buildZip(entries));
  return path;
}

/** Run a node script; resolves {code, stdout, stderr}. */
export function runNode(args, { env = {}, timeoutMs = 60_000, cwd = REPO } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
