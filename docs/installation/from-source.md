# Install NEXORA ENGINE from source

Clone this repository, rather than using an unpublished npm package or the inherited upstream `install.sh`:

```sh
git clone https://github.com/NADER-CY/nexora-engine.git
cd nexora-engine
node --version
node nexora/bin/nexora.mjs --help
```

The dependency-free offline CLI needs no install/build step. It analyzes local supplied artifacts; it does not start the full MCP engine.

## Full engine

`package.json` requires Node `^22.23.4 || ^24.22.1 || >=26.12.1`; `.nvmrc` pins `24.22.1` and `packageManager` specifies `npm@11.16.0`. Check these files before installing a toolchain; this guide does not install or upgrade system software. Use a supported Node version, not merely an arbitrary current LTS.

```sh
npm ci --ignore-scripts
npm run build
node scripts/rea.mjs mcp
```

Do not remove `--ignore-scripts` to work around a failure. Optional native dependencies can remain unavailable when their lifecycle scripts are skipped. Review the exact failing toolchain/provider before explicitly enabling a necessary build step. The offline CLI remains usable when the full build cannot complete.

The package remains private for npm. No registry package, prebuilt NEXORA ENGINE release or installer is promised. Full build/MCP client connections were not validated in the current environment; see [verification](../milestones.md).

## Optional tools

Ghidra needs a compatible local Ghidra distribution and its required JDK. No Ghidra/Java auto-install occurs. Use [the Ghidra tutorial](../tutorials/ghidra.md). Optional native/provider dependencies have separate platform and license requirements; [the Windows addon guide](../../native/windows/README.md) describes its build and verification. Do not fetch unreviewed optional submodules as part of the basic installation.

See [Windows](windows.md), [Linux](linux.md), [macOS](macos.md), [MCP setup](../mcp/README.md), and [first analysis](../tutorials/README.md).
