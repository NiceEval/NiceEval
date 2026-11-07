---
relations:
  - role: root-cause
    target: memory/fixed-watchdog-systemd-execstartpost-quoting.md
---

# Fixed-image watchdog unit is rejected for unbalanced ExecStartPost quoting

Deploying the NiceEval 7a69dd917 fixed-image NixOS module generated niceeval-docker-profile-fixed-watchdog-harness-raw.service with an ExecStartPost value that systemd rejected as unbalanced quoting. The unit entered bad-setting before the fixed-image profile could be activated.

## Impact

A first fixed-image deployment cannot start its watchdog, so comin reports a failed switch and downstream Eval invocations continue using the legacy transient profile.

The first fixed-image deployment on ctrdh-studio built successfully but systemd rejected the generated watchdog unit before activation.
