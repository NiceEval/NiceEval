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
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path


MARKER = ".niceeval-docker-profile-e2e"
SETUP_PREFIX_FILESYSTEM_BYTES = 512 * 1024 * 1024
SETUP_PREFIX_SLOT_COUNT = 2
SETUP_PREFIX_SEED_COUNT = 4
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
        *(root / "data" / "fixed-image-v1" / "seeds" / f"seed-{index:08d}"
          for index in reversed(range(seed_count))),
        *(root / "data" / "fixed-image-v1" / "slots" / f"slot-{index:04d}"
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

    def detach_loops_backed_by(prefix: Path) -> None:
        devices = json.loads(run(
            "losetup", "--list", "--json", "--output", "NAME,BACK-FILE",
        ) or '{"loopdevices":[]}').get("loopdevices", [])
        prefix_text = str(prefix.resolve()) + os.sep
        for device in devices:
            name = device.get("name") if isinstance(device, dict) else None
            backing = device.get("back-file") if isinstance(device, dict) else None
            if isinstance(name, str) and isinstance(backing, str) \
                    and backing.removesuffix(" (deleted)").startswith(prefix_text):
                run("losetup", "--detach", name)

    # An unmounted inner ext4 loop still holds its image file open on the outer
    # filesystem.  Detach those loops before attempting to unmount the outer
    # store, then detach the outer image loop after the mount is gone.
    detach_loops_backed_by(root / "data")
    mount = root / "data"
    mounted = subprocess.run(
        ["findmnt", "-n", "--mountpoint", str(mount)],
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode == 0
    if mounted:
        # Crash/recovery tests may leave a private slot mount below the outer
        # fixture filesystem.  Unmount the marker-guarded fixture subtree
        # deepest-first instead of relying on the nominal slot directory list.
        run("umount", "--recursive", str(mount))
    detach_loops_backed_by(root)
    if remove_root:
        shutil.rmtree(root)


def proxy_prepared_response(root: Path) -> None:
    """Hold one public capture receipt after Host prepare while other frames pass."""
    if os.geteuid() != 0:
        raise SystemExit("profile E2E control proxy requires root")
    if not (root / MARKER).is_file():
        raise SystemExit(f"refusing to proxy unmarked fixture root: {root}")
    control = root / "control.sock"
    upstream = root / "control.upstream.sock"
    ready = root / "control-proxy.ready"
    prepared = root / "control-proxy.prepared.json"
    release = root / "control-proxy.release"
    trace = root / "control-proxy.trace.ndjson"
    if not control.exists() or upstream.exists():
        raise SystemExit("control proxy requires one live watchdog socket")

    stop = threading.Event()
    workers: list[threading.Thread] = []

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    def receive_line(peer: socket.socket) -> bytes:
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = peer.recv(64 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > 2 * 1024 * 1024:
                raise RuntimeError("control proxy frame exceeds the fixture limit")
            if b"\n" in chunk:
                break
        return b"".join(chunks)

    def relay(client: socket.socket) -> None:
        try:
            request = receive_line(client)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as host:
                host.connect(str(upstream))
                host.sendall(request)
                response = receive_line(host)
            request_value = json.loads(request.decode("utf-8"))
            response_value = json.loads(response.decode("utf-8"))
            with trace.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"request": request_value, "response": response_value}) + "\n")
                stream.flush()
            result = response_value.get("result") if isinstance(response_value, dict) else None
            result_status = result.get("status") if isinstance(result, dict) else None
            status = response_value.get("status") if isinstance(response_value, dict) else None
            prepared_state = (
                isinstance(status, dict) and status.get("state") == "prepared"
            ) or (
                isinstance(response_value, dict) and response_value.get("state") == "prepared"
            ) or (
                isinstance(result_status, dict) and result_status.get("state") == "prepared"
            )
            if prepared_state \
                    and not prepared.exists():
                prepared.write_text(json.dumps({
                    "operationId": request_value.get("operationId"),
                    "response": response_value,
                }) + "\n", encoding="utf-8")
                while not stop.is_set() and not release.exists():
                    time.sleep(0.01)
            if not stop.is_set():
                client.sendall(response)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            client.close()

    os.replace(control, upstream)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(str(control))
        os.chmod(control, 0o600)
        listener.listen(32)
        listener.settimeout(0.1)
        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)
        ready.write_text("ready\n", encoding="utf-8")
        while not stop.is_set():
            try:
                client, _ = listener.accept()
            except TimeoutError:
                continue
            worker = threading.Thread(target=relay, args=(client,), daemon=True)
            workers.append(worker)
            worker.start()
    finally:
        stop.set()
        listener.close()
        for worker in workers:
            worker.join(timeout=1)
        for path in (ready, prepared, release, trace, control):
            path.unlink(missing_ok=True)
        if upstream.exists():
            os.replace(upstream, control)


def setup(args: argparse.Namespace) -> None:
    if os.geteuid() != 0:
        raise SystemExit("profile E2E host fixture setup requires root")
    root = checked_root(args.root)
    filesystem_bytes = args.setup_prefix_filesystem_bytes
    slot_count = args.setup_prefix_slot_count
    seed_count = args.setup_prefix_seed_count
    if filesystem_bytes <= 0 or slot_count <= 0 or seed_count <= 0:
        raise SystemExit("setup-prefix filesystem bytes and slot/seed counts must be positive")
    fixed_ledger = (slot_count + seed_count + slot_count) * filesystem_bytes
    # The provisioner proves the complete ledger plus 1/8 of the outer image
    # from f_bavail, after ext4 metadata and reserved blocks.  A bare 1/8 byte
    # addition is therefore insufficient on the real loop filesystem.
    fixed_store_bytes = max(
        fixed_ledger + 2 * filesystem_bytes,
        fixed_ledger * 3,
    )
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
    if args.setup_prefix:
        storage_root = Path(args.storage_root).resolve() if args.storage_root else root
        if storage_root != root and root not in storage_root.parents:
            raise SystemExit("fixture storage override must remain inside its marked root")
        image = storage_root / "fixed-image-v1" / "store.img"
    else:
        storage_root = root
        image = root / "storage.img"
    try:
        run(
            str(scripts / "prepare-loop-storage.sh"),
            "--image", str(image),
            "--size", str(fixed_store_bytes if args.setup_prefix else (1536 * 1024**2)),
            "--mount", str(mount),
            *(["--fully-allocate"] if args.setup_prefix else []),
        )
        run("mount", "-o", "loop" + ("" if args.setup_prefix else ",prjquota"), str(image), str(mount))
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
            "activationDependency": {
                "class": "direct-exclusive-process-scan/v1",
                "cgroupPath": None,
            },
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
                "size": fixed_store_bytes if args.setup_prefix else "1536M",
                "backing": "fixed-image-ext4" if args.setup_prefix else "loop-ext4",
                "outerImagePath": str(image),
                "legacyOuterImagePath": str(root / "storage.img"),
                "rootDir": str(storage_root),
                "slotRootPath": str(mount / "quota-slots"),
                "slotRegistryPath": str(journal / "quota-slots.json"),
            },
            "assets": {"manifestPath": str(assets)},
            "policy": {"hostLoopback": False, "tcpDockerEndpoint": False},
        }
        if args.setup_prefix:
            config["setupPrefix"] = {
                "enable": True,
                "seedCount": seed_count,
            }
        host_config.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        os.chmod(host_config, 0o600)
        if args.setup_prefix:
            run(
                sys.executable, str(scripts / "activate-fixed-images.py"),
                "--host-config", str(host_config),
                "--descriptor", str(descriptor),
                "--lock", str(root / "activation.lock"),
            )
        else:
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
            "journal": str(journal / ("fixed-image-v1/events.ndjson" if args.setup_prefix else "events.ndjson")),
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
    create.add_argument("--storage-root")
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
    proxy = subparsers.add_parser("proxy-prepared-response")
    proxy.add_argument("--root", required=True)
    args = parser.parse_args()
    root = checked_root(args.root)
    if args.command == "setup":
        setup(args)
    elif args.command == "cleanup":
        if os.geteuid() != 0:
            raise SystemExit("profile E2E host fixture cleanup requires root")
        cleanup(root, remove_root=True)
    else:
        proxy_prepared_response(root)


if __name__ == "__main__":
    main()
