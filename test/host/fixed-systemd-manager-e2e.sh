#!/usr/bin/env bash
# Real isolated systemd-manager receipt for the generic fixed-image unit graph.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE_ROOT="$(mktemp -d /tmp/niceeval-fixed-systemd-manager.XXXXXX)"
NSPAWN_PID=""

cleanup() {
  if [[ -n "$NSPAWN_PID" ]] && kill -0 "$NSPAWN_PID" 2>/dev/null; then
    sudo -n kill -TERM "$NSPAWN_PID" 2>/dev/null || true
    wait "$NSPAWN_PID" 2>/dev/null || true
  fi
  sudo -n rm -rf -- "$FIXTURE_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p \
  "$FIXTURE_ROOT/etc/systemd/system/probe-steady.target.wants" \
  "$FIXTURE_ROOT/etc" "$FIXTURE_ROOT/sbin" "$FIXTURE_ROOT/bin" \
  "$FIXTURE_ROOT/usr/lib/systemd" "$FIXTURE_ROOT/run" \
  "$FIXTURE_ROOT/proc" "$FIXTURE_ROOT/sys" "$FIXTURE_ROOT/dev"
cp /etc/os-release "$FIXTURE_ROOT/etc/os-release"
cp /etc/machine-id "$FIXTURE_ROOT/etc/machine-id"
systemd_unit_root="$(dirname "$(readlink -f /etc/systemd/system/multi-user.target)")"
ln -s "$(readlink -f /run/current-system/systemd/lib/systemd/systemd)" "$FIXTURE_ROOT/sbin/init"
ln -s "$(readlink -f /bin/sh)" "$FIXTURE_ROOT/bin/sh"
ln -s "$(readlink -f "$(command -v sleep)")" "$FIXTURE_ROOT/bin/sleep"
ln -s "$systemd_unit_root" "$FIXTURE_ROOT/usr/lib/systemd/system"

cp "$ROOT_DIR/packaging/docker-profile-host/systemd/niceeval-docker-profile-fixed-activation@.service" \
  "$FIXTURE_ROOT/etc/systemd/system/"
cp "$ROOT_DIR/packaging/docker-profile-host/systemd/niceeval-docker-profile-fixed-images@.service" \
  "$FIXTURE_ROOT/etc/systemd/system/"
cp "$ROOT_DIR/packaging/docker-profile-host/systemd/niceeval-docker-profile-fixed-descriptor@.service" \
  "$FIXTURE_ROOT/etc/systemd/system/"
cp "$ROOT_DIR/packaging/docker-profile-host/systemd/niceeval-docker-profile-fixed-watchdog@.service" \
  "$FIXTURE_ROOT/etc/systemd/system/"

# Retain the production Before/After/Requires/Conflicts graph. Replace only
# host filesystems, Docker, identities and product processes at this external
# systemd boundary.
activation="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-activation@.service"
attestation="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-images@.service"
descriptor="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-descriptor@.service"
watchdog="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-watchdog@.service"
sed -i \
  -e '/^After=local-fs.target docker.service$/d' \
  -e '/^Requires=docker.service /d' \
  -e '/^ConditionPathExists=/d' \
  -e '/^RequiresMountsFor=/d' \
  -e "s|^ExecStart=.*|ExecStart=/bin/sh -c 'echo activation >> /etc/probe-events; test ! -e /etc/probe-fail'|" \
  "$activation"
sed -i \
  -e 's/ docker.service$//' \
  -e '/^Requires=docker.service /d' \
  -e '/^ConditionPathExists=/d' \
  -e '/^RequiresMountsFor=/d' \
  -e "s|^ExecStart=.*|ExecStart=/bin/sh -c 'test -e /etc/probe-committed; test ! -e /etc/probe-parent-missing; echo epoch=committed manifest=sha256:new > /etc/probe-current; echo attested >> /etc/probe-events'|" \
  "$attestation"
sed -i \
  -e '/^ConditionPathExists=/d' \
  -e "s|^ExecStart=.*|ExecStart=/bin/sh -c 'echo descriptor >> /etc/probe-events'|" \
  "$descriptor"
sed -i \
  -e 's/^After=.*/After=niceeval-docker-profile-fixed-descriptor@%i.service/' \
  -e 's/^Requires=.*/Requires=niceeval-docker-profile-fixed-descriptor@%i.service/' \
  -e '/^Wants=/d' -e '/^ConditionPathExists=/d' \
  -e '/^User=/d' -e '/^Group=/d' -e '/^Slice=/d' -e '/^Delegate=/d' \
  -e '/^Environment=/d' -e '/^WorkingDirectory=/d' -e '/^ExecStartPost=/d' \
  -e '/^ReadWritePaths=/d' \
  -e "s|^ExecStart=.*|ExecStart=/bin/sh -c 'IFS= read -r value < /etc/probe-current; test \"\$value\" = \"epoch=committed manifest=sha256:new\"; echo watchdog-start >> /etc/probe-events; exec /bin/sleep infinity'|" \
  "$watchdog"

cat > "$FIXTURE_ROOT/etc/systemd/system/probe-steady.target" <<'EOF'
[Unit]
DefaultDependencies=no
Wants=niceeval-docker-profile-fixed-images@probe.service niceeval-docker-profile-fixed-descriptor@probe.service niceeval-docker-profile-fixed-watchdog@probe.service
After=niceeval-docker-profile-fixed-images@probe.service niceeval-docker-profile-fixed-descriptor@probe.service
AllowIsolate=yes
EOF
for unit in "$activation" "$attestation" "$descriptor" "$watchdog"; do
  sed -i '/^\[Unit\]$/a DefaultDependencies=no' "$unit"
done
ln -s probe-steady.target "$FIXTURE_ROOT/etc/systemd/system/default.target"
touch "$FIXTURE_ROOT/etc/probe-committed"

SYSTEMD_UNIT_PATH="$FIXTURE_ROOT/etc/systemd/system:/etc/systemd/system" systemd-analyze verify \
  "$activation" "$attestation" "$descriptor" "$watchdog"

systemctl_bin="$(readlink -f "$(command -v systemctl)")"
start_manager() {
  local before current
  before="$(grep -c '^watchdog-start$' "$FIXTURE_ROOT/etc/probe-events" 2>/dev/null || true)"
  sudo -n systemd-nspawn --directory="$FIXTURE_ROOT" --bind-ro=/nix/store \
    --register=no --boot --console=pipe >"$FIXTURE_ROOT/nspawn.log" 2>&1 &
  NSPAWN_PID=$!
  for _ in $(seq 1 100); do
    current="$(grep -c '^watchdog-start$' "$FIXTURE_ROOT/etc/probe-events" 2>/dev/null || true)"
    (( current > before )) && return
    sleep 0.05
  done
  sed -n '1,200p' "$FIXTURE_ROOT/nspawn.log" >&2
  return 1
}
manager_pid() {
  local pid="$NSPAWN_PID" command child
  for _ in $(seq 1 8); do
    command="$(sudo -n tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$command" == "/sbin/init " ]]; then
      echo "$pid"
      return
    fi
    child="$(pgrep -P "$pid" | head -1 || true)"
    [[ -n "$child" ]] || break
    pid="$child"
  done
  return 1
}
managerctl() {
  local pid
  pid="$(manager_pid)"
  sudo -n nsenter -t "$pid" -m -p -- "$systemctl_bin" "$@"
}
managerexec() {
  local pid
  pid="$(manager_pid)"
  sudo -n nsenter -t "$pid" -m -p -- /bin/sh -c "$1"
}
stop_manager() {
  managerctl poweroff >/dev/null 2>&1 || true
  wait "$NSPAWN_PID"
  NSPAWN_PID=""
}

start_manager
managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
initial_activation_count="$(grep -c '^activation$' "$FIXTURE_ROOT/etc/probe-events" || true)"
[[ "$initial_activation_count" == 0 ]]
managerctl restart niceeval-docker-profile-fixed-watchdog@probe.service
managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
managerctl start niceeval-docker-profile-fixed-activation@probe.service
! managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
managerctl start niceeval-docker-profile-fixed-watchdog@probe.service
touch "$FIXTURE_ROOT/etc/probe-fail"
if managerctl start niceeval-docker-profile-fixed-activation@probe.service; then
  echo "failed activation unexpectedly succeeded" >&2
  exit 1
fi
! managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
rm -f -- "$FIXTURE_ROOT/etc/probe-fail"
stop_manager

sudo -n rm -rf -- "$FIXTURE_ROOT/run/systemd/system"
sudo -n rm -f -- "$FIXTURE_ROOT/etc/probe-current"
start_manager
managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
grep -qx 'epoch=committed manifest=sha256:new' "$FIXTURE_ROOT/etc/probe-current"
[[ "$(grep -c '^activation$' "$FIXTURE_ROOT/etc/probe-events" || true)" == 2 ]]
[[ "$(grep -c '^attested$' "$FIXTURE_ROOT/etc/probe-events" || true)" == 2 ]]
printf '%s\n' 'epoch=stale manifest=sha256:old' | sudo -n tee "$FIXTURE_ROOT/etc/probe-current" >/dev/null
managerctl restart niceeval-docker-profile-fixed-watchdog@probe.service || true
sleep 0.2
! managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
managerctl restart niceeval-docker-profile-fixed-images@probe.service
managerctl start niceeval-docker-profile-fixed-watchdog@probe.service
stop_manager

# A root-filesystem lookalike must not substitute for the capsule-bound parent
# data mount on a fresh manager. The verifier fails and watchdog never becomes ready.
sudo -n rm -rf -- "$FIXTURE_ROOT/run/systemd/system"
sudo -n rm -f -- "$FIXTURE_ROOT/etc/probe-current"
mkdir -p "$FIXTURE_ROOT/data"
touch "$FIXTURE_ROOT/etc/probe-parent-missing"
sudo -n systemd-nspawn --directory="$FIXTURE_ROOT" --bind-ro=/nix/store \
  --register=no --boot --console=pipe >"$FIXTURE_ROOT/nspawn-missing-parent.log" 2>&1 &
NSPAWN_PID=$!
sleep 1
! grep -q '^watchdog-start$' <(tail -n 1 "$FIXTURE_ROOT/etc/probe-events")
! test -e "$FIXTURE_ROOT/etc/probe-current"
stop_manager

echo "fixed-systemd-manager-e2e ok"
