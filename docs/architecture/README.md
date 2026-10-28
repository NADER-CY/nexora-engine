# Evidence and architecture contracts

The offline path lives in `nexora/lib/`; the full engine retains [the upstream layered map](../architecture.mermaid). Project analysis owns file identity and dependency resolution. Architecture summaries consume its parsed facts, avoiding a second interpretation of raw source.

`nexora-project-analysis/v1` includes files, symbols, calls, dependencies, failures and `architecture`. The current `nexora-architecture/v1` summarizes local dependency candidates: nodes have distinct incoming/outgoing file counts; edges retain import-site evidence; cycle groups are strongly connected components. Cross-file function calls remain unresolved.

Evidence byte ranges belong to the per-file digest in the project report. `local-path-candidate` is not compiler/module-loader proof. Missing, external, ambiguous, failed or omitted facts prevent complete coverage. Cycles/degrees describe retained edges only. Do not infer services, database layers, event contracts or live WebSocket schemas merely from filenames.

The next graph milestone will add a unified export carrying identity/method/confidence/coverage per relationship and deterministic Mermaid rendering. Until that command is documented and tested, consume the existing JSON through `analyze-project`. No live systems or traffic are accessed by these tutorials.
