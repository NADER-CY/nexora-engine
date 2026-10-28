# Codex

Build the full engine first; see [MCP prerequisites](README.md). These registration/configuration examples follow [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp), checked 2026-10-28. A live NEXORA ENGINE connection was not executed here.

```sh
codex mcp add nexora-engine -- node /absolute/path/to/nexora-engine/scripts/rea.mjs mcp
codex mcp list
```

Alternatively, merge into `~/.codex/config.toml`:

```toml
[mcp_servers.nexora-engine]
command = "node"
args = ["/absolute/path/to/nexora-engine/scripts/rea.mjs", "mcp"]
```

Windows example, with illustrative paths replaced by your installation:

```toml
[mcp_servers.nexora-engine]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\dev\nexora-engine\scripts\rea.mjs', 'mcp']
```

After registration, use `/mcp` in the Codex terminal client to inspect active servers. A saved configuration alone does not prove successful initialization. If startup fails, run the exact launcher manually, check `dist/` was built and inspect sanitized stderr. Resolve missing Node/launcher paths before changing client timeouts. Keep offline source analysis tests distinct from full-server tool discovery and invocation.
