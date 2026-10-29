# Offline tutorials

Run commands from the repository root. Node is required; dependencies/build are not needed for these offline commands. Output paths below use your local temporary directory to avoid committing generated reports.

## First source file

```sh
node nexora/bin/nexora.mjs analyze-source examples/tutorial/project/main.js
```

Expected: `schema` is `nexora-source-analysis/v1`; symbols include `format` and `start`. A call inside `start` resolves as a unique-name candidate for `format`. This lexical result does not prove compiler scope/type semantics.

## Project dependencies and cycles

```sh
node nexora/bin/nexora.mjs analyze-project examples/tutorial/project
node nexora/bin/nexora.mjs analyze-project examples/tutorial/cycle
```

The project reports one local edge from `main.js` to `worker.js`. The cycle example reports a strongly connected dependency group with `a.js` and `b.js`. The `architecture` object has schema `nexora-architecture/v1`, node degree counts, evidence-bearing edges and coverage. Imports are static candidates, not proof of runtime calls. See [architecture contracts](../architecture/README.md).

## PE, ELF and Mach-O

Compile the non-sensitive sample with an installed compiler. Typical commands (availability/platform-dependent):

```sh
cc -g examples/tutorial/sample.c -o /tmp/nexora-example
node nexora/bin/nexora.mjs analyze-binary /tmp/nexora-example
```

Linux normally produces ELF; macOS normally produces Mach-O. Windows MinGW can produce PE:

```powershell
gcc -g .\examples\tutorial\sample.c -o "$env:TEMP\nexora-example.exe"
node .\nexora\bin\nexora.mjs analyze-binary "$env:TEMP\nexora-example.exe"
```

Only compile with an existing reviewed compiler; do not execute the target. Expect the detected format, input SHA-256 and byte-based section/symbol evidence. The offline reader does not disassemble instructions or recover a CFG. Synthetic fixtures cover format variants in tests; actual compiler/platform validation is reported separately in [milestones](../milestones.md).

## Ghidra JSONL import

```sh
node nexora/bin/nexora.mjs ghidra-report examples/tutorial/ghidra.synthetic.jsonl
```

Expected schema: `nexora-ghidra-report/v1`, one function named `example`, producer version `synthetic-example`. The header digest is a deliberate fixture marker, not a claim about a real binary. See [real-toolchain workflow](ghidra.md).

## Evidence and confidence

`input.sha256` identifies the analyzed bytes. `evidence.byteOffset`/`byteLength` refer to those bytes; text offsets count UTF-8 bytes, not displayed characters. `kind` distinguishes observed/provider-reported facts; lexical relationships remain candidates. Consult dropped counters, warnings and coverage before relying on an absent finding. Ghidra pseudocode is derived evidence, not original source.

## Saving JSON and diagram export

Existing commands accept `--out FILE` for atomic JSON output, for example `node nexora/bin/nexora.mjs analyze-project examples/tutorial/cycle --out project.json`. Keep generated files out of commits. Architecture JSON can be consumed directly; diagram export support and its exact command are described in [architecture contracts](../architecture/README.md). Do not invent a Mermaid CLI flag on commands that do not expose one.
