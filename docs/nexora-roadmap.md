# NEXORA ENGINE roadmap

## On main

Dependency-free lexical source analysis, ELF/PE/thin Mach-O metadata, evidence-bearing file dependency/cycle reports and supplied Ghidra JSONL ingestion. These capabilities have explicit coverage and resource limits.

## Proposed in draft PR #1

See [the development PR](https://github.com/NADER-CY/nexora-engine/pull/1) for opt-in JS/TS AST scopes, direct relative ESM call candidates, richer relocation metadata, Ghidra binary-identity matching and unified JSON/Mermaid architecture reports. These are not merged or released on main.

## Further verification and development

Real Ghidra exporter/headless verification; broader real ELF/Mach-O cases; deeper compiler-aware source relationships; native instruction CFG integration; more provider and OS verification. These are planned tasks, not availability claims. Service boundaries and runtime message schemas require evidence, never name-only guesses.

Registry, binary release and site deployment remain out of scope unless separately authorized. The original [upstream roadmap](roadmap.md) is retained without being represented as a NEXORA release schedule.
