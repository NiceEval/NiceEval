---
relations:
  - role: root-cause
    target: memory/fixed-activation-recovered-legacy-leases.md
---

# Fixed activation rejects legacy journals containing only recovered leases

The fixed-image activation and its provisioner each rejected the legacy ownership journal as non-drained even though it contained 104 leases all in the terminal recovered state and zero reservations, queue entries, builds, containers, or setup-prefix operations.

## Impact

A host upgraded from the legacy transient watchdog cannot activate fixed-image storage without manually rewriting durable journal state, despite having no live ownership.

The production activation and provisioning boundaries failed closed on terminal receipts retained by the legacy watchdog.
