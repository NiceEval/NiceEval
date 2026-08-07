#!/usr/bin/env python3
"""Offline protocol/journal smoke for the host watchdog."""
from __future__ import annotations

import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
MODULE = ROOT / "packaging/docker-profile-host/scripts/watchdog.py"
spec = importlib.util.spec_from_file_location("niceeval_watchdog", MODULE)
assert spec is not None and spec.loader is not None
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


def fake_docker(self, *args: str, check: bool = True):
    if args[:2] == ("info", "--format"):
        output = json.dumps({"ID": "offline-daemon"}) + "\n"
    else:
        output = ""
    return subprocess.CompletedProcess(args, 0, output, "")


watchdog.Admission._docker = fake_docker

with tempfile.TemporaryDirectory(prefix="niceeval-watchdog-") as raw:
    root = Path(raw)
    docker_socket = root / "docker.sock"
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(docker_socket))
    descriptor = {
        "profileId": "profile-test",
        "transport": {"hostMachineIdentity": "host-test"},
        "backend": {"machineIdentity": "host-test"},
        "capacity": {
            "cpus": 4,
            "memoryBytes": 1024,
            "pids": 32,
            "maxContainers": 1,
            "maxBuilds": 1,
        },
    }
    descriptor_path = root / "default.json"
    descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
    journal = root / "events.ndjson"
    admission = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5)
    challenge = admission.handle({"kind": "challenge", "clientNonce": "nonce"})
    assert challenge["clientNonce"] == "nonce"
    assert challenge["descriptorDigest"].startswith("sha256:")
    created = admission.handle({
        "kind": "lease.create",
        "profileId": "profile-test",
        "daemonGeneration": challenge["daemonGeneration"],
        "invocationId": "invocation-a",
    })
    token = created["leaseToken"]
    common = {"invocationId": "invocation-a", "leaseToken": token}
    first = admission.handle({
        **common,
        "kind": "reservation.acquire",
        "reservationId": "reservation-a",
        "reservationKind": "container",
        "resources": {"cpus": 4, "memoryBytes": 1024, "pids": 32, "containers": 1},
    })
    assert first["state"] == "granted"
    admission.handle({
        **common,
        "kind": "reservation.commit",
        "reservationId": "reservation-a",
        "containerId": "container-a",
        "networkId": "network-a",
    })
    admission.handle({**common, "kind": "reservation.release", "reservationId": "reservation-a"})
    admission.handle({**common, "kind": "lease.drain"})
    assert admission.state["leases"]["invocation-a"]["state"] == "recovered"
    contents = journal.read_text(encoding="utf-8")
    assert token not in contents
    restarted = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5)
    assert restarted.state["leases"]["invocation-a"]["state"] == "recovered"
    sock.close()

print("watchdog-smoke ok")
