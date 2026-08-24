#!/usr/bin/env bash
# Offline host-surface checks. No sudo, no machine mutation, no docker daemon.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/niceeval-host-check-cache}"

PASS=0
FAIL=0
pass() { echo "PASS  $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $*"; FAIL=$((FAIL + 1)); }

echo "== asset layout =="
for f in \
  nix/lib/capacity.nix \
  nix/lib/paths.nix \
  nix/modules/docker-profiles.nix \
  nix/packages/docker-profile-host.nix \
  packaging/docker-profile-host/scripts/validate-capacity.py \
  packaging/docker-profile-host/scripts/generate-descriptor.py \
  packaging/docker-profile-host/scripts/prepare-loop-storage.sh \
  packaging/docker-profile-host/scripts/watchdog.py \
  packaging/docker-profile-host/scripts/preload-verify-assets.py \
  packaging/docker-profile-host/config/assets-v1.json \
  packaging/docker-profile-host/scripts/install-quota-slots.py \
  packaging/docker-profile-host/scripts/host-doctor.sh \
  packaging/docker-profile-host/scripts/apply-rootless-network-policy.sh \
  packaging/docker-profile-host/scripts/verify-sibling-isolation.sh \
  packaging/docker-profile-host/config/network-policy.md \
  packaging/docker-profile-host/systemd/niceeval-docker-profile@.service \
  packaging/docker-profile-host/systemd/niceeval-docker-profile-watchdog@.service \
  packaging/docker-profile-host/systemd/niceeval-docker-profile-quota-slots@.service \
  packaging/docker-profile-host/systemd/niceeval-docker-profile-watchdog@.socket \
  packaging/docker-profile-host/systemd/niceeval-docker-profile-default.slice \
  packaging/docker-profile-host/sysusers.d/niceeval-docker-profile.conf \
  packaging/docker-profile-host/tmpfiles.d/niceeval-docker-profile.conf \
  packaging/docker-profile-host/config/default.host.json.example \
  flake.nix
do
  if [[ -e "$f" ]]; then pass "$f"; else fail "missing $f"; fi
done

echo
echo "== capacity validation (python) =="
PY=packaging/docker-profile-host/scripts/validate-capacity.py
if python3 "$PY" packaging/docker-profile-host/config/default.host.json.example --json \
  | tee /tmp/ne-dp-cap.json \
  | grep -q '"cpus": 16'; then
  pass "example host config validates; allocatable cpus=16"
else
  fail "example host config validation"
fi

if python3 "$PY" - <<'JSON' 2>/tmp/ne-dp-disk-bad.err
{"name":"bad-disk","capacity":{"cpus":1,"memory":"1G","pids":10,"maxContainers":2,"maxBuilds":1,"ephemeralDiskBytes":"8G","dockerDataAllocationCount":2},"aggregate":{"cpus":1,"memory":"1G","pids":10},"storage":{"size":"10G"}}
JSON
then
  fail "should reject quota slot sparse overcommit"
else
  if grep -q 'exceeds storage.size' /tmp/ne-dp-disk-bad.err; then
    pass "rejects dockerDataAllocationCount * ephemeralDiskBytes > physical storage"
  else
    fail "disk overcommit reject message unclear: $(cat /tmp/ne-dp-disk-bad.err)"
  fi
fi

if grep -q '"cpus": 20' /tmp/ne-dp-cap.json; then
  pass "aggregate cpus=20 present"
else
  fail "aggregate cpus missing"
fi

if python3 "$PY" - <<'JSON' 2>/tmp/ne-dp-cap-bad.err
{"name":"bad","capacity":{"cpus":20,"memory":"32G","pids":100,"maxContainers":1,"maxBuilds":1},"aggregate":{"cpus":16,"memory":"32G","pids":100}}
JSON
then
  fail "should reject aggregate < capacity"
else
  if grep -q 'aggregate.cpus' /tmp/ne-dp-cap-bad.err; then
    pass "rejects aggregate.cpus < capacity.cpus"
  else
    fail "reject message unclear: $(cat /tmp/ne-dp-cap-bad.err)"
  fi
fi

echo
echo "== unit policy strings =="
UNIT=packaging/docker-profile-host/systemd/niceeval-docker-profile@.service
if grep -q 'DISABLE_HOST_LOOPBACK=true' "$UNIT"; then
  pass "dockerd unit disables host loopback"
else
  fail "missing DISABLE_HOST_LOOPBACK"
fi
if grep -q 'PORT_DRIVER=none' "$UNIT"; then
  pass "dockerd unit sets PORT_DRIVER=none (no builtin/198.18 publish path)"
else
  fail "missing PORT_DRIVER=none"
fi
if grep -q 'apply-rootless-network-policy' "$UNIT"; then
  pass "dockerd unit applies fail-closed network policy post-start"
else
  fail "missing apply-rootless-network-policy ExecStartPost"
fi
if grep -q 'Slice=niceeval-docker-profile-%i.slice' "$UNIT"; then
  pass "dockerd unit joins aggregate slice"
else
  fail "dockerd unit missing Slice="
fi
if grep -q 'Delegate=yes' "$UNIT"; then
  pass "dockerd unit Delegate=yes"
else
  fail "dockerd unit missing Delegate"
fi
if grep -q 'User=niceeval-dp-%i' "$UNIT"; then
  pass "dockerd runs as dedicated UID"
else
  fail "dockerd User= not dedicated"
fi
if ! grep -qE ' -H tcp://|tcp://0\.0\.0\.0' "$UNIT" packaging/docker-profile-host/config/*.example; then
  pass "no TCP Docker host in units/examples"
else
  fail "TCP Docker host found"
fi

NETPOL=packaging/docker-profile-host/scripts/apply-rootless-network-policy.sh
if grep -q '198.18.0.0/15' "$NETPOL" && grep -q 'tcp-reset' "$NETPOL"; then
  pass "network policy rejects 198.18/15 with tcp-reset"
else
  fail "network policy missing 198.18 REJECT"
fi
if grep -q "must be 'none'" "$NETPOL"; then
  pass "network policy requires port-driver=none"
else
  fail "network policy does not enforce port-driver=none"
fi
if grep -q 'Durable admission' packaging/docker-profile-host/scripts/watchdog.py; then
  pass "durable watchdog/admission implementation present"
else
  fail "durable watchdog/admission implementation missing"
fi
if python3 -c 'import json; d=json.load(open("packaging/docker-profile-host/config/daemon.json.example")); assert d["bridge"]=="none"'; then
  pass "daemon.json example bridge=none"
else
  fail "daemon.json example missing bridge=none"
fi

# apply script must refuse builtin port driver without needing a live netns
if DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=builtin \
   DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true \
   bash packaging/docker-profile-host/scripts/apply-rootless-network-policy.sh --profile default \
   --dns-server 1.1.1.1 --blocked-cidr 198.18.0.0/15 \
   >/tmp/ne-dp-net-bad.out 2>/tmp/ne-dp-net-bad.err; then
  fail "apply-rootless-network-policy should reject PORT_DRIVER=builtin"
else
  if grep -q "PORT_DRIVER must be 'none'" /tmp/ne-dp-net-bad.err; then
    pass "apply-rootless-network-policy rejects builtin port driver"
  else
    fail "apply script reject message unclear: $(cat /tmp/ne-dp-net-bad.err)"
  fi
fi

SLICE=packaging/docker-profile-host/systemd/niceeval-docker-profile-default.slice
if grep -q 'MemorySwapMax=0' "$SLICE"; then
  pass "aggregate slice MemorySwapMax=0"
else
  fail "slice missing MemorySwapMax=0"
fi

echo
echo "== host script env isolation contracts =="
VSI=packaging/docker-profile-host/scripts/verify-sibling-isolation.sh
PLS=packaging/docker-profile-host/scripts/prepare-loop-storage.sh
HD=packaging/docker-profile-host/scripts/host-doctor.sh

if grep -q 'DOCKER_HOST' "$VSI"; then
  fail "verify-sibling-isolation must not read/export DOCKER_HOST"
else
  pass "verify-sibling-isolation never consults DOCKER_HOST"
fi

if grep -q 'NICEEVAL_NETCHECK_IMAGE' "$VSI"; then
  fail "NICEEVAL_NETCHECK_IMAGE still referenced"
else
  pass "no NICEEVAL_NETCHECK_IMAGE in verify-sibling-isolation"
fi

if grep -q 'IMAGE="docker.io/library/alpine:3.20"' "$VSI"; then
  pass "default netcheck image is a constant"
else
  fail "default netcheck image not a constant"
fi

if grep -q 'NICEEVAL_DOCKER_PROFILE_REGISTRY' "$HD"; then
  fail "host-doctor registry override still present"
else
  pass "no NICEEVAL_DOCKER_PROFILE_REGISTRY in host-doctor"
fi

if grep -q 'REGISTRY_DIR="/etc/niceeval/docker-profiles"' "$HD"; then
  pass "host-doctor registry fixed to /etc/niceeval/docker-profiles"
else
  fail "host-doctor registry not fixed"
fi

if grep -q 'DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER' "$HD" &&
   grep -q 'DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK' "$HD"; then
  pass "host-doctor retains RootlessKit upstream env contract"
else
  fail "host-doctor dropped RootlessKit upstream env vars"
fi

if grep -q 'FORCE_RECREATE' "$PLS"; then
  fail "FORCE_RECREATE still present in prepare-loop-storage"
else
  pass "no FORCE_RECREATE in prepare-loop-storage"
fi

if grep -qE 'rm (-f|--force) ' "$PLS" || grep -qE '\bunlink\b' "$PLS"; then
  fail "prepare-loop-storage still has an unlink/recreate path"
else
  pass "prepare-loop-storage never unlinks an existing image"
fi

if grep -q -- '--force' "$PLS"; then
  fail "prepare-loop-storage gained a --force flag"
else
  pass "no --force flag in prepare-loop-storage"
fi

# every docker invocation must go through the explicit --host wrapper
if python3 - "$VSI" <<'PY'
import re, sys
bad = []
for i, ln in enumerate(open(sys.argv[1]).read().splitlines(), 1):
    if re.search(r'(^|;|&&|\|\|)\s*docker(\s|$)', ln):
        if re.match(r'docker --host "\$DOCKER_SOCK"', ln.strip()):
            continue
        bad.append((i, ln))
assert not bad, bad
print("ok")
PY
then
  pass "every docker call goes through explicit --host wrapper"
else
  fail "bare docker invocation not routed through --host"
fi

# strict flag parsing: missing value and unknown flag must fail
if bash "$VSI" --image >/dev/null 2>&1; then
  fail "--image without a value must fail"
else
  pass "--image without a value fails"
fi
if bash "$VSI" --definitely-bogus >/dev/null 2>&1; then
  fail "unknown flag must fail"
else
  pass "unknown flag fails"
fi

echo
echo "== descriptor generator (offline, fake user via -- dry run of pure helpers) =="
# generate-descriptor needs real passwd entries; only test stable id helper via python snippet
python3 - <<'PY'
import hashlib, json, sys
sys.path.insert(0, "packaging/docker-profile-host/scripts")
# inline stable id (same as generator)
def stable_profile_id(name, machine_id):
    return hashlib.sha256(f"niceeval-docker-profile-v1:{name}:{machine_id}".encode()).hexdigest()[:32]
pid = stable_profile_id("default", "fb6b09fc2cbc492983bf2b8fcc0e982e")
assert len(pid) == 32
# policy forbids swap + tcp
from pathlib import Path
ex = json.loads(Path("packaging/docker-profile-host/config/default.host.json.example").read_text())
assert ex["policy"]["hostLoopback"] is False
assert ex["policy"]["tcpDockerEndpoint"] is False
assert ex["capacity"]["memorySwapBytes"] == 0
assert ex["capacity"]["ephemeralDiskBytes"] == "6G"
print("stable id", pid)
PY
pass "descriptor pure helpers / example policy"

echo
echo "== watchdog protocol/journal smoke =="
if python3 test/host/descriptor-modes-smoke.py; then
  pass "managed and raw descriptors have TS-compatible policy/storage shape"
else
  fail "descriptor mode generation smoke"
fi

if python3 test/host/watchdog-smoke.py; then
  pass "watchdog challenge, lease, reservation, release, recovery and replay"
else
  fail "watchdog protocol/journal smoke"
fi

if python3 test/host/setup-prefix-watchdog-smoke.py; then
  pass "default-off dockerData raw-image capture/restore and crash safety"
else
  fail "dockerData raw-image watchdog smoke"
fi

echo
echo "== nix capacity lib =="
if command -v nix-instantiate >/dev/null 2>&1; then
  if nix-instantiate --eval --strict --expr "
    let
      lib = import <nixpkgs/lib>;
      capacityLib = import $ROOT/nix/lib/capacity.nix { inherit lib; };
      v = capacityLib.validateCapacityVsAggregate {
        profileName = \"default\";
        capacity = { cpus = 16; memory = \"28G\"; pids = 8192; maxContainers = 4; maxBuilds = 2; memorySwapBytes = 0; };
        aggregate = { cpus = 20; memory = \"32G\"; pids = 12288; memorySwapBytes = 0; };
      };
    in v.headroom.cpus
  " | grep -q '^4$'; then
    pass "nix capacity headroom.cpus == 4"
  else
    fail "nix capacity eval"
  fi

  if nix-instantiate --eval --strict --expr "
    let
      lib = import <nixpkgs/lib>;
      capacityLib = import $ROOT/nix/lib/capacity.nix { inherit lib; };
    in capacityLib.validateCapacityVsAggregate {
      profileName = \"bad\";
      capacity = { cpus = 20; memory = \"32G\"; pids = 1; maxContainers = 1; maxBuilds = 1; memorySwapBytes = 0; };
      aggregate = { cpus = 16; memory = \"32G\"; pids = 1; memorySwapBytes = 0; };
    }
  " >/tmp/ne-dp-nix-bad.out 2>/tmp/ne-dp-nix-bad.err; then
    fail "nix should reject aggregate < capacity"
  else
    pass "nix rejects aggregate < capacity"
  fi
else
  fail "nix-instantiate not available"
fi

echo
echo "== flake checks (if flake.lock / nix available) =="
if [[ -f flake.lock ]]; then
  SYS=$(nix eval --impure --raw --expr builtins.currentSystem)
  for check in capacity-ok capacity-reject host-assets nixos-eval; do
    if nix build --no-link --no-update-lock-file ".#checks.${SYS}.${check}" 2>&1 | tee -a /tmp/ne-dp-flake-check.log; then
      pass "nix build checks.${SYS}.${check}"
    else
      fail "nix build checks.${SYS}.${check} (see /tmp/ne-dp-flake-check.log)"
    fi
  done
else
  echo "SKIP  flake check (no flake.lock); pure nix-instantiate already ran"
fi

echo
echo "summary PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
