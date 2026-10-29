# Windows 10/11 installation

Use PowerShell, Git and a supported Node.js/npm toolchain from [source prerequisites](from-source.md). The offline CLI needs no compiler.

```powershell
git clone https://github.com/NADER-CY/nexora-engine.git
Set-Location nexora-engine
node --version
node .\nexora\bin\nexora.mjs analyze-source .\examples\tutorial\project\main.js
```

## Full CLI and MCP on Windows x64

Supply an existing MSYS2 UCRT64 or MINGW64 GCC toolchain. Run in this order:

```powershell
npm ci --ignore-scripts
$env:NEXORA_MINGW_BIN = 'C:\msys64\ucrt64\bin'
npm run build:windows-native
npm run verify:windows-native:artifact
npm run build
node .\scripts\nexora-engine.mjs --help
node .\scripts\nexora-engine.mjs mcp
```

Replace the compiler path with your actual installation. Windows x64 native controls require Windows 10+ and fixed local NTFS volumes; Windows ARM64 full-engine support is not claimed. The addon build checks compiler target, permitted DLL imports, manifest identity and hash. It may download integrity-checked official Node-API headers. [Native details](../../native/windows/README.md).

All dependency/native/full-build steps above passed on Windows x64 with Node 24.22.1/npm 11.16.0. Live desktop-client registration and Ghidra execution were not run. Ghidra and a full JDK are separate prerequisites.

Use absolute local Node and launcher paths in [MCP configuration](../mcp/README.md). JSON needs doubled backslashes; TOML literal strings can preserve single backslashes. Waiting for MCP protocol input is normal.

If temporary files cannot be created, select a writable temporary directory for this terminal session and keep it outside commits. Do not remove resource checks or enable all install scripts to bypass an error. [Troubleshooting](../troubleshooting.md) · [Updates](updating.md).
