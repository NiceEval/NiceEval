#!/usr/bin/env python3
"""Offline protocol/journal smoke for the host watchdog."""
from __future__ import annotations

import importlib.util
import json
import os
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
    commands = self.__dict__.setdefault("fake_commands", [])
    commands.append(args)
    if args[:2] == ("info", "--format"):
        output = json.dumps({"ID": "offline-daemon"}) + "\n"
    elif args[:2] == ("network", "create"):
        self.__dict__["fake_network"] = "network-a"
        output = "network-a\n"
    elif args[:1] == ("create",):
        self.__dict__["fake_container"] = "container-a"
        if self.__dict__.pop("fake_ambiguous_create", False):
            raise subprocess.TimeoutExpired(args, 30)
        output = "container-a\n"
    elif args[:2] == ("ps", "-aq") and self.__dict__.get("fake_query_failure"):
        return subprocess.CompletedProcess(args, 1, "", "daemon unavailable")
    elif args[:3] == ("network", "ls", "-q") and self.__dict__.get("fake_query_failure"):
        return subprocess.CompletedProcess(args, 1, "", "daemon unavailable")
    elif args[:2] == ("ps", "-aq"):
        output = self.__dict__.get("fake_container", "") + "\n"
    elif args[:3] == ("network", "ls", "-q"):
        output = self.__dict__.get("fake_network", "") + "\n"
    elif args[:2] == ("rm", "-f"):
        self.__dict__.pop("fake_container", None)
        output = ""
    elif args[:2] == ("network", "rm"):
        self.__dict__.pop("fake_network", None)
        output = ""
    else:
        output = ""
    return subprocess.CompletedProcess(args, 0, output, "")


watchdog.Admission._docker = fake_docker
watchdog.Admission._slot_references = lambda self, slot: []
watchdog.Admission._slot_facts = lambda self, slot: {
    "projectId": slot["projectId"], "usageBytes": slot["baselineUsageBytes"],
    "hardBytes": slot["limitBytes"], "uid": slot["ownerUid"],
    "gid": slot["ownerGid"], "mode": slot["mode"],
}

with tempfile.TemporaryDirectory(prefix="niceeval-watchdog-") as raw:
    root = Path(raw)
    docker_socket = root / "docker.sock"
    docker_socket.touch()
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
            "ephemeralDiskBytes": 512,
            "dockerDataAllocationCount": 1,
        },
    }
    slot_root = root / "slots"
    slot_root.mkdir()
    slot_path = slot_root / "slot-0000"
    slot_path.mkdir()
    slot_registry = root / "quota-slots.json"
    slot_registry.write_text(json.dumps({"schemaVersion": 1, "slots": [{
        "slotId": "slot-0000", "projectId": 20000, "path": str(slot_path),
        "limitBytes": 512, "baselineUsageBytes": 0, "ownerUid": os.getuid(),
        "ownerGid": os.getgid(), "mode": 0o700, "generation": 0, "state": "free",
    }]}), encoding="utf-8")
    descriptor["backend"]["filesystem"] = {"dockerDataPool": {
        "count": 1, "bytesPerAllocation": 512, "attestation": "linux-project-quota/v1",
    }}
    host_config = root / "default.host.json"
    host_config.write_text(json.dumps({"storage": {
        "slotRegistryPath": str(slot_registry), "slotRootPath": str(slot_root),
    }}), encoding="utf-8")
    descriptor_path = root / "default.json"
    descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
    journal = root / "events.ndjson"
    admission = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
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
    for reservation_id, resources in (
        ("invalid-nan", {"cpus": float("nan"), "memoryBytes": 1, "pids": 1,
                         "containers": 1, "ephemeralDiskBytes": 1}),
        ("invalid-count", {"cpus": 1, "memoryBytes": 1, "pids": 1,
                           "containers": 0, "ephemeralDiskBytes": 1}),
        ("invalid-allocation-size", {"cpus": 1, "memoryBytes": 1, "pids": 1,
                                     "containers": 1, "ephemeralDiskBytes": 513}),
    ):
        try:
            admission.handle({**common, "kind": "reservation.acquire",
                "reservationId": reservation_id, "reservationKind": "container",
                "resources": resources})
        except watchdog.ProtocolError as error:
            assert error.code in ("reservation-invalid", "reservation-exceeds-capacity")
        else:
            raise AssertionError("invalid resource vectors must fail closed")
    first = admission.handle({
        **common,
        "kind": "reservation.acquire",
        "reservationId": "reservation-a",
        "reservationKind": "container",
        "resources": {"cpus": 4, "memoryBytes": 1024, "pids": 32, "containers": 1,
                      "ephemeralDiskBytes": 512},
    })
    assert first["state"] == "granted"
    assert first["slotId"] == "slot-0000"

    # The sole disk slot is charged, so a second lease queues instead of overselling.
    second_lease = admission.handle({"kind": "lease.create", "profileId": "profile-test",
        "daemonGeneration": challenge["daemonGeneration"], "invocationId": "invocation-b"})
    common_b = {"invocationId": "invocation-b", "leaseToken": second_lease["leaseToken"]}
    queued = admission.handle({**common_b, "kind": "reservation.acquire",
        "reservationId": "reservation-b", "reservationKind": "container",
        "resources": {"cpus": 1, "memoryBytes": 1, "pids": 1, "containers": 1,
                      "ephemeralDiskBytes": 1}})
    assert queued["state"] == "queued"
    assert admission.handle({**common_b, "kind": "reservation.cancel",
        "reservationId": "reservation-b"}) == {"cancelled": True}
    assert "reservation-b" not in admission.state["reservations"]

    # Clients cannot smuggle host paths or Docker HostConfig through control.
    for create in (
        {"image": "image:test", "attemptId": "attempt-a", "mounts": [{"source": "/host"}]},
        {"image": "image:test", "attemptId": "attempt-a", "hostConfig": {"Binds": ["/host:/x"]}},
    ):
        try:
            admission.handle({**common, "kind": "container.create", "reservationId": "reservation-a", "create": create})
        except watchdog.ProtocolError as error:
            assert error.code == "container-create-host-input"
        else:
            raise AssertionError("host path input must fail closed")

    try:
        admission.handle({**common, "kind": "container.create", "reservationId": "reservation-a", "create": {
            "image": "image:test", "attemptId": "attempt-a",
            "tmpfs": {"/var/lib/docker/cache": "rw,size=16m"},
        }})
    except watchdog.ProtocolError as error:
        assert error.code == "container-create-invalid"
    else:
        raise AssertionError("Docker data-root descendants must not be client tmpfs")

    # A timeout after daemon acceptance is reconciled by the full provision-token labels.
    admission.fake_ambiguous_create = True
    created_container = admission.handle({**common, "kind": "container.create",
        "reservationId": "reservation-a", "create": {
            "image": "image:test", "attemptId": "attempt-a", "command": ["true"],
            "tmpfs": {
                "/tmp": "rw,nosuid,nodev,size=16m",
                "/root": "rw,nosuid,nodev,size=8m",
                "/opt/fixture-secrets": "rw,nosuid,nodev,size=8m",
            },
        }})
    assert created_container == {"containerId": "container-a", "networkId": "network-a", "state": "active"}
    create_argv = next(argv for argv in admission.fake_commands if argv[:1] == ("create",))
    assert "--privileged" in create_argv
    mount = create_argv[create_argv.index("--mount") + 1]
    assert mount == f"type=bind,src={slot_path},dst=/var/lib/docker,bind-propagation=rprivate"
    for label in watchdog.LABELS.values():
        assert any(part.startswith(label + "=") for part in create_argv)

    admission.fake_query_failure = True
    try:
        admission._destroy(admission.state["reservations"]["reservation-a"])
    except RuntimeError as error:
        assert "refusing to infer absence" in str(error)
    else:
        raise AssertionError("Docker query failure must not prove resource absence")
    admission.fake_query_failure = False

    outside = root / "outside-sentinel"
    outside.write_text("preserve", encoding="utf-8")
    (slot_path / "docker-metadata").write_text("used", encoding="utf-8")
    (slot_path / "untrusted-link").symlink_to(outside)
    slot_path.chmod(0o710)
    assert admission.handle({**common, "kind": "reservation.release", "reservationId": "reservation-a"}) == {"released": True}
    assert list(slot_path.iterdir()) == []
    assert outside.read_text(encoding="utf-8") == "preserve"
    assert admission.state["slots"]["slot-0000"]["generation"] == 1
    assert admission.handle({"kind": "status"})["availableQuotaSlots"] == 1
    admission.handle({**common, "kind": "lease.drain"})
    assert admission.state["leases"]["invocation-a"]["state"] == "recovered"
    contents = journal.read_text(encoding="utf-8")
    assert token not in contents
    events = [json.loads(line)["event"] for line in contents.splitlines()]
    assert events.index("container-create-intent") < events.index("container-network-create-intent")
    assert events.index("container-network-create-intent") < events.index("container-network-created")
    assert events.index("container-network-created") < events.index("container-created")
    restarted = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    assert restarted.state["slots"]["slot-0000"]["state"] == "free"
    assert restarted.handle({"kind": "status"})["availableQuotaSlots"] == 1

    # Lost/SIGKILL-equivalent lease recovery destroys, scrubs, and reuses safely.
    lease_c = restarted.handle({"kind": "lease.create", "profileId": "profile-test",
        "daemonGeneration": challenge["daemonGeneration"], "invocationId": "invocation-c"})
    common_c = {"invocationId": "invocation-c", "leaseToken": lease_c["leaseToken"]}
    restarted.handle({**common_c, "kind": "reservation.acquire", "reservationId": "reservation-c",
        "reservationKind": "container", "resources": {"cpus": 1, "memoryBytes": 1, "pids": 1,
        "containers": 1, "ephemeralDiskBytes": 1}})
    restarted.handle({**common_c, "kind": "container.create", "reservationId": "reservation-c",
        "create": {"image": "image:test", "attemptId": "attempt-c"}})
    (slot_path / "orphaned").write_text("data", encoding="utf-8")
    restarted.fake_query_failure = True
    assert restarted.handle({**common_c, "kind": "lease.drain"}) == {"state": "draining"}
    assert "reservation-c" in restarted.state["reservations"]
    assert restarted.state["slots"]["slot-0000"]["state"] == "active"
    assert any(item.startswith("recovery blocked for reservation-c:")
               for item in restarted.state["degraded"])
    restarted.fake_query_failure = False
    restarted._recover_once()
    assert restarted.state["leases"]["invocation-c"]["state"] == "recovered"
    assert not any(item.startswith("recovery blocked for reservation-c:")
                   for item in restarted.state["degraded"])
    assert restarted.state["slots"]["slot-0000"]["generation"] == 2
    assert list(slot_path.iterdir()) == []

    # Any uncertain activity quarantines durably and replay never re-grants it.
    lease_d = restarted.handle({"kind": "lease.create", "profileId": "profile-test",
        "daemonGeneration": challenge["daemonGeneration"], "invocationId": "invocation-d"})
    common_d = {"invocationId": "invocation-d", "leaseToken": lease_d["leaseToken"]}
    restarted.handle({**common_d, "kind": "reservation.acquire", "reservationId": "reservation-d",
        "reservationKind": "container", "resources": {"cpus": 1, "memoryBytes": 1, "pids": 1,
        "containers": 1, "ephemeralDiskBytes": 1}})
    restarted._slot_references = lambda slot: ["pid:123:fd"]
    try:
        restarted.handle({**common_d, "kind": "reservation.release", "reservationId": "reservation-d"})
    except watchdog.ProtocolError as error:
        assert error.code == "slot-quarantined"
    else:
        raise AssertionError("uncertain references must quarantine")
    replayed = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    assert replayed.state["slots"]["slot-0000"]["state"] == "quarantined"
    assert replayed.handle({"kind": "status"})["availableQuotaSlots"] == 0

print("watchdog-smoke ok")
