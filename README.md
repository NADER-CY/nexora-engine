# NEXORA ENGINE

**Advanced Reverse Engineering & Software Analysis Platform**

**NEXORA ENGINE** is an open-source reverse engineering and software analysis platform designed to help developers, security researchers, and software engineers explore complex applications, inspect executable binaries, analyze source code, and reconstruct software architecture through traceable evidence.

Combining binary inspection, JavaScript and TypeScript analysis, dependency mapping, architecture visualization, Ghidra integration components, and CLI/MCP workflows, NEXORA ENGINE provides a unified foundation for investigating software systems.

Its analysis capabilities emphasize reproducibility, structured results, resource-aware processing, and clear distinctions between verified findings and inferred relationships.

**Project Status:** Active Development · Open Source · MIT Licensed

NEXORA ENGINE currently provides tested offline analysis tools and experimental integrations. Some advanced capabilities, including full Ghidra execution and certain provider-backed workflows, require additional dependencies and verification.

Installation instructions, usage examples, supported capabilities, and known limitations are documented below.

---

## Capabilities

| Area | Current scope |
|---|---|
| **Source Analysis** | Streaming lexical function, call, and dependency candidates for JavaScript, TypeScript, Go, Rust, C, and C++. Additional semantic JavaScript/TypeScript analysis is available through the full engine. |
| **Binary Inspection** | Bounded ELF32/64, PE32/PE32+, and thin Mach-O32/64 inspection, including metadata, sections, symbols, imports, exports, and dependencies, with explicit format limitations. |
| **Architecture Analysis** | Per-file dependency edges with source evidence, incoming/outgoing degree counts, and strongly connected dependency cycles, including self-imports. |
| **Evidence & Provenance** | Input SHA-256, byte ranges, confidence levels, analyzer profiles, omission counters, and incomplete-coverage indicators. |
| **Ghidra Integration** | Structured JSONL importer for functions, pseudocode, and references, with a Ghidra exporter script. Real exporter compilation and execution remain unverified. |
| **Large-File Analysis** | Chunked reads, bounded inventories, cooperative deadlines, cancellation, and failure isolation. These are not hard operating-system resource limits. |
| **Supporting Tools** | Bundle scanning, supplied-session summaries, dependency mapping, archive safety checks, and install-script auditing. |
| **Full Analysis Engine** | Provider adapters, CLI/MCP workflows, and optional runtime analysis capabilities. Availability and verification vary by operating system and installed tools. |

---

## Architecture

NEXORA ENGINE combines offline analysis capabilities with a broader provider-backed analysis engine.

```text
NEXORA ENGINE
│
├── Offline Analysis CLI
│   ├── Source Code Analysis
│   ├── Binary Inspection
│   ├── Project Dependency Analysis
│   ├── Architecture Reconstruction
│   ├── Ghidra Report Analysis
│   └── Evidence & Resource Management
│
└── Full Analysis Engine
    ├── CLI Interface
    ├── MCP Server
    ├── Shared Analysis Workflows
    ├── Provider Integrations
    └── Domain Contracts & Evidence
```

### Offline Analysis

The offline CLI is located at:

`nexora/bin/nexora.mjs`

It uses Node.js built-in functionality and does not require dependency installation or a build step for its supported offline commands.

### Full Engine

The full engine launcher is located at:

`scripts/rea.mjs`

It connects the compiled engine to CLI and MCP interfaces, shared workflows, provider adapters, and analysis contracts.

The full engine retains the layered architecture described in [Architecture Documentation](docs/architecture.mermaid).

The offline analysis additions are separate capabilities and are not automatically registered as new MCP operations.

---

## Requirements and Installation

### System Requirements

- **Node.js:** `^22.23.4`, `^24.22.1`, or `>=26.12.1`
- **Recommended repository-pinned Node.js:** `24.22.1`
- **npm:** `11.16.0` for the full dependency-backed engine
- **Git:** Required for cloning the repository
- **Operating Systems:** Windows, Linux, and macOS, subject to the platform-specific limitations described below

Optional providers such as Ghidra, Java, Hopper, IDA, and platform-specific native tools must be installed separately.

Their individual licenses and system requirements apply.

### Step 1 — Clone NEXORA ENGINE

```bash
git clone https://github.com/NADER-CY/nexora-engine.git
cd nexora-engine
```

### Step 2 — Run the Offline CLI

The offline CLI requires no dependency installation or build.

```bash
node nexora/bin/nexora.mjs --help
```

This command displays the available offline analysis commands.

### Step 3 — Install the Full Engine

For the full engine, install dependencies and build the project.

```bash
npm ci --ignore-scripts
npm run build
```

**Important:** Review dependency lifecycle scripts before enabling them.

The optional Frida dependency normally downloads a native binding through its lifecycle script. Skipping installation scripts can leave optional providers unavailable.

The repository's inherited `install.sh` targets an upstream distribution and is not the recommended NEXORA ENGINE installation method.

The npm package remains marked `private: true` and is not published as a public npm package.

### Installation Guides

Detailed platform-specific instructions are available in the repository documentation:

- [Windows Installation](docs/installation/windows.md)
- [Linux Installation](docs/installation/linux.md)
- [macOS Installation](docs/installation/macos.md)
- [Installation from Source](docs/installation/from-source.md)

Some of these detailed guides are part of the current development documentation and may not yet be present on the default branch.

---

## CLI Usage

NEXORA ENGINE provides commands for analyzing source code, software projects, binaries, reports, and archives.

### Analyze Source Code

```bash
node nexora/bin/nexora.mjs analyze-source ./example.ts --out source.json
```

Extract lexical functions, calls, imports, and dependency candidates from supported source files.

### Analyze an Entire Project

```bash
node nexora/bin/nexora.mjs analyze-project ./authorized-source --out project.json
```

Generate a bounded source and dependency map.

The report can include dependency relationships, incoming and outgoing connections, and cycles.

### Analyze Executable Binaries

```bash
node nexora/bin/nexora.mjs analyze-binary ./authorized-binary --out binary.json
```

Inspect supported PE, ELF, and Mach-O executable formats.

Results depend on the input format and available analysis capabilities.

### Import Ghidra Reports

```bash
node nexora/bin/nexora.mjs ghidra-report ./export.jsonl --out ghidra.json
```

Process structured JSONL records exported by the Ghidra integration.

### Scan JavaScript Bundles

```bash
node nexora/bin/nexora.mjs scan-bundle ./app.bundle.js --out bundle.json
```

### Summarize Supplied Sessions

```bash
node nexora/bin/nexora.mjs summary ./supplied-session.jsonl --out summary.json
```

### Inspect ZIP Archives

```bash
node nexora/bin/nexora.mjs check-archive ./incoming.zip
```

Inspect archive entries for unsafe paths without extracting the archive.

### Audit Dependency Lifecycle Scripts

```bash
node nexora/bin/nexora.mjs audit-lifecycle .
```

### Inspect Analysis Limits

```bash
node nexora/bin/nexora.mjs limits
```

### Understanding Results

Analysis reports may include:

- Input file identity
- SHA-256 checksums
- Source or binary locations
- Function and symbol references
- Dependency candidates
- Evidence ranges
- Confidence classifications
- Warnings
- Truncation and omission counters
- Coverage limitations

Always review evidence and coverage indicators before interpreting the results as complete.

For technical schemas, resource limits, and additional examples, see [PHASE3A.md](PHASE3A.md).

---

## MCP Integration

NEXORA ENGINE includes a provider-backed MCP server interface for compatible MCP clients.

MCP stands for **Model Context Protocol**.

### Start the MCP Server

After successfully building the full engine:

```bash
node scripts/rea.mjs mcp
```

The server communicates over standard input and output.

### Generic MCP Client Configuration

Use an absolute path to your local NEXORA ENGINE installation:

```json
{
  "mcpServers": {
    "nexora-engine": {
      "command": "node",
      "args": [
        "/absolute/path/to/nexora-engine/scripts/rea.mjs",
        "mcp"
      ]
    }
  }
}
```

Replace the example path with the actual location of your installation.

On Windows, ensure that absolute paths are correctly escaped when using JSON.

### Automatic Local Setup

The following command can register the local launcher with supported detected clients:

```bash
node scripts/rea.mjs setup
```

Review any proposed configuration changes before accepting them.

### Important MCP Notes

- The full engine must be built before starting the server.
- Optional provider functionality depends on installed dependencies.
- Not every offline analysis command is currently exposed as an MCP operation.
- Full MCP client discovery and provider-backed integration have not been comprehensively revalidated.
- Do not use an unpublished `npx` package name as an installation method.

---

## Supported Platforms

| Platform | Current support |
|---|---|
| **Windows** | Offline analysis workflows have focused test coverage. Optional native integrations require additional toolchains. |
| **Linux** | Portable offline workflows are designed for Linux, but additional platform-specific verification is required. |
| **macOS** | Portable offline workflows are designed for macOS, but native and provider integrations require separate verification. |

The current publication checks were performed on Windows x64.

Real PE inspection was checked against the host Node.js executable. ELF and Mach-O coverage at publication used deterministic fixtures.

Optional Windows native functionality requires the relevant compiler and native artifact verification process.

See [Windows Native Integration](native/windows/README.md).

---

## Security and Privacy

NEXORA ENGINE is intended for authorized software inspection and analysis.

Only analyze software, files, applications, and systems that you own or are permitted to investigate.

### Offline Analysis

The offline analysis commands read caller-supplied local files without executing target code.

### Provider-Backed Workflows

Other full-engine workflows may:

- Launch external analysis providers
- Interact with local applications
- Inspect authorized runtime environments
- Fetch caller-selected resources

Review the permissions and behavior of each provider before enabling it.

### Sensitive Information

Analysis reports can contain:

- Source code
- Function names and symbols
- Filesystem paths
- Decompiled material
- Application structure
- Runtime or session evidence

Do not publish reports containing confidential information without reviewing and sanitizing them.

### Resource Safety

The analysis engine includes bounded inventories, input-size checks, cancellation, and cooperative deadline controls.

These controls do not replace operating-system isolation for untrusted or hostile inputs.

No general telemetry guarantees are made for optional third-party tools.

For more details:

- [Security Policy](SECURITY.md)
- [Publication Security Review](PUBLICATION_REVIEW.md)

Automatic npm, Cloudflare, GitHub Pages, and MCP registry publication workflows remain disabled.

---

## Tests and Verification

### Focused Analysis Tests

```bash
npm run test:nexora:phase3a
```

### Existing Compatibility Tests

```bash
node --test nexora/test/core.test.mjs nexora/test/analysis.test.mjs nexora/test/esm-paths.test.mjs nexora/test/windows-native-build.test.mjs
```

The complete test suite may require additional dependencies, platform-specific tools, and a supported Node.js runtime.

```bash
npm run test:nexora
```

Full upstream TypeScript tests, build validation, lint checks, and optional provider integrations must be evaluated separately.

Passing focused tests does not establish production readiness for every provider.

Benchmark generators are available under:

`nexora/bench/`

Generated benchmark inputs and machine-specific verification artifacts are intentionally excluded from the public source distribution.

---

## Current Limitations

NEXORA ENGINE is actively being developed.

The following limitations apply to the published baseline:

- Lexical analysis is not equivalent to full compiler-level scope and type resolution.
- Macros, templates, interpolated strings, indirect calls, and dynamic language constructs can produce incomplete results.
- Cross-file semantic call resolution is limited in the published baseline.
- The offline binary reader does not reconstruct instruction-level call graphs.
- Universal Mach-O and several optional executable metadata formats remain unsupported.
- Ghidra importer fixture tests do not prove real exporter or decompiler compatibility.
- Decompiled pseudocode is derived analysis output, not the original source code.
- Missing, ambiguous, external, or dropped dependency facts can prevent complete architecture reconstruction.
- Incomplete dependency graphs cannot establish the absence of cycles.
- Full engine build, lint, MCP integration, and optional provider workflows are not represented as fully verified by the focused offline test results.
- Optional third-party source trees may be absent from the supplied source distribution.

See [Third-Party Components](third_party/README.md).

Newer capabilities under development may address some of these limitations, but should not be treated as released until merged and verified.

---

## Development Roadmap

NEXORA ENGINE is being expanded toward deeper evidence-driven software analysis.

### 1. Advanced Binary Analysis

- Expand PE, ELF, and Mach-O metadata support.
- Improve relocation and symbol analysis.
- Add instruction-level analysis where supported.
- Improve function relationships and control-flow reconstruction.

### 2. Ghidra Integration

- Verify real exporter compilation and execution.
- Expand function and reference extraction.
- Improve pseudocode report handling.
- Validate provider compatibility using real test binaries.

### 3. Semantic Source Analysis

- Improve compiler-aware analysis.
- Expand symbol and scope resolution.
- Strengthen cross-file function relationships.
- Improve module and dependency resolution.

### 4. Architecture Reconstruction

- Expand evidence-based architecture graphs.
- Improve component and service relationship analysis.
- Support richer structured analysis reports.
- Improve visualization and traceability.

### 5. Reliability and Compatibility

- Extend Windows, Linux, and macOS verification.
- Improve resource and provider testing.
- Review optional third-party components.
- Strengthen reproducibility and security checks.

These items describe development priorities, not guarantees that every feature is already available.

---

## Open Source and Contributing

NEXORA ENGINE is an open-source project distributed under the MIT License.

Developers and researchers are welcome to review the source, report reproducible issues, suggest improvements, and contribute changes.

For the latest development status, source code, and available documentation, visit:

[**NEXORA ENGINE on GitHub**](https://github.com/NADER-CY/nexora-engine)

Please review the repository's contribution and security policies before submitting changes.

---

## Origin and License

NEXORA ENGINE is derived from the MIT-licensed **REA — Reverse Engineer Anything** project, originally developed by **morluto**.

Upstream source: https://github.com/morluto/rea

Original upstream package: `rea-agents` 6.8.0

Original upstream reference commit:

`3b242491a430b3807853436bfeb9568d606169ac`

The original project provides a substantial portion of the underlying engine, providers, bridges, and supporting architecture.

NEXORA ENGINE extends that foundation with additional offline analysis, architecture reconstruction, resource-management improvements, and related development work.

NEXORA ENGINE is an independent derivative project and is not affiliated with or endorsed by the original authors.

The original MIT License and **Copyright (c) 2026 morluto** are preserved.

Additional attribution and license information:

- [LICENSE](LICENSE)
- [NOTICE.md](NOTICE.md)
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- [Original Project Documentation](UPSTREAM_README.md)
- `licenses/`

Historical upstream documentation may describe distribution mechanisms or integrations that are not enabled in NEXORA ENGINE.

---

**NEXORA ENGINE — Follow the evidence. Understand the system.**
