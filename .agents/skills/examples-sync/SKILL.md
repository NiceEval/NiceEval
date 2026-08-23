---
name: examples-sync
description: Check or apply NiceEval example tier synchronization and resolve declared conflicts.
metadata:
  command: pnpm examples:sync
  design: docs/engineering/example-tier-sync/README.md
---

# Example tier synchronization

Read the [tier synchronization design](../../../docs/engineering/example-tier-sync/README.md) and the nearest example owner README. Run `pnpm examples:sync --help` for current syntax.

Check before applying. Treat conflicts as an owner decision, not an opportunity to overwrite a higher-tier example. Preserve unrelated edits and include the generated receipt with the intended example paths.

After applying, rerun the check and the validation command named by the affected example owner.
