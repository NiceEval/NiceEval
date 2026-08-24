#!/usr/bin/env python3
"""Create and remove the isolated real-host boundary for the Docker profile E2E."""
from __future__ import annotations

import argparse
import json
import os
import pwd
import grp
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


MARKER = ".niceeval-docker-profile-e2e"
SETUP_PREFIX_FILESYSTEM_BYTES = 512 * 1024 * 1024
SETUP_PREFIX_SLOT_COUNT = 2
SETUP_PREFIX_SEED_COUNT = 4
SETUP_PREFIX_TEMPORARY_CLONE_HEADROOM = 1
SETUP_PREFIX_CAPACITY_BYTES = 4 * 1024**3
PROFILE_MEMORY = "2G"
AGGREGATE_MEMORY = "4G"
sys.dont_write_bytecode = True


def run(*args: str) -> str:
    result = subprocess.run(
        args,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{shlex.join(args)} failed with exit {result.returncode}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result.stdout.strip()


def checked_root(raw: str) -> Path:
    root = Path(raw).resolve()
    if root.parent != Path("/tmp") or not root.name.startswith("niceeval-e2e-docker-profile-"):
        raise SystemExit(f"refusing unsafe fixture root: {root}")
    return root


def fixture_counts(marker: Path) -> tuple[int, int]:
    try:
        value = json.loads(marker.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return SETUP_PREFIX_SLOT_COUNT, SETUP_PREFIX_SEED_COUNT
    setup_prefix = value.get("setupPrefix") if isinstance(value, dict) else None
    if not isinstance(setup_prefix, dict):
        return SETUP_PREFIX_SLOT_COUNT, SETUP_PREFIX_SEED_COUNT
    slot_count = setup_prefix.get("slotCount")
    seed_count = setup_prefix.get("seedCount")
    if not isinstance(slot_count, int) or not 1 <= slot_count <= 1024 \
            or not isinstance(seed_count, int) or not 1 <= seed_count <= 1024:
        raise SystemExit(f"fixture marker has unsafe setup-prefix counts: {marker}")
    return slot_count, seed_count


def cleanup(root: Path, *, remove_root: bool) -> None:
    marker = root / MARKER
    if not marker.is_file():
        raise SystemExit(f"refusing to clean unmarked fixture root: {root}")
    slot_count, seed_count = fixture_counts(marker)
    fixed_mounts = [
        *(root / "data" / "setup-prefix-seeds" / f"seed-e2e{index:05d}"
          for index in reversed(range(seed_count))),
        *(root / "data" / "quota-slots" / f"slot-{index:04d}"
          for index in reversed(range(slot_count))),
    ]
    for fixed_mount in fixed_mounts:
        mounted = subprocess.run(
            ["findmnt", "-n", "--mountpoint", str(fixed_mount)],
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0
        if mounted:
            run("umount", str(fixed_mount))
    mount = root / "data"
    mounted = subprocess.run(
        ["findmnt", "-n", "--mountpoint", str(mount)],
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0
    if mounted:
        run("umount", str(mount))
    if remove_root:
        shutil.rmtree(root)


def setup(args: argparse.Namespace) -> None:
    if os.geteuid() != 0:
        raise SystemExit("profile E2E host fixture setup requires root")
    root = checked_root(args.root)
    filesystem_bytes = args.setup_prefix_filesystem_bytes
    slot_count = args.setup_prefix_slot_count
    seed_count = args.setup_prefix_seed_count
    if filesystem_bytes <= 0 or slot_count <= 0 or seed_count <= 0:
        raise SystemExit("setup-prefix filesystem bytes and slot/seed counts must be positive")
    required_setup_prefix_capacity = (
        slot_count
        + seed_count
        + SETUP_PREFIX_TEMPORARY_CLONE_HEADROOM
    ) * filesystem_bytes
    setup_prefix_capacity = max(SETUP_PREFIX_CAPACITY_BYTES, required_setup_prefix_capacity)
    scripts = Path(args.scripts).resolve()
    if not (scripts / "watchdog.py").is_file():
        raise SystemExit(f"actual Docker profile host scripts are absent: {scripts}")
    root.mkdir(mode=0o700, exist_ok=True)
    (root / MARKER).write_text(json.dumps({
        "schemaVersion": 1,
        "setupPrefix": {"slotCount": slot_count, "seedCount": seed_count},
    }) + "\n", encoding="utf-8")
    os.chmod(root / MARKER, 0o600)
    mount = root / "data"
    image = root / "storage.img"
    try:
        run(
            str(scripts / "prepare-loop-storage.sh"),
            "--image", str(image),
            "--size", str((4 * 1024**3) if args.setup_prefix else (1536 * 1024**2)),
            "--mount", str(mount),
        )
        run("mount", "-o", "loop,prjquota", str(image), str(mount))
        run("mount", "--make-rprivate", str(mount))

        user = pwd.getpwnam(args.user)
        group = grp.getgrnam(args.group)
        journal = root / "journal"
        journal.mkdir(mode=0o700)
        host_config = root / "profile.host.json"
        descriptor = root / "profile.json"
        assets = root / "assets-v1.json"
        assets.write_text(json.dumps({"schemaVersion": 1, "platform": "linux/amd64", "images": [
            {"purpose": "doctor-dind", "reference": "docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c", "platform": "linux/amd64"},
            {"purpose": "doctor-buildkit", "reference": "moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8", "platform": "linux/amd64"},
        ]}) + "\n", encoding="utf-8")
        config = {
            "name": args.name,
            "securityLevel": "raw-dind-storage/v1",
            "userName": user.pw_name,
            "userGroup": group.gr_name,
            "accessGroup": "docker",
            "dockerSocket": "/run/docker.sock",
            "controlSocket": str(root / "control.sock"),
            "dataMount": str(mount),
            "dockerRootDir": args.docker_root,
            "journalDir": str(journal),
            "aggregateCgroupPath": "/sys/fs/cgroup/system.slice/docker.service",
            "capacity": {
                "cpus": 2,
                "memory": args.profile_memory,
                "pids": 2048,
                "maxContainers": slot_count if args.setup_prefix else 1,
                "maxBuilds": 1,
                "ephemeralDiskBytes": filesystem_bytes if args.setup_prefix else "1G",
                "dockerDataAllocationCount": slot_count if args.setup_prefix else 1,
                "memorySwapBytes": 0,
            },
            "aggregate": {
                "cpus": 4,
                "memory": args.aggregate_memory,
                "pids": 4096,
                "memorySwapBytes": 0,
            },
            "storage": {
                "size": "4G" if args.setup_prefix else "1536M",
                "backing": "existing-mount" if args.setup_prefix else "loop-ext4",
                "slotRootPath": str(mount / "quota-slots"),
                "slotRegistryPath": str(journal / "quota-slots.json"),
                **({"slotAttestation": "independent-fixed-filesystem/v1"}
                   if args.setup_prefix else {}),
            },
            "assets": {"manifestPath": str(assets)},
            "policy": {"hostLoopback": False, "tcpDockerEndpoint": False},
        }
        if args.setup_prefix:
            slot_root = mount / "quota-slots"
            image_root = root / "setup-prefix-images"
            image_root.mkdir(mode=0o700)
            slots = []
            for index in range(slot_count):
                slot_id = f"slot-{index:04d}"
                slot = slot_root / slot_id
                slot_image = image_root / f"docker-data-{slot_id}.img"
                run(
                    str(scripts / "prepare-loop-storage.sh"),
                    "--image", str(slot_image),
                    "--size", str(filesystem_bytes),
                    "--mount", str(slot),
                )
                run("fallocate", "--length", str(filesystem_bytes), str(slot_image))
                run("mount", "-o", "loop,rw", str(slot_image), str(slot))
                run("mount", "--make-rprivate", str(slot))
                lost_found = slot / "lost+found"
                if lost_found.is_dir():
                    lost_found.rmdir()
                os.chown(slot, user.pw_uid, group.gr_gid)
                os.chmod(slot, 0o700)
                slot_stat = slot.stat()
                slot_filesystem = os.statvfs(slot)
                slot_baseline = (
                    slot_filesystem.f_blocks - slot_filesystem.f_bfree
                ) * slot_filesystem.f_frsize
                slots.append({
                    "slotId": slot_id,
                    "projectId": 0,
                    "path": str(slot),
                    "imagePath": str(slot_image),
                    "limitBytes": filesystem_bytes,
                    "baselineUsageBytes": slot_baseline,
                    "ownerUid": user.pw_uid,
                    "ownerGid": group.gr_gid,
                    "mode": 0o700,
                    "generation": 0,
                    "state": "free",
                    "attestation": "independent-fixed-filesystem/v1",
                    "filesystemIdentity": f"dev={slot_stat.st_dev}:ino={slot_stat.st_ino}",
                    "fsType": "ext4",
                    "mountOptions": ["rw"],
                })
            registry = {
                "schemaVersion": 1,
                "mount": str(mount),
                "slotAttestation": "independent-fixed-filesystem/v1",
                "slots": slots,
            }
            (journal / "quota-slots.json").write_text(
                json.dumps(registry, indent=2) + "\n", encoding="utf-8",
            )
            os.chmod(journal / "quota-slots.json", 0o600)
            image_root_stat = image_root.stat()
            seed_root = mount / "setup-prefix-seeds"
            seed_root.mkdir(mode=0o700)
            seeds = []
            for index in range(seed_count):
                seed_id = f"seed-e2e{index:05d}"
                seed = seed_root / seed_id
                seed_image = image_root / f"setup-prefix-{seed_id}.img"
                run(
                    str(scripts / "prepare-loop-storage.sh"),
                    "--image", str(seed_image),
                    "--size", str(filesystem_bytes),
                    "--mount", str(seed),
                )
                run("fallocate", "--length", str(filesystem_bytes), str(seed_image))
                run("mount", "-o", "loop,rw", str(seed_image), str(seed))
                run("mount", "--make-rprivate", str(seed))
                seed_lost_found = seed / "lost+found"
                if seed_lost_found.is_dir():
                    seed_lost_found.rmdir()
                os.chown(seed, 0, 0)
                os.chmod(seed, 0o700)
                seed_filesystem = os.statvfs(seed)
                seed_baseline = (
                    seed_filesystem.f_blocks - seed_filesystem.f_bfree
                ) * seed_filesystem.f_frsize
                run("umount", str(seed))
                if subprocess.run(
                    ["findmnt", "-n", "--mountpoint", str(seed)],
                    text=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                ).returncode == 0:
                    raise RuntimeError(f"published seed fixture remained mounted: {seed}")
                seed_stat = seed.stat()
                seeds.append({
                    "seedId": seed_id,
                    "path": str(seed),
                    "imagePath": str(seed_image),
                    "limitBytes": filesystem_bytes,
                    "baselineUsageBytes": seed_baseline,
                    "ownerUid": 0,
                    "ownerGid": 0,
                    "mode": 0o700,
                    "generation": 0,
                    "state": "free",
                    "attestation": "independent-fixed-filesystem/v1",
                    "filesystemIdentity": f"dev={seed_stat.st_dev}:ino={seed_stat.st_ino}",
                    "fsType": "ext4",
                    "mountOptions": ["ro", "noload"],
                })
            seed_registry = journal / "setup-prefix-seeds.json"
            seed_registry.write_text(json.dumps({
                "schemaVersion": 1,
                "slotAttestation": "independent-fixed-filesystem/v1",
                "filesystemIdentity": f"dev={image_root_stat.st_dev}:ino={image_root_stat.st_ino}",
                "seeds": seeds,
            }, indent=2) + "\n", encoding="utf-8")
            os.chmod(seed_registry, 0o600)
            config["setupPrefix"] = {
                "enabled": True,
                "protocol": "niceeval-docker-profile-state/docker-data-snapshot/v1",
                "coverage": "dockerData",
                "requiredState": "dockerData",
                "helperRevision": "niceeval-docker-profile-host/docker-data-snapshot/v1",
                "copyProtocol": "raw-image/v1",
                "copyRevision": "niceeval-docker-profile-host/raw-image-copy/v1",
                "quiesceRevision": "niceeval-docker-profile-host/docker-data-quiesce/v1",
                "slotAttestation": "independent-fixed-filesystem/v1",
                "filesystemSizeBytes": filesystem_bytes,
                "filesystemFeatures": [
                    "ext4",
                    "fixed-size",
                    "fully-allocated",
                    "independent-image",
                ],
                "seedPolicy": "immutable-unmounted/v1",
                "publicationRevision": "journal-first-atomic-publish/v1",
                "recoveryRevision": "scrub-quarantine-cancel-restart/v1",
                "seedRegistryPath": str(seed_registry),
                "imageRootPath": str(image_root),
                "copyStrategy": "raw-image/v1",
                "filesystemIdentity": f"dev={image_root_stat.st_dev}:ino={image_root_stat.st_ino}",
                "filesystemLimitBytes": setup_prefix_capacity,
                "seedLimitBytes": seed_count * filesystem_bytes,
            }
        host_config.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        os.chmod(host_config, 0o600)
        run(
            sys.executable, str(scripts / "generate-descriptor.py"),
            "--host-config", str(host_config),
            "--output", str(descriptor),
        )
        os.chmod(descriptor, 0o600)
        if not args.setup_prefix:
            run(sys.executable, str(scripts / "install-quota-slots.py"), "--host-config", str(host_config))
        print(json.dumps({
            "assets": str(assets),
            "controlSocket": str(root / "control.sock"),
            "descriptor": str(descriptor),
            "hostConfig": str(host_config),
            "journal": str(journal / "events.ndjson"),
            "profileId": json.loads(descriptor.read_text(encoding="utf-8"))["profileId"],
            "readyFile": str(root / "ready"),
        }))
    except BaseException:
        cleanup(root, remove_root=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("setup")
    create.add_argument("--root", required=True)
    create.add_argument("--scripts", required=True)
    create.add_argument("--docker-root", required=True)
    create.add_argument("--user", required=True)
    create.add_argument("--group", required=True)
    create.add_argument("--name", default="e2e-cold-build")
    create.add_argument("--profile-memory", default=PROFILE_MEMORY)
    create.add_argument("--aggregate-memory", default=AGGREGATE_MEMORY)
    create.add_argument("--setup-prefix", action="store_true")
    create.add_argument(
        "--setup-prefix-filesystem-bytes",
        type=int,
        default=SETUP_PREFIX_FILESYSTEM_BYTES,
    )
    create.add_argument(
        "--setup-prefix-slot-count",
        type=int,
        default=SETUP_PREFIX_SLOT_COUNT,
    )
    create.add_argument(
        "--setup-prefix-seed-count",
        type=int,
        default=SETUP_PREFIX_SEED_COUNT,
    )
    remove = subparsers.add_parser("cleanup")
    remove.add_argument("--root", required=True)
    args = parser.parse_args()
    root = checked_root(args.root)
    if args.command == "setup":
        setup(args)
    else:
        if os.geteuid() != 0:
            raise SystemExit("profile E2E host fixture cleanup requires root")
        cleanup(root, remove_root=True)


if __name__ == "__main__":
    main()
