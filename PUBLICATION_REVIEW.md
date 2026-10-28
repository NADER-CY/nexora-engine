# NEXORA ENGINE public-source review

Review date: 2026-10-28. Destination: `NADER-CY/nexora-engine`, explicitly selected by the owner during publication preparation.

## Source and inventory

Prepared directly from the latest completed workspace that produced `NEXORA_ENGINE_Continued.zip`. All 6,644 recovered source files were checked against its final SHA-256 inventory before copying. No older archive was substituted. The original workspace and delivered ZIP remain intact.

Excluded 73 historical artifacts: root machine-specific recovery/implementation/audit reports, `phase3a-results/`, `security/scans/` and historical `docs/verification/` records. These are historical outputs, not executable implementation or test source. Public test fixtures and benchmark generators remain; generated benchmark inputs, installed dependencies, caches, build outputs, personal session captures and private research files are not included. No source or test files under `src/`, `bridge/`, `nexora/`, `tests/`, `scripts/` or `native/` were intentionally removed.

The public README and security summary were rewritten. The MIT license, NOTICE, upstream README, third-party notices and license texts are preserved. Executable shebang scripts receive executable Git modes. Registry metadata identifies this repository without advertising an unpublished npm install target.

## Security checks

| Check | Result |
|---|---|
| Gitleaks v8.30.1, full publication directory | Three matches, all reviewed as test data/checksum false positives; no real credentials detected. Scanner archive SHA-256 verified against the official release checksums. |
| npm audit against the inherited lock, scripts disabled | Zero known vulnerabilities reported across 963 locked dependency entries. |
| Dependency source/integrity inventory | Registry URLs and SHA-512 integrity metadata checked; no new dependency or lock changes. |
| Lifecycle allowlist audit | Passed; no unexpected or changed root hooks or declared dependency install scripts. |
| Executable-script review | Root prepare/prepack hooks, upstream installer, publishing configuration and high-risk shell patterns reviewed. No confirmed malicious component identified. |
| Private data and artifact review | Personal machine paths and historical logs removed/excluded; fixture paths and synthetic data retained where required for tests. No real credentials, private captures or private keys identified. |
| Publication controls | Package remains `private: true`; all 31 inherited active workflows moved to inactive `.yml.txt` documentation. No active executable workflows; npm, Cloudflare, Pages and MCP registry automation remain disabled. |

Gitleaks match classifications:

- `scripts/fixtures/browser-request-site.mjs`: explicitly synthetic bearer token used by the local request/capture fixture.
- `tests/conformance/android/ReaJadxMetadataRegression.java`: deliberately absent regression selector, not an authentication credential.
- `tests/fixtures/golden/provenance.json`: SHA-256 provenance checksum for a public fixture.

These matches are documented rather than broadly suppressed. A new scan may still report them and requires the same contextual review. Raw secret scanner output and local machine paths are excluded from the public repository.

The root `prepare` hook applies a local release-tool patch and configures Husky when dependencies are installed. `prepack` builds/verifies packaging. Declared dependency install hooks belong to esbuild, optional Frida and fsevents. `npm ci --ignore-scripts` is the documented initial installation path. Frida can download a native binding if its script is explicitly enabled. The inherited `install.sh` installs upstream REA and is not recommended for NEXORA ENGINE.

## Executed tests

| Suite | Result |
|---|---|
| `npm run test:nexora:phase3a` | 39 passed, zero failures or skips. Includes source/binary/Ghidra importer, resource boundaries and project architecture tests. |
| Existing core, analysis, ESM path and Windows-native-build tests | 40 passed, zero failures, seven existing platform/toolchain skips. |
| Architecture public CLI | Verified import-site evidence, duplicate-edge degree handling, dependency cycles and self-imports. |
| Architecture graph boundary | Verified a 12,000-file chain, retained output limits and budget checks. |

Runtime: Windows x64, Node v24.21.0. This is below the repository pin of v24.22.1; the documented supported runtime must be used for broader verification.

## Unavailable checks and residual limitations

- Full upstream build, TypeScript/lint suite and Vitest discovery were not run successfully: dependencies are not installed. The existing fork-identity test fails at module load on missing `semver`; it is not represented as passed.
- Real Ghidra exporter compilation/decompilation and full MCP client/server workflows remain unverified. Importer fixtures do not establish provider runtime compatibility.
- Real PE coverage exists in the focused suite; ELF/Mach-O use synthetic format fixtures. Linux/macOS and optional native/provider lanes require separate checks.
- The npm audit is a point-in-time advisory query, not a malware guarantee. Dependency tarballs were not exhaustively inspected. Inherited prerelease/transitive transport behavior requires separate provider review even when it falls outside published advisory ranges.
- Optional third-party submodule contents were absent in the supplied source; no unreviewed submodules were fetched or integrated.
- The initial Git diff includes inherited whitespace warnings in unchanged upstream/license texts; those texts were preserved rather than cosmetically rewritten.
- Historical verification-output links in inherited documentation can point to artifacts excluded from this clean source publication. The main README links to the current public verification scope.

No confirmed secret, malicious component or critical security issue was found by the executed checks. This review supports publication as development source, not a production-readiness or comprehensive security certification. No npm publication or service deployment is authorized or performed.
