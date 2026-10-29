# Generic stdio MCP clients

The launch contract is a local process: executable `node`, arguments `["/absolute/path/to/nexora-engine/scripts/nexora-engine.mjs", "mcp"]`. Build the full engine first. The client must support MCP stdio and manage initialization, tool discovery and process shutdown.

There is no universal client configuration file. This example applies only to clients that document the `mcpServers` JSON shape; translate it using your client's documentation:

```json
{"mcpServers":{"nexora-engine":{"command":"node","args":["/absolute/path/to/nexora-engine/scripts/nexora-engine.mjs","mcp"]}}}
```

Windows JSON paths need doubled backslashes, for example `C:\\dev\\nexora-engine\\scripts\\nexora-engine.mjs`. A full absolute Node executable path avoids PATH differences between terminals and desktop clients. Do not assume `cwd`, timeout or transport keys are accepted by every client.

Verify these stages separately: process starts; MCP initialization succeeds; tools list is returned; one authorized local-file read succeeds; cancellation/shutdown releases the process. The server may wait silently on stdin when started manually. Keep diagnostics on stderr and never insert progress text into protocol stdout. Full-server end-to-end client verification was not performed here. See [Codex](codex.md) and [Claude](claude.md) for client-specific examples.
