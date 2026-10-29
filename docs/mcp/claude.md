# Claude Code and Claude Desktop

First [build the full server](../installation/from-source.md). Instructions were checked against [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) and [the MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) on 2026-10-28. No live client connection is claimed.

## Claude Code

```sh
claude mcp add --transport stdio nexora-engine -- node /absolute/path/to/nexora-engine/scripts/rea.mjs mcp
claude mcp get nexora-engine
```

In PowerShell, quote paths containing spaces:

```powershell
claude mcp add --transport stdio nexora-engine -- "C:\Program Files\nodejs\node.exe" "C:\dev\nexora-engine\scripts\rea.mjs" mcp
```

Use `/mcp` in Claude Code for connection status. Configuration registration is not proof of successful server initialization.

## Claude Desktop

Merge an entry into `claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS):

```json
{"mcpServers":{"nexora-engine":{"command":"C:\\Program Files\\nodejs\\node.exe","args":["C:\\dev\\nexora-engine\\scripts\\rea.mjs","mcp"]}}}
```

For macOS replace both paths with absolute paths to the intended Node executable and checkout. Restart Desktop and check its server status/logs. If it fails, validate JSON, confirm the paths exist, and run the exact launcher manually. Missing compiled runtime requires the full build; arbitrary timeout increases do not fix it.
