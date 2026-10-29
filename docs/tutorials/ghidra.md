# Ghidra export and import

Provide an existing compatible Ghidra installation and its required JDK. No tool is downloaded or installed automatically. Inspect `bridge/ghidra/NexoraExport.java` and use a throwaway project directory outside the repository. The exporter writes a new file and refuses to overwrite an existing output.

Example for a configured headless launcher (replace all paths):

```sh
/absolute/ghidra/support/analyzeHeadless /absolute/tmp/projects nexora-example -import /absolute/tmp/nexora-example -scriptPath /absolute/nexora-engine/bridge/ghidra -postScript NexoraExport.java /absolute/tmp/export.jsonl 5000 30 -deleteProject
node nexora/bin/nexora.mjs ghidra-report /absolute/tmp/export.jsonl
```

On Windows use `analyzeHeadless.bat` and PowerShell's `&` invocation operator with quoted absolute paths. The final exporter parameters bound functions and per-function decompilation seconds. An external overall timeout is still necessary for headless analysis. Preserve partial JSONL when a run is interrupted; a missing footer or dropped/oversized rows means incomplete coverage.

The original binary SHA-256 in the header is provider-reported. Use `node nexora/bin/nexora.mjs ghidra-report /absolute/tmp/export.jsonl --binary /absolute/tmp/nexora-example` to independently hash and match the supplied binary. A mismatch is an invalid-input error with no report output. `binaryIdentity.status` distinguishes `provider-claimed` from `matched-supplied-binary`; matching does not authenticate the exporter or pseudocode. Pseudocode is decompiler-derived. API compatibility, real headless execution and tool availability are reported in [milestones](../milestones.md); fixture ingestion alone does not establish real Ghidra success.
