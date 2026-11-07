# pnpm lint docs prepare ignores mise-installed Node 24

### Actual observation

`pnpm lint` fails at `docs site prepare`: "NiceEval docs require Node 24; current version is 26.10.0". Node 24 is installed via mise, but the fallback list in `packages/repo-tools/src/docs/generators.ts` only probes `NICEEVAL_DOCS_NODE_BIN` and Homebrew `node@24` paths.

### Expected behavior

A locally installed Node 24 from mise, or a repo-pinned Node version, is found without setting an env var.

### Impact

Every docs edit on a machine whose default Node is 26 hits a lint failure before any docs check runs.

### Public entry-point reproduction

Default `node` is 26.x and Node 24 is installed only via mise. Run `pnpm lint` from the repo root. Workaround: `NICEEVAL_DOCS_NODE_BIN=$(mise where node@24.15.0)/bin pnpm lint`.

### NiceEval identity

main checkout at 5af6c24c7

### Environment

macOS, Homebrew node 26.10.0, mise node 24.15.0

### Source provenance

Local checkout

### Public data confirmation

- [x] I removed secrets, credentials, private customer data, private repository content, and other sensitive material from this issue.
- [x] This issue does not disclose or describe a suspected security vulnerability.
