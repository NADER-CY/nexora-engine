# Update an existing installation

Review local changes before updating. Do not reset or clean the checkout to discard work:

```sh
git status --short
git branch --show-current
git fetch origin
```

If the working tree is clean and you intend to follow main:

```sh
git switch main
git pull --ff-only origin main
node nexora/bin/nexora.mjs analyze-project examples/tutorial/cycle
```

If changes are present or the branches diverge, preserve them on a branch/commit and reconcile deliberately before continuing. Do not copy an older ZIP over a newer checkout.

For the full engine, reinstall locked dependencies when the lockfile changes and rebuild after updating source. On Windows rebuild and verify its native artifact before the full build as described in [from-source installation](from-source.md). No npm self-update or registry installation is required. Recheck MCP absolute paths if the checkout moved.
