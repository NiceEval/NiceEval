---
relations:
  - role: root-cause
    target: memory/fixed-image-storage-root-tmpfiles-ownership.md
---

# Fixed-image NixOS module does not create its configured storage root

After all ownership and cgroup gates passed, fixed activation failed with portable fixed storage paths/size are invalid because /data/niceeval/docker-profiles/harness-raw did not exist. The NixOS module required the path's mount but did not declare the root directory.

## Impact

A clean first deployment cannot prepare its fixed-image store without an imperative root mkdir, defeating reproducible NixOS ownership and root-filesystem fallback protection.

The module configured storage.rootDir but omitted the corresponding tmpfiles directory declaration.
