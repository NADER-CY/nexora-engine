# NEXORA ENGINE

**Advanced Reverse Engineering & Software Analysis Platform**

NEXORA ENGINE combines offline source and binary inspection with evidence-based architecture analysis and a provider-backed CLI/MCP server. It is an MIT-licensed derivative of [REA — Reverse Engineer Anything](https://github.com/morluto/rea) by morluto. The original engine, provider integrations and attribution are preserved; NEXORA ENGINE adds bounded offline analysis, resource-management improvements and dependency architecture summaries.

**Status:** development source distribution. The focused offline workflows are tested. Provider support depends on the installed toolchain; experimental and unverified integrations are documented below. No npm package, hosted service or registry deployment is published by this repository.

## Capabilities

| Area | Current scope |
|---|---|
| Source analysis | Streaming lexical function, call and dependency candidates for JavaScript, TypeScript, Go, Rust, C and C++; preserved upstream semantic JS/TS analysis is available through the full engine. |
| Binary inspection | Bounded ELF32/64, PE32/PE32+ and thin Mach-O32/64 metadata, sections, symbols, imports/exports and dependencies, with explicit format limitations. |
| Architecture | Per-file dependency edges with source evidence, incoming/outgoing degrees and strongly connected dependency cycles, including self-imports. |
| Evidence | Input SHA-256, byte ranges, confidence, analyzer profile, omission counters and incomplete-coverage indicators. |
| Ghidra | Structured JSONL importer for functions, pseudocode and references; exporter script included. Real exporter compilation/execution remains unverified in this distribution. |
| Large inputs | Chunked reads, bounded retained inventories, cooperative deadlines/cancellation and failure isolation. These are not hard OS resource limits. |
| Supporting offline tools | Bundle scanning, supplied-session summaries, dependency mapping, archive checks and install-script auditing. |
| Full engine | Preserved upstream provider adapters, shared CLI/MCP workflows and optional runtime analysis. Provider availability and verification vary by OS and external tools. |

## Architecture

```text
Offline CLI: nexora/bin/nexora.mjs
  -> source / binary / project / Ghidra report analyzers
  -> shared input hashing, evidence, inventories and resource limits
  -> architecture summary derived from project-owned dependency facts

Full engine: scripts/rea.mjs -> compiled dist/
  -> CLI and MCP adapters -> shared workflows -> provider adapters
  -> domain contracts and evidence
```

The offline CLI uses Node.js built-ins and requires no build. The full engine retains the upstream layered architecture described in [docs/architecture.mermaid](docs/architecture.mermaid). Offline additions are additive and are **not** newly registered MCP operations.

## Requirements and installation

- Node.js matching `package.json`: `^22.23.4`, `^24.22.1` or `>=26.12.1`; `.nvmrc` pins `24.22.1`.
- npm `11.16.0` for the full dependency-backed engine.
- Optional providers such as Ghidra, Java, Hopper, IDA and platform-specific tools must be supplied separately. Their licenses and requirements apply.

```bash
git clone https://github.com/NADER-CY/nexora-engine.git
cd nexora-engine

# Offline CLI: no dependency installation or build required
node nexora/bin/nexora.mjs --help

# Full engine: review lifecycle scripts before enabling any of them
npm ci --ignore-scripts
npm run build
```

The optional Frida dependency normally downloads a native binding through its lifecycle script; skipped scripts can leave optional providers unavailable. Enable a provider's installation steps only after reviewing them. The inherited `install.sh` targets upstream REA and is **not** the NEXORA ENGINE installation path. The package remains `private: true`; do not publish it to npm.

## CLI examples

```bash
node nexora/bin/nexora.mjs analyze-source ./example.ts --out source.json
node nexora/bin/nexora.mjs analyze-project ./authorized-source --out project.json
node nexora/bin/nexora.mjs analyze-binary ./authorized-binary --out binary.json
node nexora/bin/nexora.mjs ghidra-report ./export.jsonl --out ghidra.json
node nexora/bin/nexora.mjs scan-bundle ./app.bundle.js --out bundle.json
node nexora/bin/nexora.mjs summary ./supplied-session.jsonl --out summary.json
node nexora/bin/nexora.mjs check-archive ./incoming.zip
node nexora/bin/nexora.mjs audit-lifecycle .
node nexora/bin/nexora.mjs limits
```

Inspect coverage, warnings, dropped counts and limitations before drawing conclusions. Architecture cycles describe retained relative-path dependency candidates, not runtime calls. See [PHASE3A.md](PHASE3A.md) for schemas, limits and the Ghidra export workflow. The full engine retains the `nexora-engine` and `rea` compatibility aliases.

## MCP integration

After building the full engine, start its stdio server:

```bash
node scripts/rea.mjs mcp
```

Configure an MCP client with an absolute local launcher path:

```json
{
  "mcpServers": {
    "nexora-engine": {
      "command": "node",
      "args": ["/absolute/path/to/nexora-engine/scripts/rea.mjs", "mcp"]
    }
  }
}
```

On Windows, use a correctly escaped absolute path. `node scripts/rea.mjs setup` can register the local launcher with supported detected clients; review the planned configuration changes. Do not substitute an unpublished `npx` package. Full-server build, client discovery and provider-backed integration were not revalidated during this publication preparation.

## Platforms

The portable offline workflows target Windows, Linux and macOS. The current publication checks ran on Windows x64. Real PE analysis was checked against the host Node binary; ELF/Mach-O coverage uses deterministic fixtures. Linux/macOS execution and platform-specific native control require their own verification lanes. The optional Windows addon needs its documented native toolchain and artifact verification; see [native/windows/README.md](native/windows/README.md).

## Security and privacy

Analyze artifacts you are authorized to inspect. Offline commands read caller-supplied local files without executing target code. Other full-engine workflows may launch providers, interact with local applications or fetch caller-selected resources; review the chosen workflow and provider's authority before use.

Analysis output can expose source, symbols, filesystem paths and decompiled material. Keep reports and session captures private unless intentionally sanitized. Filesystem checks and cooperative budgets are not a replacement for isolation when examining hostile input. No telemetry claim is made for third-party tools; review them separately.

See [SECURITY.md](SECURITY.md) and [PUBLICATION_REVIEW.md](PUBLICATION_REVIEW.md). The publication review records secret scanning, the dependency audit, executed tests and unavailable checks. All inherited GitHub Actions workflows are retained as inactive text under `docs/maintainers/upstream-ci-disabled/`; no automatic npm, Cloudflare, GitHub Pages or MCP registry publishing is enabled.

## Tests and verification

```bash
npm run test:nexora:phase3a
node --test nexora/test/core.test.mjs nexora/test/analysis.test.mjs nexora/test/esm-paths.test.mjs nexora/test/windows-native-build.test.mjs
```

The full `npm run test:nexora` additionally needs installed runtime dependencies. Full upstream TypeScript tests/build/lint require the dependency toolchain. Generated benchmark inputs, session captures and machine-specific historical reports are intentionally excluded; benchmark generator source remains under `nexora/bench/`.

## Current limitations

- Lexical analysis is not full compiler scope/type binding; macros, templates, raw/interpolated strings and indirect calls can be incomplete. Cross-file semantic call binding is unresolved.
- The offline binary reader does not reconstruct instruction-level call graphs. Universal Mach-O and several ELF/PE optional metadata formats remain unsupported.
- Ghidra importer fixture tests do not establish real decompiler/exporter compatibility. Pseudocode is derived output, not recovered original source.
- Missing, ambiguous, external or dropped dependency facts prevent complete architecture coverage. Incomplete graphs cannot prove an absence of cycles.
- Full upstream build, lint, MCP integration and optional provider lanes are not represented as passed by focused offline tests.
- Optional third-party source trees were absent from the supplied workspace. Do not assume recursive cloning retrieves pinned, reviewed submodule contents; consult [third_party/README.md](third_party/README.md).

## Roadmap

1. Verify real Ghidra export and MCP end-to-end workflows with supported toolchains.
2. Add real ELF/Mach-O verification and expand metadata-format coverage.
3. Improve compiler-aware source relationships while preserving evidence and uncertainty.
4. Extend reproducible provider/resource and platform verification.
5. Review and pin optional third-party components before integration.

These are planned improvements, not availability claims.

## Origin and license

NEXORA ENGINE derives from **REA — Reverse Engineer Anything**, `rea-agents` 6.8.0, upstream commit `3b242491a430b3807853436bfeb9568d606169ac`, by **morluto**. Most engine code, providers, bridges and documentation originate upstream. NEXORA ENGINE is not affiliated with or endorsed by the upstream authors.

The original **MIT License** and **Copyright (c) 2026 morluto** remain unchanged. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), the `licenses/` directory and [UPSTREAM_README.md](UPSTREAM_README.md). Historical upstream documentation can describe upstream distribution or automation that is disabled in this repository.
