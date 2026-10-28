# Disabled upstream publishing automation

These files come from upstream REA (`morluto/rea`). In this fork they are
**inactive**: GitHub Actions only runs workflows under `.github/workflows/`,
and only resolves local actions under `.github/actions/`.

| File | What it did upstream | Why it is disabled here |
|---|---|---|
| `workflows/release.yml` | release-please PRs, npm publish of `rea-agents` with provenance (OIDC `id-token: write`), GitHub releases, MCP-registry publish | Publishes under the upstream package and registry identity; uses `RELEASE_PLEASE_TOKEN`, `TURBO_TOKEN` |
| `workflows/release-recovery.yml` | Re-runs failed publish steps (OIDC) | Same publishing identity |
| `workflows/website-pages.yml` | Deploys the upstream website to Cloudflare Pages (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and probes `rea.tools` | Upstream deployment target and credentials |
| `actions/publish-mcp/` | Publishes `server.json` to the MCP registry as `io.github.morluto/rea` | Upstream registry namespace |
| `actions/prepare-release-package/` | Packs the npm release artifact | Only used by the release workflows |

`package.json` also sets `"private": true`, so `npm publish` is refused even
if run by hand.

## Re-enabling for NEXORA ENGINE (only when you decide to publish)

1. Choose and **register** the npm package name and MCP-registry namespace you
   control (for example `nexora-engine` and `io.github.<you>/nexora-engine`).
2. Set `PRODUCT_IDENTITY.registryPackage` in `src/identity.ts` to that exact
   package name, update `server.json`, and remove `"private": true`.
3. Review every job, permission and secret in these files, replace upstream
   names, then move them back under `.github/`.
4. Configure your own secrets. Never reuse credentials from another project.
