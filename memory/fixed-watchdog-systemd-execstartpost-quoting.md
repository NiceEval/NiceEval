---
format: niceeval.memory/v1
id: fixed-watchdog-systemd-execstartpost-quoting
title: Fixed-image watchdog systemd unit has invalid multiline ExecStartPost quoting
createdAt: 2026-08-25T10:39:31+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed-image watchdog systemd unit has invalid multiline ExecStartPost quoting

## Observation

The first deployment of the fixed-image NixOS module on `ctrdh-studio` built successfully, but systemd rejected `niceeval-docker-profile-fixed-watchdog-harness-raw.service` with `Unbalanced quoting` in `ExecStartPost`. The public deployment boundary was comin generation `a44850b4-0225-42f9-9ab8-53f93f63e410`.

## Root cause

`nix/modules/docker-profiles.nix` embedded a multiline shell program inside a systemd command string using `bash -c` plus `lib.escapeShellArg`. The generated unit serialized the embedded newlines as physical unit-file lines, so systemd parsed an unterminated quoted command.

## Fix

Generate the socket readiness logic with `pkgs.writeShellScript` and use the resulting executable path directly as `ExecStartPost` for both the regular and fixed watchdog services. This leaves systemd no nested multiline command to quote.

## Verification state

Open until the corrected product revision is deployed, fixed-image activation succeeds, the generated watchdog unit starts, and a real downstream dogfood run completes. Per the current user direction, no automated E2E suite is being run.
