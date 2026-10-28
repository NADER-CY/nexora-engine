#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importVerifierSource } from "./lib/verifier-source-loader.mjs";
import { resolveWindowsNativeToolchain } from "./lib/windows-native-toolchain.mjs";
import { expectedSha256, extractNodeHeaders } from "./lib/node-headers-archive.mjs";
import { checkWindowsNativeImports } from "./lib/pe-imports.mjs";

const { WINDOWS_NATIVE_ARTIFACT, createWindowsNativeManifest } =
  await importVerifierSource(
    new URL("../src/domain/windowsNativeArtifact.ts", import.meta.url).href,
    import.meta.url,
  );

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeVersion = "22.19.0";
const cache = join(homedir(), ".cache", "rea-windows-native");
const inspectionFixture = process.argv[2] === "--inspection-fixture";
if (process.argv.length > 3 || (process.argv.length > 2 && !inspectionFixture))
  throw new Error("Unknown Windows native build argument");
const output = inspectionFixture
  ? join(root, ".cache", "windows-native-inspection-fixture")
  : join(root, "native", "windows", "build");
// Linux: MinGW-w64 cross toolchain. Windows: native MSYS2 UCRT64/MINGW64 GCC
// (NEXORA_MINGW_BIN or PATH). Both produce the same artifact contract.
const toolchain = resolveWindowsNativeToolchain();
const compiler = toolchain.compiler;
const run = (command, args, timeout = 120_000) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: toolchain.env,
    encoding: "utf8",
    maxBuffer: 4 * 1_024 * 1_024,
    timeout,
    windowsHide: true,
  });
  if (result.error !== undefined)
    throw new Error(
      `Windows native build lane requires ${command}: ${result.error.message}`,
    );
  if (result.status !== 0)
    throw new Error(
      `Windows native build failed: ${result.stdout}${result.stderr}`,
    );
  return result.stdout;
};
process.stderr.write(
  `Windows native build lane: ${toolchain.lane}, ${toolchain.compilerVersion}, C runtime ${toolchain.crt}\n`,
);
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const fetchBytes = async (name) => {
  const response = await fetch(
    `https://nodejs.org/dist/v${nodeVersion}/${name}`,
    {
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Node build prerequisite download failed: ${name}: HTTP ${response.status}`,
    );
  return Buffer.from(await response.arrayBuffer());
};
const checksums = (await fetchBytes("SHASUMS256.txt")).toString("utf8");
const verifiedDownload = async (name, path) => {
  if (!(await exists(path))) await writeFile(path, await fetchBytes(name));
  const digest = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  const expected = expectedSha256(checksums, name);
  if (expected === undefined || digest !== expected)
    throw new Error(`Node build prerequisite SHA-256 mismatch: ${name}`);
};
// Reuse node-gyp's header cache when present (Linux/macOS: ~/.cache/node-gyp,
// Windows: %LOCALAPPDATA%\node-gyp\Cache), else the verified download.
const headerCandidates = [
  join(homedir(), ".cache", "node-gyp", nodeVersion, "include", "node"),
  ...(process.env.LOCALAPPDATA
    ? [join(process.env.LOCALAPPDATA, "node-gyp", "Cache", nodeVersion, "include", "node")]
    : []),
  join(cache, `node-v${nodeVersion}`, "include", "node"),
];
let headers;
for (const candidate of headerCandidates)
  if (await exists(join(candidate, "node_api.h"))) {
    headers = candidate;
    break;
  }
if (headers === undefined) {
  const archive = join(cache, `node-v${nodeVersion}-headers.tar.gz`);
  await verifiedDownload(`node-v${nodeVersion}-headers.tar.gz`, archive);
  // Extract with Node built-ins: host tar differs across Linux, MSYS2 and Windows.
  headers = (await extractNodeHeaders(await readFile(archive), nodeVersion, cache)).headersDir;
}
const artifact = WINDOWS_NATIVE_ARTIFACT.artifact;
// MSVC short-import libraries do not produce a correct Node import table with
// GNU ld. Generate a GNU delay-import library for the exact stable Node-API
// symbols; addon.cc binds it to the host executable, whatever its file name.
const sources = ["addon.cc", "filesystem.cc", "process.cc"];
const sourceText = (
  await Promise.all(
    sources.map((path) =>
      readFile(join(root, "native", "windows", "src", path), "utf8"),
    ),
  )
).join("\n");
const symbols = [
  ...new Set(
    [...sourceText.matchAll(/\b(napi_[a-z0-9_]+)\s*\(/gu)].map(
      (match) => match[1],
    ),
  ),
].sort();
const definition = join(cache, "node-api.def");
const library = join(cache, "libnode-api.a");
await writeFile(
  definition,
  `LIBRARY node.exe\nEXPORTS\n${symbols.join("\n")}\n`,
);
run(toolchain.dlltool, ["-m", "i386:x86-64", "-d", definition, "-y", library]);
run(compiler, [
  "-std=c++17",
  "-O2",
  `-DNAPI_VERSION=${WINDOWS_NATIVE_ARTIFACT.nodeApiVersion}`,
  "-D_WIN32_WINNT=0x0A00",
  "-shared",
  "-static",
  "-static-libgcc",
  "-static-libstdc++",
  "-Wl,--no-insert-timestamp",
  `-I${headers}`,
  "native/windows/src/addon.cc",
  inspectionFixture
    ? "tests/fixtures/windows-native-inspection-failure.cc"
    : "native/windows/src/filesystem.cc",
  "native/windows/src/process.cc",
  library,
  "-ladvapi32",
  "-lbcrypt",
  "-lntdll",
  "-o",
  join(output, artifact),
], 600_000);
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const bytes = await readFile(join(output, artifact));
// Import policy: OS DLLs only, node.exe delay-loaded, no toolchain runtime DLLs.
const imports = checkWindowsNativeImports(bytes);
if (!imports.ok)
  throw new Error(
    `Windows native artifact violates the import policy: ${imports.problems.join("; ")}`,
  );
const created = createWindowsNativeManifest(packageJson.version, bytes);
if (!created.ok) throw created.error;
const metadata = created.value;
await writeFile(
  join(output, "manifest.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({
    ...metadata,
    artifactBytes: bytes.length,
    build: { lane: toolchain.lane, compiler: toolchain.compilerVersion, crt: toolchain.crt },
    imports: imports.imports,
    delayImports: imports.delayImports,
  })}\n`,
);
