#!/usr/bin/env python3
"""Build both descriptor modes offline and check the public TS-compatible shape."""
from __future__ import annotations

import importlib.util
import json
import os
import pwd
import grp
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "packaging/docker-profile-host/scripts/generate-descriptor.py"
spec = importlib.util.spec_from_file_location("niceeval_descriptor", MODULE)
assert spec and spec.loader
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


with tempfile.TemporaryDirectory(prefix="niceeval-descriptor-") as raw:
    root = Path(raw)
    docker_socket = root / "docker.sock"
    docker_socket.touch()
    original_is_socket = generator.Path.is_socket
    generator.Path.is_socket = lambda self: self == docker_socket or original_is_socket(self)
    current_user = pwd.getpwuid(os.getuid())
    current_group = grp.getgrgid(os.getgid())
    common = {
        "name": "default",
        "userName": current_user.pw_name,
        "userGroup": current_group.gr_name,
        "dockerSocket": str(docker_socket),
        "controlSocket": str(root / "control.sock"),
        "dataMount": str(root),
        "dockerRootDir": "/data/docker",
        "aggregateCgroupPath": "/sys/fs/cgroup/niceeval-docker-profile-default.slice",
        "hostMachineIdentity": "machine-test",
        "capacity": {"cpus": 2, "memory": "2G", "pids": 128,
                     "maxContainers": 2, "maxBuilds": 1,
                     "ephemeralDiskBytes": "1G", "dockerDataAllocationCount": 2},
        "aggregate": {"cpus": 3, "memory": "3G", "pids": 256},
        "storage": {"size": "4G"},
    }
    managed_host = {**common, "securityLevel": "managed-rootless/v1", "networkPolicy": {
        "dnsServers": ["1.1.1.1"], "blockedCidrs": ["10.0.0.0/8"], "ipv6": "disabled",
    }}
    managed = generator.build_descriptor(managed_host)
    raw_desc = generator.build_descriptor({**common, "securityLevel": "raw-dind-storage/v1"})

    for desc, level in ((managed, "managed-rootless/v1"),
                        (raw_desc, "raw-dind-storage/v1")):
        assert desc["schemaVersion"] == 1
        assert desc["securityLevel"] == desc["policy"]["level"] == level
        pool = desc["backend"]["filesystem"]["dockerDataPool"]
        assert pool == {"count": 2, "bytesPerAllocation": 1024**3,
                        "attestation": "linux-project-quota/v1"}
        assert desc["capacity"]["ephemeralDiskBytes"] == 2 * 1024**3
        assert "dockerDataAllocationCount" not in desc["backend"]["filesystem"]
        assert "rootPath" not in json.dumps(desc) and "registryPath" not in json.dumps(desc)
        assert "setupPrefix" not in desc["backend"]["filesystem"]

    assert managed["policy"]["privilegedTranslation"] == "rootless-userns"
    assert managed["policy"]["writableRoot"] == "declared-tmpfs-only"
    assert raw_desc["policy"] == {
        "level": "raw-dind-storage/v1",
        "privilegedTranslation": "host-daemon",
        "dockerData": "private-project-quota-allocation/v1",
    }
    assert raw_desc["transport"]["dockerSocket"]["peerUid"] == os.stat(docker_socket).st_uid
    assert raw_desc["backend"]["owner"] == {
        "uid": os.stat(docker_socket).st_uid, "gid": os.stat(docker_socket).st_gid,
    }
    assert raw_desc["backend"]["filesystem"]["dockerRootDir"] == "/data/docker"

    snapshot_root = root / "setup-prefix"
    snapshot_root.mkdir()
    snapshot_outer = root / "setup-prefix-outer.ext4"
    subprocess.run(["fallocate", "-l", "16M", str(snapshot_outer)], check=True)
    subprocess.run(
        ["mkfs.ext4", "-F", "-m", "0", str(snapshot_outer)], check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    snapshot_identity = generator.filesystem_identity(str(snapshot_root), str(snapshot_outer))
    snapshot_host = {
        **common,
        "securityLevel": "raw-dind-storage/v1",
        "storage": {
            "size": "4G",
            "backing": "fixed-image-ext4",
            "outerImagePath": str(snapshot_outer),
            "slotAttestation": "independent-fixed-filesystem/v1",
        },
        "setupPrefix": {
            "enabled": True,
            "protocol": "niceeval-docker-profile-state/docker-data-snapshot/v1",
            "coverage": "dockerData",
            "requiredState": "dockerData",
            "helperRevision": "niceeval-docker-profile-host/docker-data-snapshot/v1",
            "copyProtocol": "raw-image/v1",
            "copyRevision": "niceeval-docker-profile-host/raw-image-copy-reuuid/v2",
            "quiesceRevision": "niceeval-docker-profile-host/docker-data-quiesce/v1",
            "slotAttestation": "independent-fixed-filesystem/v1",
            "seedPolicy": "immutable-unmounted/v1",
            "publicationRevision": "prepared-copy-client-commit-publish/v4",
            "recoveryRevision": "epoch-capsule-no-guess-recovery/v3",
            "manifestSchema": "niceeval-docker-profile-activation/v3",
            "seedRegistryPath": str(snapshot_root / "seeds.json"),
            "imageRootPath": str(snapshot_root),
            "copyStrategy": "raw-image/v1",
            "filesystemIdentity": snapshot_identity,
            "filesystemSizeBytes": "1G",
            "filesystemFeatures": [
                "ext4", "fixed-size", "fully-allocated", "independent-image",
            ],
            "filesystemLimitBytes": "3G",
            "seedLimitBytes": "1G",
        },
    }
    snapshot = generator.build_descriptor(snapshot_host)
    capability = snapshot["backend"]["filesystem"]["setupPrefix"]
    assert capability["protocol"] == "niceeval-docker-profile-state/docker-data-snapshot/v1"
    assert capability["coverage"] == "dockerData"
    assert capability["requiredState"] == "dockerData"
    assert capability["copyProtocol"] == "raw-image/v1"
    assert capability["copyRevision"] == "niceeval-docker-profile-host/raw-image-copy-reuuid/v2"
    assert capability["filesystemSizeBytes"] == 1024**3
    assert capability["filesystemFeatures"] == [
        "ext4", "fixed-size", "fully-allocated", "independent-image",
    ]
    assert capability["providerIdentity"].startswith("sha256:")
    assert capability["executionDomain"].startswith("sha256:")
    assert snapshot["backend"]["filesystem"]["dockerDataPool"]["attestation"] \
        == "independent-fixed-filesystem/v1"

    try:
        generator.build_descriptor({
            **snapshot_host,
            "setupPrefix": {
                **snapshot_host["setupPrefix"],
                "filesystemIdentity": "self-reported-not-the-image-root",
            },
        })
    except SystemExit as error:
        assert "actual imageRootPath filesystem" in str(error)
    else:
        raise AssertionError("setup-prefix filesystem identity must be measured, not self-reported")

    try:
        generator.build_descriptor({
            **snapshot_host,
            "setupPrefix": {**snapshot_host["setupPrefix"], "requiredState": "all"},
        })
    except SystemExit as error:
        assert "requiredState" in str(error)
    else:
        raise AssertionError("generic all-state capability must never be published")

    for field, legacy in (
        ("recoveryRevision", "no-guess-scrub-or-quarantine/v2"),
        ("manifestSchema", "niceeval-docker-profile-activation/v2"),
    ):
        try:
            generator.build_descriptor({
                **snapshot_host,
                "setupPrefix": {**snapshot_host["setupPrefix"], field: legacy},
            })
        except SystemExit as error:
            assert field in str(error)
        else:
            raise AssertionError(f"legacy {field} must fail closed")

    try:
        generator.build_descriptor({
            **snapshot_host,
            "storage": {"size": "4G", "backing": "loop-ext4",
                        "slotAttestation": "independent-fixed-filesystem/v1"},
        })
    except SystemExit as error:
        assert "fixed-image-ext4" in str(error)
    else:
        raise AssertionError("shared loop-ext4 must never publish setup-prefix capability")
    generator.Path.is_socket = original_is_socket

print("descriptor-modes-smoke ok")
