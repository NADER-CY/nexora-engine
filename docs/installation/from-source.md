# Install NEXORA ENGINE from source

## Prerequisites

Use Git, Node.js 24.22.1 (the repository pin) and npm 11.16.0. The accepted Node ranges in package.json are `^22.23.4 || ^24.22.1 || >=26.12.1`. Check `node --version` and `npm --version`; an arbitrary LTS version may be too old. These instructions do not install system software.

```sh
git clone https://github.com/NADER-CY/nexora-engine.git
cd nexora-engine
node nexora/bin/nexora.mjs analyze-project examples/tutorial/cycle
```

Alternatively download the [main source ZIP](https://github.com/NADER-CY/nexora-engine/archive/refs/heads/main.zip), extract it and enter its root. The offline CLI needs no dependencies or build. Expect schema `nexora-project-analysis/v1` and the two-file dependency cycle. Never use an unpublished registry package or the inherited installer to acquire this source distribution.

## Full engine

Install the locked dependencies without running dependency lifecycle scripts:

```sh
npm ci --ignore-scripts
```

**Windows x64 requires the native addon before the full build.** Supply an existing MSYS2 UCRT64 or MINGW64 GCC toolchain; neither a compiler nor Java is installed automatically:

```powershell
$env:NEXORA_MINGW_BIN = 'C:\msys64\ucrt64\bin'
npm run build:windows-native
npm run verify:windows-native:artifact
```

The explicit directory must contain the matching x64 GCC/dlltool tools. The build can download pinned official Node-API headers, checks their SHA-256 and rejects unsupported compiler targets. See [native controls](../../native/windows/README.md).

Then build and check the runtime:

```sh
npm run build
node scripts/nexora-engine.mjs --help
node scripts/nexora-engine.mjs mcp
```

The final command speaks MCP over stdio and waits for protocol input. See [client setup](../mcp/README.md). For Linux/macOS the same dependency/build commands are source-derived but were not executed on those systems; native/provider requirements differ.

Windows x64 installation, native build/verification and full compilation passed on the pinned toolchain. The initial full build failed because the native addon had not yet been built; the corrected order above passed. Live Codex/Claude connections and real Ghidra execution remain unverified. [Verification record](../github-experience-verification.md).

Do not enable every lifecycle script to work around an optional dependency failure. Review the exact provider requirement. The offline CLI remains available when full-engine dependencies are unavailable. The package remains private for npm; no prebuilt installer or registry distribution is promised.

## Optional providers

Ghidra needs a compatible caller-supplied distribution and full JDK. Follow [Ghidra setup](../tutorials/ghidra.md); optional providers have their own platform and licensing constraints. Do not fetch unreviewed submodules as part of basic installation.

[Windows](windows.md) · [Linux](linux.md) · [macOS](macos.md) · [Update safely](updating.md) · [Troubleshooting](../troubleshooting.md).
