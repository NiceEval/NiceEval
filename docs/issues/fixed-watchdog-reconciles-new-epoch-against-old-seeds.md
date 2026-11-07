---
relations:
  - role: root-cause
    target: memory/fixed-watchdog-journal-state-crosses-activation-generations.md
---

# Fixed watchdog reconciles a new epoch against prior seed facts

A new committed 4 GiB registry epoch passed activation, descriptor generation, and mount attestation, but watchdog startup loaded the prior 2 GiB journal state and rejected seed-00000000 because its immutable registry facts changed across restart.

## Impact

Every legitimate fixed backing or seed epoch rotation can commit successfully yet leave admission closed because the steady-state journal treats cross-epoch physical identities as same-generation drift.

Watchdog generation identity covered Docker and assets but omitted the committed fixed descriptor/backing, and registry loading happened before any generation reset.
