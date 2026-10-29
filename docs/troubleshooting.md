# Troubleshooting and FAQ

## Node or npm version rejected

Check `node --version`, `npm --version` and the executable resolved by PATH. The repository pins Node 24.22.1/npm 11.16.0. Its accepted Node range is in package.json; older installed LTS versions may not qualify. Use the intended toolchain without changing the engine's version checks.

## First run and optional AST parser

The lexical offline CLI requires no dependency installation: `node nexora/bin/nexora.mjs --help`. AST commands require locked dependencies (`npm ci --ignore-scripts`). A missing optional parser does not mean lexical commands are unavailable. Do not substitute runtime or type-checking claims for static candidates.

## Compiled runtime or Windows native artifact missing

Use [the complete build order](installation/from-source.md). On Windows x64, compile and verify the native addon before `npm run build`. Supply an existing supported MinGW GCC toolchain. A missing `native/windows/build/manifest.json` is a build-prerequisite failure; do not bypass artifact verification or point the loader at an arbitrary module.

## MCP server appears to hang

Stdio waits for JSON-RPC initialization. Register absolute local Node/launcher paths in the client. Verify process startup, initialization, tool discovery, a read-only invocation and shutdown separately. Configuration syntax alone is not a live-client test. Inspect sanitized stderr; stdout belongs to the protocol. See [MCP setup](mcp/README.md).

## Ghidra unavailable

Provide a supported local Ghidra distribution and its compatible full JDK. Check `GHIDRA_INSTALL_DIR`, `JAVA_HOME` and the selected release's Java contract. Run provider diagnostics after building. Fixture import success does not validate a real decompiler. See [Ghidra tutorial](tutorials/ghidra.md).

## Partial output, unresolved edges or report errors

Inspect coverage, omissions, method and confidence. Missing input, unsupported format, parser ambiguity and exhausted limits have different meanings. Preserve the actual error and smallest non-sensitive reproduction. Never treat dropped facts as proof of absence or remove limits to make a report appear complete.

## Can I share a report?

Reports can include proprietary code, absolute paths, configuration references and pseudocode. Review and sanitize before sharing. Do not attach credentials, session captures or private target data to public issues. [Security policy](../SECURITY.md).

## Updating or finding an installer

This project distributes source; there is no official unpublished-package workaround, prebuilt installer or automatic registry update. Follow [updating safely](installation/updating.md), preserve local changes, and rebuild the full engine after source changes.
