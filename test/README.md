# Property tests

See the [test architecture](../docs/engineering/testing/architecture.md) for test boundaries and cost limits.

Use `pnpm exec vitest run --maxWorkers=1 <file>` to check one file locally.
The `default` project collects Library, in-process CLI, and process tests in
`integration/`, `cli/`, and `process/`. Use the suffixes `.docker.test.ts`,
`.linux.test.ts`, and `.live.test.ts` for tests that require those CI environments.
The legacy `unit` project remains available during migration.

The Vitest reporter checks process file headers and per-test median duration.
It uses the successful attempts from the current invocation. Use Vitest repeats
for more samples when checking a duration locally.

Install the Bombadil release matching the exact `@antithesishq/bombadil` version
in the root `package.json`. Download the binary for your OS and CPU from
[GitHub Releases](https://github.com/antithesishq/bombadil/releases), verify its
SHA-256 against the release asset digest, and put the executable on your PATH
as `bombadil`. Check the installed version with `bombadil --version`.

For a short local UI run against an existing package build:

```sh
pnpm exec node test/bombadil/driver.ts terminal test --time-limit 9s --exit-on-violation
pnpm exec node test/bombadil/driver.ts browser test --headless --time-limit 9s --exit-on-violation
```

Set `NICEEVAL_BOMBADIL_INTERRUPT_PHASE=startup` to explore interruption before
the first Eval reaches its active phase. Pass `--output-path <directory>` to
keep traces. The browser needs a local Chromium or Google Chrome installation.
