#!/usr/bin/env bash
# Real isolated systemd-manager receipt for the generic fixed-image boot graph.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE_ROOT="$(mktemp -d /tmp/niceeval-fixed-systemd-manager.XXXXXX)"
PROFILE_ROOT="$(mktemp -d /tmp/niceeval-e2e-docker-profile-systemd.XXXXXX)"
NSPAWN_PID=""
PROFILE_READY=0
PROFILE_BOUND=0

cleanup() {
  if [[ -n "$NSPAWN_PID" ]] && kill -0 "$NSPAWN_PID" 2>/dev/null; then
    sudo -n kill -TERM "$NSPAWN_PID" 2>/dev/null || true
    wait "$NSPAWN_PID" 2>/dev/null || true
  fi
  if [[ "$PROFILE_READY" == 1 ]]; then
    sudo -n env PYTHONDONTWRITEBYTECODE=1 python3 \
      "$ROOT_DIR/e2e/lifecycle/fixtures/profile-host-fixture.py" prepare-reboot \
      --root "$PROFILE_ROOT" >/dev/null 2>&1 || true
  fi
  if [[ "$PROFILE_BOUND" == 1 ]]; then
    sudo -n umount -- "$PROFILE_ROOT" >/dev/null 2>&1 || true
  fi
  sudo -n python3 -c 'import os,shutil,sys; p=os.path.realpath(sys.argv[1]); assert p.startswith("/tmp/niceeval-e2e-docker-profile-systemd.") and p.count("/")==2; shutil.rmtree(p)' "$PROFILE_ROOT"
  sudo -n python3 -c 'import os,shutil,sys; p=os.path.realpath(sys.argv[1]); assert p.startswith("/tmp/niceeval-fixed-systemd-manager.") and p.count("/")==2; shutil.rmtree(p)' "$FIXTURE_ROOT"
}
trap cleanup EXIT INT TERM

scripts="$ROOT_DIR/packaging/docker-profile-host/scripts"
fixture_script="$ROOT_DIR/e2e/lifecycle/fixtures/profile-host-fixture.py"
python_store_bin="$(dirname "$(readlink -f /run/current-system/sw/bin/python3)")"
util_store_bin="$(dirname "$(readlink -f /run/current-system/sw/bin/blkid)")"
docker_root="$(docker info --format '{{.DockerRootDir}}')"
fixture_user="${USER:-${LOGNAME:-}}"
[[ -n "$fixture_user" ]]
fixture_group="$(id -gn "$fixture_user")"
profile_name=probe

# Keep the capsule's rootDir parent-mount identity identical inside and outside
# the nspawn manager. Without this self-bind, nspawn creates an additional bind
# layer only after the capsule was committed and the production attestation
# correctly rejects the artificial identity drift.
sudo -n mount --bind "$PROFILE_ROOT" "$PROFILE_ROOT"
sudo -n mount --make-private "$PROFILE_ROOT"
PROFILE_BOUND=1

setup_receipt="$(sudo -n env PYTHONDONTWRITEBYTECODE=1 python3 "$fixture_script" setup \
  --root "$PROFILE_ROOT" \
  --scripts "$scripts" \
  --docker-root "$docker_root" \
  --user "$fixture_user" \
  --group "$fixture_group" \
  --name "$profile_name" \
  --setup-prefix \
  --setup-prefix-filesystem-bytes "$((64 * 1024 * 1024))" \
  --setup-prefix-slot-count 1 \
  --setup-prefix-seed-count 1)"
PROFILE_READY=1
fixture_json="$(printf '%s\n' "$setup_receipt" | tail -n 1)"
descriptor="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["descriptor"])' "$fixture_json")"
host_config="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["hostConfig"])' "$fixture_json")"
journal="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["journal"])' "$fixture_json")"
control_socket="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["controlSocket"])' "$fixture_json")"
ready_file="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["readyFile"])' "$fixture_json")"
generation="$PROFILE_ROOT/journal/fixed-image-v1"
current_pointer="$generation/current"
committed_epoch="$(sudo -n python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["epoch"])' "$current_pointer")"

mkdir -p \
  "$FIXTURE_ROOT/etc/systemd/system" "$FIXTURE_ROOT/etc" \
  "$FIXTURE_ROOT/sbin" "$FIXTURE_ROOT/bin" "$FIXTURE_ROOT/usr/bin" \
  "$FIXTURE_ROOT/usr/libexec/niceeval" "$FIXTURE_ROOT/usr/lib/systemd" \
  "$FIXTURE_ROOT/run" "$FIXTURE_ROOT/proc" "$FIXTURE_ROOT/sys" "$FIXTURE_ROOT/dev"
cp /etc/os-release "$FIXTURE_ROOT/etc/os-release"
cp /etc/machine-id "$FIXTURE_ROOT/etc/machine-id"
cp /etc/passwd "$FIXTURE_ROOT/etc/passwd"
cp /etc/group "$FIXTURE_ROOT/etc/group"
systemd_unit_root="$(dirname "$(readlink -f /etc/systemd/system/multi-user.target)")"
ln -s "$(readlink -f /run/current-system/systemd/lib/systemd/systemd)" "$FIXTURE_ROOT/sbin/init"
ln -s "$(readlink -f /run/current-system/sw/bin/sh)" "$FIXTURE_ROOT/bin/sh"
ln -s "$(readlink -f /run/current-system/sw/bin/sleep)" "$FIXTURE_ROOT/bin/sleep"
for executable in env python3 findmnt mount umount losetup blkid docker systemctl chmod chgrp grep; do
  ln -s "$(readlink -f "/run/current-system/sw/bin/$executable")" "$FIXTURE_ROOT/usr/bin/$executable"
done
ln -s "$systemd_unit_root" "$FIXTURE_ROOT/usr/lib/systemd/system"
# The nspawn root only exposes the fixture tree plus the explicitly bound
# repository.  Install executable copies at the production absolute paths so
# systemd invokes the real programs through ExecStart, rather than a probe or
# an out-of-root symlink that PID 1 cannot execute.
cp "$scripts/activate-fixed-images.py" "$FIXTURE_ROOT/usr/libexec/niceeval/activate-fixed-images"
cp "$scripts/provision-fixed-images.py" "$FIXTURE_ROOT/usr/libexec/niceeval/provision-fixed-images.py"
cp "$scripts/watchdog.py" "$FIXTURE_ROOT/usr/libexec/niceeval/docker-profile-watchdog"
sed -i "1c\\#!$python_store_bin/python3" \
  "$FIXTURE_ROOT/usr/libexec/niceeval/activate-fixed-images" \
  "$FIXTURE_ROOT/usr/libexec/niceeval/provision-fixed-images.py" \
  "$FIXTURE_ROOT/usr/libexec/niceeval/docker-profile-watchdog"
chmod 0755 "$FIXTURE_ROOT/usr/libexec/niceeval/activate-fixed-images" \
  "$FIXTURE_ROOT/usr/libexec/niceeval/provision-fixed-images.py" \
  "$FIXTURE_ROOT/usr/libexec/niceeval/docker-profile-watchdog"

for unit_name in fixed-activation fixed-images fixed-descriptor fixed-watchdog; do
  cp "$ROOT_DIR/packaging/docker-profile-host/systemd/niceeval-docker-profile-${unit_name}@.service" \
    "$FIXTURE_ROOT/etc/systemd/system/"
done

activation="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-activation@.service"
attestation="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-images@.service"
descriptor_unit="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-descriptor@.service"
watchdog="$FIXTURE_ROOT/etc/systemd/system/niceeval-docker-profile-fixed-watchdog@.service"

# Keep the production ExecStart programs and arguments. Only redirect the
# package-owned absolute profile paths into this marked fixture and remove
# dependencies that belong to the outer host manager (Docker and the slice).
for unit in "$activation" "$attestation" "$descriptor_unit" "$watchdog"; do
  sed -i \
    -e '/^After=/s/ local-fs.target//g' \
    -e '/^After=/s/ docker.service//g' \
    -e '/^Requires=/s/docker.service //g' \
    -e '/^Requires=/s/ niceeval-docker-profile-%i.slice//g' \
    -e '/^Requires=niceeval-docker-profile-%i.slice$/d' \
    -e '/^Wants=docker.service$/d' \
    -e '/^ConditionPathExists=/d' \
    -e "s|/etc/niceeval/docker-profiles/%i.fixed-image-v1.host.json|$host_config|g" \
    -e "s|/etc/niceeval/docker-profiles/%i.json|$descriptor|g" \
    -e "s|/var/lib/niceeval/docker-profiles/%i/journal/fixed-image-v1/events.ndjson|$journal|g" \
    -e "s|/var/lib/niceeval/docker-profiles/%i/journal/fixed-image-v1|$generation|g" \
    -e "s|/var/lib/niceeval/docker-profiles/%i/data/fixed-image-v1|$PROFILE_ROOT/data/fixed-image-v1|g" \
    -e "s|/run/niceeval/docker-profiles/%i/control.sock|$control_socket|g" \
    -e "s|/run/niceeval/docker-profiles/%i/watchdog.ready|$ready_file|g" \
    -e "s|/run/niceeval/docker-profiles/%i|$PROFILE_ROOT|g" \
    "$unit"
  sed -i '/^\[Unit\]$/a DefaultDependencies=no' "$unit"
  sed -i "/^\[Service\]$/a StandardError=append:$PROFILE_ROOT/systemd-services.log\nStandardOutput=append:$PROFILE_ROOT/systemd-services.log" "$unit"
  sed -i "s|^ExecStart=|Environment=PATH=$util_store_bin:$python_store_bin:/usr/bin:/bin\\nExecStart=|" "$unit"
done
sed -i \
  -e '/^Slice=/d' \
  -e '/^Delegate=/d' \
  -e "s|^Environment=HOME=.*|Environment=HOME=$PROFILE_ROOT/home|" \
  -e "s|^Environment=XDG_RUNTIME_DIR=.*|Environment=XDG_RUNTIME_DIR=$PROFILE_ROOT|" \
  -e 's/chgrp niceeval-dp-%i-access/chgrp 0/' \
  "$watchdog"
mkdir -p "$PROFILE_ROOT/home"

cat > "$FIXTURE_ROOT/etc/systemd/system/probe-steady.target" <<'EOF'
[Unit]
DefaultDependencies=no
Wants=niceeval-docker-profile-fixed-images@probe.service niceeval-docker-profile-fixed-descriptor@probe.service niceeval-docker-profile-fixed-watchdog@probe.service
After=niceeval-docker-profile-fixed-images@probe.service niceeval-docker-profile-fixed-descriptor@probe.service
AllowIsolate=yes
EOF
ln -s probe-steady.target "$FIXTURE_ROOT/etc/systemd/system/default.target"

# systemd-analyze's offline verifier resolves ExecStart against the host root,
# while this receipt intentionally executes those production paths inside the
# nspawn root.  The live manager below is the authoritative graph check.

journalctl_bin="$(readlink -f "$(command -v journalctl)")"
systemctl_bin="$(readlink -f "$(command -v systemctl)")"
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
  sudo -n nsenter -t "$pid" -m -p -- /bin/sh -c \
    "PATH='$util_store_bin:$python_store_bin:/usr/bin:/bin'; export PATH; $1"
}
wait_active() {
  local unit="$1"
  for _ in $(seq 1 100); do
    managerctl is-active --quiet "$unit" && return
    sleep 0.05
  done
  managerctl status "$unit" --no-pager >&2 || true
  return 1
}
start_manager() {
  rm -f -- "$ready_file"
  sudo -n systemd-nspawn --directory="$FIXTURE_ROOT" \
    --bind-ro=/nix/store --bind-ro="$ROOT_DIR" --bind="$PROFILE_ROOT" \
    --bind=/dev --bind=/run/docker.sock \
    --property='DeviceAllow=block-loop rwm' \
    --property='DeviceAllow=/dev/loop-control rwm' \
    --register=no --boot --console=pipe \
    >"$FIXTURE_ROOT/nspawn.log" 2>&1 &
  NSPAWN_PID=$!
  for _ in $(seq 1 200); do
    [[ -f "$ready_file" ]] && return
    ! kill -0 "$NSPAWN_PID" 2>/dev/null && break
    sleep 0.05
  done
  managerctl status niceeval-docker-profile-fixed-images@probe.service \
    niceeval-docker-profile-fixed-descriptor@probe.service \
    niceeval-docker-profile-fixed-watchdog@probe.service --no-pager >&2 || true
  managerctl show niceeval-docker-profile-fixed-images@probe.service \
    -p Environment -p ExecMainCode -p ExecMainStatus --no-pager >&2 || true
  pid="$(manager_pid || true)"
  [[ -n "$pid" ]] && sudo -n nsenter -t "$pid" -m -p -- "$journalctl_bin" -u niceeval-docker-profile-fixed-images@probe.service -n 80 --no-pager >&2 || true
  [[ -n "$pid" ]] && sudo -n nsenter -t "$pid" -m -p -- /bin/sh -c \
    "PATH='$util_store_bin:$python_store_bin:/usr/bin:/bin'; export PATH; /usr/libexec/niceeval/activate-fixed-images --host-config='$host_config' --descriptor='$descriptor' --boot-restore --systemd-drop-in-root=/run/systemd/system --systemd-watchdog-unit=niceeval-docker-profile-fixed-watchdog@probe.service --reload-systemd" >&2 || true
  sudo -n sed -n '1,260p' "$PROFILE_ROOT/systemd-services.log" >&2 || true
  sed -n '1,240p' "$FIXTURE_ROOT/nspawn.log" >&2
  return 1
}
stop_manager() {
  managerctl poweroff >/dev/null 2>&1 || true
  wait "$NSPAWN_PID" || true
  NSPAWN_PID=""
}

assert_production_boot() {
  wait_active niceeval-docker-profile-fixed-images@probe.service
  wait_active niceeval-docker-profile-fixed-descriptor@probe.service
  wait_active niceeval-docker-profile-fixed-watchdog@probe.service
  ! managerctl is-active --quiet niceeval-docker-profile-fixed-activation@probe.service
  managerexec "python3 -c 'import json; assert json.load(open(\"$current_pointer\"))[\"epoch\"] == \"$committed_epoch\"'"
  managerexec "python3 -c 'from pathlib import Path; import json; p=json.load(open(\"$current_pointer\")); c=Path(p[\"capsulePath\"]); assert Path(\"$descriptor\").read_bytes() == (c / \"descriptor.json\").read_bytes()'"
  managerexec "grep -q 'Environment=NICEEVAL_ACTIVATION_EPOCH=$committed_epoch' '/run/systemd/system/niceeval-docker-profile-fixed-watchdog@probe.service.d/50-niceeval-fixed-activation.conf'"
  managerexec "python3 -c 'import json; lines=open(\"$ready_file\").read().splitlines(); assert json.loads(lines[1])[\"activationEpoch\"] == \"$committed_epoch\"'"
}

# The first manager proves the package unit graph runs the real boot restore,
# descriptor verifier and watchdog rather than a shell probe.
start_manager
assert_production_boot
managerctl restart niceeval-docker-profile-fixed-watchdog@probe.service
managerctl is-active --quiet niceeval-docker-profile-fixed-watchdog@probe.service
stop_manager

# Model a fresh boot: /run is empty and no loop/ext4 mount survives. The only
# durable authority is the committed capsule/current pointer under journal.
sudo -n env PYTHONDONTWRITEBYTECODE=1 python3 "$fixture_script" prepare-reboot --root "$PROFILE_ROOT"
sudo -n python3 -c 'import os,shutil,sys; root=os.path.realpath(sys.argv[1]); target=os.path.realpath(sys.argv[2]); assert target.startswith(root+os.sep) and target != root; os.path.exists(target) and shutil.rmtree(target)' "$FIXTURE_ROOT" "$FIXTURE_ROOT/run/systemd/system"
rm -f -- "$ready_file" "$control_socket"
start_manager
assert_production_boot
stop_manager

echo "fixed-systemd-manager-e2e ok"
