#!/usr/bin/env bash
# Fail-closed network policy for a managed-rootless docker profile daemon.
#
# Threat (observed): a host fake-DNS resolver can map both unknown sibling names
# and public names into 198.18.0.0/15.  Merely replacing resolv.conf is bypassable;
# this child-netns policy fixes allowed resolvers and rejects synthetic/private
# destinations at the final egress boundary.
#
# This script does NOT implement admission/watchdog. It only hardens the rootless
# dockerd network namespace after the daemon is up.
#
# Actions (idempotent):
#   1. Require/record port-driver=none + host-loopback disabled (env contract).
#   2. Enter the dockerd/rootlesskit netns.
#   3. Permit DNS only to descriptor-pinned public resolvers.
#   4. Reject descriptor-pinned synthetic/private destination CIDRs.
#   5. Permit established traffic and new HTTPS; reject other outbound traffic.
#   6. Refuse to leave the netns without proving the rules are present.
set -euo pipefail

PROFILE=""
STATE_DIR=""
RUNTIME_DIR=""
CHECK_ONLY=0
DNS_SERVERS=()
BLOCKED_CIDRS=()
CHAIN="NICEEVAL-DP-ISOLATION"

usage() {
  cat <<'EOF'
Usage:
  apply-rootless-network-policy.sh --profile NAME --dns-server IP... --blocked-cidr CIDR...
  apply-rootless-network-policy.sh --check-only --profile NAME [--state-dir DIR]

Applies fail-closed isolation inside the profile rootless netns.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE=$2; shift 2 ;;
    --state-dir) STATE_DIR=$2; shift 2 ;;
    --runtime-dir) RUNTIME_DIR=$2; shift 2 ;;
    --dns-server) DNS_SERVERS+=("$2"); shift 2 ;;
    --blocked-cidr|--reject-cidr) BLOCKED_CIDRS+=("$2"); shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  usage
  exit 2
fi
RUNTIME_DIR="${RUNTIME_DIR:-/run/niceeval/docker-profiles/${PROFILE}}"
STATE_DIR="${STATE_DIR:-${RUNTIME_DIR}/dockerd-rootless}"

log() { echo "niceeval-dp-net[${PROFILE}]: $*"; }
die() { echo "niceeval-dp-net[${PROFILE}]: ERROR: $*" >&2; exit 1; }
[[ ${#DNS_SERVERS[@]} -gt 0 ]] || die "at least one --dns-server is required"
[[ ${#BLOCKED_CIDRS[@]} -gt 0 ]] || die "at least one --blocked-cidr is required"

# Env contract: callers (systemd) must set these before dockerd-rootless starts.
# We re-check here so a misconfigured unit cannot silently ship builtin port driver.
require_env_contract() {
  local pd="${DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER:-}"
  local hl="${DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK:-}"
  if [[ "$pd" != "none" ]]; then
    die "DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER must be 'none' (got '${pd:-unset}'); builtin port driver enables 198.18/15 synthetic endpoints"
  fi
  if [[ "$hl" != "true" && "$hl" != "1" ]]; then
    die "DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK must be true (got '${hl:-unset}')"
  fi
}

find_netns_pid() {
  local pid=""
  if [[ -f "${STATE_DIR}/child_pid" ]]; then
    pid=$(tr -d ' \n' <"${STATE_DIR}/child_pid" || true)
    if [[ -n "$pid" && -d "/proc/${pid}" ]]; then
      echo "$pid"
      return 0
    fi
  fi
  # Fall back: dockerd child of this profile's rootlesskit state.
  # Prefer processes whose environ references our state dir / socket.
  local candidate
  for candidate in $(pgrep -x dockerd 2>/dev/null || true); do
    if [[ -r "/proc/${candidate}/environ" ]] &&
      tr '\0' '\n' <"/proc/${candidate}/environ" | grep -Fq "${RUNTIME_DIR}"; then
      echo "$candidate"
      return 0
    fi
  done
  for candidate in $(pgrep -x rootlesskit 2>/dev/null || true); do
    if [[ -r "/proc/${candidate}/cmdline" ]] &&
      tr '\0' ' ' <"/proc/${candidate}/cmdline" | grep -Fq "${STATE_DIR}"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

ns_iptables() {
  local pid=$1
  shift
  # util-linux nsenter; run iptables inside the rootless netns as same UID.
  nsenter --target "$pid" --user --net -- iptables "$@"
}

ns_ip6tables() {
  local pid=$1
  shift
  nsenter --target "$pid" --user --net -- ip6tables "$@"
}

rules_present() {
  local pid=$1
  local rules
  rules=$(ns_iptables "$pid" -n -L "$CHAIN" 2>/dev/null) || return 1
  local item
  for item in "${DNS_SERVERS[@]}" "${BLOCKED_CIDRS[@]}"; do
    [[ "$item" == *:* ]] && continue
    grep -Fq "$item" <<<"$rules" || return 1
  done
  grep -Fq "tcp dpt:443" <<<"$rules" || return 1
  ns_ip6tables "$pid" -n -L "$CHAIN" 2>/dev/null | grep -Fq "reject-with icmp6-adm-prohibited"
}

install_rules() {
  local pid=$1

  # Create/flush dedicated chain (idempotent).
  if ns_iptables "$pid" -n -L "$CHAIN" >/dev/null 2>&1; then
    ns_iptables "$pid" -F "$CHAIN"
  else
    ns_iptables "$pid" -N "$CHAIN"
  fi
  if ns_ip6tables "$pid" -n -L "$CHAIN" >/dev/null 2>&1; then
    ns_ip6tables "$pid" -F "$CHAIN"
  else
    ns_ip6tables "$pid" -N "$CHAIN"
  fi

  ns_iptables "$pid" -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  local server cidr
  for server in "${DNS_SERVERS[@]}"; do
    ns_iptables "$pid" -A "$CHAIN" -p udp -d "$server" --dport 53 -j RETURN
    ns_iptables "$pid" -A "$CHAIN" -p tcp -d "$server" --dport 53 -j RETURN
  done
  ns_iptables "$pid" -A "$CHAIN" -p udp --dport 53 -j REJECT --reject-with icmp-port-unreachable
  ns_iptables "$pid" -A "$CHAIN" -p tcp --dport 53 -j REJECT --reject-with tcp-reset
  for cidr in "${BLOCKED_CIDRS[@]}"; do
    [[ "$cidr" == *:* ]] && continue
    ns_iptables "$pid" -A "$CHAIN" -p tcp -d "$cidr" -j REJECT --reject-with tcp-reset
    ns_iptables "$pid" -A "$CHAIN" -d "$cidr" -j REJECT --reject-with icmp-host-unreachable
  done
  ns_iptables "$pid" -A "$CHAIN" -p tcp --dport 443 -j RETURN
  ns_iptables "$pid" -A "$CHAIN" -j REJECT --reject-with icmp-admin-prohibited
  ns_ip6tables "$pid" -A "$CHAIN" -j REJECT --reject-with icmp6-adm-prohibited

  # Hook OUTPUT + FORWARD at the top once.
  if ! ns_iptables "$pid" -C OUTPUT -j "$CHAIN" 2>/dev/null; then
    ns_iptables "$pid" -I OUTPUT 1 -j "$CHAIN"
  fi
  if ! ns_iptables "$pid" -C FORWARD -j "$CHAIN" 2>/dev/null; then
    ns_iptables "$pid" -I FORWARD 1 -j "$CHAIN"
  fi
  if ! ns_ip6tables "$pid" -C OUTPUT -j "$CHAIN" 2>/dev/null; then
    ns_ip6tables "$pid" -I OUTPUT 1 -j "$CHAIN"
  fi
  if ! ns_ip6tables "$pid" -C FORWARD -j "$CHAIN" 2>/dev/null; then
    ns_ip6tables "$pid" -I FORWARD 1 -j "$CHAIN"
  fi
}

require_env_contract

if ! command -v nsenter >/dev/null 2>&1; then
  die "nsenter not found (util-linux required)"
fi
if ! command -v iptables >/dev/null 2>&1; then
  die "iptables not found"
fi
if ! command -v ip6tables >/dev/null 2>&1; then
  die "ip6tables not found"
fi

pid=""
for _ in $(seq 1 40); do
  if pid=$(find_netns_pid); then
    break
  fi
  sleep 0.25
done
[[ -n "$pid" ]] || die "could not locate rootless dockerd/rootlesskit pid for state-dir=$STATE_DIR"

log "using child netns pid=$pid state=$STATE_DIR dns=${DNS_SERVERS[*]} blocked=${BLOCKED_CIDRS[*]}"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  if rules_present "$pid"; then
    log "CHECK PASS: $CHAIN matches pinned DNS and blocked CIDRs"
    exit 0
  fi
  die "CHECK FAIL: $CHAIN is missing one or more pinned DNS, blocked CIDR, HTTPS, or IPv6 rules"
fi

install_rules "$pid"

if ! rules_present "$pid"; then
  die "rules installed but verification failed"
fi

# Marker for host-doctor (runtime, dedicated-UID writable).
mkdir -p "${RUNTIME_DIR}"
cat >"${RUNTIME_DIR}/network-policy.ready" <<EOF
profile=${PROFILE}
dns_servers=${DNS_SERVERS[*]}
blocked_cidrs=${BLOCKED_CIDRS[*]}
port_driver=none
host_loopback=disabled
netns_pid=${pid}
applied_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 0640 "${RUNTIME_DIR}/network-policy.ready" 2>/dev/null || true

log "FAIL-CLOSED OK: pinned DNS, private/synthetic reject, HTTPS-only; port-driver=none"
exit 0
