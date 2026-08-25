#!/usr/bin/env python3
"""Exclusively activate one fixed-image Docker profile backing epoch."""
from __future__ import annotations

import argparse
import errno
import fcntl
import hashlib
import json
import os
import pwd
import grp
import subprocess
import sys
import tempfile
import time
import uuid
import base64
import shutil
from pathlib import Path
from typing import Any


SCHEMA = "niceeval-docker-profile-activation/v3"
RECOVERY_SCHEMA = "niceeval-docker-profile-activation-recovery/v2"
DETACHED_CLASS = "detached-cache/v1"
OWNERSHIP_LABEL = "niceeval.ownership-class"
OWNERSHIP_LABELS = {
    "niceeval.profile-id", "niceeval.invocation-id", "niceeval.reservation-id",
    "niceeval.provision-token", "niceeval.attempt-id", "niceeval.parent-attempt",
    "niceeval.resource", "niceeval.operation-id", "niceeval.host", "niceeval.pid",
    "niceeval.managed-network", OWNERSHIP_LABEL,
}
ACTIVE_OWNERSHIP_LABELS = {
    "niceeval.invocation-id", "niceeval.reservation-id", "niceeval.provision-token",
    "niceeval.attempt-id", "niceeval.parent-attempt", "niceeval.operation-id",
    "niceeval.managed-network", "niceeval.host", "niceeval.pid",
}


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(16 * 1024 * 1024), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def atomic_json(path: Path, value: object, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(json.dumps(value, sort_keys=True, indent=2).encode() + b"\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(raw, mode)
        os.chown(raw, 0, 0)
        os.replace(raw, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(raw):
            os.unlink(raw)


def atomic_text(path: Path, value: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(raw, mode)
        os.chown(raw, 0, 0)
        os.replace(raw, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(raw):
            os.unlink(raw)


def _snapshot_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False}
    return {"exists": True, "mode": path.stat().st_mode & 0o777,
            "bytes": base64.b64encode(path.read_bytes()).decode("ascii")}


def _restore_file(path: Path, snapshot: dict[str, Any]) -> None:
    if not snapshot.get("exists"):
        if path.exists():
            path.unlink()
        return
    atomic_text(path, base64.b64decode(str(snapshot["bytes"])).decode("utf-8"),
                mode=int(snapshot.get("mode", 0o600)))


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def mounted_backing(mount: Path) -> dict[str, Any] | None:
    result = subprocess.run(
        ["findmnt", "-n", "--raw", "-o", "SOURCE,FSTYPE,OPTIONS", "--mountpoint", str(mount)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        raise RuntimeError(f"could not inspect data mount {mount}: {result.stderr.strip()}")
    fields = result.stdout.strip().split(None, 2)
    if len(fields) != 3:
        raise RuntimeError(f"incomplete mount identity for {mount}")
    source, fs_type, options = fields
    backing = None
    if source.startswith("/dev/loop"):
        loop = run("losetup", "-n", "-O", "BACK-FILE", source)
        if loop:
            backing = str(Path(loop).resolve())
    return {
        "source": source,
        "backingImage": backing,
        "fsType": fs_type,
        "options": options.split(","),
    }


def ext4_image_identity(image: Path) -> dict[str, Any]:
    info = image.stat()
    uuid_value = run("blkid", "-s", "UUID", "-o", "value", str(image))
    fs_type = run("blkid", "-s", "TYPE", "-o", "value", str(image))
    if fs_type != "ext4" or not uuid_value:
        raise RuntimeError(f"fixed backing is not an identified ext4 image: {image}")
    return {
        "path": str(image.resolve()),
        "sizeBytes": info.st_size,
        "allocatedBytes": info.st_blocks * 512,
        "filesystemType": fs_type,
        "filesystemUuid": uuid_value,
    }


def assert_same_ext4_backing(current: dict[str, Any], recorded: dict[str, Any]) -> None:
    """Bind rollback to stable backing identity while re-attesting allocation now.

    ``st_blocks`` is an allocation fact, not a stable file identity: writing through
    a loop-mounted ext4 image may change that accounting without changing the
    backing path, byte size, filesystem type, or filesystem UUID.  The capsule
    records the activation-time value for audit, but rollback admission proves
    that both the recorded and current image were/are fully allocated instead of
    requiring those two counters to be byte-for-byte equal.
    """
    stable_fields = ("path", "sizeBytes", "filesystemType", "filesystemUuid")
    if any(current.get(field) != recorded.get(field) for field in stable_fields):
        raise RuntimeError("rollback capsule outer image identity differs")
    for label, fact in (("recorded", recorded), ("current", current)):
        size = fact.get("sizeBytes")
        allocated = fact.get("allocatedBytes")
        if not isinstance(size, int) or not isinstance(allocated, int) or allocated < size:
            raise RuntimeError(f"rollback capsule outer image {label} allocation is incomplete")


def parent_mount_identity(root: Path) -> dict[str, Any]:
    if not root.is_absolute() or root == Path("/") or not root.exists():
        raise RuntimeError("fixed storage root is absent; refusing root-filesystem fallback")
    fields = run("findmnt", "-n", "--raw", "-o", "TARGET,SOURCE,FSTYPE", "-T", str(root)).split(None, 2)
    if len(fields) != 3:
        raise RuntimeError("fixed storage root parent mount identity is incomplete")
    target, source, fs_type = fields
    return {
        "target": str(Path(target).resolve()),
        "source": source,
        "fsType": fs_type,
        "filesystemUuid": run("blkid", "-s", "UUID", "-o", "value", source, check=False) or None,
    }


def switch_mount(image: Path, mount: Path) -> None:
    expected = str(image.resolve())
    current = mounted_backing(mount)
    if current is not None and current.get("backingImage") == expected:
        identity = ext4_image_identity(image)
        if current["fsType"] != "ext4" or identity["allocatedBytes"] < identity["sizeBytes"]:
            raise RuntimeError("active fixed backing identity/allocation is invalid")
        return
    if current is not None:
        run("umount", "--", str(mount))
    try:
        run("mount", "-t", "ext4", "-o", "loop,noatime,nodev,nosuid", "--", expected, str(mount))
        run("mount", "--make-rprivate", "--", str(mount))
        mounted = mounted_backing(mount)
        if mounted is None or mounted.get("backingImage") != expected or mounted.get("fsType") != "ext4":
            raise RuntimeError("mounted fixed backing does not match the requested image")
        identity = ext4_image_identity(image)
        if identity["allocatedBytes"] < identity["sizeBytes"]:
            raise RuntimeError("mounted fixed backing is sparse")
    except BaseException:
        if mounted_backing(mount) is not None:
            run("umount", "--", str(mount), check=False)
        raise


def restore_mount(mount: Path, snapshot: dict[str, Any] | None) -> None:
    current = mounted_backing(mount)
    expected = snapshot.get("backingImage") if isinstance(snapshot, dict) else None
    if current is not None and current.get("backingImage") == expected:
        return
    if current is not None:
        run("umount", "--", str(mount))
    if snapshot is None:
        return
    if not isinstance(expected, str) or not Path(expected).is_file():
        raise RuntimeError("activation recovery cannot restore the previous backing image")
    run("mount", "-t", str(snapshot.get("fsType", "ext4")),
        "-o", ",".join(str(item) for item in snapshot.get("options", ["rw"])),
        "--", expected, str(mount))
    run("mount", "--make-rprivate", "--", str(mount))


def recover_activation(path: Path) -> None:
    if not path.is_file():
        return
    record = json.loads(path.read_text(encoding="utf-8"))
    if record.get("schema") != RECOVERY_SCHEMA:
        raise RuntimeError("unknown activation recovery schema")
    if record.get("state") == "committed":
        path.unlink()
        return
    pointer_path = record.get("currentPointer")
    if isinstance(pointer_path, str) and Path(pointer_path).is_file():
        pointer = json.loads(Path(pointer_path).read_text(encoding="utf-8"))
        if pointer.get("schema") == "niceeval-docker-profile-current-epoch/v1" \
                and pointer.get("epoch") == record.get("epoch"):
            marker = record.get("pendingMarker")
            if isinstance(marker, str):
                Path(marker).unlink(missing_ok=True)
            path.unlink()
            sync_directory(path.parent)
            return
    files = record.get("files")
    if not isinstance(files, dict):
        raise RuntimeError("activation recovery record is incomplete")
    mount_path = record.get("dataMount")
    expected_mount = record.get("mount")
    if isinstance(mount_path, str):
        current_mount = mounted_backing(Path(mount_path))
        expected_backing = expected_mount.get("backingImage") \
            if isinstance(expected_mount, dict) else None
        if current_mount is not None and current_mount.get("backingImage") != expected_backing:
            recovery_configs: set[str] = set()
            for field in ("activeHostConfig", "targetHostConfig"):
                config_path = record.get(field)
                if not isinstance(config_path, str) or config_path in recovery_configs \
                        or not Path(config_path).is_file():
                    continue
                recovery_configs.add(config_path)
                active_config = json.loads(Path(config_path).read_text(encoding="utf-8"))
                if str(Path(str(active_config.get("dataMount", ""))).resolve()) != \
                        str(Path(mount_path).resolve()):
                    raise RuntimeError("activation recovery host config targets another data mount")
                # A rotated epoch provisions its writable slot loop mounts below
                # the new outer backing.  They must be released before that outer
                # filesystem can be replaced with the pre-activation snapshot.
                unmount_owned_slots(active_config)
    for name, snapshot in files.items():
        _restore_file(Path(name), snapshot)
    if isinstance(mount_path, str):
        restore_mount(Path(mount_path), expected_mount)
    path.unlink()
    sync_directory(path.parent)


def systemd_word(path: Path) -> str:
    value = str(path)
    if any(character.isspace() or ord(character) < 32 for character in value):
        raise RuntimeError(f"systemd-bound path contains whitespace/control characters: {value!r}")
    return value


def append_event(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab", buffering=0) as output:
        output.write(canonical(value) + b"\n")
        os.fsync(output.fileno())


def run(*args: str, check: bool = True, pass_fds: tuple[int, ...] = ()) -> str:
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            check=False, pass_fds=pass_fds)
    if check and result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def sibling_tool(installed_name: str, source_name: str) -> str:
    installed = Path(__file__).with_name(installed_name)
    return str(installed if installed.exists() else Path(__file__).with_name(source_name))


def tool_command(path: str) -> list[str]:
    return [sys.executable, path] if Path(path).suffix == ".py" else [path]


def provision_fixed_images(config: Path, provisioner: str, lock_fd: int) -> None:
    env = os.environ.copy()
    env["NICEEVAL_FIXED_ACTIVATION"] = "1"
    env["NICEEVAL_FIXED_ACTIVATION_LOCK_FD"] = str(lock_fd)
    result = subprocess.run(
        [*tool_command(provisioner), "--host-config", str(config)],
        env=env, pass_fds=(lock_fd,), text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"fixed provisioner failed: {result.stderr.strip()}")


def last_state(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    result = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            item = json.loads(line)
            if isinstance(item.get("state"), dict):
                result = item["state"]
    return result


def durable_last_state(path: Path) -> dict[str, Any] | None:
    """Read one fsynced, append-stable watchdog journal snapshot.

    The activation lock fixes the active epoch, but the steady-state watchdog
    deliberately holds that lock shared and keeps appending state.  Read a
    bounded file length, fsync it, and accept it only if that length stayed
    unchanged across the flush.  A later append can then linearize after this
    status read, while every record used here is durable for restart replay.
    """
    if not path.exists():
        return None
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    try:
        snapshot: bytes | None = None
        for _ in range(32):
            size = os.fstat(descriptor).st_size
            candidate = os.pread(descriptor, size, 0)
            os.fsync(descriptor)
            if len(candidate) == size and os.fstat(descriptor).st_size == size:
                snapshot = candidate
                break
        if snapshot is None:
            raise RuntimeError("watchdog journal did not reach a stable durable read boundary")
    finally:
        os.close(descriptor)
    if snapshot and not snapshot.endswith(b"\n"):
        raise RuntimeError("watchdog journal is truncated; status fails closed")
    result = None
    for line in snapshot.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError("watchdog journal is corrupt; status fails closed") from error
        if not isinstance(item.get("state"), dict):
            raise RuntimeError("watchdog journal record has no durable state")
        result = item["state"]
    return result


def assert_journals_drained(paths: list[Path]) -> None:
    for path in paths:
        state = last_state(path)
        if state is None:
            continue
        leases = state.get("leases", {})
        recovered_only = isinstance(leases, dict) and all(
            isinstance(lease, dict) and lease.get("state") == "recovered"
            for lease in leases.values()
        )
        if not recovered_only or state.get("reservations") or state.get("queue") \
                or state.get("builds") or state.get("containers") \
                or state.get("setupPrefix", {}).get("operations"):
            raise RuntimeError(f"activation requires a drained ownership journal: {path}")


def docker_json(socket_path: str, *args: str) -> Any:
    raw = run("docker", "--host", f"unix://{socket_path}", *args)
    return json.loads(raw) if raw else []


def classify_labels(labels: Any, profile_id: str) -> str | None:
    if not isinstance(labels, dict):
        return None
    niceeval = {str(key): str(value) for key, value in labels.items()
                if str(key) in OWNERSHIP_LABELS}
    if not niceeval:
        return None
    owner = niceeval.get("niceeval.profile-id")
    if owner not in (None, "", profile_id):
        return None
    if owner in (None, ""):
        if niceeval.get("niceeval.resource") != "target-app-proxy" \
                and "niceeval.parent-attempt" not in niceeval \
                and OWNERSHIP_LABEL not in niceeval:
            return None
        return "active-or-ambiguous"
    if niceeval.get(OWNERSHIP_LABEL) == DETACHED_CLASS and owner == profile_id \
            and not ACTIVE_OWNERSHIP_LABELS.intersection(niceeval):
        return "detached"
    return "active-or-ambiguous"


def assert_docker_closure(socket_path: str, profile_id: str) -> list[dict[str, str]]:
    detached: list[dict[str, str]] = []
    queries = (
        ("container", ["ps", "-aq", "--no-trunc"]),
        ("network", ["network", "ls", "-q", "--no-trunc"]),
        ("volume", ["volume", "ls", "-q"]),
        ("image", ["image", "ls", "-q", "--no-trunc"]),
    )
    for kind, query in queries:
        ids = sorted(set(run("docker", "--host", f"unix://{socket_path}", *query).split()))
        if not ids:
            continue
        inspected = docker_json(socket_path, kind, "inspect", *ids)
        if not isinstance(inspected, list) or len(inspected) != len(ids):
            raise RuntimeError(f"Docker {kind} ownership query was incomplete")
        for item in inspected:
            labels = item.get("Config", {}).get("Labels") if kind in ("container", "image") \
                else item.get("Labels")
            ownership = classify_labels(labels, profile_id)
            identity = str(item.get("Id") or item.get("ID") or item.get("Name") or "unknown")
            names = [str(item.get("Name", "")), *map(str, item.get("RepoTags") or [])]
            legacy_build_owner = (
                kind == "container" and any(name.startswith("/buildx_buildkit_niceeval-build-") for name in names)
            ) or (
                kind == "volume" and any(
                    name.startswith("buildx_buildkit_niceeval-build-") and name.endswith("_state")
                    for name in names
                )
            ) or (
                kind == "image" and any(name.startswith("niceeval-build-provisional:") for name in names)
            )
            if legacy_build_owner:
                raise RuntimeError(
                    f"activation found legacy-ambiguous NiceEval builder/state/provisional {kind} {identity}"
                )
            if ownership == "active-or-ambiguous":
                raise RuntimeError(f"activation found active or legacy-ambiguous NiceEval {kind} {identity}")
            if ownership == "detached":
                detached.append({"kind": kind, "id": identity})
    return detached


def assert_no_old_admission(control_socket: Path, host_config: Path,
                            inactive_units: list[str]) -> None:
    for unit in inactive_units:
        result = subprocess.run(
            ["systemctl", "is-active", "--quiet", unit], check=False,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        if result.returncode == 0:
            raise RuntimeError(f"old admission unit is still active: {unit}")
        if result.returncode not in (3, 4):
            raise RuntimeError(
                f"could not prove old admission unit inactive: {unit}: {result.stderr.strip()}"
            )
    if control_socket.exists() or control_socket.is_socket():
        raise RuntimeError(f"old admission control socket still exists: {control_socket}")
    needles = (str(control_socket), str(host_config))
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            command = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError as error:
            raise RuntimeError(
                f"could not inspect admission process command line: pid={entry.name}"
            ) from error
        if "watchdog" in command and any(needle in command for needle in needles):
            raise RuntimeError(f"old admission process is still alive: pid={entry.name}")


def vanished(error: OSError) -> bool:
    return isinstance(error, (FileNotFoundError, ProcessLookupError)) \
        or error.errno in (errno.ENOENT, errno.ESRCH)


def read_proc_link(path: Path, pid: str, kind: str) -> str | None:
    try:
        return os.readlink(path)
    except OSError as error:
        if vanished(error):
            return None
        raise RuntimeError(f"could not inspect process {kind}: pid={pid}") from error


def storage_owner(target: str, roots: tuple[str, ...]) -> bool:
    normalized = target.removesuffix(" (deleted)")
    return any(normalized == root or normalized.startswith(root + "/") for root in roots)


def assert_cgroup_empty(config: dict[str, Any]) -> dict[str, Any]:
    dependency = config.get("activationDependency")
    if not isinstance(dependency, dict):
        raise RuntimeError("fixed activation dependency binding is absent")
    dependency_class = dependency.get("class")
    if dependency_class == "direct-exclusive-process-scan/v1":
        if dependency.get("cgroupPath") not in (None, ""):
            raise RuntimeError("direct activation dependency must not claim a cgroup proof")
        return {"class": dependency_class, "cgroupPath": None, "emptyAtActivation": None}
    if dependency_class != "systemd-profile-slice/v1":
        raise RuntimeError("fixed activation dependency class is unsupported")
    raw = dependency.get("cgroupPath")
    if not isinstance(raw, str) or not raw.startswith("/sys/fs/cgroup/"):
        raise RuntimeError("systemd activation dependency cgroup path is invalid")
    cgroup = Path(raw)
    try:
        cgroup = cgroup.resolve(strict=True)
    except OSError as error:
        raise RuntimeError("systemd activation dependency cgroup is unavailable") from error
    result = subprocess.run(
        ["findmnt", "-n", "-T", str(cgroup), "-o", "FSTYPE"],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode != 0 or result.stdout.strip() != "cgroup2":
        raise RuntimeError("activation could not prove the profile dependency is a cgroup v2 subtree")
    try:
        events = dict(
            line.split(None, 1) for line in (cgroup / "cgroup.events").read_text(encoding="utf-8").splitlines()
        )
    except (OSError, ValueError) as error:
        raise RuntimeError("activation could not query profile cgroup population") from error
    if events.get("populated") != "0":
        raise RuntimeError(f"old admission cgroup is still populated: {cgroup}")
    try:
        descendants = [cgroup, *(path for path in cgroup.rglob("*") if path.is_dir())]
    except OSError as error:
        raise RuntimeError("activation could not enumerate profile cgroup descendants") from error
    for descendant in descendants:
        try:
            members = (descendant / "cgroup.procs").read_text(encoding="utf-8").split()
        except OSError as error:
            raise RuntimeError(f"activation could not query cgroup members: {descendant}") from error
        if members:
            raise RuntimeError(
                f"old admission cgroup still owns processes: {descendant}: {','.join(members)}"
            )
    return {"class": dependency_class, "cgroupPath": str(cgroup), "emptyAtActivation": True}


def assert_no_process_owners(roots: tuple[str, ...], subject: str) -> None:
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        pid = entry.name
        try:
            before = (entry / "stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()[19]
        except OSError as error:
            if vanished(error):
                continue
            raise RuntimeError(f"could not establish process identity: pid={pid}") from error
        for kind in ("cwd", "root"):
            target = read_proc_link(entry / kind, pid, kind)
            if target is not None and storage_owner(target, roots):
                raise RuntimeError(
                    f"activation found process ownership of {subject}: pid={pid} {kind}={target}"
                )
        try:
            for fd in (entry / "fd").iterdir():
                target = read_proc_link(fd, pid, f"fd {fd.name}")
                if target is not None and storage_owner(target, roots):
                    raise RuntimeError(
                        f"activation found process ownership of {subject}: pid={pid} fd={fd.name}"
                    )
        except OSError as error:
            if vanished(error):
                continue
            raise RuntimeError(f"could not enumerate process file descriptors: pid={pid}") from error
        try:
            maps = (entry / "maps").read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as error:
            if vanished(error):
                continue
            raise RuntimeError(f"could not inspect process mappings: pid={pid}") from error
        for line in maps:
            fields = line.split(None, 5)
            if len(fields) == 6 and fields[5].startswith("/") and storage_owner(fields[5], roots):
                raise RuntimeError(
                    f"activation found process ownership of {subject}: pid={pid} path={fields[5]}"
                )
        try:
            after = (entry / "stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()[19]
        except OSError as error:
            if vanished(error):
                continue
            raise RuntimeError(f"could not revalidate process identity: pid={pid}") from error
        if before != after:
            raise RuntimeError(f"process identity changed during activation closure scan: pid={pid}")


def assert_mount_and_process_closure(config: dict[str, Any]) -> None:
    data_mount = Path(str(config["dataMount"])).resolve()
    allowed = {data_mount}
    registry_raw = config.get("storage", {}).get("slotRegistryPath")
    if isinstance(registry_raw, str) and Path(registry_raw).is_file():
        registry = json.loads(Path(registry_raw).read_text(encoding="utf-8"))
        allowed.update(Path(str(record["path"])).resolve() for record in registry.get("slots", []))
    result = subprocess.run(
        ["findmnt", "-R", "-n", "--raw", "-o", "TARGET", "--target", str(data_mount)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError("activation could not query slot mount ownership")
    for raw in result.stdout.splitlines():
        target = Path(raw).resolve()
        if target not in allowed:
            raise RuntimeError(f"activation found an unowned nested slot mount: {target}")
    roots = (str(data_mount), str(Path(config["journalDir"]).resolve()))
    assert_no_process_owners(roots, "profile storage")


def unmount_owned_slots(config: dict[str, Any]) -> None:
    registry_raw = config.get("storage", {}).get("slotRegistryPath")
    if not isinstance(registry_raw, str) or not Path(registry_raw).is_file():
        return
    registry = json.loads(Path(registry_raw).read_text(encoding="utf-8"))
    data_mount = Path(str(config["dataMount"])).resolve()
    paths = sorted(
        (Path(str(record["path"])).resolve() for record in registry.get("slots", [])),
        key=lambda path: len(path.parts), reverse=True,
    )
    for path in paths:
        if path == data_mount or data_mount not in path.parents:
            raise RuntimeError(f"slot registry path escapes the active data mount: {path}")
        if mounted_backing(path) is not None:
            run("umount", "--", str(path))


def stable_profile_id(config: dict[str, Any]) -> str:
    machine = config.get("hostMachineIdentity")
    if not machine:
        machine = Path("/etc/machine-id").read_text(encoding="utf-8").strip()
    return hashlib.sha256(
        f"niceeval-docker-profile-v1:{config['name']}:{machine}".encode()
    ).hexdigest()[:32]


def validate_store_paths(config: dict[str, Any]) -> tuple[Path, Path]:
    storage = config["storage"]
    outer = Path(str(storage.get("outerImagePath", "")))
    root = Path(str(storage.get("rootDir", "")))
    legacy = Path(str(storage.get("legacyOuterImagePath", "")))
    if not root.is_absolute() or root == Path("/") or not root.exists():
        raise RuntimeError("fixed storage root must be an existing non-root absolute path")
    root = root.resolve()
    if not outer.is_absolute() or outer == Path("/") or not outer.exists():
        raise RuntimeError("fixed outer image path must be an existing non-root absolute path")
    outer = outer.resolve()
    fixed_root = root / "fixed-image-v1"
    rotation_root = fixed_root / "rotation-epochs"
    if outer != fixed_root / "store.img" \
            and not (outer.parent.parent == rotation_root and outer.name == "store.img"):
        raise RuntimeError("fixed outer image is not the versioned path derived from storage.rootDir")
    if legacy.is_absolute() and legacy.exists() and outer == legacy.resolve():
        raise RuntimeError("fixed outer image conflicts with the legacy active store")
    mount = Path(str(config["dataMount"]))
    if not mount.is_absolute() or mount == Path("/") or not mount.exists():
        raise RuntimeError("fixed data mount must be an existing non-root absolute path")
    mount = mount.resolve()
    if root == mount:
        raise RuntimeError("fixed storage root conflicts with the active data mount")
    return outer, mount


def prepare_store(config: dict[str, Any], helper: str) -> None:
    storage = config["storage"]
    outer = Path(str(storage.get("outerImagePath", "")))
    root = Path(str(storage.get("rootDir", "")))
    legacy = Path(str(storage.get("legacyOuterImagePath", "")))
    mount = Path(str(config.get("dataMount", "")))
    size = int(storage.get("sizeBytes", storage.get("size", 0)))
    if not root.is_absolute() or root == Path("/") or not root.exists() \
            or not outer.is_absolute() or outer == Path("/") or not mount.is_absolute() \
            or mount == Path("/") or not mount.exists() or size <= 0:
        raise RuntimeError("portable fixed storage paths/size are invalid")
    root = root.resolve()
    mount = mount.resolve()
    fixed_root = root / "fixed-image-v1"
    rotation_root = fixed_root / "rotation-epochs"
    valid_outer = outer == fixed_root / "store.img" \
        or (outer.parent.parent == rotation_root and outer.name == "store.img")
    if root == mount or not valid_outer \
            or legacy.is_absolute() and legacy.exists() and outer == legacy.resolve():
        raise RuntimeError("portable fixed storage paths conflict with active/legacy storage")
    run(helper, "--image", str(outer), "--size", str(size), "--mount", str(mount),
        "--fully-allocate")
    switch_mount(outer, mount)


def capsule_directory(generation: Path, epoch: str) -> Path:
    if not epoch or "/" in epoch or epoch in (".", ".."):
        raise RuntimeError("activation epoch is invalid")
    return generation / "epochs" / epoch


def write_capsule(generation: Path, epoch: str, *, config: dict[str, Any],
                  descriptor_bytes: bytes, manifest: dict[str, Any],
                  manifest_digest: str) -> Path:
    epochs = generation / "epochs"
    epochs.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = capsule_directory(generation, epoch)
    if target.exists():
        raise RuntimeError(f"activation epoch capsule already exists: {epoch}")
    temporary = epochs / f".{epoch}.pending-{os.getpid()}"
    if temporary.exists():
        raise RuntimeError(f"stale activation capsule staging directory exists: {temporary}")
    temporary.mkdir(mode=0o700)
    try:
        outer = Path(str(config["storage"]["outerImagePath"])).resolve()
        mount = Path(str(config["dataMount"])).resolve()
        backing = ext4_image_identity(outer)
        mounted = mounted_backing(mount)
        if mounted is None or mounted.get("backingImage") != str(outer):
            raise RuntimeError("activation capsule backing is not mounted at dataMount")
        files = {
            "config.json": json.dumps(config, sort_keys=True, indent=2).encode() + b"\n",
            "descriptor.json": descriptor_bytes,
            "manifest.json": json.dumps(manifest, sort_keys=True, indent=2).encode() + b"\n",
            "manifest.sha256": (manifest_digest + "\n").encode(),
        }
        capsule = {
            "schema": "niceeval-docker-profile-epoch-capsule/v1",
            "epoch": epoch,
            "profileId": manifest["profileId"],
            "alias": manifest["alias"],
            "configDigest": digest_bytes(files["config.json"]),
            "descriptorDigest": digest_bytes(descriptor_bytes),
            "manifestDigest": manifest_digest,
            "slotRegistry": manifest["slotRegistry"],
            "seedRegistry": manifest["seedRegistry"],
            "outerImage": backing,
            "dataMount": str(mount),
            "mountedIdentity": mounted,
            "rootDirParentMount": parent_mount_identity(Path(config["storage"]["rootDir"])),
        }
        files["capsule.json"] = json.dumps(capsule, sort_keys=True, indent=2).encode() + b"\n"
        for name, value in files.items():
            path = temporary / name
            with path.open("wb") as output:
                output.write(value)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(path, 0o400)
            os.chown(path, 0, 0)
        sync_directory(temporary)
        os.chmod(temporary, 0o500)
        os.replace(temporary, target)
        sync_directory(epochs)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return target


def load_capsule(generation: Path, epoch: str) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    root = capsule_directory(generation, epoch)
    capsule = json.loads((root / "capsule.json").read_text(encoding="utf-8"))
    config_bytes = (root / "config.json").read_bytes()
    descriptor_bytes = (root / "descriptor.json").read_bytes()
    manifest_bytes = (root / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    expected_digest = (root / "manifest.sha256").read_text(encoding="utf-8").strip()
    if capsule.get("schema") != "niceeval-docker-profile-epoch-capsule/v1" \
            or capsule.get("epoch") != epoch or manifest.get("epoch") != epoch \
            or capsule.get("configDigest") != digest_bytes(config_bytes) \
            or capsule.get("descriptorDigest") != digest_bytes(descriptor_bytes) \
            or capsule.get("manifestDigest") != digest_bytes(canonical(manifest)) \
            or expected_digest != capsule.get("manifestDigest"):
        raise RuntimeError("activation epoch capsule digest binding is invalid")
    for key in ("slotRegistry", "seedRegistry"):
        fact = capsule.get(key, {})
        path = Path(str(fact.get("path", "")))
        if not path.is_absolute() or not path.is_file() or fact.get("digest") != file_digest(path):
            raise RuntimeError(f"rollback capsule {key} backing fact differs")
    outer_fact = capsule.get("outerImage", {})
    outer = Path(str(outer_fact.get("path", "")))
    if not outer.is_file():
        raise RuntimeError("rollback capsule outer image identity differs")
    assert_same_ext4_backing(ext4_image_identity(outer), outer_fact)
    config = json.loads(config_bytes)
    if str(Path(config["dataMount"]).resolve()) != capsule.get("dataMount"):
        raise RuntimeError("rollback capsule data mount identity differs")
    if capsule.get("rootDirParentMount") != parent_mount_identity(
        Path(config["storage"]["rootDir"])
    ):
        raise RuntimeError("epoch capsule rootDir parent mount identity differs")
    return config, descriptor_bytes, manifest


def load_current(generation: Path) -> tuple[dict[str, Any], dict[str, Any], bytes, dict[str, Any]]:
    pointer_path = generation / "current"
    if pointer_path.is_symlink() or not pointer_path.is_file():
        raise RuntimeError("committed current-epoch pointer is absent or a symlink")
    info = pointer_path.stat()
    if info.st_uid != 0 or info.st_gid != 0 or (info.st_mode & 0o777) != 0o600:
        raise RuntimeError("committed current-epoch pointer owner/mode is invalid")
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    if pointer.get("schema") != "niceeval-docker-profile-current-epoch/v1":
        raise RuntimeError("committed current-epoch pointer schema is unsupported")
    epoch = str(pointer.get("epoch", ""))
    config, descriptor_bytes, manifest = load_capsule(generation, epoch)
    if pointer.get("manifestDigest") != digest_bytes(canonical(manifest)) \
            or pointer.get("capsulePath") != str(capsule_directory(generation, epoch)):
        raise RuntimeError("committed current-epoch pointer binding is invalid")
    return pointer, config, descriptor_bytes, manifest


def active_seed_status(generation: Path, capsule: dict[str, Any]) -> tuple[dict[str, int], str]:
    registry_path = Path(str(capsule.get("seedRegistry", {}).get("path", "")))
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry_seeds = registry.get("seeds")
    if not isinstance(registry_seeds, list) or not registry_seeds:
        raise RuntimeError("active seed registry has no seed inventory")
    seed_ids = [seed.get("seedId") for seed in registry_seeds if isinstance(seed, dict)]
    if len(seed_ids) != len(registry_seeds) or any(not isinstance(seed_id, str) or not seed_id
                                                   for seed_id in seed_ids) \
            or len(set(seed_ids)) != len(seed_ids):
        raise RuntimeError("active seed registry inventory is invalid")

    latest = durable_last_state(generation / "events.ndjson")
    if latest is None:
        raise RuntimeError("durable watchdog state is absent; active seed capacity is unknown")
    seeds = latest.get("setupPrefix", {}).get("seeds")
    if not isinstance(seeds, dict) or set(seeds) != set(seed_ids) \
            or any(not isinstance(seed, dict) for seed in seeds.values()):
        raise RuntimeError("durable watchdog seed inventory differs from the active epoch registry")
    source = "durable-watchdog-latest-state"

    counts = {"total": len(seed_ids), "free": 0, "published": 0, "quarantined": 0, "other": 0}
    for seed in seeds.values():
        state = seed.get("state")
        if state in ("free", "published", "quarantined"):
            counts[state] += 1
        else:
            counts["other"] += 1
    return counts, source


def epoch_status(generation: Path) -> dict[str, Any]:
    pointer, _, _, current_manifest = load_current(generation)
    current_epoch = str(pointer["epoch"])
    previous_epoch = current_manifest.get("previousEpoch")
    tombstone_root = generation / "retired"
    retired = {path.stem for path in tombstone_root.glob("*.json")} if tombstone_root.is_dir() else set()
    epochs: list[dict[str, Any]] = []
    active_seeds: dict[str, int] | None = None
    active_seed_source: str | None = None
    retained_bytes = 0
    retirable_bytes = 0
    reclaimable_bytes = 0
    for root in sorted((generation / "epochs").iterdir()):
        if not root.is_dir() or root.name.startswith("."):
            continue
        capsule = json.loads((root / "capsule.json").read_text(encoding="utf-8"))
        size = int(capsule.get("outerImage", {}).get("sizeBytes", 0))
        state = "current" if root.name == current_epoch else (
            "previous" if root.name == previous_epoch else ("retired" if root.name in retired else "retained")
        )
        if state != "current":
            retained_bytes += size
        if state == "retained":
            retirable_bytes += size
        if state == "retired":
            reclaimable_bytes += size
        if state == "current":
            active_seeds, active_seed_source = active_seed_status(generation, capsule)
        epochs.append({"epoch": root.name, "state": state, "outerBytes": size})
    if active_seeds is None or active_seed_source is None:
        raise RuntimeError("current activation epoch has no retained capsule")
    active_seed_remaining = active_seeds["free"]
    warnings: list[dict[str, Any]] = []
    if active_seed_remaining == 0:
        warnings.append({
            "code": "active-seed-capacity-exhausted",
            "severity": "error",
            "remaining": 0,
            "message": "Active immutable seed capacity is exhausted; rotate seeds before publishing.",
        })
    elif active_seed_remaining == 1:
        warnings.append({
            "code": "active-seed-capacity-low",
            "severity": "warning",
            "remaining": 1,
            "message": "Only one active immutable seed remains; rotate seeds before exhaustion.",
        })
    return {
        "schema": "niceeval-docker-profile-epoch-capacity/v1",
        "currentEpoch": current_epoch,
        "activeSeedRemaining": active_seed_remaining,
        "activeSeeds": active_seeds,
        "activeSeedStateSource": active_seed_source,
        "retainedEpochBytes": retained_bytes,
        "retirableBytes": retirable_bytes,
        "reclaimableBytes": reclaimable_bytes,
        "warnings": warnings,
        "epochs": epochs,
    }


def verify_manifest(manifest_path: Path, digest_path: Path, host_config: Path,
                    descriptor: Path, *, verify_capsule: bool = True) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    host = json.loads(host_config.read_text(encoding="utf-8"))
    expected = digest_path.read_text(encoding="utf-8").strip()
    actual = digest_bytes(canonical(manifest))
    host_dependency = host.get("activationDependency", {})
    expected_empty = True if host_dependency.get("class") == "systemd-profile-slice/v1" else None
    if expected != actual or manifest.get("schema") != SCHEMA or manifest.get("state") != "committed" \
            or manifest.get("hostConfigPath") != str(host_config.resolve()) \
            or manifest.get("hostConfigDigest") != file_digest(host_config) \
            or manifest.get("descriptorPath") != str(descriptor.resolve()) \
            or manifest.get("descriptorDigest") != file_digest(descriptor) \
            or manifest.get("activationDependency", {}).get("class") \
                != host.get("activationDependency", {}).get("class") \
            or manifest.get("activationDependency", {}).get("cgroupPath") \
                != host_dependency.get("cgroupPath") \
            or manifest.get("activationDependency", {}).get("emptyAtActivation") != expected_empty:
        raise RuntimeError("fixed activation manifest/digest/path binding is invalid")
    for key in ("slotRegistry", "seedRegistry"):
        fact = manifest.get(key, {})
        path = Path(str(fact.get("path", "")))
        if not path.is_absolute() or fact.get("digest") != file_digest(path):
            raise RuntimeError(f"fixed activation manifest {key} binding is invalid")
    if manifest.get("activationRevision") != "exclusive-capsule-cutover/v1" \
            or manifest.get("recoveryRevision") != "idempotent-four-file-mount-restore/v2":
        raise RuntimeError("fixed activation manifest revision is unsupported")
    if verify_capsule:
        generation = Path(host["journalDir"]).resolve() / "fixed-image-v1"
        pointer, capsule_config, capsule_descriptor, capsule_manifest = load_current(generation)
        if canonical(capsule_config) != canonical(host) \
                or descriptor.read_bytes() != capsule_descriptor \
                or canonical(capsule_manifest) != canonical(manifest) \
                or pointer.get("epoch") != manifest.get("epoch"):
            raise RuntimeError("active activation files differ from the committed epoch capsule")
    return manifest


def install_watchdog_dropin(config: dict[str, Any], generation: Path, epoch: str, digest: str,
                            root: str | None, unit: str | None, reload_systemd: bool) -> None:
    if root is None and unit is None:
        return
    if root is None or unit is None:
        raise RuntimeError("portable systemd drop-in root and watchdog unit must be supplied together")
    if "/" in unit or not unit.endswith(".service"):
        raise RuntimeError("portable systemd watchdog unit name is invalid")
    dropin = Path(root).resolve() / f"{unit}.d" / "50-niceeval-fixed-activation.conf"
    runtime = Path(str(config["controlSocket"])).parent
    dropin_text = "\n".join((
        "[Unit]",
        f"RequiresMountsFor={systemd_word(Path(config['storage']['rootDir']))} {systemd_word(Path(config['dataMount']))}",
        "[Service]",
        "ReadWritePaths=",
        f"ReadWritePaths={systemd_word(Path(config['dataMount']) / 'fixed-image-v1')} "
        f"{systemd_word(generation)} {systemd_word(runtime)}",
        f"Environment=NICEEVAL_ACTIVATION_MANIFEST_DIGEST={digest}",
        f"Environment=NICEEVAL_ACTIVATION_EPOCH={epoch}",
        "",
    ))
    atomic_text(dropin, dropin_text, mode=0o644)
    if reload_systemd:
        run("systemctl", "daemon-reload")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-config", required=True)
    parser.add_argument("--source-host-config")
    parser.add_argument("--descriptor", required=True)
    parser.add_argument("--access-group")
    parser.add_argument("--provisioner", default=sibling_tool(
        "provision-fixed-images", "provision-fixed-images.py"))
    parser.add_argument("--generator", default=sibling_tool(
        "generate-descriptor", "generate-descriptor.py"))
    parser.add_argument("--activation-manifest")
    parser.add_argument("--activation-digest")
    parser.add_argument("--lock")
    parser.add_argument("--inactive-unit", action="append", default=[])
    parser.add_argument("--prepare-store", action="store_true")
    parser.add_argument("--prepare-helper", default=str(Path(__file__).with_name("prepare-loop-storage.sh")))
    parser.add_argument("--systemd-drop-in-root")
    parser.add_argument("--systemd-watchdog-unit")
    parser.add_argument("--reload-systemd", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--boot-restore", action="store_true")
    parser.add_argument("--rollback-to")
    parser.add_argument("--rotate-seeds", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--retire-epoch")
    parser.add_argument("--reclaim-epoch")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("fixed-image activation requires root")
    host_config = Path(args.host_config).resolve()
    source_host_config = Path(args.source_host_config).resolve() if args.source_host_config else None
    descriptor = Path(args.descriptor).resolve()
    config_source = source_host_config if source_host_config is not None else host_config
    config = json.loads(config_source.read_text(encoding="utf-8"))
    if config.get("storage", {}).get("backing") != "fixed-image-ext4":
        raise SystemExit("fixed-image activation requires storage.backing=fixed-image-ext4")
    generation = Path(config["journalDir"]).resolve() / "fixed-image-v1"
    manifest_path = Path(args.activation_manifest or generation / "activation.json").resolve()
    digest_path = Path(args.activation_digest or generation / "activation.sha256").resolve()
    lock_path = Path(args.lock or f"/run/lock/niceeval/docker-profiles/{config['name']}.lock").resolve()
    if sum(bool(value) for value in (args.verify_only, args.boot_restore, args.rollback_to,
                                      args.rotate_seeds, args.status, args.retire_epoch,
                                      args.reclaim_epoch)) > 1:
        raise SystemExit("activation administrative modes are mutually exclusive")
    generation.mkdir(mode=0o700, parents=True, exist_ok=True)
    recovery_path = host_config.parent / f".{config['name']}.fixed-activation.recovery.json"
    lock_path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    lock_path.touch(mode=0o600, exist_ok=True)
    os.chown(lock_path, 0, 0)
    with lock_path.open("r+b") as lock_file:
        shared_mode = args.verify_only or args.status
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_SH if shared_mode else fcntl.LOCK_EX)
        # Recover the last complete binding before inspecting its manifest.  The
        # record is durable before any active file is replaced, so a kill at any
        # later point cannot strand a half-written epoch.
        recover_activation(recovery_path)
        if args.status:
            print(json.dumps(epoch_status(generation), sort_keys=True, indent=2))
            return
        if args.verify_only:
            verify_manifest(manifest_path, digest_path, host_config, descriptor)
            return
        if args.boot_restore:
            pointer, active, descriptor_bytes, committed = load_current(generation)
            config_bytes = json.dumps(active, sort_keys=True, indent=2).encode() + b"\n"
            atomic_text(host_config, config_bytes.decode("utf-8"),
                        mode=host_config.stat().st_mode & 0o777 if host_config.exists() else 0o600)
            atomic_text(descriptor, descriptor_bytes.decode("utf-8"), mode=0o644)
            atomic_json(manifest_path, committed)
            atomic_text(digest_path, str(pointer["manifestDigest"]) + "\n")
            outer, data_mount = validate_store_paths(active)
            switch_mount(outer, data_mount)
            # A reboot loses the writable slot loop mounts even though their
            # immutable registry and image files remain in the outer store.
            # Re-adopt that registry under the same exclusive activation lock
            # before descriptor verification and watchdog admission.
            provision_fixed_images(host_config, args.provisioner, lock_file.fileno())
            active = json.loads(host_config.read_text(encoding="utf-8"))
            verify_manifest(manifest_path, digest_path, host_config, descriptor)
            digest = str(pointer["manifestDigest"])
            install_watchdog_dropin(active, generation, str(committed["epoch"]), digest,
                                    args.systemd_drop_in_root,
                                    args.systemd_watchdog_unit, args.reload_systemd)
            return
        if args.retire_epoch or args.reclaim_epoch:
            pointer, active, _, active_manifest = load_current(generation)
            target_epoch = str(args.retire_epoch or args.reclaim_epoch)
            if target_epoch in (pointer.get("epoch"), active_manifest.get("previousEpoch")):
                raise RuntimeError("current and previous epochs cannot be retired or reclaimed")
            target_config, _, target_manifest = load_capsule(generation, target_epoch)
            retired_root = generation / "retired"
            retired_root.mkdir(mode=0o700, parents=True, exist_ok=True)
            tombstone = retired_root / f"{target_epoch}.json"
            if args.retire_epoch:
                atomic_json(tombstone, {
                    "schema": "niceeval-docker-profile-epoch-retirement/v1",
                    "epoch": target_epoch,
                    "outerImagePath": target_manifest["outerImagePath"],
                    "retiredAtUnixNs": time.time_ns(),
                    "coldRollbackAvailable": False,
                })
                append_event(generation / "activation.ndjson", {
                    "schema": SCHEMA, "state": "epoch-retired", "epoch": target_epoch,
                    "retiredAtUnixNs": time.time_ns(),
                })
                return
            if not tombstone.is_file():
                raise RuntimeError("epoch reclaim requires a committed retirement tombstone")
            assert_no_old_admission(Path(str(active["controlSocket"])), host_config, args.inactive_unit)
            assert_journals_drained([
                Path(active["journalDir"]) / "events.ndjson", generation / "events.ndjson",
            ])
            assert_cgroup_empty(active)
            detached = assert_docker_closure(str(active["dockerSocket"]), stable_profile_id(active))
            if detached or target_manifest.get("detachedRealizations"):
                raise RuntimeError("retired epoch still has detached-cache ownership references")
            outer = Path(str(target_config["storage"]["outerImagePath"])).resolve()
            active_state = last_state(generation / "events.ndjson")
            if active_state is not None:
                encoded_state = canonical(active_state).decode("utf-8", errors="replace")
                if target_epoch in encoded_state or str(outer) in encoded_state:
                    raise RuntimeError("retired epoch still has active artifact or journal ownership references")
            if run("losetup", "-j", str(outer), check=False):
                raise RuntimeError("retired epoch backing still has a loop or mount reference")
            assert_no_process_owners(
                (str(outer), str(outer.parent)), "retired epoch backing",
            )
            for other in (generation / "epochs").iterdir():
                if not other.is_dir() or other.name in (target_epoch,) or other.name.startswith("."):
                    continue
                other_config = json.loads((other / "config.json").read_text(encoding="utf-8"))
                if Path(str(other_config["storage"]["outerImagePath"])).resolve() == outer:
                    raise RuntimeError("another retained capsule references the retired backing")
            rotation_root = Path(str(target_config["storage"]["rootDir"])).resolve() \
                / "fixed-image-v1" / "rotation-epochs"
            if outer.parent.parent != rotation_root:
                raise RuntimeError("base backing is never reclaimable; only rotated epoch paths are eligible")
            intent = generation / "reclaim" / f"{target_epoch}.intent.json"
            receipt = generation / "reclaim" / f"{target_epoch}.receipt.json"
            atomic_json(intent, {
                "schema": "niceeval-docker-profile-epoch-reclaim-intent/v1",
                "epoch": target_epoch, "outerImagePath": str(outer),
                "startedAtUnixNs": time.time_ns(),
            })
            shutil.rmtree(outer.parent)
            capsule = capsule_directory(generation, target_epoch)
            os.chmod(capsule, 0o700)
            for child in capsule.iterdir():
                os.chmod(child, 0o600)
            shutil.rmtree(capsule)
            atomic_json(receipt, {
                "schema": "niceeval-docker-profile-epoch-reclaim-receipt/v1",
                "epoch": target_epoch, "outerImagePath": str(outer),
                "reclaimedAtUnixNs": time.time_ns(), "coldRollbackAvailable": False,
            })
            append_event(generation / "activation.ndjson", {
                "schema": SCHEMA, "state": "epoch-reclaimed", "epoch": target_epoch,
                "receipt": str(receipt),
            })
            return
        control_socket = Path(str(config["controlSocket"]))
        assert_no_old_admission(control_socket, host_config, args.inactive_unit)
        previous = None
        previous_config: dict[str, Any] | None = None
        if manifest_path.is_file():
            if not host_config.is_file() or not descriptor.is_file():
                raise RuntimeError("published activation exists without its active config/descriptor")
            previous = verify_manifest(manifest_path, digest_path, host_config, descriptor)
            previous_config = json.loads(host_config.read_text(encoding="utf-8"))
        source_descriptor: bytes | None = None
        if args.rollback_to:
            if previous is None:
                raise RuntimeError("rollback requires an active committed epoch")
            config, source_descriptor, _ = load_capsule(generation, args.rollback_to)
        elif source_host_config is not None:
            config = json.loads(source_host_config.read_text(encoding="utf-8"))
        epoch = str(uuid.uuid4())
        if args.rotate_seeds:
            storage_root = Path(str(config["storage"]["rootDir"])).resolve()
            config["storage"]["outerImagePath"] = str(
                storage_root / "fixed-image-v1" / "rotation-epochs" / epoch / "store.img"
            )
            config["storage"]["registryEpoch"] = epoch
        elif previous_config is not None and source_host_config is not None:
            previous_outer = Path(str(previous_config["storage"]["outerImagePath"])).resolve()
            requested_outer = Path(str(config["storage"]["outerImagePath"])).resolve()
            if previous_outer != requested_outer:
                # A declarative backing cutover must publish its registries and
                # provision intent in a fresh namespace.  The legacy root paths
                # remain bound to the previous committed capsule and cannot
                # describe a different slot count, size, or backing identity.
                config["storage"]["registryEpoch"] = epoch
            elif previous_config["storage"].get("registryEpoch") is not None:
                # A same-backing policy update adopts the already published
                # physical registry.  Source config is declarative and omits
                # this activation-owned namespace, so carry it forward from
                # the committed capsule instead of falling back to the legacy
                # unversioned provision journal.
                config["storage"]["registryEpoch"] = previous_config["storage"]["registryEpoch"]
        marker = generation / "activation.pending.json"
        current_pointer = generation / "current"
        journal = generation / "activation.ndjson"
        snapshots = {str(path): _snapshot_file(path) for path in
                     (host_config, descriptor, manifest_path, digest_path)}
        mount_path = Path(str(config["dataMount"])).resolve()
        staging = generation / "staging" / epoch
        staging_config = staging / "host.json"
        atomic_json(recovery_path, {"schema": RECOVERY_SCHEMA,
                                    "state": "pending", "epoch": epoch,
                                    "files": snapshots, "dataMount": str(mount_path),
                                    "activeHostConfig": str(host_config),
                                    "targetHostConfig": str(staging_config),
                                    "mount": mounted_backing(mount_path),
                                    "currentPointer": str(current_pointer),
                                    "pendingMarker": str(marker)})
        staging.mkdir(mode=0o700, parents=True)
        staging_descriptor = staging / "descriptor.json"
        config["activation"] = {
            "schema": SCHEMA,
            "manifestPath": str(manifest_path),
            "manifestDigestPath": str(digest_path),
            "lockPath": str(lock_path),
            "currentPointerPath": str(current_pointer),
        }
        atomic_json(staging_config, config)
        assert_journals_drained([
            Path(config["journalDir"]) / "events.ndjson",
            generation / "events.ndjson",
        ])
        dependency = assert_cgroup_empty(config)
        closure_config = previous_config if previous_config is not None else config
        assert_mount_and_process_closure(closure_config)
        # A same-backing re-activation must leave published writable slots mounted:
        # the provisioner attests their mounted filesystem-root ownership before it
        # adopts the existing registry. Only a real backing cutover needs the old
        # slot mounts released before the data mount can switch.
        same_backing = previous_config is not None \
            and Path(str(previous_config["storage"]["outerImagePath"])).resolve() \
                == Path(str(config["storage"]["outerImagePath"])).resolve() \
            and Path(str(previous_config["dataMount"])).resolve() \
                == Path(str(config["dataMount"])).resolve()
        if not same_backing:
            unmount_owned_slots(closure_config)
        detached = assert_docker_closure(str(config["dockerSocket"]), stable_profile_id(config))
        if args.prepare_store:
            prepare_store(config, args.prepare_helper)
        outer, data_mount = validate_store_paths(config)
        # Preparing is only required to create/fully allocate a new outer
        # image. Rollback targets already exist and must still become the
        # active backing before their published registries are adopted.
        switch_mount(outer, data_mount)
        intent = {"schema": SCHEMA, "state": "preparing", "epoch": epoch,
                  "previousEpoch": previous.get("epoch") if isinstance(previous, dict) else None,
                  "startedAtUnixNs": time.time_ns()}
        atomic_json(marker, intent)
        append_event(journal, intent)
        try:
            provision_fixed_images(staging_config, args.provisioner, lock_file.fileno())
            config = json.loads(staging_config.read_text(encoding="utf-8"))
            if source_descriptor is None:
                generator = [*tool_command(args.generator), "--host-config", str(staging_config),
                             "--output", str(staging_descriptor)]
                if args.access_group:
                    generator.extend(["--access-group", args.access_group])
                run(*generator)
                descriptor_bytes = staging_descriptor.read_bytes()
            else:
                descriptor_bytes = source_descriptor
                atomic_text(staging_descriptor, descriptor_bytes.decode("utf-8"))
            config_bytes = json.dumps(config, sort_keys=True, indent=2).encode() + b"\n"
            slot_registry = Path(config["storage"]["slotRegistryPath"]).resolve()
            seed_registry = Path(config["setupPrefix"]["seedRegistryPath"]).resolve()
            manifest = {
                "schema": SCHEMA,
                "state": "committed",
                "epoch": epoch,
                "previousEpoch": intent["previousEpoch"],
                "alias": config["name"],
                "profileId": stable_profile_id(config),
                "backing": "fixed-image-ext4",
                "outerImagePath": str(outer),
                "dataMount": str(data_mount),
                "hostConfigPath": str(host_config),
                "hostConfigDigest": digest_bytes(config_bytes),
                "descriptorPath": str(descriptor),
                "descriptorDigest": digest_bytes(descriptor_bytes),
                "slotRegistry": {"path": str(slot_registry), "digest": file_digest(slot_registry)},
                "seedRegistry": {"path": str(seed_registry), "digest": file_digest(seed_registry)},
                "dependencyClass": "fixed-activation-descriptor-watchdog/v1",
                "activationDependency": dependency,
                "writePathClass": "fixed-image-v1-only/v1",
                "detachedRealizations": detached,
                "activationRevision": "exclusive-capsule-cutover/v1",
                "recoveryRevision": "idempotent-four-file-mount-restore/v2",
                "outerImageIdentity": ext4_image_identity(outer),
                "mountedIdentity": mounted_backing(data_mount),
                "rootDirParentMount": parent_mount_identity(Path(config["storage"]["rootDir"])),
                "currentPointerPath": str(current_pointer),
                "committedAtUnixNs": time.time_ns(),
            }
            manifest_digest = digest_bytes(canonical(manifest))
            write_capsule(generation, epoch, config=config, descriptor_bytes=descriptor_bytes,
                          manifest=manifest, manifest_digest=manifest_digest)
            active_mode = host_config.stat().st_mode & 0o777 if host_config.exists() else 0o600
            atomic_text(host_config, config_bytes.decode("utf-8"), mode=active_mode)
            atomic_text(descriptor, descriptor_bytes.decode("utf-8"), mode=0o644)
            atomic_json(manifest_path, manifest)
            atomic_text(digest_path, manifest_digest + "\n")
            atomic_json(current_pointer, {
                "schema": "niceeval-docker-profile-current-epoch/v1",
                "epoch": epoch,
                "manifestDigest": manifest_digest,
                "capsulePath": str(capsule_directory(generation, epoch)),
            })
            install_watchdog_dropin(config, generation, epoch, manifest_digest,
                                    args.systemd_drop_in_root, args.systemd_watchdog_unit,
                                    args.reload_systemd)
            append_event(journal, manifest)
            atomic_json(recovery_path, {"schema": RECOVERY_SCHEMA,
                                        "state": "committed", "epoch": epoch})
            marker.unlink()
            recovery_path.unlink(missing_ok=True)
            sync_directory(recovery_path.parent)
            shutil.rmtree(staging)
        except BaseException as error:
            failed = {**intent, "state": "failed", "failedAtUnixNs": time.time_ns(),
                      "reason": str(error)[-2000:]}
            atomic_json(marker, failed)
            append_event(journal, failed)
            recover_activation(recovery_path)
            raise


if __name__ == "__main__":
    main()
