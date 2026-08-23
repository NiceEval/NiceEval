---
name: docs-diff-code
description: Check or regenerate NiceEval before-and-after integration example pages and their shared assets.
metadata:
  command: pnpm docs:diff-code
  design: docs/origin-integration.md
---

# Documentation diff examples

Read [Origin integration](../../../docs/origin-integration.md) and the [example tier owner](../../../docs/engineering/example-tier-sync/README.md). Run `pnpm docs:diff-code --help` for current syntax.

Run with `--dry-run` before generating. Treat origin and tier directories as the inputs; never edit generated MDX, CSS, or JavaScript to hide source drift. Inspect every generated page diff, then run the docs-site lint and full `pnpm lint`.
