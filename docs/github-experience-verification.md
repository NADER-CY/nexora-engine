# GitHub documentation verification

## Branch boundaries

This documentation branch starts from main at `95514eff805b014920a3058054e193e5de38dd8c`. It reuses installation/MCP guides, tutorials and non-sensitive samples from the earlier documentation commit `4ad2f9069a586ee5e2ff4ef44956aba32d32daea`, without taking its package/test-script changes or any analysis code.

[Draft PR #1](https://github.com/NADER-CY/nexora-engine/pull/1) remains separate. Its AST scopes, direct ESM calls, enhanced relocations, Ghidra identity matching and unified architecture/Mermaid commands are proposed development work, not main-branch availability. This README's Mermaid diagrams are authored explanations of the unchanged engine and sample results.

There is no engine dependency on PR #1 for the first-run examples. Some reused documentation overlaps with PR #1; maintainers should reconcile those documentation changes when reviewing merge order rather than automatically merging or rewriting that branch.

## Demonstrations

Five offline commands were executed on Windows using Node v24.22.1, the repository pin. Four captured full outputs analyze the included source/project/cycle and explicitly synthetic Ghidra sample. A fifth inspects a real locally compiled MinGW PE; the target was not executed. See [recorded outputs and provenance](demos/README.md).

Output snippets are selected actual report fields. No screenshots of an invented interface, benchmark figures, passing CI badges or provider successes are used. Static badges mean development source, MIT license and source installation.

## Documentation checks

Run `node scripts/verify-github-docs.mjs` from the repository root. It checks authored/reused Markdown links and anchors, local asset references, JSON configuration blocks, SVG safety/geometry, social PNG dimensions, main-only CLI examples and their recorded invariants. It also rejects changes to engine/source/package/license files in this documentation branch.

Visual review uses local GitHub-style rendering in desktop light/dark and mobile layouts. This is a preview, not a claim that the PR has merged or a screenshot of GitHub's live README. Both desktop hero variants and compact mobile variants use local SVG with no external fonts/scripts. Social artwork is 1280×640 PNG with SVG source.

Actual results on the documentation branch: 23 Markdown files, 122 local references/anchors, three JSON examples and ten SVGs checked; four repeated CLI example checks passed. Five issue-form YAML files parsed successfully using the existing locked YAML version in temporary verification tooling. The social PNG is 108,345 bytes. The unchanged engine's 39 focused tests passed with no failures/skips. Four browser layouts loaded every image, rendered both Mermaid diagrams and showed no page-width overflow. Mermaid's npm browser bundle was integrity-verified and used only for local preview, not added as a project dependency.

## Unverified and conditional commands

Full-engine installation/build, live MCP client initialization, Linux/macOS compilation and real Ghidra exporter execution are not reported as passed. Their guides describe conditional setup using separately supplied tools. No unreviewed lifecycle scripts, registries or sites are enabled. The offline layer does not need these integrations.

Official client configuration references were checked on 2026-10-29: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp). Client capability or a syntactically valid example does not establish an actual NEXORA ENGINE connection.

## Repository settings

Description/topics are public metadata and can be updated independently of the PR. The social PNG must be uploaded manually in GitHub's social-preview settings; committing the asset alone does not apply it. See [manual settings](github-settings.md). The [launch announcement](launch-announcement.md) is a draft for human adaptation; nothing is posted automatically.

The configured description and 17 topics were applied and read back during preparation. Package, lockfile, analysis source and license files remain unchanged; all publishing/deployment workflows remain disabled.
