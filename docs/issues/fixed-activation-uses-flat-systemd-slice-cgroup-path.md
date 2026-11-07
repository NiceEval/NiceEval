---
relations:
  - role: root-cause
    target: memory/fixed-activation-systemd-slice-cgroup-hierarchy.md
---

# Fixed activation looks for a flattened systemd slice cgroup path

Fixed activation rejected the configured aggregate cgroup as unavailable. The host config named /sys/fs/cgroup/niceeval-docker-profile-harness-raw.slice, while systemd exposed the active slice at /sys/fs/cgroup/niceeval.slice/niceeval-docker.slice/niceeval-docker-profile.slice/niceeval-docker-profile-harness.slice/niceeval-docker-profile-harness-raw.slice.

## Impact

Every fixed-image profile whose alias participates in a systemd slice hierarchy fails activation before store preparation, even when the required slice is active and empty.

The generated host config flattened a hierarchical systemd slice name into an impossible cgroup filesystem path.
