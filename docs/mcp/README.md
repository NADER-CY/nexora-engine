# MCP setup

The full NEXORA ENGINE server is launched with `node /absolute/path/to/nexora-engine/scripts/nexora-engine.mjs mcp` after [building from source](../installation/from-source.md). The dependency-free offline additions are CLI commands; they are not separately registered MCP tools.

- [Codex](codex.md): TOML or `codex mcp add`.
- [Claude Code and Desktop](claude.md): CLI registration or Desktop JSON.
- [Other clients](generic-client.md): stdio connection contract and verification.

Always resolve absolute paths locally. Do not paste illustrative paths without replacing them, and do not use `npx nexora-engine` for this unpublished package. Keep transport stdout reserved for MCP protocol messages. The optional `setup` workflow can alter detected client configuration; review its proposed changes first.

Validation levels differ: configuration syntax, server startup, protocol initialization, tool listing, invocation and shutdown are separate checks. The Windows x64 full build passed. A direct stdio smoke check initialized the server, listed 231 tools and shut down cleanly. Provider invocation and live Codex/Claude connections have not been verified here. Record the failing stage, client/server versions and sanitized stderr when troubleshooting. Do not publish session captures or credentials.

## Optional plugin metadata

The Codex and Claude manifests use NEXORA ENGINE identity and the local plugin launcher, with version pins checked against package.json. Their marketplace entries point to local source rather than an upstream npm package. Manifest/icon paths are checked; installation through either client's plugin UI is unverified. A source plugin still needs dependencies, compiled runtime and platform prerequisites at its installed location. Prefer the explicit local MCP registration above for the documented source-build workflow; no one-click plugin installation is promised.
