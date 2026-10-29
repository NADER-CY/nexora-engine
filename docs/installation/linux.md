# Linux installation

Follow [source prerequisites](from-source.md) for exact supported Node/npm versions. Check your shell resolves the intended Node executable before installing dependencies.

```sh
git clone https://github.com/NADER-CY/nexora-engine.git
cd nexora-engine
node --version
node nexora/bin/nexora.mjs analyze-source examples/tutorial/project/main.js
```

## Full engine (not executed on this OS in this verification)

```sh
npm ci --ignore-scripts
npm run build
node scripts/nexora-engine.mjs mcp
```

The dependency-free offline CLI does not need the full build. Provider tools and native bridges are OS-specific; a successful offline command does not verify them. Supply Ghidra and its compatible JDK yourself; no automatic installation is performed. The inherited upstream installer is not the NEXORA ENGINE installer.

Use [MCP guides](../mcp/README.md) for absolute local paths and connection verification. If an optional dependency fails after scripts were skipped, review that provider's documented build requirements rather than enabling every install script. This environment did not execute the Linux installation or live MCP client workflow; these commands are documented from the supported source entrypoints.
