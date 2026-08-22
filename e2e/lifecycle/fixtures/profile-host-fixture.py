#!/usr/bin/env python3
"""Create and remove the isolated real-host boundary for the Docker profile E2E."""
from __future__ import annotations

import argparse
import json
import os
import pwd
import grp
import shutil
import subprocess
import sys
from pathlib import Path


MARKER = ".niceeval-docker-profile-e2e"
sys.dont_write_bytecode = True


def run(*args: str) -> str:
    return subprocess.run(
        args,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    ).stdout.strip()


def checked_root(raw: str) -> Path:
    root = Path(raw).resolve()
    if root.parent != Path("/tmp") or not root.name.startswith("niceeval-e2e-docker-profile-"):
        raise SystemExit(f"refusing unsafe fixture root: {root}")
    return root


def cleanup(root: Path, *, remove_root: bool) -> None:
    marker = root / MARKER
    if not marker.is_file():
        raise SystemExit(f"refusing to clean unmarked fixture root: {root}")
    mount = root / "data"
    mounted = subprocess.run(
        ["findmnt", "-n", "--target", str(mount)],
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
    scripts = Path(args.scripts).resolve()
    if not (scripts / "watchdog.py").is_file():
        raise SystemExit(f"actual Docker profile host scripts are absent: {scripts}")
    root.mkdir(mode=0o700, exist_ok=True)
    (root / MARKER).write_text("isolated Docker profile E2E\n", encoding="utf-8")
    os.chmod(root / MARKER, 0o600)
    mount = root / "data"
    image = root / "storage.img"
    try:
        run(
            str(scripts / "prepare-loop-storage.sh"),
            "--image", str(image),
            "--size", str(1536 * 1024 * 1024),
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
        config = {
            "name": "e2e-cold-build",
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
                "memory": "2G",
                "pids": 2048,
                "maxContainers": 1,
                "maxBuilds": 1,
                "ephemeralDiskBytes": "1G",
                "dockerDataAllocationCount": 1,
                "memorySwapBytes": 0,
            },
            "aggregate": {
                "cpus": 4,
                "memory": "4G",
                "pids": 4096,
                "memorySwapBytes": 0,
            },
            "storage": {
                "size": "1536M",
                "backing": "loop-ext4",
                "slotRootPath": str(mount / "quota-slots"),
                "slotRegistryPath": str(journal / "quota-slots.json"),
            },
            "policy": {"hostLoopback": False, "tcpDockerEndpoint": False},
        }
        host_config.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        os.chmod(host_config, 0o600)
        run(
            sys.executable, str(scripts / "generate-descriptor.py"),
            "--host-config", str(host_config),
            "--output", str(descriptor),
        )
        os.chmod(descriptor, 0o600)
        run(sys.executable, str(scripts / "install-quota-slots.py"), "--host-config", str(host_config))
        print(json.dumps({
            "controlSocket": str(root / "control.sock"),
            "descriptor": str(descriptor),
            "hostConfig": str(host_config),
            "journal": str(journal / "events.ndjson"),
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
