# GitHub documentation verification

## Branch boundaries

PR #1 was integrated into main before finalizing PR #2. The documentation branch then merged that baseline, preserving all analysis algorithms and regression tests. The original premium artwork and recorded examples remain. A newer main README edit was retained during the PR #1 merge; its installation and usage subjects are reconciled into the final premium homepage.

The final integration uses the existing two PRs with merge commits, no force-push or rewritten history. The original development worktree's uncommitted README/milestone edits remain preserved locally.

## Installation verification

An isolated source checkout used Node 24.22.1 and npm 11.16.0. `npm ci --ignore-scripts` passed. The initial Windows full build failed because the native addon was absent. With an existing MSYS2 UCRT64 compiler, `npm run build:windows-native`, `npm run verify:windows-native:artifact` and the full build passed. The corrected guides preserve this required order; no verification check was bypassed.

Linux/macOS installation, live Codex/Claude client connections and real Ghidra compilation/execution were not run. Their commands are conditional/source-derived. No provider installation, registry publication or website deployment occurs.

## Final executed checks

- Offline analysis/compatibility suite: **117 passed, seven platform-specific skips, zero failures**. The initial branding assertion failure was corrected to require the new primary CLI name; the legacy package alias remains independently checked.
- Provider/filesystem message regressions: **103 passed, 17 platform/provider skips**, using the repository's focused test lane. These fixture/mock tests do not establish real provider success.
- Reference-source projection: **two passed**. Onboarding contracts: **five passed**.
- The full documentation conformance invocation also ran four historical performance-receipt checks. All four failed with missing `docs/verification/analysis-efficiency/mcp-integer-allocation.json` / `.md` inputs, which were excluded from the public source. The tests remain intact; no receipts or speed claims were fabricated. A targeted onboarding rerun passed all five onboarding cases and filtered those four historical checks. These unavailable benchmark receipts are not an engine/installation/security regression.
- Final Windows full build, branded CLI help and compatibility-launcher help passed. MCP initialized with protocol `2025-11-25`, listed 231 tools and shut down with exit zero. No provider invocation or live Codex/Claude connection was tested.
- Nine documented command checks ran: eight succeeded; Ghidra doctor returned exit one with `missing_analysis_engine` because `GHIDRA_INSTALL_DIR` was unset, as expected. Source/AST and JSON/Mermaid report examples succeeded. Decompilation help was checked; real decompilation was not executed.
- Branding-baseline verification confirms no changes to engine algorithms or dependencies. Original legal notices and lockfile are unchanged. Test string/regex expectations follow product labels; the documentation conformance contract now checks local source registration and preserved historical translations.
- Secret scan: three reviewed synthetic test-fixture matches, zero credential leaks. Locked dependency audit: zero known vulnerabilities. No active publishing/deployment workflows; npm remains private.
- The inherited acquisition installer is disabled before any package acquisition. Bash syntax passed and execution returned the intentional exit one with source-installation guidance.

## Demonstrations and visual checks

The recorded source, project, cycle and explicitly synthetic Ghidra outputs were produced by actual offline commands. A real MinGW PE was compiled and inspected, compared with objdump and never executed. [Outputs and provenance](demos/README.md).

`node scripts/verify-github-docs.mjs` checks active Markdown references, JSON examples, local SVG/PNG assets, branding, plugin/launcher metadata, offline demonstrations and preservation of the engine algorithm baseline. Local browser previews cover desktop/mobile light/dark themes with no overflow and real asset loading. They are labelled previews, not live GitHub screenshots.

## Compatibility, attribution and publication

The original MIT license and legal notice files remain unchanged. Technical aliases and origin/history references are [classified here](legacy-identifiers.md). npm stays private and publication/deployment workflows remain disabled. Original artwork is reused, not regenerated.

Official client/configuration sources: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Claude MCP](https://code.claude.com/docs/en/mcp), [Codex local plugin catalog](https://developers.openai.com/plugins/build/plugins), [Claude marketplace paths](https://code.claude.com/docs/en/plugin-marketplaces). Configuration examples are not proof of a live client connection.

Description and the existing 17 topics are retained. The social PNG is ready but requires GitHub's manual social-preview upload; [exact setting](github-settings.md). No launch announcement is posted automatically.
