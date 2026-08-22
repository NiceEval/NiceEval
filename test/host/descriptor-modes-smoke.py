#!/usr/bin/env python3
"""Build both descriptor modes offline and check the public TS-compatible shape."""
from __future__ import annotations

import importlib.util
import json
import os
import pwd
import grp
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
        assert "dockerDataAllocationCount" not in desc["backend"]["filesystem"]
        assert "rootPath" not in json.dumps(desc) and "registryPath" not in json.dumps(desc)

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
    generator.Path.is_socket = original_is_socket

print("descriptor-modes-smoke ok")
