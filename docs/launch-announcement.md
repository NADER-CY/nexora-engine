# Launch announcement draft

Prepared for a human to adapt to a relevant developer community. Not posted automatically. Check the target community's rules and current branch status before sharing.

---

**NEXORA ENGINE: local reverse-engineering reports with traceable evidence**

I'm developing NEXORA ENGINE, an independently maintained MIT-licensed platform expanded from the REA codebase by morluto, for developers who want to inspect source code, executable metadata and software dependencies locally.

The dependency-free CLI produces lexical function/call candidates for six languages, ELF/PE/thin Mach-O metadata, and file dependency maps with cycle detection. Reports include input hashes, byte ranges and coverage limits so findings can be checked against the artifact. A small included sample lets you try it without installing dependencies.

It's development source—not a finished disassembler or compiler-semantic analyzer. The optional full MCP engine needs its own build and providers; real Ghidra exporter validation remains open. Optional JS/TS scope analysis and unified JSON/Mermaid evidence graphs are integrated on main; they remain static candidates rather than runtime proof.

Repository: https://github.com/NADER-CY/nexora-engine

I'd welcome feedback on report usability, reproducible parser edge cases and platform verification. Please use non-sensitive examples and keep security reports private. Upstream attribution and the original MIT license are preserved.
