# Development milestone evidence

This page records development scope, not a production-readiness claim. No release/deployment workflow is enabled. Source package version and upstream history remain separate from the NEXORA release field.

## Milestone 1 — Documentation and installation

Added platform/source installation guides, official-source-backed Codex/Claude and generic MCP instructions, source/project/cycle and explicitly synthetic Ghidra examples, evidence/binary tutorials, architecture/roadmap navigation and community guidance. The original upstream changelog/contribution text and all license notices remain.

Verification: three tutorial/link/configuration tests passed and all 39 existing focused tests passed, with no failures or skips. Commands: `npm run test:nexora:docs` and `npm run test:nexora:phase3a`. The tutorial suite executes the actual offline CLI, checks expected invariants, validates new local documentation links and parses JSON configuration blocks. Subsequent combined regression results are recorded in the PR and delivery report.

Full-engine installation/build and live MCP client connections remain unverified: dependencies are absent and available Node 24.21.0 is below the repository's 24.22.1 pin. No client capability is inferred from successful offline CLI tests. Linux/macOS installation and Ghidra headless commands are documented procedures, not executed platform verification.

## Milestone 2 — Binary and Ghidra

Implemented bounded PE base relocation entries (including HIGHADJ pairs), CodeView RSDS metadata, COFF long section-name decoding, ELF symbol/section annotations and Mach-O relocation-directory/debug-symbol descriptors. Relocations remain raw architecture-specific facts and are not applied. Added independent supplied-binary SHA-256 matching with `ghidra-report --binary FILE`, preserving partial-export status. Three new integration tests passed, including compilation of the checked-in C sample with local MinGW GCC and comparison against local objdump; the target was never executed. New real-tool coverage exposed and fixed missing COFF long section-name decoding. ELF/Mach-O relocations, instruction disassembly/CFGs and real Ghidra execution remain outside this increment. Ghidra/Java were not found on PATH or the checked standard installation locations; no automatic installation occurs. Existing Ghidra API/runtime verification remains open.

## Milestone 3 — Semantic source

Next: expose a supported AST/semantic path using existing parser ownership; retain lexical behavior and explicit unresolved references. JS/TS parser dependencies exist in the lockfile but are not installed here. No compiler-level semantic coverage is claimed for Go/Rust/C/C++.

## Milestone 4 — Architecture reconstruction

Next: identity-bearing unified graph exports and Mermaid, reusing parsed facts. Existing project dependency cycles are already supported. Service/database/event/WebSocket runtime relationships must remain unknown without corresponding evidence.

No performance measurement has been executed for these documentation changes.
