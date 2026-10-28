/**
 * Read the DLL names imported by a PE32+ image (regular and delay-load import
 * directories) and check them against the Windows native artifact policy.
 *
 * Policy for rea-windows-x64.node:
 *  - Only operating-system DLLs may be imported: KERNEL32, ADVAPI32, bcrypt,
 *    ntdll, and the C runtime (msvcrt.dll for the Linux/MSVCRT lane;
 *    ucrtbase.dll / api-ms-win-crt-*.dll for UCRT toolchains such as MSYS2
 *    UCRT64), plus api-ms-win-core-* API sets.
 *  - node.exe must be imported ONLY through the delay-load directory: addon.cc
 *    redirects it to the host executable, whatever its file name. A regular
 *    node.exe import would fail in hosts with a different executable name.
 *  - Toolchain runtime DLLs (libstdc++-6.dll, libgcc_s_seh-1.dll,
 *    libwinpthread-1.dll, ...) are rejected: they mean the static link failed
 *    and the addon would only load where that toolchain is installed.
 */

const IMAGE_DIRECTORY_ENTRY_IMPORT = 1;
const IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT = 13;

export const SYSTEM_DLL_ALLOWLIST = [/^kernel32\.dll$/iu, /^advapi32\.dll$/iu, /^bcrypt\.dll$/iu, /^ntdll\.dll$/iu, /^msvcrt\.dll$/iu, /^ucrtbase\.dll$/iu, /^api-ms-win-crt-[a-z0-9-]+\.dll$/iu, /^api-ms-win-core-[a-z0-9-]+\.dll$/iu];

/** @returns {{imports: string[], delayImports: string[]}} */
export function readPeImports(bytes) {
  if (bytes.length < 64 || bytes.toString("latin1", 0, 2) !== "MZ") throw new Error("Not a PE image");
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 24 > bytes.length || bytes.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("Not a PE image");
  const sections = bytes.readUInt16LE(pe + 6);
  const optSize = bytes.readUInt16LE(pe + 20);
  const opt = pe + 24;
  if (opt + optSize > bytes.length) throw new Error("Truncated PE optional header");
  if (bytes.readUInt16LE(opt) !== 0x20b) throw new Error("Not a PE32+ image");
  const numberOfRvaAndSizes = bytes.readUInt32LE(opt + 108);
  const dir = (index) => (index < numberOfRvaAndSizes ? { rva: bytes.readUInt32LE(opt + 112 + index * 8), size: bytes.readUInt32LE(opt + 116 + index * 8) } : { rva: 0, size: 0 });
  const table = opt + optSize;
  const secs = [];
  for (let i = 0; i < sections; i++) {
    const s = table + i * 40;
    if (s + 40 > bytes.length) throw new Error("Truncated PE section table");
    secs.push({ va: bytes.readUInt32LE(s + 12), vsize: bytes.readUInt32LE(s + 8), raw: bytes.readUInt32LE(s + 20), rsize: bytes.readUInt32LE(s + 16) });
  }
  const toOffset = (rva) => {
    for (const s of secs) {
      const span = Math.max(s.vsize, s.rsize);
      if (rva >= s.va && rva < s.va + span) {
        const off = s.raw + (rva - s.va);
        if (off < bytes.length) return off;
      }
    }
    throw new Error(`PE RVA 0x${rva.toString(16)} is outside every section`);
  };
  const cstring = (rva) => {
    const off = toOffset(rva);
    const end = bytes.indexOf(0, off);
    if (end === -1 || end - off > 260) throw new Error("Invalid PE import name");
    return bytes.toString("latin1", off, end);
  };
  const names = (entry, descriptorSize, nameOffset) => {
    const out = [];
    if (!entry.rva) return out;
    let off = toOffset(entry.rva);
    for (let i = 0; i < 4096; i++, off += descriptorSize) {
      if (off + descriptorSize > bytes.length) throw new Error("Truncated PE import directory");
      if (bytes.subarray(off, off + descriptorSize).every((b) => b === 0)) return out;
      const nameRva = bytes.readUInt32LE(off + nameOffset);
      if (nameRva) out.push(cstring(nameRva));
    }
    throw new Error("PE import directory is not terminated");
  };
  return {
    imports: names(dir(IMAGE_DIRECTORY_ENTRY_IMPORT), 20, 12),
    delayImports: names(dir(IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT), 32, 4),
  };
}

/** @returns {{ok: true, imports: string[], delayImports: string[]} | {ok: false, problems: string[], imports: string[], delayImports: string[]}} */
export function checkWindowsNativeImports(bytes) {
  const { imports, delayImports } = readPeImports(bytes);
  const problems = [];
  const allowed = (dll) => SYSTEM_DLL_ALLOWLIST.some((re) => re.test(dll));
  for (const dll of imports) {
    if (/^node\.exe$/iu.test(dll)) problems.push("node.exe is a regular import; it must be delay-loaded so the addon binds to the host executable");
    else if (!allowed(dll)) problems.push(`unexpected import ${dll} (only operating-system DLLs are allowed; a toolchain runtime DLL means the static link failed)`);
  }
  for (const dll of delayImports) if (!/^node\.exe$/iu.test(dll) && !allowed(dll)) problems.push(`unexpected delay import ${dll}`);
  if (!delayImports.some((dll) => /^node\.exe$/iu.test(dll))) problems.push("node.exe delay import is missing (Node-API symbols would not resolve)");
  return problems.length ? { ok: false, problems, imports, delayImports } : { ok: true, imports, delayImports };
}
