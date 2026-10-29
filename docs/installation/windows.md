# Windows installation

Use PowerShell and a Node version accepted by [the source guide](from-source.md). Git and Node must be available on PATH.

```powershell
git clone https://github.com/NADER-CY/nexora-engine.git
Set-Location nexora-engine
node --version
node .\nexora\bin\nexora.mjs analyze-source .\examples\tutorial\project\main.js
```

For the full engine, from the repository root:

```powershell
npm ci --ignore-scripts
npm run build
node .\scripts\rea.mjs mcp
```

The MCP process speaks JSON-RPC over stdio; waiting for input is normal. Use [client configuration](../mcp/README.md) to verify initialization/tools rather than typing arbitrary text into it. Use absolute paths to both Node and the launcher when configuring a client. JSON requires doubled backslashes; TOML literal strings can use single backslashes.

The optional Windows native addon requires its documented compiler/header and artifact checks; it is not needed by the offline CLI. Ghidra and a compatible JDK must be provided separately. Do not run the inherited Bash installer to install NEXORA ENGINE.

If tests fail creating temporary files in a restricted environment, choose a writable temporary directory for this terminal session:

```powershell
New-Item -ItemType Directory -Force .\local-test-temp | Out-Null
$env:TEMP = (Resolve-Path .\local-test-temp).Path
$env:TMP = $env:TEMP
npm run test:nexora:phase3a
```

Keep temporary artifacts out of commits. Current offline tests ran on Windows; full-engine/provider build and live client connection remain unverified.
