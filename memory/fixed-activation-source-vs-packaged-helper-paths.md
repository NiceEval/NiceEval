---
format: niceeval.memory/v1
id: fixed-activation-source-vs-packaged-helper-paths
title: Fixed activation confuses source helpers with packaged wrappers
createdAt: 2026-08-25T11:00:50+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed activation confuses source helpers with packaged wrappers

## Observation

Production activation created and fully allocated the outer store, then failed to open `provision-fixed-images.py`. The Nix package deliberately installs extensionless wrapped helpers instead.

## Root cause

Activation derived source-tree sibling names as runtime defaults and always invoked the provisioner/generator through `sys.executable`. In the package, those paths do not exist and the installed wrappers are shell executables rather than Python source files.

## Fix

Resolve the installed extensionless sibling when present and otherwise fall back to the source filename. Invoke `.py` helpers through the current Python interpreter and installed wrappers directly. Apply the same rule to provisioner and descriptor generator.

## Verification state

Open until the packaged helper completes provisioning, activation publishes the epoch and descriptor, the fixed watchdog starts, and real downstream dogfood completes. Per the current user direction, no automated E2E suite is being run.
