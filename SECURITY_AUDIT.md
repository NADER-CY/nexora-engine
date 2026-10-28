# NEXORA ENGINE security review

See [PUBLICATION_REVIEW.md](PUBLICATION_REVIEW.md) for the current public-source review, executed checks, unavailable verification and residual limitations.

Machine-specific historical audits and raw scan/session data are intentionally excluded from this public tree. Their omission does not establish that previously unverified integrations have passed. The package remains private for npm, and all inherited GitHub Actions workflows are inactive.

The lifecycle allowlist in `nexora/lib/lifecycle-check.mjs` covers the root prepare/prepack/prepublish hooks and the inherited esbuild, Frida and fsevents install-script declarations. Use `npm ci --ignore-scripts` initially. Audit results are not a guarantee that dependency tarballs are malware-free.
