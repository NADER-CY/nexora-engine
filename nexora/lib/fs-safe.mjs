/**
 * Filesystem safety helpers: path validation (NUL bytes, traversal outside
 * allowed roots, symlink escapes), size-checked input files, private temp
 * directories and atomic, size-capped, owner-only output writes.
 */
import { promises as fsp, constants as fsc } from "node:fs";
import { resolve, dirname, join, relative, isAbsolute, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { NexoraError, ErrorCodes } from "./errors.mjs";

function isInside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Validate a user-supplied path.
 * @param {string} input
 * @param {{roots?: string[], mustExist?: boolean, kind?: "file"|"dir"}} [opts]
 * When `roots` is given, the real (symlink-resolved) path must stay inside one of them.
 */
export async function safePath(input, opts = {}) {
  if (typeof input !== "string" || input.length === 0 || input.length > 4096)
    throw new NexoraError(ErrorCodes.PATH_REJECTED, "Path must be a non-empty string under 4096 characters");
  if (input.includes("\0")) throw new NexoraError(ErrorCodes.PATH_REJECTED, "Path contains a NUL byte");
  const abs = resolve(input);
  let real = abs;
  try {
    real = await fsp.realpath(abs);
  } catch (error) {
    if (opts.mustExist) throw new NexoraError(ErrorCodes.NOT_FOUND, `Path not found: ${basename(abs)}`, { cause: error });
    // For new files, validate the nearest existing parent instead.
    real = join(await fsp.realpath(dirname(abs)).catch(() => dirname(abs)), basename(abs));
  }
  if (opts.roots?.length) {
    const roots = await Promise.all(opts.roots.map((r) => fsp.realpath(resolve(r)).catch(() => resolve(r))));
    if (!roots.some((root) => isInside(root, real)))
      throw new NexoraError(ErrorCodes.PATH_REJECTED, "Path is outside the allowed directories", {
        hint: "Set NEXORA_ALLOWED_ROOTS (path-delimited) to permit additional directories.",
      });
  }
  if (opts.mustExist && opts.kind) {
    const st = await fsp.stat(real);
    if (opts.kind === "file" && !st.isFile()) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, "Expected a regular file");
    if (opts.kind === "dir" && !st.isDirectory()) throw new NexoraError(ErrorCodes.INVALID_ARGUMENT, "Expected a directory");
  }
  return real;
}

/** Validate an input file and its size against `maxBytes`. Returns {path, size}. */
export async function checkedInputFile(input, { maxBytes, roots } = {}) {
  const path = await safePath(input, { roots, mustExist: true, kind: "file" });
  const { size } = await fsp.stat(path);
  if (maxBytes && size > maxBytes)
    throw new NexoraError(ErrorCodes.LIMIT_EXCEEDED, `Input is ${Math.ceil(size / 1048576)} MB, above the ${Math.floor(maxBytes / 1048576)} MB limit`, {
      hint: "Raise NEXORA_MAX_FILE_BYTES or split the input.",
      details: { size, maxBytes },
    });
  return { path, size };
}

/** Create a private (0700) temporary directory. */
export async function privateTempDir(prefix = "nexora-") {
  const dir = await fsp.mkdtemp(join(tmpdir(), prefix));
  await fsp.chmod(dir, 0o700).catch(() => {});
  return dir;
}

/**
 * Atomically write `data` (string or Buffer) with owner-only permissions.
 * Rejects data larger than `maxBytes` before touching the filesystem.
 */
export async function writeFileAtomic(target, data, { maxBytes, mode = 0o600, roots } = {}) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  if (maxBytes && buf.length > maxBytes)
    throw new NexoraError(ErrorCodes.LIMIT_EXCEEDED, `Output would be ${buf.length} bytes, above the ${maxBytes} byte limit`, {
      hint: "Raise NEXORA_MAX_OUTPUT_BYTES or narrow the analysis.",
    });
  const path = await safePath(target, { roots });
  await fsp.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await fsp.open(tmp, fsc.O_CREAT | fsc.O_EXCL | fsc.O_WRONLY, mode);
  try {
    await handle.writeFile(buf);
    await handle.sync().catch(() => {});
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tmp, path);
  } catch (error) {
    await fsp.rm(tmp, { force: true });
    throw error;
  }
  return path;
}

/** Allowed roots from NEXORA_ALLOWED_ROOTS (path-delimited), or undefined for unrestricted CLI use. */
export function allowedRootsFromEnv(env = process.env) {
  const raw = env.NEXORA_ALLOWED_ROOTS;
  if (!raw) return undefined;
  const sep = process.platform === "win32" ? ";" : ":";
  return raw.split(sep).filter(Boolean);
}
