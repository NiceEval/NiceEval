# Report E2E

`pnpm e2e` creates one frozen classic World with the public CLI, gives every
native test an ordinary-byte private copy of its Record and static export, then
runs Vitest, Playwright, and the retained legacy Evidence suite. The three
lanes run even when an earlier lane fails; the final exit code is folded.
The default legacy profile requires the `OPENAI_API_KEY` and
`OPENAI_BASE_URL` declared in `e2e.json`; it is never silently skipped.

Target a no-secret native suite with its path; this still prepares the classic
World exactly once and skips the legacy profile:

```sh
pnpm e2e --repo report -- --run test/show/report-show.test.ts
pnpm e2e --repo report -- --run test/view/report.browser.spec.ts
```

`pnpm e2e:prepare --out /tmp/report-world` is useful for local diagnosis.
The resulting World is read-only; consumers must use `withClassicWorld` rather
than writing to it. The default legacy lane remains intentionally separate
until its real gateway Evidence can be prepared under the same coordinator.
