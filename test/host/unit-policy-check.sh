#!/usr/bin/env bash
# Grep-level unit/policy contract checks for packaging assets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/packaging/docker-profile-host"

grep -q 'MemorySwapMax=0' systemd/niceeval-docker-profile-default.slice
grep -q 'DISABLE_HOST_LOOPBACK=true' systemd/niceeval-docker-profile@.service
grep -q 'PORT_DRIVER=none' systemd/niceeval-docker-profile@.service
grep -q 'apply-rootless-network-policy' systemd/niceeval-docker-profile@.service
grep -q 'User=niceeval-dp-%i' systemd/niceeval-docker-profile@.service
grep -q 'Delegate=yes' systemd/niceeval-docker-profile@.service
grep -q 'Slice=niceeval-docker-profile-%i.slice' systemd/niceeval-docker-profile@.service
grep -q 'unix://' systemd/niceeval-docker-profile@.service
# Forbidden: builtin port driver re-opens 198.18 synthetic TCP connect path
if grep -E 'PORT_DRIVER=builtin|port-driver=builtin' systemd/niceeval-docker-profile@.service; then
  echo "builtin port driver is forbidden" >&2
  exit 1
fi
! grep -qE 'tcp://' systemd/* config/* 2>/dev/null || {
  if grep -RE 'tcp://' systemd config | grep -v example-comment; then
    exit 1
  fi
}

grep -q '198.18.0.0/15' scripts/apply-rootless-network-policy.sh
grep -q 'tcp-reset' scripts/apply-rootless-network-policy.sh
grep -q 'PORT_DRIVER' scripts/apply-rootless-network-policy.sh
grep -q 'Durable admission' scripts/watchdog.py

# daemon.json: bridge none, no userland-proxy
python3 - <<'PY'
import json
from pathlib import Path
daemon = json.loads(Path("config/daemon.json.example").read_text())
assert daemon.get("bridge") == "none", daemon
assert daemon.get("userland-proxy") is False
cfg = json.loads(Path("config/default.host.json.example").read_text())
assert cfg["capacity"]["cpus"] == 16
assert cfg["aggregate"]["cpus"] == 20
assert cfg["capacity"]["cpus"] < cfg["aggregate"]["cpus"]
assert cfg["policy"]["tcpDockerEndpoint"] is False
assert cfg["policy"]["hostLoopback"] is False
np = cfg["networkPolicy"]
assert np["rootlessPortDriver"] == "none"
assert np["dnsServers"] == ["1.1.1.1", "9.9.9.9"]
assert "198.18.0.0/15" in np["blockedCidrs"]
assert np["ipv6"] == "disabled"
assert np["defaultBridge"] == "none"
print("unit-policy-check ok")
PY
