#!/usr/bin/env bash
# Static host-side checks for a managed docker profile (no sudo mutations).
# Full runtime attestation remains with `niceeval docker profile doctor`.
set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "Usage: docker-profile-host-doctor <profile-alias>" >&2
  exit 2
fi

REGISTRY_DIR="${NICEEVAL_DOCKER_PROFILE_REGISTRY:-/etc/niceeval/docker-profiles}"
DESC="${REGISTRY_DIR}/${NAME}.json"
HOST_CFG="${REGISTRY_DIR}/${NAME}.host.json"
RUNTIME="/run/niceeval/docker-profiles/${NAME}"
STATE="/var/lib/niceeval/docker-profiles/${NAME}"
PASS=0
FAIL=0

ok() { echo "PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "FAIL  $*"; FAIL=$((FAIL + 1)); }

if [[ -f "$HOST_CFG" ]]; then
  ok "host config present: $HOST_CFG"
  if command -v niceeval-docker-profile-validate-capacity >/dev/null 2>&1; then
    if niceeval-docker-profile-validate-capacity "$HOST_CFG" >/dev/null; then
      ok "capacity allocatable vs aggregate"
    else
      bad "capacity allocatable vs aggregate"
    fi
  elif [[ -x "$(dirname "$0")/validate-capacity" ]]; then
    if "$(dirname "$0")/validate-capacity" "$HOST_CFG" >/dev/null; then
      ok "capacity allocatable vs aggregate"
    else
      bad "capacity allocatable vs aggregate"
    fi
  else
    bad "validate-capacity helper not on PATH"
  fi
else
  bad "host config missing: $HOST_CFG"
fi

if [[ -f "$DESC" ]]; then
  ok "descriptor present: $DESC"
  if [[ -L "$DESC" ]]; then
    bad "descriptor must not be a symlink"
  else
    ok "descriptor is not a symlink"
  fi
  owner=$(stat -c '%u:%g' "$DESC" 2>/dev/null || stat -f '%u:%g' "$DESC")
  mode=$(stat -c '%a' "$DESC" 2>/dev/null || stat -f '%OLp' "$DESC")
  if [[ "$owner" == 0:* ]]; then
    ok "descriptor root-owned ($owner)"
  else
    bad "descriptor owner $owner (want root uid 0)"
  fi
  if [[ "$mode" == "640" || "$mode" == "644" || "$mode" == "600" ]]; then
    ok "descriptor mode $mode"
  else
    bad "descriptor mode $mode (want 640/644/600)"
  fi
  # schemaVersion + capacity.aggregate present
  if python3 - "$DESC" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assert d.get("schemaVersion")==1
assert "capacity" in d and "aggregate" in d["capacity"]
assert d["capacity"]["memorySwapBytes"]==0
assert d["capacity"]["aggregate"]["memorySwapBytes"]==0
assert d["policy"]["tcpDockerEndpoint"] is False
assert d["policy"]["hostLoopback"] is False
assert d["transport"]["kind"]=="unix"
print("ok")
PY
  then
    ok "descriptor schema policy constraints"
  else
    bad "descriptor schema policy constraints"
  fi
else
  bad "descriptor missing: $DESC"
fi

if [[ -d "$RUNTIME" ]]; then
  ok "runtime dir: $RUNTIME"
else
  bad "runtime dir missing: $RUNTIME"
fi

if [[ -S "$RUNTIME/docker.sock" ]]; then
  ok "docker unix socket present"
else
  bad "docker unix socket missing (daemon not running?)"
fi

if [[ -S "$RUNTIME/control.sock" ]]; then
  ok "control unix socket present"
else
  bad "control unix socket missing (watchdog not running?)"
fi

# Reject obsolete packaging stubs; the installed watchdog must answer the v1 challenge.
if [[ -f "$RUNTIME/watchdog.ready" ]]; then
  if command -v python3 >/dev/null 2>&1 && [[ -S "$RUNTIME/control.sock" ]]; then
    stub=$(
      python3 - <<PY 2>/dev/null || true
import json, socket
s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(1.0)
try:
    s.connect("${RUNTIME}/control.sock")
    s.sendall(b'{"kind":"challenge","clientNonce":"doctor"}\n')
    print(s.recv(4096).decode())
except Exception as e:
    print("err", e)
PY
    )
    if echo "$stub" | grep -q '"status": "stub"'; then
      bad "watchdog is still the incomplete stub (admission/control protocol not deployed)"
    else
      ok "watchdog control reply is not the packaging stub"
    fi
  fi
fi

# Fail-closed network policy contract (static + runtime marker).
if [[ -f "$HOST_CFG" ]]; then
  if python3 - "$HOST_CFG" <<'PY'
import json, sys
h=json.load(open(sys.argv[1]))
np=h.get("networkPolicy") or {}
assert np.get("rootlessPortDriver")=="none"
assert "198.18.0.0/15" in (np.get("blockedCidrs") or [])
assert np.get("defaultBridge")=="none"
print("ok")
PY
  then
    ok "host config networkPolicy fail-closed (port-driver=none, reject 198.18/15, bridge=none)"
  else
    bad "host config missing networkPolicy fail-closed fields"
  fi
fi

if [[ -f "$RUNTIME/network-policy.ready" ]]; then
  if grep -q 'port_driver=none' "$RUNTIME/network-policy.ready" &&
    grep -q '198.18.0.0/15' "$RUNTIME/network-policy.ready"; then
    ok "runtime network-policy.ready (198.18 reject applied)"
  else
    bad "runtime network-policy.ready incomplete"
  fi
  # Prefer live iptables check when daemon netns is reachable.
  if command -v niceeval-docker-profile-apply-network-policy >/dev/null 2>&1 || \
     [[ -x "$(dirname "$0")/apply-rootless-network-policy" ]]; then
    apply_bin=$(command -v niceeval-docker-profile-apply-network-policy || true)
    [[ -n "$apply_bin" ]] || apply_bin="$(dirname "$0")/apply-rootless-network-policy"
    net_args=()
    while IFS= read -r value; do net_args+=(--dns-server "$value"); done < <(
      python3 -c "import json; print(*json.load(open('$HOST_CFG'))['networkPolicy']['dnsServers'], sep='\\n')"
    )
    while IFS= read -r value; do net_args+=(--blocked-cidr "$value"); done < <(
      python3 -c "import json; print(*json.load(open('$HOST_CFG'))['networkPolicy']['blockedCidrs'], sep='\\n')"
    )
    if DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=none \
       DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true \
       "$apply_bin" --check-only --profile "$NAME" \
         --state-dir "$RUNTIME/dockerd-rootless" \
         --runtime-dir "$RUNTIME" "${net_args[@]}" >/dev/null 2>&1; then
      ok "netns iptables REJECT 198.18.0.0/15 present"
    else
      bad "netns iptables REJECT 198.18.0.0/15 missing (apply-rootless-network-policy --check-only failed)"
    fi
  fi
else
  bad "network-policy.ready missing — rootless 198.18 path may still accept TCP connect"
fi

if [[ -d "$STATE/data" ]]; then
  ok "data mount/dir: $STATE/data"
  # Refuse plain root-partition "only a subdirectory" when host config demands loop-ext4
  if [[ -f "$HOST_CFG" ]]; then
    backing=$(python3 -c "import json;print(json.load(open('$HOST_CFG')).get('storage',{}).get('backing',''))")
    if [[ "$backing" == "loop-ext4" ]]; then
      fstype=$(findmnt -n -o FSTYPE "$STATE/data" 2>/dev/null || true)
      source=$(findmnt -n -o SOURCE "$STATE/data" 2>/dev/null || true)
      if [[ -n "$fstype" && "$fstype" == "ext4" ]]; then
        ok "data fstype ext4 source=$source"
      else
        bad "loop-ext4 backing required but mount not proven (fstype=${fstype:-none})"
      fi
    fi
  fi
else
  bad "data dir missing: $STATE/data"
fi

echo
echo "summary PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
