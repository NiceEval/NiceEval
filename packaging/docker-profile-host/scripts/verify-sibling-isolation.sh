#!/usr/bin/env bash
# Live verification that sibling TCP connect fails under managed-rootless policy.
# Requires a running profile dockerd and docker CLI. Does not start/stop the host
# daemon. Safe to run as access-group member with DOCKER_HOST set.
#
# Proves the frozen contract: TCP connect to a sibling (or to 198.18/15 synthetic
# addresses) must fail. enable_icc=false alone is not accepted as proof.
set -euo pipefail

PROFILE="${1:-default}"
DOCKER_HOST="${DOCKER_HOST:-unix:///run/niceeval/docker-profiles/${PROFILE}/docker.sock}"
export DOCKER_HOST

PASS=0
FAIL=0
pass() { echo "PASS  $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $*"; FAIL=$((FAIL + 1)); }

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI required" >&2
  exit 2
fi

echo "DOCKER_HOST=$DOCKER_HOST"

# 1) Host static contract
if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -qi rootless; then
  pass "daemon reports rootless"
else
  fail "daemon not rootless or unreachable"
fi

# 2) Policy marker from apply-rootless-network-policy
MARKER="/run/niceeval/docker-profiles/${PROFILE}/network-policy.ready"
if [[ -f "$MARKER" ]] && grep -q 'port_driver=none' "$MARKER" && grep -q '198.18.0.0/15' "$MARKER"; then
  pass "network-policy.ready present (port_driver=none, 198.18 reject)"
else
  fail "network-policy.ready missing or incomplete ($MARKER)"
fi

# 3) Synthetic CGNAT must not accept TCP (fail closed)
# Run from a short-lived container on an icc=false user-defined network.
NET="niceeval-netcheck-$$"
IMG="${NICEEVAL_NETCHECK_IMAGE:-docker.io/library/alpine:3.20}"
cleanup() {
  docker rm -f "$C1" "$C2" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create \
  --driver bridge \
  -o "com.docker.network.bridge.enable_icc=false" \
  "$NET" >/dev/null

C1=$(docker run -d --rm --network "$NET" --name "ne-netcheck-a-$$" "$IMG" sleep 60)
C2=$(docker run -d --rm --network "$NET" --name "ne-netcheck-b-$$" "$IMG" sleep 60)

# Same-network ICC=false: connect to sibling by name must fail at TCP layer.
# Install a listener on C1; C2 tries /dev/tcp.
docker exec "$C1" sh -c 'nc -l -p 8080 >/dev/null 2>&1 & sleep 0.2' || \
  docker exec "$C1" sh -c 'while true; do :; done' >/dev/null 2>&1 &

set +e
docker exec "$C2" sh -c 'timeout 2 sh -c "echo hi >/dev/tcp/ne-netcheck-a-'$$'/8080" 2>/dev/null'
rc_same=$?
set -e
if [[ "$rc_same" -ne 0 ]]; then
  pass "same-network ICC=false: TCP connect to sibling name failed (rc=$rc_same)"
else
  fail "same-network ICC=false: TCP connect to sibling name succeeded (contract violation)"
fi

# Direct 198.18 synthetic target must fail (the observed rootlesskit failure mode).
set +e
docker exec "$C2" sh -c 'timeout 2 sh -c "echo hi >/dev/tcp/198.18.0.1/8080" 2>/dev/null'
rc_syn=$?
set -e
if [[ "$rc_syn" -ne 0 ]]; then
  pass "synthetic 198.18.0.1:8080 TCP connect failed (rc=$rc_syn)"
else
  fail "synthetic 198.18.0.1:8080 TCP connect succeeded (port-driver/198.18 path still open)"
fi

# Cross-network: second network + container; TCP to the first container's IP must fail.
NET2="niceeval-netcheck2-$$"
docker network create \
  --driver bridge \
  -o "com.docker.network.bridge.enable_icc=false" \
  "$NET2" >/dev/null
C3=$(docker run -d --rm --network "$NET2" --name "ne-netcheck-c-$$" "$IMG" sleep 60)
# shellcheck disable=SC2016
IP1=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$C1")
set +e
docker exec "$C3" sh -c "timeout 2 sh -c 'echo hi >/dev/tcp/${IP1}/8080' 2>/dev/null"
rc_cross=$?
set -e
docker rm -f "$C3" >/dev/null 2>&1 || true
docker network rm "$NET2" >/dev/null 2>&1 || true
if [[ "$rc_cross" -ne 0 ]]; then
  pass "cross-network TCP connect to sibling IP failed (rc=$rc_cross)"
else
  fail "cross-network TCP connect to sibling IP succeeded"
fi

echo
echo "summary PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
