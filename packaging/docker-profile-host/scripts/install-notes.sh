#!/usr/bin/env bash
# Print safe administrator install commands. Does not modify the machine.
set -euo pipefail

cat <<'EOF'
NiceEval docker-profile host package — administrator install notes
==================================================================

This helper only prints commands. It does not run sudo or change the host.

Generic systemd Linux (Ubuntu/Debian-style)
-------------------------------------------
1. Install package assets (units, sysusers, tmpfiles, libexec helpers).
2. Create dedicated user/group/subids and access group (sysusers + subuid/subgid).
3. Provide a hard-capacity filesystem:
     - recommended: loop-ext4 via prepare-loop-storage + mount unit
     - or admin-provided LVM/ZFS/independent mount at the data path
   Ordinary root-partition subdirectories without a hard limit are rejected.
4. Install root-owned host config under /etc/niceeval/docker-profiles/<alias>.host.json
   with capacity (allocatable) and aggregate (cgroup hard limits) separated.
   Preload and verify the fixed linux/amd64 DIND and BuildKit assets before
   starting watchdog (deployment may load an administrator-provided OCI archive
   or explicitly pull these exact digests; runtime never pulls):
     niceeval-docker-profile-preload-verify-assets \
       --manifest /etc/niceeval/docker-profiles/assets-v1.json --load-archive /path/assets.oci.tar
5. systemctl daemon-reload && systemctl enable --now \
     niceeval-docker-profile-storage@<alias>.service \
     niceeval-docker-profile@<alias>.service \
     niceeval-docker-profile-watchdog@<alias>.socket
6. Generate descriptor (root):
     niceeval-docker-profile-generate-descriptor \
       --host-config /etc/niceeval/docker-profiles/<alias>.host.json \
       --output /etc/niceeval/docker-profiles/<alias>.json \
       --access-group niceeval-dp-<alias>-access
7. Static check:
     niceeval-docker-profile-host-doctor <alias>
8. Runtime doctor (as access user, no sudo):
     niceeval docker profile doctor <alias>

NixOS
-----
services.niceeval.dockerProfiles.<alias> = {
  enable = true;
  accessUsers = [ "youruser" ];
  capacity = { cpus = 16; memory = "28G"; pids = 8192; maxContainers = 4; maxBuilds = 2; };
  aggregate = { cpus = 20; memory = "32G"; pids = 12288; };
  storage = { size = "30G"; backing = "loop-ext4"; };
};
# then: sudo nixos-rebuild switch
# daily work: niceeval docker profile doctor default

Hard constraints (must hold)
----------------------------
- capacity.* is allocatable; capacity.aggregate / aggregate.* is cgroup hard limit
- dedicated UID owns rootless dockerd + watchdog; not the daily login UID
- no TCP Docker endpoint; no host network bind for the daemon
- host loopback disabled in rootlesskit
- DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=none (never builtin)
- daemon bridge=none; Attempt networks use enable_icc=false (core) + host 198.18 REJECT
- apply-rootless-network-policy must leave network-policy.ready after dockerd start
- MemorySwapMax=0 / memorySwapBytes=0
- access group may read/traverse sockets; cannot write descriptor parent dirs
- watchdog challenge/lease/reservation protocol and journal smoke must pass before admission opens

Sibling isolation proof (live, after enable)
--------------------------------------------
  niceeval-docker-profile-verify-sibling-isolation --profile <alias> \
    --image docker.io/library/alpine:3.20
  # TCP connect to sibling name, 198.18.0.1, and cross-network IP must all FAIL

Example sudo enable sequence (admin only; not run by this script)
-----------------------------------------------------------------
  sudo nixos-rebuild switch
  # or on generic systemd:
  sudo systemctl enable --now niceeval-docker-profile@default.service
  sudo systemctl enable --now niceeval-docker-profile-watchdog@default.socket
EOF
