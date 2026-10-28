/**
 * Resolve the MinGW-w64 toolchain for the Windows x64 native artifact.
 *
 * Supported lanes:
 *  - linux: the cross toolchain `x86_64-w64-mingw32-g++` / `-dlltool`
 *    (unchanged upstream CI lane).
 *  - win32: a native MinGW-w64 GCC targeting x86_64-w64-mingw32, e.g. MSYS2
 *    UCRT64 or MINGW64. Tools are taken from NEXORA_MINGW_BIN (absolute
 *    directory, e.g. C:\msys64\ucrt64\bin) when set, otherwise from PATH.
 *
 * Every candidate compiler must report `-dumpmachine` == x86_64-w64-mingw32
 * and identify as GCC, which rejects the MSYS runtime compiler
 * (x86_64-pc-msys), 32-bit toolchains and clang-based environments that this
 * build has not been validated with. Nothing is installed or downloaded.
 */
import { spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";

export const TARGET_TRIPLE = "x86_64-w64-mingw32";

/**
 * @param {{platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv,
 *          probe?: (command: string, args: string[], env: NodeJS.ProcessEnv) => {ok: boolean, stdout: string}}} [opts]
 * @returns {{lane: "linux-cross"|"windows-native", compiler: string, dlltool: string,
 *            env: NodeJS.ProcessEnv, crt: "ucrt"|"msvcrt"|"unknown", compilerVersion: string}}
 */
export function resolveWindowsNativeToolchain(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const baseEnv = opts.env ?? process.env;
  const probe = opts.probe ?? defaultProbe;

  if (platform !== "linux" && platform !== "win32")
    throw new Error(
      `The Windows x64 artifact build lane supports Linux (MinGW-w64 cross toolchain) and Windows (MSYS2 UCRT64/MINGW64 GCC); ${platform} is not supported.`,
    );

  // Use the target platform's path rules, independent of the host running this
  // code (keeps the Windows lane correct and testable everywhere).
  const path = platform === "win32" ? win32 : posix;
  let env = baseEnv;
  let compilers;
  let dlltools;
  if (platform === "linux") {
    compilers = [`${TARGET_TRIPLE}-g++`];
    dlltools = [`${TARGET_TRIPLE}-dlltool`];
  } else {
    const bin = baseEnv.NEXORA_MINGW_BIN;
    if (bin !== undefined && bin !== "") {
      if (!path.isAbsolute(bin)) throw new Error("NEXORA_MINGW_BIN must be an absolute directory, e.g. C:\\msys64\\ucrt64\\bin");
      // The compiler driver's helpers (as, ld, cc1plus) and their DLLs live
      // beside it, so the directory must also lead PATH for child processes.
      const pathKey = Object.keys(baseEnv).find((k) => k.toLowerCase() === "path") ?? "PATH";
      env = { ...baseEnv, [pathKey]: `${bin}${path.delimiter}${baseEnv[pathKey] ?? ""}` };
      compilers = [path.join(bin, `${TARGET_TRIPLE}-g++.exe`), path.join(bin, "g++.exe")];
      dlltools = [path.join(bin, `${TARGET_TRIPLE}-dlltool.exe`), path.join(bin, "dlltool.exe")];
    } else {
      compilers = [`${TARGET_TRIPLE}-g++`, "g++"];
      dlltools = [`${TARGET_TRIPLE}-dlltool`, "dlltool"];
    }
  }

  const rejected = [];
  let compiler;
  let compilerVersion = "";
  for (const candidate of compilers) {
    const machine = probe(candidate, ["-dumpmachine"], env);
    if (!machine.ok) {
      rejected.push(`${candidate}: not runnable`);
      continue;
    }
    const triple = machine.stdout.trim();
    if (triple !== TARGET_TRIPLE) {
      rejected.push(`${candidate}: targets ${triple || "unknown"}, need ${TARGET_TRIPLE}`);
      continue;
    }
    const version = probe(candidate, ["--version"], env);
    const first = version.ok ? version.stdout.split(/\r?\n/u)[0] ?? "" : "";
    if (!/\bGCC\b|\bg\+\+/u.test(first) || /clang/iu.test(first)) {
      rejected.push(`${candidate}: not GCC (${first || "no version"})`);
      continue;
    }
    compiler = candidate;
    compilerVersion = first.trim();
    break;
  }
  if (compiler === undefined)
    throw new Error(
      platform === "linux"
        ? `Windows native build lane requires the MinGW-w64 cross compiler ${TARGET_TRIPLE}-g++. ${rejected.join("; ")}`
        : `Windows native build lane requires a MinGW-w64 GCC targeting ${TARGET_TRIPLE} (MSYS2 UCRT64: pacman -S mingw-w64-ucrt-x86_64-gcc). Set NEXORA_MINGW_BIN=C:\\msys64\\ucrt64\\bin or add it to PATH. Tried: ${rejected.join("; ")}`,
    );

  let dlltool;
  for (const candidate of dlltools) {
    if (probe(candidate, ["--version"], env).ok) {
      dlltool = candidate;
      break;
    }
  }
  if (dlltool === undefined)
    throw new Error(`Windows native build lane requires dlltool from binutils (tried ${dlltools.join(", ")}).`);

  // Report which C runtime the toolchain links; both are system components on
  // Windows 10+, the addon's minimum (_WIN32_WINNT=0x0A00).
  const macros = probe(compiler, ["-dM", "-E", "-x", "c++", "-include", "_mingw.h", platform === "win32" ? "NUL" : "/dev/null"], env);
  const crt = !macros.ok ? "unknown" : /#define _UCRT\b/u.test(macros.stdout) ? "ucrt" : "msvcrt";

  return { lane: platform === "linux" ? "linux-cross" : "windows-native", compiler, dlltool, env, crt, compilerVersion };
}

function defaultProbe(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return { ok: result.error === undefined && result.status === 0, stdout: result.stdout ?? "" };
}
