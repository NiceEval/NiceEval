---
relations:
  - role: root-cause
    target: memory/fixed-watchdog-findmnt-duplicate-mount-rows.md
---

# Fixed watchdog rejects valid slot mounts in its systemd namespace

After activation successfully published and mounted all sixteen fixed slots, the watchdog failed with independent slot is not loop-mounted from its attested image. Inside an equivalent systemd ReadWritePaths mount namespace, findmnt returned two identical source/target rows for the same slot.

## Impact

The fixed profile has a valid committed epoch and mounted storage but admission never opens, so real evals cannot start.

The mount verifier treated duplicate identical rows as one newline-containing source instead of one unambiguous mount identity.
