---
format: niceeval.memory/v1
id: incus-cli-mutation-error-hidden-by-json-decoder
title: Incus CLI mutation error is hidden by JSON decoding
createdAt: 2026-09-04
kind:
  type: problem
  state: open
promotions: []
---
# Incus CLI mutation errors are parsed as JSON responses

## Observation

An Incus setup-prefix publication can fail before Attempt dispatch with `Incus POST /1.0/instances?... returned an unexpected JSON shape`, hiding the provider error emitted by `incus query --wait --raw`.

## Root cause

The Incus CLI converts a failed asynchronous operation into a non-zero process exit and writes a plain-text `Error: ...` diagnostic to stderr. NiceEval selected stderr when stdout was empty but always parsed the selected stream as a REST response envelope, so JSON parsing replaced the original Incus failure.

## Repair boundary

Keep successful and JSON response envelopes under exact Effect Schema validation. For non-zero CLI exits whose selected output is not a valid envelope, report the exit code plus a control-character-normalized, credential-redacted, bounded excerpt. This exposes the provider cause without accepting unknown successful response shapes.

## Verification status

The installed-candidate lifecycle owner now injects a plain-text failed Incus mutation through the fake external CLI boundary and requires the original provider error instead of `unexpected JSON shape`. Formal local red/takeover evidence is blocked before test execution because this host lacks the lifecycle Repo `linux-loop-project-quota` capability; keep this Problem open until the owner runs in CI or on a capable host.
