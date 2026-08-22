#!/usr/bin/env python3
"""Generate root-owned callback-free DockerExecutionProfileV1 descriptor JSON.

Reads a host config (written by NixOS module or admin package install) plus
live machine facts (machine-id, dedicated UID/GID) and writes the pure-data
descriptor consumed by NiceEval core.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pwd
import grp
import sys
from pathlib import Path
from typing import Any

def _load_validate_capacity():
    """Load sibling validate-capacity helper (source tree or installed libexec)."""
    here = Path(__file__).resolve().parent
    candidates = [
        here / "validate-capacity.py",
        here / "validate-capacity",
        Path(sys.argv[0]).resolve().parent / "validate-capacity",
        Path(sys.argv[0]).resolve().parent / "validate-capacity.py",
    ]
    from importlib.machinery import SourceFileLoader

    for path in candidates:
        if path.is_file():
            try:
                return SourceFileLoader("validate_capacity", str(path)).load_module()
            except Exception:
                continue
    return None


_vc = _load_validate_capacity()


def parse_bytes(value: Any) -> int:
    if _vc is not None:
        return _vc.parse_bytes(value)
    if isinstance(value, int):
        return value
    s = str(value).strip().lower()
    if s.endswith("b") and not s.endswith("ib"):
        s = s[:-1]
    mult = 1
    for suffix, m in (
        ("ti", 1024**4),
        ("t", 1024**4),
        ("gi", 1024**3),
        ("g", 1024**3),
        ("mi", 1024**2),
        ("m", 1024**2),
        ("ki", 1024),
        ("k", 1024),
    ):
        if s.endswith(suffix):
            mult = m
            s = s[: -len(suffix)]
            break
    return int(s) * mult


def read_machine_id() -> str:
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        p = Path(path)
        if p.is_file():
            return p.read_text(encoding="utf-8").strip()
    raise SystemExit("machine-id not found")


def stable_profile_id(name: str, machine_id: str) -> str:
    digest = hashlib.sha256(
        f"niceeval-docker-profile-v1:{name}:{machine_id}".encode()
    ).hexdigest()
    return digest[:32]


def semantic_policy_revision(payload: dict[str, Any]) -> str:
    """Match core's semanticPolicyJson + stableJson exactly."""
    semantic = {
        "schemaVersion": 1,
        "securityLevel": payload["securityLevel"],
        "backend": {
            "kind": payload["backend"]["kind"],
            "cgroup": {
                "policyRevision": payload["backend"]["cgroup"]["policyRevision"],
                "controllers": payload["backend"]["cgroup"]["controllers"],
            },
        },
        "policy": payload["policy"],
    }
    canonical = json.dumps(semantic, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:8]


def filesystem_identity(mount_path: str) -> str:
    st = os.stat(mount_path)
    # device id + inode of the mount point is a stable local identity marker
    return f"dev={st.st_dev}:ino={st.st_ino}"


def build_descriptor(host: dict[str, Any]) -> dict[str, Any]:
    name = host["name"]
    security_level = host.get("securityLevel", "managed-rootless/v1")
    if security_level not in ("managed-rootless/v1", "raw-dind-storage/v1"):
        raise SystemExit("securityLevel must be managed-rootless/v1 or raw-dind-storage/v1")
    user_name = host["userName"]
    pw = pwd.getpwnam(user_name)
    gr = grp.getgrnam(host.get("userGroup", user_name))
    machine_id = host.get("hostMachineIdentity") or read_machine_id()
    data_mount = host["dataMount"]
    limit_bytes = parse_bytes(host["storage"]["size"])

    if _vc is not None:
        normalized = _vc.validate(
            {
                "name": name,
                "capacity": host["capacity"],
                "aggregate": host["aggregate"],
            }
        )
        capacity_block = {
            "cpus": normalized["capacity"]["cpus"],
            "memoryBytes": normalized["capacity"]["memoryBytes"],
            "memorySwapBytes": 0,
            "pids": normalized["capacity"]["pids"],
            "maxContainers": normalized["capacity"]["maxContainers"],
            "maxBuilds": normalized["capacity"]["maxBuilds"],
            "ephemeralDiskBytes": normalized["capacity"]["ephemeralDiskBytes"],
            "aggregate": {
                "cpus": normalized["aggregate"]["cpus"],
                "memoryBytes": normalized["aggregate"]["memoryBytes"],
                "memorySwapBytes": 0,
                "pids": normalized["aggregate"]["pids"],
            },
        }
    else:
        capacity_block = {
            "cpus": int(host["capacity"]["cpus"]),
            "memoryBytes": parse_bytes(
                host["capacity"].get("memory", host["capacity"]["memoryBytes"])
            ),
            "memorySwapBytes": 0,
            "pids": int(host["capacity"]["pids"]),
            "maxContainers": int(host["capacity"]["maxContainers"]),
            "maxBuilds": int(host["capacity"]["maxBuilds"]),
            "ephemeralDiskBytes": parse_bytes(host["capacity"]["ephemeralDiskBytes"]),
            "aggregate": {
                "cpus": int(host["aggregate"]["cpus"]),
                "memoryBytes": parse_bytes(
                    host["aggregate"].get("memory", host["aggregate"]["memoryBytes"])
                ),
                "memorySwapBytes": 0,
                "pids": int(host["aggregate"]["pids"]),
            },
        }

    profile_id = host.get("profileId") or stable_profile_id(name, machine_id)
    aggregate_path = host["aggregateCgroupPath"]
    docker_socket = Path(host["dockerSocket"])
    if security_level == "raw-dind-storage/v1":
        if not docker_socket.is_socket():
            raise SystemExit(f"raw Docker socket is absent or not a Unix socket: {docker_socket}")
        socket_stat = docker_socket.stat()
        backend_uid = socket_stat.st_uid
        backend_gid = socket_stat.st_gid
    else:
        backend_uid = pw.pw_uid
        backend_gid = gr.gr_gid
    network = host.get("networkPolicy")
    if security_level == "managed-rootless/v1" and (
        not network or network.get("ipv6") != "disabled"
    ):
        raise SystemExit("managed networkPolicy.ipv6 must be disabled")

    draft = {
        "schemaVersion": 1,
        "profileId": profile_id,
        "securityLevel": security_level,
        "semanticPolicyRevision": "pending",
        "transport": {
            "kind": "unix",
            "hostMachineIdentity": machine_id,
            "dockerSocket": {
                "path": host["dockerSocket"],
                "peerUid": backend_uid,
            },
            "controlSocket": {
                "path": host["controlSocket"],
                "peerUid": 0,
                "protocol": "niceeval-docker-profile-control/v1",
            },
        },
        "backend": {
            "kind": "local-systemd",
            "machineIdentity": machine_id,
            "owner": {"uid": backend_uid, "gid": backend_gid},
            "filesystem": {
                "identity": filesystem_identity(data_mount)
                if Path(data_mount).exists()
                else f"pending:{data_mount}",
                "mountPath": data_mount,
                "dockerRootDir": host["dockerRootDir"],
                "limitBytes": limit_bytes,
                "dockerDataPool": {
                    "count": int(host["capacity"].get("dockerDataAllocationCount", host["capacity"]["maxContainers"])),
                    "bytesPerAllocation": parse_bytes(host["capacity"]["ephemeralDiskBytes"]),
                    "attestation": "linux-project-quota/v1",
                },
            },
            "cgroup": {
                "aggregatePath": aggregate_path,
                "policyRevision": "managed-rootless-cgroup-v1"
                if security_level == "managed-rootless/v1"
                else "raw-dind-storage-cgroup-v1",
                "controllers": ["cpu", "memory", "pids"],
            },
        },
        "capacity": capacity_block,
        "policy": (
            {
                "level": "raw-dind-storage/v1",
                "privilegedTranslation": "host-daemon",
                "dockerData": "private-project-quota-allocation/v1",
            }
            if security_level == "raw-dind-storage/v1"
            else {
                "level": "managed-rootless/v1",
                "hostLoopback": False,
                "tcpDockerEndpoint": False,
                "outerSocketInjection": False,
                "privilegedTranslation": "rootless-userns",
                "writableRoot": "declared-tmpfs-only",
                "dockerData": "private-project-quota-allocation/v1",
                "network": {
                "version": 1,
                "dns": {
                    "mode": "explicit",
                    "servers": network["dnsServers"],
                },
                "egress": {
                    "mode": "rootless-nat",
                    "allowedProtocols": ["dns", "https"],
                    "denyPrivateNetworks": True,
                    "denySiblingSyntheticEndpoints": True,
                    "denyCidrs": network["blockedCidrs"],
                    "ipv6": "disabled",
                    "disableHostLoopback": True,
                    "portDriver": "none",
                    "daemonBridge": "none",
                    "exclusiveNetwork": True,
                    "icc": False,
                },
                },
            }
        ),
    }
    rev = semantic_policy_revision(draft)
    draft["semanticPolicyRevision"] = rev
    return draft


def atomic_write(path: Path, data: str, mode: int = 0o640) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    os.chmod(tmp, mode)
    tmp.replace(path)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host-config", required=True, help="host config JSON")
    p.add_argument("--output", required=True, help="descriptor JSON path")
    p.add_argument(
        "--access-group",
        default=None,
        help="chgrp descriptor to this access group (optional)",
    )
    args = p.parse_args()

    with open(args.host_config, encoding="utf-8") as f:
        host = json.load(f)

    desc = build_descriptor(host)
    text = json.dumps(desc, indent=2, sort_keys=True) + "\n"
    out = Path(args.output)
    atomic_write(out, text, 0o640)

    # Root-owned; access group may read. Caller should already be root for install.
    if os.geteuid() == 0:
        os.chown(out, 0, 0)
        if args.access_group:
            try:
                gid = grp.getgrnam(args.access_group).gr_gid
                os.chown(out, 0, gid)
            except KeyError:
                pass
        # parent directory: root-owned, not group-writable
        parent = out.parent
        os.chown(parent, 0, 0)
        os.chmod(parent, 0o755)

    print(f"wrote {out} profileId={desc['profileId']} policy={desc['semanticPolicyRevision']}")


if __name__ == "__main__":
    main()
