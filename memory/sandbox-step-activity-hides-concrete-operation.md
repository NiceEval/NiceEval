# Sandbox step activity hides the concrete operation

## Observation

`niceeval exp` runs a declarative Sandbox action successfully, but the Human TTY row only says `preparing sandbox`. During a long `shell()` step it does not show the author-declared command, so users cannot distinguish useful work from a stalled Sandbox.

## Root cause

`SandboxStep` keeps execution and debug-plan data, while `executeSandboxAction()` does not emit a step-level progress update. Provider progress reaches the dashboard, but the provider-neutral declarative step being interpreted is absent from that channel.

## Fixed boundary

Every declarative step owns a separate safe runtime presentation that does not participate in identity or cache keys. The shared action interpreter emits it before execution for ordinary Attempt preparation, cleanup, and provider-native setup-prefix preparation. Shell presentation uses the author command rather than the `/bin/sh -lc` implementation wrapper; content and credential-bearing operations expose only bounded safe metadata.
