// Windows native artifact build lane: toolchain resolution, Node headers
// extraction, and the PE import policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, symlink, readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { gzipSync } from "node:zlib";
import { resolveWindowsNativeToolchain, TARGET_TRIPLE } from "../../scripts/lib/windows-native-toolchain.mjs";
import { expectedSha256, extractNodeHeaders } from "../../scripts/lib/node-headers-archive.mjs";
import { readPeImports, checkWindowsNativeImports } from "../../scripts/lib/pe-imports.mjs";
import { withTempDir, runNode, importRepoSource } from "./helpers.mjs";

// ---------------------------------------------------------------- toolchain

/** Fake probe: map of command -> {machine, version, ucrt} */
function fakeProbe(table, calls = []) {
  return (command, args, env) => {
    calls.push({ command, args, env });
    const t = table[command];
    if (!t) return { ok: false, stdout: "" };
    if (args[0] === "-dumpmachine") return { ok: true, stdout: `${t.machine}\n` };
    if (args[0] === "--version") return { ok: true, stdout: `${t.version}\n` };
    if (args[0] === "-dM") return { ok: true, stdout: t.ucrt ? "#define _UCRT 1\n#define __MINGW64__ 1\n" : "#define __MINGW64__ 1\n" };
    return { ok: false, stdout: "" };
  };
}

test("toolchain: Linux cross lane is unchanged", () => {
  const r = resolveWindowsNativeToolchain({
    platform: "linux",
    env: {},
    probe: fakeProbe({
      "x86_64-w64-mingw32-g++": { machine: TARGET_TRIPLE, version: "x86_64-w64-mingw32-g++ (GCC) 13-win32" },
      "x86_64-w64-mingw32-dlltool": { version: "GNU dlltool (GNU Binutils) 2.42" },
    }),
  });
  assert.equal(r.lane, "linux-cross");
  assert.equal(r.compiler, "x86_64-w64-mingw32-g++");
  assert.equal(r.dlltool, "x86_64-w64-mingw32-dlltool");
  assert.equal(r.crt, "msvcrt");
});

test("toolchain: Windows MSYS2 UCRT64 via PATH (g++ / dlltool names)", () => {
  const r = resolveWindowsNativeToolchain({
    platform: "win32",
    env: { Path: "C:\\msys64\\ucrt64\\bin" },
    probe: fakeProbe({
      "g++": { machine: TARGET_TRIPLE, version: "g++.exe (Rev1, Built by MSYS2 project) 16.2.0", ucrt: true },
      dlltool: { version: "GNU dlltool (GNU Binutils) 2.45" },
    }),
  });
  assert.equal(r.lane, "windows-native");
  assert.equal(r.compiler, "g++");
  assert.equal(r.dlltool, "dlltool");
  assert.equal(r.crt, "ucrt");
  assert.match(r.compilerVersion, /16\.2\.0/);
});

test("toolchain: NEXORA_MINGW_BIN selects absolute tools and leads PATH for child processes", () => {
  const bin = "C:\\msys64\\ucrt64\\bin";
  const table = {
    [win32.join(bin, "g++.exe")]: { machine: TARGET_TRIPLE, version: "g++.exe (GCC) 16.2.0", ucrt: true },
    [win32.join(bin, "dlltool.exe")]: { version: "GNU dlltool 2.45" },
  };
  const calls = [];
  const r = resolveWindowsNativeToolchain({ platform: "win32", env: { NEXORA_MINGW_BIN: bin, Path: "C:\\Windows" }, probe: fakeProbe(table, calls) });
  assert.equal(r.compiler, "C:\\msys64\\ucrt64\\bin\\g++.exe");
  assert.equal(r.dlltool, "C:\\msys64\\ucrt64\\bin\\dlltool.exe");
  assert.equal(r.env.Path, "C:\\msys64\\ucrt64\\bin;C:\\Windows", "MinGW bin must lead PATH so as/ld/cc1plus and their DLLs resolve");
  assert.ok(calls.every((c) => c.env.Path.startsWith(bin)));
  assert.equal(r.crt, "ucrt");
});

test("toolchain: rejects MSYS runtime compiler, 32-bit, clang and missing tools with actionable errors", () => {
  const winEnv = { Path: "C:\\x" };
  assert.throws(
    () => resolveWindowsNativeToolchain({ platform: "win32", env: winEnv, probe: fakeProbe({ "g++": { machine: "x86_64-pc-msys", version: "g++ (GCC) 15" } }) }),
    (e) => /targets x86_64-pc-msys/.test(e.message) && /pacman -S mingw-w64-ucrt-x86_64-gcc/.test(e.message),
  );
  assert.throws(
    () => resolveWindowsNativeToolchain({ platform: "win32", env: winEnv, probe: fakeProbe({ "g++": { machine: "i686-w64-mingw32", version: "g++ (GCC) 15" } }) }),
    /targets i686-w64-mingw32/,
  );
  assert.throws(
    () => resolveWindowsNativeToolchain({ platform: "win32", env: winEnv, probe: fakeProbe({ "g++": { machine: TARGET_TRIPLE, version: "clang version 20.1.0" } }) }),
    /not GCC/,
  );
  assert.throws(
    () => resolveWindowsNativeToolchain({ platform: "win32", env: winEnv, probe: fakeProbe({ "g++": { machine: TARGET_TRIPLE, version: "g++ (GCC) 16.2.0" } }) }),
    /requires dlltool/,
  );
  assert.throws(() => resolveWindowsNativeToolchain({ platform: "darwin", env: {}, probe: fakeProbe({}) }), /darwin is not supported/);
  assert.throws(() => resolveWindowsNativeToolchain({ platform: "win32", env: { NEXORA_MINGW_BIN: "ucrt64\\bin" }, probe: fakeProbe({}) }), /must be an absolute directory/);
});

test("build script: fails clearly when no MinGW toolchain is available", { skip: hasCommand("x86_64-w64-mingw32-g++") || process.platform === "win32" }, async () => {
  const r = await runNode(["scripts/build-windows-native.mjs"], { timeoutMs: 120_000 });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /requires the MinGW-w64 cross compiler x86_64-w64-mingw32-g\+\+/);
  assert.doesNotMatch(r.stderr, /currently requires Linux/);
});

// ---------------------------------------------------------------- headers

test("expectedSha256: parses SHASUMS256 lines, including binary-mode markers", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const body = `${a}  node-v22.19.0-headers.tar.gz\r\n${b} *win-x64/node.lib\n`;
  assert.equal(expectedSha256(body, "node-v22.19.0-headers.tar.gz"), a);
  assert.equal(expectedSha256(body, "win-x64/node.lib"), b);
  assert.equal(expectedSha256(body, "node-v22.19.0-headers.tar"), undefined);
});

/** Minimal ustar writer for tests. */
function tarEntry(name, data = "", type = "0", linkname = "") {
  const body = Buffer.from(data);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write(linkname, 157, 100);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

test("extractNodeHeaders: writes only include/node regular files", async () => {
  await withTempDir(async (dir) => {
    const v = "22.19.0";
    const tgz = gzipSync(
      Buffer.concat([
        tarEntry(`node-v${v}/`, "", "5"),
        tarEntry(`node-v${v}/include/node/`, "", "5"),
        tarEntry(`node-v${v}/include/node/node_api.h`, "#define NAPI_VERSION_MAX 10\n"),
        tarEntry(`node-v${v}/include/node/js_native_api.h`, "// js api\n"),
        tarEntry(`node-v${v}/include/node/openssl/opensslconf.h`, "// nested\n"),
        tarEntry(`node-v${v}/README.md`, "outside include, ignored"),
        Buffer.alloc(1024),
      ]),
    );
    const r = await extractNodeHeaders(tgz, v, dir);
    assert.equal(r.files, 3);
    assert.equal(r.headersDir, join(dir, `node-v${v}`, "include", "node"));
    assert.match(await readFile(join(r.headersDir, "node_api.h"), "utf8"), /NAPI_VERSION_MAX/);
    assert.deepEqual((await readdir(join(dir, `node-v${v}`))).sort(), ["include"]);
  });
});

test("extractNodeHeaders: rejects link entries inside include/node and empty archives", async () => {
  await withTempDir(async (dir) => {
    const v = "22.19.0";
    const withLink = gzipSync(Buffer.concat([tarEntry(`node-v${v}/include/node/node_api.h`, "x"), tarEntry(`node-v${v}/include/node/v8.h`, "", "2", "/etc/hosts"), Buffer.alloc(1024)]));
    await assert.rejects(extractNodeHeaders(withLink, v, join(dir, "a")), /non-regular entry/);
    const empty = gzipSync(Buffer.concat([tarEntry(`node-v${v}/README.md`, "x"), Buffer.alloc(1024)]));
    await assert.rejects(extractNodeHeaders(empty, v, join(dir, "b")), /no node-v22\.19\.0\/include\/node\/ files/);
  });
});

test("extractNodeHeaders: reads a tarball produced by the system tar", { skip: !hasCommand("tar") }, async () => {
  await withTempDir(async (dir) => {
    const v = "9.9.9";
    const src = join(dir, "src", `node-v${v}`, "include", "node");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "node_api.h"), "// real tar\n");
    const archive = join(dir, "h.tar.gz");
    const r = spawnSync("tar", ["-czf", archive, "-C", join(dir, "src"), `node-v${v}`]);
    if (r.status !== 0) return;
    const out = await extractNodeHeaders(await readFile(archive), v, join(dir, "out"));
    assert.equal(out.files, 1);
  });
});

// ---------------------------------------------------------------- PE import policy

/** True when the executable can be launched (some LLVM tools reject --version). */
function hasCommand(cmd) {
  return spawnSync(cmd, ["--help"], { encoding: "utf8", timeout: 20_000 }).error === undefined;
}
const canLinkPe = hasCommand("clang") && hasCommand("lld-link") && hasCommand("llvm-dlltool");

/** Link a real PE32+ DLL with lld. imports: {dll: [symbols]}, delay: [dll names]. */
async function linkDll(dir, name, imports, delay = []) {
  const libs = [];
  const decls = [];
  const uses = [];
  for (const [dll, symbols] of Object.entries(imports)) {
    const def = join(dir, `${dll}.def`);
    await writeFile(def, `LIBRARY ${dll}\nEXPORTS\n${symbols.join("\n")}\n`);
    const lib = join(dir, `${dll}.lib`);
    assert.equal(spawnSync("llvm-dlltool", ["-m", "i386:x86-64", "-d", def, "-l", lib]).status, 0);
    libs.push(lib);
    for (const s of symbols) {
      decls.push(`__declspec(dllimport) int ${s}(void);`);
      uses.push(`${s}()`);
    }
  }
  const c = join(dir, `${name}.c`);
  await writeFile(c, `${decls.join("\n")}\nvoid *__delayLoadHelper2(void *a, void *b) { return 0; }\n__declspec(dllexport) int f(void) { return ${uses.join(" + ") || "0"}; }\n`);
  const obj = join(dir, `${name}.o`);
  assert.equal(spawnSync("clang", ["--target=x86_64-pc-windows-msvc", "-ffreestanding", "-fno-stack-protector", "-c", c, "-o", obj]).status, 0);
  const out = join(dir, `${name}.dll`);
  const link = spawnSync("lld-link", ["/dll", "/noentry", "/nodefaultlib", "/machine:x64", ...delay.map((d) => `/delayload:${d}`), obj, ...libs, `/out:${out}`], { encoding: "utf8" });
  assert.equal(link.status, 0, link.stderr);
  return readFile(out);
}

test("PE imports: an MSVCRT-lane-shaped addon passes", { skip: !canLinkPe }, async () => {
  await withTempDir(async (dir) => {
    const bytes = await linkDll(dir, "msvcrt_lane", { "KERNEL32.dll": ["GetTickCount"], "ADVAPI32.dll": ["RegCloseKey"], "bcrypt.dll": ["BCryptGenRandom"], "ntdll.dll": ["NtClose"], "msvcrt.dll": ["malloc"], "node.exe": ["napi_create_object"] }, ["node.exe"]);
    const r = checkWindowsNativeImports(bytes);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.delayImports, ["node.exe"]);
    assert.ok(r.imports.includes("msvcrt.dll"));
  });
});

test("PE imports: a UCRT64-lane-shaped addon passes", { skip: !canLinkPe }, async () => {
  await withTempDir(async (dir) => {
    const bytes = await linkDll(dir, "ucrt_lane", { "KERNEL32.dll": ["GetTickCount"], "api-ms-win-crt-heap-l1-1-0.dll": ["malloc"], "api-ms-win-crt-runtime-l1-1-0.dll": ["_initterm"], "node.exe": ["napi_create_object"] }, ["node.exe"]);
    assert.equal(checkWindowsNativeImports(bytes).ok, true);
  });
});

test("PE imports: toolchain runtime DLLs (failed static link) are rejected", { skip: !canLinkPe }, async () => {
  await withTempDir(async (dir) => {
    const bytes = await linkDll(dir, "dynamic", { "KERNEL32.dll": ["GetTickCount"], "libstdc++-6.dll": ["_ZSt4cout"], "libwinpthread-1.dll": ["pthread_mutex_lock"], "node.exe": ["napi_create_object"] }, ["node.exe"]);
    const r = checkWindowsNativeImports(bytes);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("libstdc++-6.dll")));
    assert.ok(r.problems.some((p) => p.includes("libwinpthread-1.dll")));
  });
});

test("PE imports: node.exe as a regular import, or missing, is rejected", { skip: !canLinkPe }, async () => {
  await withTempDir(async (dir) => {
    const regular = await linkDll(dir, "regular", { "KERNEL32.dll": ["GetTickCount"], "node.exe": ["napi_create_object"] });
    const r1 = checkWindowsNativeImports(regular);
    assert.equal(r1.ok, false);
    assert.ok(r1.problems.some((p) => p.includes("regular import")));
    const none = await linkDll(dir, "none", { "KERNEL32.dll": ["GetTickCount"] });
    assert.ok(checkWindowsNativeImports(none).problems.some((p) => p.includes("delay import is missing")));
  });
});

test("PE imports: lld-built PE32+ passes the repository's manifest validator unchanged", { skip: !canLinkPe }, async () => {
  await withTempDir(async (dir) => {
    const bytes = await linkDll(dir, "manifest", { "KERNEL32.dll": ["GetTickCount"], "node.exe": ["napi_create_object"] }, ["node.exe"]);
    // Pure-Node TypeScript loader; no tsx required.
    const { createWindowsNativeManifest, validateWindowsNativeArtifact } = await importRepoSource("src", "domain", "windowsNativeArtifact.ts");
    const m = createWindowsNativeManifest("6.8.0", bytes);
    assert.equal(m.ok, true);
    assert.equal(m.value.artifactSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(validateWindowsNativeArtifact(m.value, bytes).ok, true);
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 1] ^= 0xff;
    assert.equal(validateWindowsNativeArtifact(m.value, tampered).ok, false);
  });
});

test("PE imports: non-PE and truncated inputs are rejected", () => {
  assert.throws(() => readPeImports(Buffer.from("not a pe image".padEnd(80))), /Not a PE image/);
  const mz = Buffer.alloc(128);
  mz.write("MZ", 0);
  mz.writeUInt32LE(4096, 0x3c);
  assert.throws(() => readPeImports(mz), /Not a PE image/);
});

void symlink;
