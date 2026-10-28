# NEXORA ENGINE Phase 3A

Phase 3A adds offline commands to the dependency-free NEXORA CLI. Existing REA CLI/MCP tools, AST analysis, providers and compatibility wrappers remain available. These new commands are additive; they do not replace the upstream semantic analyzers or register new MCP tools.

```sh
node nexora/bin/nexora.mjs analyze-source sample.ts --out source.json
node nexora/bin/nexora.mjs analyze-project ./authorized-source --out project.json
node nexora/bin/nexora.mjs analyze-binary ./authorized-binary --out binary.json
node nexora/bin/nexora.mjs ghidra-report ./export.jsonl --out decompilation.json
npm run test:nexora:phase3a
```

All common CLI limits and `NEXORA_ALLOWED_ROOTS` apply. The new analyzers use only Node built-ins; no install step or dependency lifecycle script is needed for them. Existing upstream commands still need their original dependencies and toolchains.

## Continued development: project architecture

`analyze-project` additionally returns `architecture` (`nexora-architecture/v1`). Nodes summarize incoming/outgoing distinct file counts; edges retain each import site, specifier, resolution and original byte evidence. `cycles` lists strongly connected dependency candidate groups, including self-imports. Repeated imports remain separate evidence edges but count once toward a file's degree. Existing dependency and per-file call fields remain available.

The summary consumes the project analyzer's existing resolution facts. It neither fetches dependencies nor resolves cross-file function calls. An iterative graph traversal handles long chains without recursive stack growth. Graph inventories share the existing retained output budget, and graph traversal checks the existing cancellation, heap and deadline owner.

`architecture.coverage.complete` concerns retained lexical dependency candidates only. External, missing, ambiguous or failed targets, incomplete source/traversal coverage, and dropped graph inventories make it false. Degrees and cycles describe retained edges: incomplete results cannot establish absence of cycles. This is not a claim of compiler-level or runtime dependency coverage; consult the source analyzer's lexical limitations.

## Source analysis

Supported extensions: JS/MJS/CJS/JSX, TS/TSX, Go, Rust, C/H and C++/CC/CXX/HPP. The incremental byte lexer discards comments, bounds stored tokens, and handles strings and UTF-8 bytes across read boundaries. It recognizes named function definitions, block arrow functions, Go receiver methods, common C/C++ definitions, literal imports/includes and Rust module paths. Reports contain symbol IDs, parent functions, body ranges, calls, incoming/outgoing call references and dependency candidates.

Calls bind only to a unique retained name in the same file. Qualified, ambiguous, missing and truncated-inventory cases remain unresolved. This is an explicitly labeled lexical approximation, without a compiler's scope/type binding. Use the existing REA JavaScript semantic analysis for richer JS/TS analysis on suitably sized inputs.

`analyze-project` visits source files sequentially, skips symlinks and `.git`, `node_modules`, `target`, `dist`, `.cache`, and limits directory depth to 64. Its global inventories and retained JSON payload have bounds. Local relative imports map to candidate files; it does not resolve package managers, tsconfig aliases or compiler modules. Cross-file calls stay unresolved. File failures are recorded independently; cancellation, timeout and exhausted resource budgets stop the operation.

## Binary analysis

The random-access reader retains at most eight 64 KiB pages. A separate reusable input slab computes SHA-256 without loading the file into memory.

| Format | Recovered metadata |
| --- | --- |
| ELF32/64, little/big endian | machine, entry point, section records/names, SYMTAB/DYNSYM names, values, binding/type/undefined state, DT_NEEDED strings from linked dynamic sections |
| PE32/PE32+ | machine, image base, entry RVA, section layout, regular imported DLLs, imported names/ordinals, named exports/forwarders, ASLR/NX/high-entropy header flags |
| Thin Mach-O32/64, little/big endian | CPU/file type/flags, load-command boundaries, segment sections, dylib paths, nlist symbols and undefined state |

Malformed optional ELF symbol/dynamic tables and PE import/export tables produce scoped warnings while preserving independently parsed facts. Invalid essential layout fails closed. Offsets, lengths, counts, entry sizes, mappings and safe-integer conversions are checked. Addresses remain hexadecimal strings. Header mitigation flags do not establish runtime protections.

## Ghidra export

`bridge/ghidra/NexoraExport.java` is an actual Ghidra postScript using its decompiler and reference APIs. It writes JSONL incrementally, binds the original executable SHA-256, exports function pseudocode and incoming function-entry references, isolates per-function failures, checks cancellation, limits decompilation time and disposes its decompiler. It refuses to overwrite an existing export.

Example with an installed, caller-selected Ghidra:

```text
analyzeHeadless PRIVATE_PROJECT_DIR nexora-phase3a -import AUTHORIZED_BINARY -readOnly -deleteProject -scriptPath bridge/ghidra -postScript NexoraExport.java NEW_EXPORT.jsonl 5000 30
node nexora/bin/nexora.mjs ghidra-report NEW_EXPORT.jsonl --out report.json
```

Export defaults: 5,000 functions, 30 seconds per function, 200,000 pseudocode characters per function and 20 references per configured maximum function (a global reference budget). Explicit accepted ranges are 1–100,000 functions and 1–300 seconds. Ghidra's own internal decompilation memory is outside the Node analyzer budgets. Keep the project directory private and ephemeral. No Ghidra, Java or other toolchain is installed by this feature.

The importer validates record shapes and digest syntax, bounds individual lines, inventories and retained payload, and reports failed/oversized/dropped records and missing footers. `producerComplete` preserves the producer assertion; `reportComplete` additionally checks the function count and local omission counters. Completion does not mean every function decompiled successfully. The importer authenticates the export bytes, but does not independently verify the producer's binary digest against a second binary input. Pseudocode is derived, not original source.

The importer is tested with deterministic provider fixtures. The Java exporter has not been compiled or executed in a real Ghidra installation in this environment.

## Evidence and resource semantics

Reports bind the input SHA-256, size, analyzer revision and effective limits. Finding evidence uses byte offset/length, evidence kind and confidence. Source graph relationships are inferences with medium confidence. Binary facts are observations of the supplied bytes. Ghidra facts are provider-reported with medium confidence. A file range is interpreted with that report's input digest; project facts additionally name their source file.

Input hashing and parsing share an owned descriptor. Size and timestamps are rechecked, and detected input changes reject the report. Reads are bounded, inventories share a retained payload budget, and loops check cancellation/deadlines/heap usage. Output limits apply to stdout and files. Heap/deadline limits are cooperative safeguards, not OS-enforced process memory or CPU limits. Metadata race checks do not provide filesystem snapshot isolation.

`scan-bundle` now commits matches by their starting position with bounded lookahead, fixing duplicate/partial HTTP-call counts at read boundaries. The existing report schema and inventories remain intact. Its regex scan remains lexical and finite-overlap; unusually long whitespace or literals can exceed its recognition window.

The concurrency gate transfers a reserved permit directly to the next queued operation, removes granted cancellation listeners, and rechecks cancellation before executing queued work. Already-aborted timeout operations are rejected before invocation.

## Reproducible checks

```sh
npm run test:nexora:phase3a
node --test nexora/test/core.test.mjs nexora/test/analysis.test.mjs nexora/test/esm-paths.test.mjs nexora/test/windows-native-build.test.mjs
node nexora/bench/phase3.mjs DATA_DIR PHASE2_ROOT/nexora/lib/bundle-scan.mjs OUTPUT.json
```

On restrictive Windows sandboxes, set TEMP and TMP to a writable workspace directory before running tests. This avoids sandbox-specific temporary-file rename failures. Benchmark fixtures are generated locally; they are not bundled binaries. The benchmark runs three new processes per case with a 128 MiB V8 heap setting and reports analysis time, end-to-end time, CPU, peak RSS, output bytes, coverage and deterministic result digests. It does not flush OS caches. The first run is not a guaranteed cold-cache measurement.

## Remaining limits

No complete grammar/type analysis for Go/Rust/C/C++, full preprocessing, C++ overload/template resolution, JS regex/interpolated strings, Rust raw-string/lifetime semantics or complete closure recognition. No native instruction call graph or disassembler is added by `analyze-binary`; use the preserved provider tools or Ghidra references. ELF sectionless dynamic metadata and extended section numbering, PE delay imports/COFF/debug/ordinal-only exports, Mach-O universal slices/dyld chained metadata and stripped symbol recovery are not decoded by the new CLI reader. Existing upstream readers may support more of these cases and are unchanged.

The upstream dependency-backed suite, a real Ghidra lane, real ELF/Mach-O binaries and Linux signal behavior were not validated here. No new dependencies were introduced. A current vulnerability-advisory scan of inherited dependencies was not performed.
