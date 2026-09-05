---
format: niceeval.memory/v1
id: e2e-exact-selector-omits-native-title-prefix
title: Exact E2E selection omits native project and suite title prefixes
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
## Observation

The managed Insight inventory collected `e2e/insight/test/view-authorization.browser.spec.ts#necase_XDDZFNTFXA177RG0`, but `pnpm e2e evidence red` failed with `No tests found`. The runner correctly rejected this as infrastructure/selection failure, without granting a red receipt.

## Root cause

`exactCaseNativeArgs` anchored a reconstructed visible title at both ends. Playwright includes the project name in its grep title, while the collected title path excludes that prefix. Vitest describe nesting can add the same kind of prefix. Visible-title reconstruction therefore did not reliably select the canonical declaration.

## Repair and verification

Select the real file and the validated, unique `[necase_...]` suffix. Inventory continues to reject duplicate case IDs; no persisted evidence fields change. Both red evidence and takeover use the same selector construction.

With the repaired runner, the same installed old candidate executed the exact Chromium case and reached its ordinary public assertion failure after authenticating a second View, returning `nered_71GPHE8Q1036RCYD`. A Vitest exact selector also executed the intended timeout case and returned `nered_P03MW58N19P2V6FD`. These are observations of the repository command repair, not product regressions for this repository-tool Problem.
