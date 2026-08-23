---
name: repository-setup
description: Check or apply NiceEval repository setup such as Git hooks and local development prerequisites.
metadata:
  command: pnpm repo:setup
  design: docs/engineering/repository-tools/README.md
---

# Repository setup

Read the [Repository Tools design](../../../docs/engineering/repository-tools/README.md#七个领域). Run `pnpm repo:setup --help` for current syntax.

Use check mode before applying. Limit writes to repository-owned hook and setup paths, preserve user Git configuration outside the repository, and do not install global tools. After applying, rerun check and report each changed setup surface.
