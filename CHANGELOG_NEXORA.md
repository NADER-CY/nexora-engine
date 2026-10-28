# NEXORA ENGINE changelog

`CHANGELOG.md` is the upstream REA changelog and is kept unchanged.

## 0.5.4 — NEXORA tests without tsx (2026-10-28)

### Fixed
- `npm run test:nexora` stopped after the plain-Node suites on machines where
  the `tsx` binary was not installed. `fork-identity.test.mjs` and
  `windows-native-build.test.mjs` now import TypeScript sources through the
  repository's existing pure-Node loader (`scripts/lib/verifier-source-loader.mjs`,
  `node:module` `registerHooks` + `stripTypeScriptTypes`, Node >= 22.15) via
  `importRepoSource()` in `nexora/test/helpers.mjs`, using `file://` URLs.
- `test:nexora` is a single `node --test` run of all five NEXORA suites.
- The manifest-validator test in `windows-native-build.test.mjs` no longer
  skips without a TypeScript loader.

### Added
- Regression tests: `test:nexora` and NEXORA test files must not require
  `tsx`; `importRepoSource()` loads `src/*.ts` with `.js` → `.ts` mapping.

### Unchanged
- `tsx@4.23.15` stays a pinned devDependency (lockfile unchanged): upstream
  scripts `verify-agent-experience.mjs`, `verify-reconstruction-readiness.mjs`
  and `scripts/lib/agent-evaluation-report-gate.mjs` import `tsx/esm/api`.

## 0.5.3 — Windows ESM test compatibility (2026-10-28)

### Fixed
- `nexora/test/fork-identity.test.mjs` failed on Windows with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`: it passed `path.join()` results
  (`C:\…\identity.ts`) to `import()`, which the ESM loader parses as a URL with
  scheme `c:`. Imports now go through `importPath()` / `importRepo()` in
  `nexora/test/helpers.mjs`, which convert with `pathToFileURL()`.

### Added
- `nexora/test/esm-paths.test.mjs` (5 tests): reproduces the Windows failure on
  every OS, checks Windows path → `file://` conversion (drive letters, spaces,
  non-ASCII, UNC) with round-trip, imports from paths with spaces and non-ASCII
  characters, and a static guard (with self-test) that rejects non-URL-safe
  `import()` specifiers across NEXORA code and tests.
- `npm run test:nexora` now includes the ESM path tests and the Windows native build tests.

## 0.5.2 — Windows native build lane (2026-10-28)

### Added
- Native Windows build of `rea-windows-x64.node` with MSYS2 UCRT64 or MINGW64 GCC
  (`npm run build:windows-native` on Windows; `NEXORA_MINGW_BIN` or `PATH`).
  The Linux/WSL2 MinGW-w64 cross lane used by CI is unchanged.
- Toolchain resolution (`scripts/lib/windows-native-toolchain.mjs`) that rejects
  non-`x86_64-w64-mingw32`, MSYS-runtime, 32-bit and non-GCC compilers with
  actionable errors, and reports the linked C runtime (UCRT or MSVCRT).
- Pure-Node extraction of the SHA-256-verified Node headers tarball
  (`scripts/lib/node-headers-archive.mjs`); the build no longer depends on host `tar`.
- PE import policy (`scripts/lib/pe-imports.mjs`), enforced after linking and by
  `verify:windows-native:artifact`: OS DLLs only, `node.exe` delay-loaded only,
  toolchain runtime DLLs rejected.
- `nexora/test/windows-native-build.test.mjs` (15 tests; PE cases link real
  PE32+ DLLs with clang/lld at test time).

### Changed
- `scripts/build-windows-native.mjs`: platform gate now admits Linux and
  Windows; explicit `dlltool -m i386:x86-64`; link timeout raised to 10 minutes;
  node-gyp header cache on Windows (`%LOCALAPPDATA%\node-gyp\Cache`) is reused.
- `scripts/verify-windows-native-artifact.mjs` additionally enforces the import
  policy; `scripts/lib/pe-imports.mjs` added to the package `files`.
- `native/windows/README.md`: both lanes, exact Windows/WSL2 commands; upstream
  prebuilt-binary recovery marked as not recommended for NEXORA ENGINE.

### Unchanged
- Manifest schema, SHA-256 binding, Node-API 8 / ABI 1 contract, loader checks.

## 0.5.1 — Phase 2: offline dependency review (2026-10-28)

### Security
- Offline dependency vulnerability scan of all 927 locked versions against the
  GitHub Advisory Database (reviewed and unreviewed): no findings. Scanner
  validated against known-vulnerable decoy versions.
- Known-malicious-package scan against OpenSSF `malicious-packages`: no matches,
  including the 13 locked names involved in past npm compromises.
- Lockfile integrity review: all 963 entries from `registry.npmjs.org` with SHA-512.
- Documented, unverified: `incur`'s nested prerelease
  `@modelcontextprotocol/server@2.0.0-alpha.4` versus three HTTP-transport
  advisories (N-13), with a validation path.
- Documented: CI runs `npm ci` with lifecycle scripts (N-14), with a testable remediation.

### Added
- `nexora/tools/ghsa-offline-scan.mjs`: offline OSV/GHSA lockfile scanner.
- `security/scans/`: reproducible scan outputs and a sanitized gitleaks summary.

### Unchanged
- No dependency, workflow or engine source changes. Release decision remains BLOCKED.

## 0.5.0 — Phase 1: core stabilization and security remediation (2026-10-28)

Base: upstream REA `rea-agents` 6.8.0, `main` @ `3b242491`.

### Security
- `rea update` no longer installs anything from npm for this source distribution.
  It refuses with a clear message before any registry lookup (`reason: "unpublished-distribution"`).
- MCP registration writes the local `node <install>/scripts/rea.mjs mcp` launcher
  instead of `npx`/`bunx` package references. Upstream `rea-agents` registrations
  are treated as foreign and left unchanged.
- Environment bundles require `--package-tarball` instead of pinning a registry package.
- Upstream publishing automation (npm, MCP registry, Cloudflare Pages) moved to
  `docs/maintainers/upstream-publishing-disabled/`; `package.json` is `"private": true`.
- New `nexora check-archive` (static ZIP inspection) and `nexora audit-lifecycle`
  (install-script allowlist) commands.
- `SECURITY_AUDIT.md` added.

### Fixed
- v0.4 JSONL tools crashed on a single oversized line; lines over `maxLineBytes`
  are now skipped without being buffered.
- v0.4 scripts did nothing on Windows (entry-point detection).
- Plugin MCP launcher validates the `nexora-engine` package identity.

### Added
- `nexora` CLI (`nexora/bin/nexora.mjs`): `summary`, `backend-map`, `scan-bundle`,
  `check-archive`, `audit-lifecycle`, `limits`.
- Bounded-memory streaming bundle scanner (API paths, WebSocket URLs, hosts, client
  routes, call styles, GraphQL operations, framework and charting signals, source
  maps; credential-like literals reported by type and offset only).
- Configurable limits (file, line, records, heap, output, timeout, concurrency,
  queue) through CLI flags and `NEXORA_*` environment variables; per-command
  deadlines; Ctrl+C cancellation; structured errors; atomic owner-only outputs;
  `NEXORA_ALLOWED_ROOTS` path restriction.
- Tests: `nexora/test/*.test.mjs` (35 tests); benchmarks: `nexora/bench/`.
- `NOTICE.md`; new `README.md` (upstream README preserved as `UPSTREAM_README.md`).

### Changed
- Product name **NEXORA ENGINE**; npm package name `nexora-engine` (unpublished);
  MCP server key `nexora-engine`; bins `nexora-engine`, `nexora`, `rea` (kept).
- `backend-map` output: `project` is now `"NEXORA ENGINE"`; summary and map add
  `oversizedLines` and `truncatedAtMaxRecords`.
- `runUpdate()` / `updateInstallCommand()` accept an explicit registry package
  (defaults to the identity value, `null`).

### Removed from the release
- Internal development briefs: `CLAUDE_IMPLEMENTATION_BRIEF.md`,
  `NEXORA_CLAUDE_AUDIT.md`, `REA_FORK_GUIDE_FA.md` (superseded by `NEXORA_README_FA.md`).
