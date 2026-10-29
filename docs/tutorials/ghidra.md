# Ghidra export and import

Provide an existing compatible Ghidra installation and its required JDK. No tool is downloaded or installed automatically. Inspect `bridge/ghidra/NexoraExport.java` and use a throwaway project directory outside the repository. The exporter writes a new file and refuses to overwrite an existing output.

Example for a configured headless launcher (replace all paths):

```sh
/absolute/ghidra/support/analyzeHeadless /absolute/tmp/projects nexora-example -import /absolute/tmp/nexora-example -scriptPath /absolute/nexora-engine/bridge/ghidra -postScript NexoraExport.java /absolute/tmp/export.jsonl 5000 30 -deleteProject
node nexora/bin/nexora.mjs ghidra-report /absolute/tmp/export.jsonl
```

On Windows use `analyzeHeadless.bat` and PowerShell's `&` invocation operator with quoted absolute paths. The final exporter parameters bound functions and per-function decompilation seconds. An external overall timeout is still necessary for headless analysis. Preserve partial JSONL when a run is interrupted; a missing footer or dropped/oversized rows means incomplete coverage.

The original binary SHA-256 in the header is provider-reported. Do not assume the importer independently authenticates it unless binary-identity verification is explicitly requested and reported. Pseudocode is decompiler-derived. API compatibility, real headless execution and tool availability are reported in [milestones](../milestones.md); fixture ingestion alone does not establish real Ghidra success.

## Requirements and provider setup

The full provider checks its supported Ghidra 12.x contract (12.1 or newer) and the selected release's `application.properties` Java requirements. Ghidra 12.1 requires JDK 21+; 12.2 requires JDK 25+. Use a full compatible JDK, not merely a JRE. No Ghidra or Java installation occurred in this verification. See [provider contract](../ghidra-provider.md) for supported host lanes and limitations; Windows x64 is experimental read-only P0.

Set absolute paths in the launching terminal, replacing examples with your installation:

```powershell
$env:GHIDRA_INSTALL_DIR = 'C:\tools\ghidra'
$env:JAVA_HOME = 'C:\tools\jdk'
node scripts/nexora-engine.mjs doctor --provider ghidra --json
```

On POSIX shells use `export GHIDRA_INSTALL_DIR=/absolute/ghidra` and `export JAVA_HOME=/absolute/jdk`. The native decompiler must match the host OS/architecture.

## Verify export identity

```sh
node nexora/bin/nexora.mjs ghidra-report /absolute/tmp/export.jsonl --binary /absolute/tmp/nexora-example
```

The importer independently hashes the supplied binary and rejects a mismatched export header. Without `--binary`, header identity is provider-reported. A missing footer or interrupted export remains partial. The bundled synthetic JSONL validates ingestion only, not real Ghidra API compilation or decompiler output.

## Conditional full-engine analysis

After building the full engine and passing provider diagnostics, invoke `analyze <binary> --provider ghidra --json`. Select a function address from the analysis, then invoke `decompile <binary> <address> --provider ghidra --json` through `node scripts/nexora-engine.mjs`. These are source-derived workflows; real provider execution is unverified here.
