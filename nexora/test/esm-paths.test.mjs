// Cross-platform ESM loading regression tests (Windows ERR_UNSUPPORTED_ESM_URL_SCHEME).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { REPO, importPath, importRepo, withTempDir } from "./helpers.mjs";

test("a raw Windows drive path is not a valid import() specifier (reproduces the Windows failure)", async () => {
  // On every platform the ESM loader parses "C:\\…" as a URL with scheme "c:".
  await assert.rejects(import("C:\\Users\\dev\\nexora-engine\\src\\identity.ts"), (e) => e.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME");
  await assert.rejects(import("D:/repo/src/identity.ts"), (e) => e.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME");
});

test("Windows paths convert to file:// URLs (drive letters, spaces, non-ASCII, UNC) and round-trip", () => {
  const cases = [
    ["C:\\Users\\dev\\nexora-engine\\src\\identity.ts", "file:///C:/Users/dev/nexora-engine/src/identity.ts"],
    ["C:\\My Projects\\nexora engine\\x.mjs", "file:///C:/My%20Projects/nexora%20engine/x.mjs"],
    ["D:\\پروژه\\nexora\\x.mjs", "file:///D:/%D9%BE%D8%B1%D9%88%DA%98%D9%87/nexora/x.mjs"],
    ["\\\\server\\share\\nexora\\x.mjs", "file://server/share/nexora/x.mjs"],
  ];
  for (const [path, url] of cases) {
    const converted = pathToFileURL(path, { windows: true }).href;
    assert.equal(converted, url, path);
    assert.equal(fileURLToPath(converted, { windows: true }), path, `round-trip ${path}`);
  }
});

test("importPath/importRepo load modules by filesystem path, including spaces and non-ASCII", async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, "dir with spaces", "پوشه");
    await mkdir(nested, { recursive: true });
    const file = join(nested, "mod #1.mjs");
    await writeFile(file, "export const value = 42;\n");
    assert.equal((await importPath(file)).value, 42);
  });
  const { isMainModule } = await importRepo("nexora", "lib", "entry.mjs");
  assert.equal(typeof isMainModule, "function");
});

/** Files whose dynamic imports must stay URL-safe on Windows. */
async function nexoraSources() {
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "results" && !e.name.startsWith(".")) await walk(p);
      } else if (e.name.endsWith(".mjs")) out.push(p);
    }
  };
  await walk(join(REPO, "nexora"));
  for (const f of ["build-windows-native.mjs", "verify-windows-native-artifact.mjs", "rea-session-report.mjs", "nexora-backend-map.mjs", "lib/windows-native-toolchain.mjs", "lib/node-headers-archive.mjs", "lib/pe-imports.mjs"])
    out.push(join(REPO, "scripts", f));
  return out;
}

/** Return dynamic import() expressions whose specifier is not URL-safe. */
export function findUnsafeImports(text) {
  // Allowed: string literals that are relative ("./", "../") or "node:" builtins,
  // URL objects/strings (`new URL(...).href`, `.href`), and pathToFileURL(...).
  const safe = /^\s*(["'`](\.{1,2}\/|node:)|new URL\(|pathToFileURL\(|[\w.]+\.href\b)/u;
  const out = [];
  for (const m of text.matchAll(/(?<![\w.$])import\(([^)]*)\)?/gu)) {
    const arg = m[1];
    if (/^\s*$/u.test(arg) || arg.startsWith("${")) continue; // empty or template text
    if (!safe.test(arg)) out.push({ line: text.slice(0, m.index).split("\n").length, arg: arg.slice(0, 60) });
  }
  return out;
}

test("static guard self-test: flags the original Windows-unsafe pattern, accepts safe ones", () => {
  const unsafe = ['const src = (p) => join(REPO, "src", p);', 'const { PRODUCT_IDENTITY } = await import(src("identity.ts"));', 'await import(join(REPO, "x.mjs"));', 'await import("C:\\\\repo\\\\x.mjs");'].join("\n");
  assert.deepEqual(findUnsafeImports(unsafe).map((f) => f.line), [2, 3, 4]);
  const safe = ['await import("./lib/x.mjs");', 'await import("../../src/a.ts");', 'await import("node:child_process");', 'await import(new URL("dist/a.js", root).href);', 'await import(pathToFileURL(p).href);', 'await import(url.href);'].join("\n");
  assert.deepEqual(findUnsafeImports(safe), []);
});

test("static guard: every dynamic import() in NEXORA code uses a URL-safe specifier", async () => {
  const offenders = [];
  for (const file of await nexoraSources()) {
    // This file holds deliberate negative examples; the self-test above covers the guard.
    if (file.endsWith("esm-paths.test.mjs")) continue;
    const text = await readFile(file, "utf8");
    for (const f of findUnsafeImports(text)) offenders.push(`${relative(REPO, file)}:${f.line} import(${f.arg})`);
  }
  assert.deepEqual(offenders, [], "use importPath()/pathToFileURL() for filesystem paths");
});

test("NEXORA tests run on plain Node: no tsx in test:nexora or in NEXORA test imports", async () => {
  const pkg = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  const script = pkg.scripts["test:nexora"];
  assert.match(script, /^node --test /u);
  assert.doesNotMatch(script, /\btsx\b/u, "test:nexora must not require the tsx binary");
  for (const file of await readdir(join(REPO, "nexora", "test"))) {
    if (!file.endsWith(".mjs")) continue;
    const text = await readFile(join(REPO, "nexora", "test", file), "utf8");
    assert.doesNotMatch(text, /from\s+["']tsx(\/[^"']*)?["']|import\(\s*["']tsx/u, `${file} must not import tsx`);
  }
});

test("importRepoSource loads TypeScript sources with plain Node (Windows-safe URL, .js -> .ts mapping)", async () => {
  const { importRepoSource } = await import("./helpers.mjs");
  // identity.ts imports "./generatedPackageMetadata.js", which only exists as .ts.
  const { PRODUCT_IDENTITY } = await importRepoSource("src", "identity.ts");
  assert.equal(PRODUCT_IDENTITY.displayName, "NEXORA ENGINE");
});
