---
relations:
  - role: root-cause
    target: memory/fixed-backing-cutover-needs-epoch-registry-namespace.md
---

# Declarative fixed backing cutover reuses the previous provision journal

After changing storage.rootDir to rotate from sixteen 2 GiB slots to four 4 GiB slots, exclusive activation mounted the independent new outer image but the provisioner read the prior root-level provision.json and failed with fixed-image provision journal identity differs from configured policy.

## Impact

A legitimate declarative capacity migration cannot publish a new epoch even though the old committed capsule remains intact and the new backing has a distinct identity.

Only the explicit seed-rotation flag assigned registryEpoch; an ordinary source-config backing change did not isolate its registry and provision state.
