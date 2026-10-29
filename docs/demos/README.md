# Recorded demonstrations

These JSON files were captured by running the unchanged main-branch offline CLI against the included non-sensitive examples. They are reports, not invented UI screenshots. [provenance.json](provenance.json) records the baseline, runtime, commands and output hashes.

Recorded command arrays use portable relative paths in place of the local machine's absolute paths. The report bytes and input identities come from the actual runs.

- [source.json](source.json): source declarations and a same-file unique-name call candidate.
- [project.json](project.json): main.js imports worker.js.
- [cycle.json](cycle.json): a.js and b.js form a static dependency cycle.
- [binary-summary.json](binary-summary.json): selected fields from a real locally compiled MinGW PE; the target was not executed. Its build hash is illustrative of that actual run, not a reproducibility guarantee across compilers.
- [ghidra-synthetic.json](ghidra-synthetic.json): explicitly synthetic importer input/output. It does not verify a real Ghidra exporter or decompiler.

Run `node scripts/verify-github-docs.mjs` from the repository root to check the included source/project/Ghidra commands, local documentation/assets and recorded invariants without installing dependencies. Binary compilation needs a separately installed compiler; no binary artifact is committed. The Windows full build and direct MCP protocol smoke check passed later; real Ghidra and live client connections remain unverified. See the [verification scope](../github-experience-verification.md).
