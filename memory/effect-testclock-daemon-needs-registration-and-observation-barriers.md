---
format: niceeval.memory/v1
id: effect-testclock-daemon-needs-registration-and-observation-barriers
title: Effect TestClock daemon tests need registration and observation barriers
createdAt: 2026-08-26T17:52:53+08:00
kind:
  type: insight
  state: current
promotions: []
---
# Effect TestClock daemon tests need registration and observation barriers

## Observation

PR #166 changed only documentation, but its Unit job failed in `case lock virtual time > renews once per heartbeat period and never writes after release` while the same base `main` SHA had passed. The failure timed out waiting for the first heartbeat after advancing `TestClock`.

PR #162 had already added polling for the heartbeat file after advancing virtual time. That closed only the output-side race: waking a sleeping fiber does not mean its asynchronous filesystem write is already observable.

## Root cause

The heartbeat runs in an Effect daemon fiber. The test could advance virtual time before that daemon had executed far enough to register its first `Effect.sleep`. `TestClock.adjust` cannot wake a sleep that is not yet in the clock's queue, so later polling the file cannot repair the missed wakeup. A fixed number of filesystem polling turns also made ordinary CI scheduling delay look like a product failure.

## Reusable rule

Tests that combine `TestClock` with a forked or daemon fiber and asynchronous external observation need two distinct barriers:

1. Before advancing virtual time, observe the scheduled wakeup through `TestClock.sleeps()`.
2. After advancing virtual time, wait until the externally observable effect, such as a filesystem write, is visible.

The first barrier proves scheduler registration; the second proves side-effect completion. Do not replace either barrier with an arbitrary delay or assume one proves the other.

## Verification

The corrected lock owner passed 50 independent targeted Vitest processes followed by five complete Unit suite runs. The original red receipt is GitHub Actions run 32953725191, job 98130682366.
