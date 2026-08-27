---
format: niceeval.memory/v1
id: pty-cleanup-kills-helper-before-exit-report
title: PTY cleanup kills helper before candidate exit report
createdAt: 2026-08-27
kind:
  type: problem
  state: open
promotions: []
---
## Problem

Testkit PTY timeout cleanup occasionally rejected a successful three-group cleanup with `PTY helper exited without reporting the candidate terminal state`. The installed-candidate nightly E2E reproduced it while killing a TERM-ignoring candidate and its descendant.

## Root cause

After SIGKILL made the candidate process group terminal, the parent cleanup immediately advanced to terminating the helper group. The helper owns the child-process wait status, so under scheduler delay it could be killed before its child `close` callback sent the `status: exit` control frame. Timeout disposal and launcher-close finalization could also enter the same group cleanup concurrently.

## Repair boundary

Keep the real candidate exit frame authoritative. After the candidate group reaches a proven terminal state, allow the owned helper a bounded interval to reap the child and flush that frame before terminating helper and launcher groups. Coalesce every cleanup caller onto one promise; do not infer candidate status from the launcher or weaken fail-closed process-group checks.

## Regression proof

The existing installed-package owner `e2e/lifecycle/test/pty-terminal-cleanup.test.ts` must kill a TERM-ignoring candidate plus descendant, return a timed-out receipt with the real signal/exit state, and prove candidate, helper, and launcher groups gone or terminal.
