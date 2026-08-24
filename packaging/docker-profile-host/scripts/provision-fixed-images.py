#!/usr/bin/env python3
"""Provision or strictly adopt fixed ext4 Docker-data slots and seeds.

The outer store must already be mounted. This helper is journal-first and only
removes unpublished temporary files created by its current invocation. Published
images and registries are retained on failure and across uninstall/rollback.
"""
from __future__ import annotations

import argparse
import fcntl
import grp
import json
import os
import pwd
import re
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Any


BACKING = "fixed-image-ext4"
ATTESTATION = "independent-fixed-filesystem/v1"
PROVISION_REVISION = "niceeval-docker-profile-host/fixed-image-ext4/v1"
SETUP_CONSTANTS = {
    "protocol": "niceeval-docker-profile-state/docker-data-snapshot/v1",
    "coverage": "dockerData",
    "requiredState": "dockerData",
    "helperRevision": "niceeval-docker-profile-host/docker-data-snapshot/v1",
    "copyProtocol": "raw-image/v1",
    "copyRevision": "niceeval-docker-profile-host/raw-image-copy-reuuid/v2",
    "quiesceRevision": "niceeval-docker-profile-host/docker-data-quiesce/v1",
    "slotAttestation": ATTESTATION,
    "filesystemFeatures": ["ext4", "fixed-size", "fully-allocated", "independent-image"],
    "seedPolicy": "immutable-unmounted/v1",
    "publicationRevision": "prepared-copy-client-commit-publish/v3",
    "recoveryRevision": "epoch-capsule-no-guess-recovery/v3",
    "manifestSchema": "niceeval-docker-profile-activation/v3",
    "copyStrategy": "raw-image/v1",
}


def parse_bytes(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("byte count must not be boolean")
    if isinstance(value, int):
        return value
    match = re.fullmatch(r"([0-9]+)\s*([kmgt]i?b?|b)?", str(value).strip().lower())
    if match is None:
        raise ValueError(f"invalid byte count {value!r}")
    suffix = match.group(2) or ""
    power = {"": 0, "b": 0, "k": 1, "kb": 1, "ki": 1, "kib": 1,
             "m": 2, "mb": 2, "mi": 2, "mib": 2,
             "g": 3, "gb": 3, "gi": 3, "gib": 3,
             "t": 4, "tb": 4, "ti": 4, "tib": 4}[suffix]
    return int(match.group(1)) * 1024**power


def run(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        args, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"{' '.join(args)} failed with exit {result.returncode}: {result.stderr.strip()}"
        )
    return result.stdout.strip()


def atomic_json(path: Path, value: object, *, mode: int = 0o600,
                owner: tuple[int, int] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, sort_keys=True, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(raw, mode)
        if owner is not None:
            os.chown(raw, *owner)
        os.replace(raw, path)
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        if os.path.exists(raw):
            os.unlink(raw)


def mounted_source(path: Path) -> str | None:
    result = subprocess.run(
        ["findmnt", "-n", "-o", "SOURCE,TARGET,FSTYPE,OPTIONS", "--mountpoint", str(path)],
        check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    fields = result.stdout.strip().split(maxsplit=3)
    if len(fields) != 4 or Path(fields[1]).resolve() != path.resolve() or fields[2] != "ext4":
        raise RuntimeError(f"{path} is not the expected ext4 mountpoint")
    return fields[0]


def mounted_options(path: Path) -> set[str]:
    value = run("findmnt", "-n", "-o", "OPTIONS", "--mountpoint", str(path))
    return set(value.split(","))


def ext4_uuid(image: Path) -> str:
    value = run("blkid", "-s", "UUID", "-o", "value", str(image))
    if re.fullmatch(r"[0-9a-fA-F-]{16,64}", value) is None:
        raise RuntimeError(f"{image} has no stable ext4 UUID")
    fstype = run("blkid", "-s", "TYPE", "-o", "value", str(image))
    if fstype != "ext4":
        raise RuntimeError(f"{image} is {fstype or 'unformatted'}, expected ext4")
    return value.lower()


def attest_regular_image(image: Path, expected_size: int) -> str:
    if image.is_symlink() or not image.is_file():
        raise RuntimeError(f"fixed image is not a real regular file: {image}")
    info = image.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RuntimeError(f"fixed image is linked or not regular: {image}")
    if info.st_size != expected_size or info.st_blocks * 512 < expected_size:
        raise RuntimeError(
            f"fixed image size/allocation mismatch: {image}; "
            f"logical={info.st_size} allocated={info.st_blocks * 512} expected={expected_size}"
        )
    return ext4_uuid(image)


def record_for(image: Path, mountpoint: Path, *, identity: str, limit: int,
               uid: int, gid: int, baseline: int,
               seed_id: str | None, slot_id: str | None) -> dict[str, Any]:
    record: dict[str, Any] = {
        "path": str(mountpoint),
        "imagePath": str(image),
        "limitBytes": limit,
        "baselineUsageBytes": baseline,
        "ownerUid": uid,
        "ownerGid": gid,
        "mode": 0o700,
        "generation": 0,
        "state": "free",
        "attestation": ATTESTATION,
        "filesystemIdentity": f"ext4-uuid:{identity}",
        "fsType": "ext4",
        "mountOptions": ["ro", "noload"] if seed_id is not None else ["rw", "noatime", "nodev", "nosuid"],
    }
    if seed_id is not None:
        record["seedId"] = seed_id
    else:
        record.update({"slotId": slot_id, "projectId": 0})
    return record


def ensure_image(image: Path, mountpoint: Path, *, size: int, uid: int, gid: int,
                 seed: bool, temporary_paths: list[Path]) -> dict[str, Any]:
    mountpoint.parent.mkdir(parents=True, exist_ok=True)
    image.parent.mkdir(parents=True, exist_ok=True)
    source = mounted_source(mountpoint) if mountpoint.exists() else None
    if image.exists():
        identity = attest_regular_image(image, size)
        if seed and source is not None:
            raise RuntimeError(f"published seed must remain unmounted: {mountpoint}")
        if seed:
            mountpoint.mkdir(mode=0o700, exist_ok=True)
            run("mount", "-t", "ext4", "-o", "loop,rw,noatime,nodev,nosuid", "--", str(image), str(mountpoint))
            run("mount", "--make-rprivate", "--", str(mountpoint))
        if not seed and source is None:
            mountpoint.mkdir(mode=0o700, exist_ok=True)
            run("mount", "-t", "ext4", "-o", "loop,rw,noatime,nodev,nosuid", "--", str(image), str(mountpoint))
            run("mount", "--make-rprivate", "--", str(mountpoint))
        elif not seed:
            loop_devices = run("losetup", "-j", str(image), check=False)
            if source not in loop_devices:
                raise RuntimeError(f"slot mount does not belong to its fixed image: {mountpoint}")
    else:
        if mountpoint.exists() and (mountpoint.is_symlink() or any(mountpoint.iterdir())):
            raise RuntimeError(f"refusing to adopt non-empty fixed mountpoint: {mountpoint}")
        tmp_image = image.with_name(f".{image.name}.niceeval-provision-{os.getpid()}")
        tmp_mount = mountpoint.with_name(f".{mountpoint.name}.niceeval-provision-{os.getpid()}")
        if tmp_image.exists() or tmp_mount.exists():
            raise RuntimeError(f"stale unpublished provision temporary exists beside {image}")
        temporary_paths.extend([tmp_image, tmp_mount])
        run("fallocate", "-l", str(size), "--", str(tmp_image))
        run(
            "mkfs.ext4", "-F", "-E", "nodiscard,lazy_itable_init=0,lazy_journal_init=0",
            "-m", "0", "-L", "ne-dp-fixed", str(tmp_image),
        )
        run("fallocate", "-l", str(size), "--", str(tmp_image))
        os.chmod(tmp_image, 0o600)
        tmp_mount.mkdir(mode=0o700)
        run("mount", "-t", "ext4", "-o", "loop,rw,noatime,nodev,nosuid", "--", str(tmp_image), str(tmp_mount))
        run("mount", "--make-rprivate", "--", str(tmp_mount))
        identity = attest_regular_image(tmp_image, size)
        lost_found = tmp_mount / "lost+found"
        if lost_found.is_dir():
            lost_found.rmdir()
        os.chown(tmp_mount, uid, gid)
        os.chmod(tmp_mount, 0o700)
        filesystem = os.statvfs(tmp_mount)
        baseline = (filesystem.f_blocks - filesystem.f_bfree) * filesystem.f_frsize
        os.sync()
        run("umount", "--", str(tmp_mount))
        run("fallocate", "-l", str(size), "--", str(tmp_image))
        attest_regular_image(tmp_image, size)
        os.replace(tmp_image, image)
        os.replace(tmp_mount, mountpoint)
        temporary_paths.remove(tmp_image)
        temporary_paths.remove(tmp_mount)
        if not seed:
            run("mount", "-t", "ext4", "-o", "loop,rw,noatime,nodev,nosuid", "--", str(image), str(mountpoint))
            run("mount", "--make-rprivate", "--", str(mountpoint))
    os.chown(mountpoint, uid, gid)
    os.chmod(mountpoint, 0o700)
    if image.exists() and 'baseline' not in locals():
        filesystem = os.statvfs(mountpoint)
        baseline = (filesystem.f_blocks - filesystem.f_bfree) * filesystem.f_frsize
    if seed and mounted_source(mountpoint) is not None:
        os.sync()
        run("umount", "--", str(mountpoint))
    if not seed:
        current = mounted_source(mountpoint)
        if current is None:
            raise RuntimeError(f"fixed slot is not mounted: {mountpoint}")
    return record_for(
        image, mountpoint, identity=identity, limit=size, uid=uid, gid=gid, baseline=baseline,
        seed_id=mountpoint.name if seed else None,
        slot_id=None if seed else mountpoint.name,
    )


def assert_drained(cfg: dict[str, Any], journals: tuple[Path, ...]) -> None:
    for legacy_journal in journals:
        if not legacy_journal.is_file():
            continue
        last: dict[str, Any] | None = None
        for line in legacy_journal.read_text(encoding="utf-8").splitlines():
            if line.strip():
                value = json.loads(line)
                if isinstance(value.get("state"), dict):
                    last = value["state"]
        if last is not None:
            reservations = last.get("reservations", {})
            leases = last.get("leases", {})
            queue = last.get("queue", [])
            builds = [item for item in reservations.values() if item.get("kind") == "build"]
            containers = [item for item in reservations.values() if item.get("kind") == "container"]
            if leases or reservations or queue or builds or containers:
                raise RuntimeError(
                    "fixed-image deployment requires zero leases, reservations, queue, builds, and containers"
                )
    socket = str(cfg["dockerSocket"])
    for kind, filters in (
        ("target-app-proxy", ["container", "ls", "--all", "--quiet", "--filter", "label=niceeval.resource=target-app-proxy"]),
        ("parent Attempt network", ["network", "ls", "--quiet", "--filter", "label=niceeval.parent-attempt"]),
    ):
        found = run("docker", "--host", f"unix://{socket}", *filters)
        if found.strip():
            raise RuntimeError(f"fixed-image deployment requires zero {kind} resources on the default daemon")


def validate_published_registry(
    registry: dict[str, Any], *, records_key: str, count: int, size: int,
    image_root: Path, mount_root: Path, uid: int, gid: int, seed: bool,
    registry_path: Path, registry_uid: int, registry_gid: int,
) -> list[dict[str, Any]]:
    registry_info = registry_path.stat()
    if registry_info.st_uid != registry_uid or registry_info.st_gid != registry_gid \
            or stat.S_IMODE(registry_info.st_mode) != 0o600:
        raise RuntimeError(f"published fixed-image registry owner/mode differs: {registry_path}")
    records = registry.get(records_key)
    if registry.get("schemaVersion") != 1 or registry.get("slotAttestation") != ATTESTATION \
            or not isinstance(records, list) or len(records) != count:
        raise RuntimeError(f"published fixed-image {records_key} registry shape does not match policy")
    result: list[dict[str, Any]] = []
    identities: set[str] = set()
    for index, raw in enumerate(records):
        expected_id = f"seed-{index:08d}" if seed else f"slot-{index:04d}"
        id_key = "seedId" if seed else "slotId"
        image_name = f"setup-prefix-seed-{index:08d}.img" if seed else f"docker-data-slot-{index:04d}.img"
        image = image_root / image_name
        mountpoint = mount_root / expected_id
        required_keys = {
            "path", "imagePath", "limitBytes", "baselineUsageBytes", "ownerUid", "ownerGid",
            "mode", "generation", "state", "attestation", "filesystemIdentity", "fsType",
            "mountOptions", id_key,
        }
        if not seed:
            required_keys.add("projectId")
        if raw.get(id_key) != expected_id or raw.get("path") != str(mountpoint) \
                or raw.get("imagePath") != str(image) or raw.get("limitBytes") != size \
                or raw.get("ownerUid") != uid or raw.get("ownerGid") != gid \
                or raw.get("mode") != 0o700 or raw.get("attestation") != ATTESTATION \
                or raw.get("fsType") != "ext4" or set(raw) != required_keys \
                or raw.get("generation") != 0 or raw.get("state") != "free" \
                or (not seed and raw.get("projectId") != 0) \
                or raw.get("mountOptions") != (["ro", "noload"] if seed else ["rw", "noatime", "nodev", "nosuid"]) \
                or not isinstance(raw.get("baselineUsageBytes"), int) \
                or not 0 <= raw["baselineUsageBytes"] < size:
            raise RuntimeError(f"published fixed-image registry ownership/path facts differ for {expected_id}")
        image_info = image.stat()
        if image_info.st_uid != 0 or image_info.st_gid != 0 \
                or stat.S_IMODE(image_info.st_mode) != 0o600:
            raise RuntimeError(f"published fixed-image file owner/mode differs for {expected_id}")
        identity = f"ext4-uuid:{attest_regular_image(image, size)}"
        if raw.get("filesystemIdentity") != identity or identity in identities:
            raise RuntimeError(f"published fixed-image filesystem identity differs for {expected_id}")
        identities.add(identity)
        if mountpoint.is_symlink() or not mountpoint.is_dir():
            raise RuntimeError(f"published fixed-image mountpoint is absent for {expected_id}")
        mount_info = mountpoint.lstat()
        if mount_info.st_uid != uid or mount_info.st_gid != gid \
                or stat.S_IMODE(mount_info.st_mode) != 0o700:
            raise RuntimeError(f"published fixed-image mountpoint owner/mode differs for {expected_id}")
        source = mounted_source(mountpoint)
        if seed and source is not None:
            raise RuntimeError(f"published immutable seed is mounted: {expected_id}")
        if not seed:
            loop_devices = run("losetup", "-j", str(image), check=False)
            if source is None or source not in loop_devices:
                raise RuntimeError(f"published writable slot is not mounted from its image: {expected_id}")
            if not {"rw", "noatime", "nodev", "nosuid"}.issubset(mounted_options(mountpoint)):
                raise RuntimeError(f"published writable slot mount policy differs for {expected_id}")
        result.append(raw)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-config", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("fixed-image provisioning requires root")
    if os.environ.get("NICEEVAL_FIXED_ACTIVATION") != "1":
        raise SystemExit("provision-fixed-images is internal to the exclusive fixed activation transaction")
    try:
        activation_lock_fd = int(os.environ["NICEEVAL_FIXED_ACTIVATION_LOCK_FD"])
        fcntl.flock(activation_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (KeyError, ValueError, OSError) as error:
        raise SystemExit("fixed-image provisioner has no inherited exclusive activation lock") from error
    config_path = Path(args.host_config)
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    storage = cfg.get("storage", {})
    policy = cfg.get("setupPrefix", {})
    if cfg.get("securityLevel") != "raw-dind-storage/v1":
        raise SystemExit("fixed-image-ext4 is supported only for raw-dind-storage/v1")
    setup_enabled = policy.get("enable", policy.get("enabled"))
    if storage.get("backing") != BACKING or setup_enabled is not True:
        raise SystemExit("fixed-image provisioning requires storage.backing=fixed-image-ext4 and setupPrefix.enable=true")
    count = int(cfg["capacity"].get("dockerDataAllocationCount", cfg["capacity"]["maxContainers"]))
    seed_count = int(policy.get("seedCount", 0))
    size = parse_bytes(cfg["capacity"]["ephemeralDiskBytes"])
    store_size = parse_bytes(storage.get("sizeBytes", storage["size"]))
    if count <= 0 or seed_count <= 0 or size <= 0:
        raise SystemExit("fixed-image slot, seed, and filesystem sizes must be positive")
    ledger = (count + seed_count + count) * size
    if ledger * 8 > store_size * 7:
        raise SystemExit(
            "fixed-image physical store is too small for slots + seeds + worst-case temporary clones + 1/8 headroom"
        )
    mount = Path(cfg["dataMount"]).resolve()
    outer_image = Path(str(storage.get("outerImagePath", "")))
    if not outer_image.is_absolute():
        raise SystemExit("fixed-image storage.outerImagePath must be absolute")
    attest_regular_image(outer_image, store_size)
    source = mounted_source(mount)
    if source is None or source not in run("losetup", "-j", str(outer_image), check=False):
        raise SystemExit("fixed-image outer store must be mounted from storage.outerImagePath")
    outer_filesystem = os.statvfs(mount)
    physical_filesystem_bytes = outer_filesystem.f_blocks * outer_filesystem.f_frsize
    available_bytes = outer_filesystem.f_bavail * outer_filesystem.f_frsize
    recovery_headroom = store_size // 8
    if ledger > physical_filesystem_bytes or available_bytes < ledger + recovery_headroom:
        raise SystemExit(
            "fixed-image allocated blocks and f_bavail cannot prove slots + seeds + temporary clones "
            "+ recovery headroom after ext4 metadata/reserved blocks"
        )
    user = pwd.getpwnam(cfg["userName"])
    group = grp.getgrnam(cfg["userGroup"])
    fixed_root = mount / "fixed-image-v1"
    image_root = fixed_root / "images"
    slot_root = fixed_root / "slots"
    seed_root = fixed_root / "seeds"
    registry_epoch = storage.get("registryEpoch")
    generation_root = Path(cfg["journalDir"]) / "fixed-image-v1"
    if registry_epoch is not None:
        if re.fullmatch(r"[0-9a-f-]{36}", str(registry_epoch)) is None:
            raise SystemExit("fixed-image registry epoch is invalid")
        generation_root = generation_root / "registry-epochs" / str(registry_epoch)
    slot_registry = generation_root / "slots.json"
    seed_registry = generation_root / "seeds.json"
    provision_journal = generation_root / "provision.json"
    assert_drained(cfg, (
        Path(cfg["journalDir"]) / "events.ndjson",
        Path(cfg["journalDir"]) / "fixed-image-v1" / "events.ndjson",
    ))
    for directory in (fixed_root, image_root, slot_root, seed_root, generation_root):
        if directory.is_symlink():
            raise SystemExit(f"fixed-image path must not be a symlink: {directory}")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
    identity_stat = image_root.stat()
    image_root_identity = f"dev={identity_stat.st_dev}:ino={identity_stat.st_ino}"
    desired = {
        "schemaVersion": 1,
        "provisionRevision": PROVISION_REVISION,
        "profileName": cfg["name"],
        "outerImagePath": str(outer_image),
        "outerStoreBytes": store_size,
        "filesystemSizeBytes": size,
        "slotCount": count,
        "seedCount": seed_count,
        "imageRootIdentity": image_root_identity,
    }
    registries_exist = slot_registry.exists() or seed_registry.exists()
    if registries_exist and not (slot_registry.is_file() and seed_registry.is_file()):
        raise SystemExit("fixed-image publication is partial; refusing to synthesize a missing registry")
    prior_intent = None
    if provision_journal.exists():
        prior_intent = json.loads(provision_journal.read_text(encoding="utf-8"))
        if any(prior_intent.get(key) != value for key, value in desired.items()):
            raise SystemExit("fixed-image provision journal identity differs from configured policy")
    if not registries_exist and any(image_root.iterdir()) \
            and (prior_intent is None or prior_intent.get("state") != "preparing"):
        raise SystemExit("unregistered fixed images exist without a matching recoverable provision intent")
    atomic_json(provision_journal, {**desired, "state": "preparing"})
    temporary_paths: list[Path] = []
    try:
        if registries_exist:
            installed_slots = json.loads(slot_registry.read_text(encoding="utf-8"))
            installed_seeds = json.loads(seed_registry.read_text(encoding="utf-8"))
            if installed_slots.get("mount") != str(mount) \
                    or installed_seeds.get("filesystemIdentity") != image_root_identity:
                raise RuntimeError("published fixed-image registry store identity differs")
            slots = validate_published_registry(
                installed_slots, records_key="slots", count=count, size=size,
                image_root=image_root, mount_root=slot_root,
                uid=user.pw_uid, gid=group.gr_gid, seed=False,
                registry_path=slot_registry, registry_uid=user.pw_uid, registry_gid=group.gr_gid,
            )
            seeds = validate_published_registry(
                installed_seeds, records_key="seeds", count=seed_count, size=size,
                image_root=image_root, mount_root=seed_root, uid=0, gid=0, seed=True,
                registry_path=seed_registry, registry_uid=user.pw_uid, registry_gid=group.gr_gid,
            )
        else:
            slots = [ensure_image(
                image_root / f"docker-data-slot-{index:04d}.img",
                slot_root / f"slot-{index:04d}", size=size,
                uid=user.pw_uid, gid=group.gr_gid, seed=False, temporary_paths=temporary_paths,
            ) for index in range(count)]
            seeds = [ensure_image(
                image_root / f"setup-prefix-seed-{index:08d}.img",
                seed_root / f"seed-{index:08d}", size=size,
                uid=0, gid=0, seed=True, temporary_paths=temporary_paths,
            ) for index in range(seed_count)]
        slot_value = {"schemaVersion": 1, "mount": str(mount),
                      "slotAttestation": ATTESTATION, "slots": slots}
        seed_value = {"schemaVersion": 1, "slotAttestation": ATTESTATION,
                      "filesystemIdentity": image_root_identity, "seeds": seeds}
        for path, expected in ((slot_registry, slot_value), (seed_registry, seed_value)):
            if path.exists():
                current = json.loads(path.read_text(encoding="utf-8"))
                if current != expected:
                    raise RuntimeError(f"refusing to replace mismatched fixed-image registry: {path}")
            else:
                atomic_json(path, expected, owner=(user.pw_uid, group.gr_gid))
        cfg["storage"].update({
            "slotAttestation": ATTESTATION,
            "slotRootPath": str(slot_root),
            "slotRegistryPath": str(slot_registry),
        })
        cfg["setupPrefix"] = {
            "enabled": True,
            **SETUP_CONSTANTS,
            "seedRegistryPath": str(seed_registry),
            "imageRootPath": str(image_root),
            "filesystemIdentity": image_root_identity,
            "filesystemSizeBytes": size,
            "filesystemLimitBytes": physical_filesystem_bytes,
            "seedLimitBytes": seed_count * size,
            "seedCount": seed_count,
        }
        config_info = config_path.stat()
        atomic_json(
            config_path, cfg, mode=stat.S_IMODE(config_info.st_mode),
            owner=(config_info.st_uid, config_info.st_gid),
        )
        atomic_json(provision_journal, {**desired, "state": "published"})
    except BaseException:
        for path in reversed(temporary_paths):
            if path.is_dir() and mounted_source(path) is not None:
                run("umount", "--", str(path), check=False)
            if path.is_dir():
                path.rmdir()
            elif path.exists():
                path.unlink()
        raise
    print(f"provisioned {count} fixed slots and {seed_count} immutable seeds under {fixed_root}")


if __name__ == "__main__":
    main()
