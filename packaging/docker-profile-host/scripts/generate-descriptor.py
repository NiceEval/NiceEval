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


SETUP_PREFIX_PROTOCOL = "niceeval-docker-profile-state/docker-data-snapshot/v1"
SETUP_PREFIX_REQUIRED_STATE = "dockerData"
SETUP_PREFIX_HELPER_REVISION = "niceeval-docker-profile-host/docker-data-snapshot/v1"
SETUP_PREFIX_COPY_PROTOCOL = "raw-image/v1"
SETUP_PREFIX_COPY_REVISION = "niceeval-docker-profile-host/raw-image-copy/v1"
SETUP_PREFIX_QUIESCE_REVISION = "niceeval-docker-profile-host/docker-data-quiesce/v1"
SETUP_PREFIX_SLOT_ATTESTATION = "independent-fixed-filesystem/v1"
SETUP_PREFIX_FILESYSTEM_FEATURES = [
    "ext4",
    "fixed-size",
    "fully-allocated",
    "independent-image",
]
SETUP_PREFIX_SEED_POLICY = "immutable-unmounted/v1"
SETUP_PREFIX_PUBLICATION_REVISION = "journal-first-atomic-publish/v1"
SETUP_PREFIX_RECOVERY_REVISION = "scrub-quarantine-cancel-restart/v1"

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


def setup_prefix_capability(
    host: dict[str, Any],
    *,
    provider_identity: str,
    execution_domain: str,
    filesystem_size_bytes: int,
) -> dict[str, Any] | None:
    """Return the path-free descriptor capability for an explicit host opt-in."""
    setup = host.get("setupPrefix")
    if setup is None or setup.get("enabled") is not True:
        return None
    storage = host.get("storage", {})
    if storage.get("backing") == "loop-ext4":
        raise SystemExit("setupPrefix is forbidden for shared loop-ext4 storage")
    if storage.get("slotAttestation") != SETUP_PREFIX_SLOT_ATTESTATION:
        raise SystemExit(
            "setupPrefix requires storage.slotAttestation=independent-fixed-filesystem/v1"
        )
    expected = {
        "protocol": SETUP_PREFIX_PROTOCOL,
        "coverage": SETUP_PREFIX_REQUIRED_STATE,
        "requiredState": SETUP_PREFIX_REQUIRED_STATE,
        "helperRevision": SETUP_PREFIX_HELPER_REVISION,
        "copyProtocol": SETUP_PREFIX_COPY_PROTOCOL,
        "copyRevision": SETUP_PREFIX_COPY_REVISION,
        "quiesceRevision": SETUP_PREFIX_QUIESCE_REVISION,
        "slotAttestation": SETUP_PREFIX_SLOT_ATTESTATION,
        "seedPolicy": SETUP_PREFIX_SEED_POLICY,
        "publicationRevision": SETUP_PREFIX_PUBLICATION_REVISION,
        "recoveryRevision": SETUP_PREFIX_RECOVERY_REVISION,
    }
    for field, value in expected.items():
        if setup.get(field) != value:
            raise SystemExit(f"setupPrefix.{field} must be {value}")
    seed_limit = parse_bytes(setup.get("seedLimitBytes", 0))
    filesystem_limit = parse_bytes(setup.get("filesystemLimitBytes", 0))
    configured_filesystem_size = parse_bytes(setup.get("filesystemSizeBytes", 0))
    identity = setup.get("filesystemIdentity")
    registry_path = setup.get("seedRegistryPath")
    image_root_path = setup.get("imageRootPath")
    copy_strategy = setup.get("copyStrategy")
    if seed_limit <= 0 or filesystem_limit <= 0 or seed_limit > filesystem_limit:
        raise SystemExit("setupPrefix seed/filesystem limits must be positive and seed <= filesystem")
    if configured_filesystem_size != filesystem_size_bytes:
        raise SystemExit(
            "setupPrefix.filesystemSizeBytes must equal one fixed Docker data allocation"
        )
    if setup.get("filesystemFeatures") != SETUP_PREFIX_FILESYSTEM_FEATURES:
        raise SystemExit(
            "setupPrefix.filesystemFeatures must attest ext4 fixed-size fully-allocated independent images"
        )
    if not isinstance(identity, str) or not identity or not isinstance(registry_path, str) \
            or not registry_path.startswith("/") or not isinstance(image_root_path, str) \
            or not image_root_path.startswith("/"):
        raise SystemExit(
            "setupPrefix requires filesystemIdentity plus absolute seedRegistryPath and imageRootPath"
        )
    image_root = Path(image_root_path)
    if image_root.is_symlink() or not image_root.is_dir():
        raise SystemExit("setupPrefix.imageRootPath must be an existing real directory")
    actual_identity = filesystem_identity(str(image_root.resolve()))
    if identity != actual_identity:
        raise SystemExit(
            "setupPrefix.filesystemIdentity must match the actual imageRootPath filesystem"
        )
    if copy_strategy != "raw-image/v1":
        raise SystemExit("setupPrefix.copyStrategy must be raw-image/v1; inode tree copy is not supported")
    return {
        **expected,
        "providerIdentity": provider_identity,
        "executionDomain": execution_domain,
        "filesystemSizeBytes": filesystem_size_bytes,
        "filesystemFeatures": SETUP_PREFIX_FILESYSTEM_FEATURES,
        "seedLimitBytes": seed_limit,
        "filesystemIdentity": actual_identity,
    }


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
    docker_data_allocation_count = int(
        host["capacity"].get("dockerDataAllocationCount", host["capacity"]["maxContainers"])
    )
    bytes_per_docker_data_allocation = parse_bytes(host["capacity"]["ephemeralDiskBytes"])
    total_ephemeral_disk_bytes = docker_data_allocation_count * bytes_per_docker_data_allocation

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
            "ephemeralDiskBytes": total_ephemeral_disk_bytes,
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
            "ephemeralDiskBytes": total_ephemeral_disk_bytes,
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
                    "count": docker_data_allocation_count,
                    "bytesPerAllocation": bytes_per_docker_data_allocation,
                    "attestation": host["storage"].get(
                        "slotAttestation", "linux-project-quota/v1"
                    ),
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
    provider_identity = "sha256:" + hashlib.sha256(
        json.dumps(
            {
                "schemaVersion": 1,
                "profileId": profile_id,
                "securityLevel": security_level,
                "semanticPolicyRevision": rev,
                "hostMachineIdentity": machine_id,
                "backendMachineIdentity": machine_id,
                "dockerDataFilesystemIdentity": draft["backend"]["filesystem"]["identity"],
                "dockerDataPool": draft["backend"]["filesystem"]["dockerDataPool"],
                "dockerDataSnapshot": {
                    "protocol": SETUP_PREFIX_PROTOCOL,
                    "coverage": SETUP_PREFIX_REQUIRED_STATE,
                    "requiredState": SETUP_PREFIX_REQUIRED_STATE,
                    "helperRevision": SETUP_PREFIX_HELPER_REVISION,
                    "copyProtocol": SETUP_PREFIX_COPY_PROTOCOL,
                    "copyRevision": SETUP_PREFIX_COPY_REVISION,
                    "quiesceRevision": SETUP_PREFIX_QUIESCE_REVISION,
                    "slotAttestation": SETUP_PREFIX_SLOT_ATTESTATION,
                    "filesystemSizeBytes": bytes_per_docker_data_allocation,
                    "filesystemFeatures": SETUP_PREFIX_FILESYSTEM_FEATURES,
                    "seedPolicy": SETUP_PREFIX_SEED_POLICY,
                    "publicationRevision": SETUP_PREFIX_PUBLICATION_REVISION,
                    "recoveryRevision": SETUP_PREFIX_RECOVERY_REVISION,
                },
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    execution_domain = "sha256:" + hashlib.sha256(
        json.dumps(
            {
                "schemaVersion": 1,
                "profileId": profile_id,
                "hostMachineIdentity": machine_id,
                "backendMachineIdentity": machine_id,
                "dockerDataFilesystemIdentity": draft["backend"]["filesystem"]["identity"],
                "slotAttestation": draft["backend"]["filesystem"]["dockerDataPool"]["attestation"],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    setup_prefix = setup_prefix_capability(
        host,
        provider_identity=provider_identity,
        execution_domain=execution_domain,
        filesystem_size_bytes=bytes_per_docker_data_allocation,
    )
    if setup_prefix is not None:
        draft["backend"]["filesystem"]["setupPrefix"] = setup_prefix
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
