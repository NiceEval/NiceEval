---
name: docs-reference
description: Check or regenerate NiceEval public API reference regions from their source owners.
metadata:
  command: pnpm docs:reference
  design: docs/README.md
---

# Documentation reference generation

Read the [documentation synchronization rules](../../../docs/README.md#同步义务) and the affected docs-site owner instructions. Run `pnpm docs:reference --help` for current syntax.

Run with `--dry-run` before generating. Edit the source TSDoc or option help that owns the content; do not patch generated regions as a shortcut. The package-owned bundled index is generated separately by `pnpm build:index`. After generation, inspect the exact generated diff and run `pnpm lint`.
