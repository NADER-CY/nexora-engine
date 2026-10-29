# Architecture evidence

The offline CLI is separate from the compiled provider-backed engine. Use the offline reports to inspect local static evidence without starting providers.

```sh
node nexora/bin/nexora.mjs analyze-project examples/tutorial/cycle
node nexora/bin/nexora.mjs architecture-report examples/tutorial/cycle --out .nexora-reports/architecture.json
node nexora/bin/nexora.mjs architecture-report examples/tutorial/cycle --format mermaid --out .nexora-reports/architecture.mmd
```

`analyze-project` includes `architecture` with schema `nexora-architecture/v1`: file dependencies, incoming/outgoing degrees and strongly connected cycle groups. The unified architecture commands add provenance-bearing file, symbol, call and supported route/event/configuration relationships. Inspect each result's schema and coverage; these projections serve different scopes.

After installing locked dependencies, opt into AST scopes and direct relative ESM function-call candidates:

```sh
node nexora/bin/nexora.mjs architecture-report-ast examples/tutorial/project --format mermaid
```

Evidence byte ranges belong to per-file SHA-256 identities. Static candidates are not compiler/module-loader or runtime proof. External, ambiguous, missing, failed and omitted facts remain explicit; cycles and degree counts describe retained edges only. AST input is capped at 2 MiB per file and remains bounded by project traversal/output budgets.

Member calls, CommonJS, re-exports, type-only references and dynamic scope can remain unresolved. Supported framework candidates require import/binding evidence, not suggestive names. No service, database, event contract or WebSocket schema is fabricated from filenames or live traffic.

The full engine uses shared application workflows between CLI/MCP adapters and provider/domain contracts: [layered architecture](../architecture.mermaid). Offline additions do not automatically register MCP tools.
