---
title: 'E2E explicit run rewrites the shared root manifest'
severity: 'major'
---

## Expected Behavior

`pnpm e2e run --candidate <tarball> --repo eval -- --run <owner-test>` must copy the selected E2E repository into its invocation-local scratch directory, inject the candidate there, and leave the source checkout manifest, lockfile, dependency links, and declaration files untouched.

## Current Behavior

From the NiceEval root, the explicit candidate command rewrote the shared root `package.json` to a 177-byte `niceeval@0.0.0-local` manifest, rewrote `pnpm-lock.yaml`, removed root dependency links, and generated root `index.d.ts` and `expect.d.ts`. It then failed with `Command "e2e" not found`.

## Possible Solution

Resolve the repository directory before package injection and assert that it is inside the runner-created scratch copy, never the source checkout. Reject a source-root injection target before any package-manager mutation.

## Minimal Reproducible Example

1. Create a candidate with `pnpm pack --pack-destination /tmp/niceeval-candidate`.
2. From the NiceEval root run `pnpm e2e run --candidate /tmp/niceeval-candidate/niceeval-0.0.0-local.tgz --repo eval -- --run test/assertion-sandbox.test.ts`.
3. Observe changes to root `package.json`, `pnpm-lock.yaml`, `index.d.ts`, and `expect.d.ts`.

## Context

Reproduced while validating the existing sandbox Assertion E2E owner in a shared multi-agent worktree. The exact pre-command contents were restored without destructive Git commands; no package or lockfile mutation belongs to the feature change.
