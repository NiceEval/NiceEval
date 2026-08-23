#!/usr/bin/env python3
"""Offline protocol/journal smoke for the host watchdog."""
from __future__ import annotations

import importlib.util
import io
import json
import os
import copy
import subprocess
import sys
import tarfile
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
    elif args[:2] == ("buildx", "create"):
        name = args[args.index("--name") + 1]
        self.__dict__["fake_builder"] = name
        self.__dict__["fake_builder_container"] = "builder-container-a"
        self.__dict__["fake_builder_volume"] = f"buildx_buildkit_{name}0_state"
        output = name + "\n"
    elif args[:2] == ("buildx", "inspect"):
        name = args[-1]
        code = 0 if self.__dict__.get("fake_builder") == name else 1
        result = subprocess.CompletedProcess(args, code, "", "")
        if check and code != 0:
            raise subprocess.CalledProcessError(code, args)
        return result
    elif args[:2] == ("buildx", "rm"):
        self.__dict__.pop("fake_builder", None)
        if not self.__dict__.get("fake_builder_rm_leaves_container"):
            self.__dict__.pop("fake_builder_container", None)
        if not self.__dict__.get("fake_builder_rm_leaves_volume"):
            self.__dict__.pop("fake_builder_volume", None)
        output = ""
    elif args[:2] == ("image", "inspect") and args[-1] in watchdog.REQUIRED_ASSETS:
        output = "linux/amd64\n"
    elif args[:2] == ("image", "inspect"):
        images = self.__dict__.setdefault("fake_images", set())
        reference = args[-1]
        code = 0 if reference in images else 1
        output = ""
        if code == 0 and "--format" in args:
            image_ids = self.__dict__.setdefault("fake_image_ids", {})
            image_labels = self.__dict__.setdefault("fake_image_labels", {})
            format_value = args[args.index("--format") + 1]
            if format_value == "{{.Id}}":
                output = image_ids[reference] + "\n"
            elif "niceeval.operation-id" in format_value:
                output = image_labels[reference] + "\n"
        result = subprocess.CompletedProcess(args, code, output, "")
        if check and code != 0:
            raise subprocess.CalledProcessError(code, args)
        return result
    elif args[:2] == ("image", "rm"):
        reference = args[-1]
        self.__dict__.setdefault("fake_images", set()).discard(reference)
        self.__dict__.setdefault("fake_image_ids", {}).pop(reference, None)
        self.__dict__.setdefault("fake_image_labels", {}).pop(reference, None)
        output = ""
    elif args[:1] == ("tag",):
        images = self.__dict__.setdefault("fake_images", set())
        if args[1] not in images:
            raise subprocess.CalledProcessError(1, args, stderr="source image missing")
        images.add(args[2])
        self.__dict__.setdefault("fake_image_ids", {})[args[2]] = self.fake_image_ids[args[1]]
        self.__dict__.setdefault("fake_image_labels", {})[args[2]] = self.fake_image_labels[args[1]]
        output = ""
    elif args[:1] == ("create",):
        self.__dict__["fake_container"] = "container-a"
        if self.__dict__.pop("fake_ambiguous_create", False):
            raise subprocess.TimeoutExpired(args, 30)
        output = "container-a\n"
    elif args[:2] == ("ps", "-aq") and any(
        str(item).startswith("name=^/buildx_buildkit_") for item in args
    ):
        output = self.__dict__.get("fake_builder_container", "") + "\n"
    elif args[:2] == ("ps", "-aq") and self.__dict__.get("fake_query_failure"):
        return subprocess.CompletedProcess(args, 1, "", "daemon unavailable")
    elif args[:2] == ("volume", "ls") and self.__dict__.get("fake_query_failure"):
        return subprocess.CompletedProcess(args, 1, "", "daemon unavailable")
    elif args[:2] == ("volume", "ls"):
        output = self.__dict__.get("fake_builder_volume", "") + "\n"
    elif args[:3] == ("network", "ls", "-q") and self.__dict__.get("fake_query_failure"):
        return subprocess.CompletedProcess(args, 1, "", "daemon unavailable")
    elif args[:2] == ("ps", "-aq"):
        output = self.__dict__.get("fake_container", "") + "\n"
    elif args[:3] == ("network", "ls", "-q"):
        output = self.__dict__.get("fake_network", "") + "\n"
    elif args[:2] == ("rm", "-f"):
        if args[2] == self.__dict__.get("fake_builder_container"):
            self.__dict__.pop("fake_builder_container", None)
        else:
            self.__dict__.pop("fake_container", None)
        output = ""
    elif args[:2] == ("volume", "rm"):
        if args[-1] == self.__dict__.get("fake_builder_volume"):
            self.__dict__.pop("fake_builder_volume", None)
        output = ""
    elif args[:2] == ("network", "rm"):
        self.__dict__.pop("fake_network", None)
        output = ""
    else:
        output = ""
    return subprocess.CompletedProcess(args, 0, output, "")


def fake_run_build(self, reservation, spec, context_path):
    self.__dict__["fake_build_runs"] = self.__dict__.get("fake_build_runs", 0) + 1
    with tarfile.open(context_path, "r:*") as archive:
        assert archive.extractfile("Dockerfile").read() == b"FROM scratch\n"
    provisional = reservation["provisionalRef"]
    self.__dict__.setdefault("fake_images", set()).add(provisional)
    self.__dict__.setdefault("fake_image_ids", {})[provisional] = "sha256:" + "1" * 64
    self.__dict__.setdefault("fake_image_labels", {})[provisional] = reservation["operationId"]


def tar_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, kind, contents in entries:
            item = tarfile.TarInfo(name)
            if kind == "file":
                item.size = len(contents)
                archive.addfile(item, io.BytesIO(contents))
            else:
                item.type = tarfile.SYMTYPE
                item.linkname = contents.decode()
                archive.addfile(item)
    return output.getvalue()


class FakeActiveProcess:
    def __init__(self):
        self.running = True

    def poll(self):
        return None if self.running else 0

    def terminate(self):
        self.running = False

    def kill(self):
        self.running = False

    def wait(self, timeout=None):
        self.running = False
        return 0


watchdog.Admission._docker = fake_docker
watchdog.Admission._run_build = fake_run_build
watchdog.Admission._builder_process_facts = lambda self, container_ids: []
watchdog.Admission._slot_references = lambda self, slot: []
watchdog.Admission._slot_facts = lambda self, slot: {
    "projectId": slot["projectId"], "usageBytes": slot["baselineUsageBytes"],
    "hardBytes": slot["limitBytes"], "uid": slot["ownerUid"],
    "gid": slot["ownerGid"], "mode": slot["mode"],
}

framed_output = io.BytesIO()
assert watchdog.receive_framed_build_context(
    io.BytesIO((4).to_bytes(4, "big") + b"test" + (0).to_bytes(4, "big")),
    framed_output,
) == 4
assert framed_output.getvalue() == b"test"
try:
    watchdog.receive_framed_build_context(
        io.BytesIO((watchdog.MAX_BUILD_CONTEXT_CHUNK_BYTES + 1).to_bytes(4, "big")),
        io.BytesIO(),
    )
except watchdog.ProtocolError as error:
    assert error.code == "build-context-frame-too-large"
else:
    raise AssertionError("oversized build-context frames must fail before allocation")
original_context_limit = watchdog.MAX_BUILD_CONTEXT_BYTES
watchdog.MAX_BUILD_CONTEXT_BYTES = 8
try:
    watchdog.receive_framed_build_context(
        io.BytesIO((5).to_bytes(4, "big") + b"first" + (5).to_bytes(4, "big") + b"again"),
        io.BytesIO(),
    )
except watchdog.ProtocolError as error:
    assert error.code == "build-context-too-large"
else:
    raise AssertionError("cumulative received build-context bytes must be capped")
finally:
    watchdog.MAX_BUILD_CONTEXT_BYTES = original_context_limit

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
    asset_manifest = root / "assets-v1.json"
    asset_manifest.write_text(json.dumps({"schemaVersion": 1, "platform": "linux/amd64", "images": [
        {"reference": reference, "platform": "linux/amd64"}
        for reference in watchdog.REQUIRED_ASSETS
    ]}), encoding="utf-8")
    host_config = root / "default.host.json"
    host_config.write_text(json.dumps({
        "storage": {"slotRegistryPath": str(slot_registry), "slotRootPath": str(slot_root)},
        "assets": {"manifestPath": str(asset_manifest)},
    }), encoding="utf-8")
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
    # A failed fsync cannot publish a heartbeat mutation in memory or after a
    # restart.  This exercises the normal handle() transition scope.
    published_before_fsync_failure = copy.deepcopy(admission._published_state)
    original_fsync = watchdog.os.fsync
    watchdog.os.fsync = lambda _fd: (_ for _ in ()).throw(OSError("injected fsync failure"))
    try:
        admission.handle({**common, "kind": "lease.heartbeat"})
    except OSError:
        pass
    else:
        raise AssertionError("injected journal fsync failure must reject the transition")
    finally:
        watchdog.os.fsync = original_fsync
    assert admission._published_state == published_before_fsync_failure
    restarted_after_fsync_failure = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    assert restarted_after_fsync_failure._published_state == published_before_fsync_failure
    # A diagnostic request is capability-free: any client-selected image,
    # command, environment, mount, tag or label is rejected before Docker I/O.
    for forbidden in ("image", "command", "environment", "mounts", "tag", "labels"):
        try:
            admission._validate_create({"intent": "diagnostic", forbidden: "client-controlled"})
        except watchdog.ProtocolError as error:
            assert error.code == "container-create-diagnostic-client-input"
        else:
            raise AssertionError("diagnostic intent must reject every client-controlled create field")
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
    # FIFO head timeouts are durably blocked and removed before the same-lock
    # grant pass can consider later work.
    with admission._transition():
        admission.state["reservations"]["reservation-b"]["createdAt"] = "2000-01-01T00:00:00Z"
        admission._commit("fixture-queue-timeout", {"reservationId": "reservation-b"})
    assert admission.handle({**common_b, "kind": "reservation.get", "reservationId": "reservation-b"})["state"] == "blocked"
    assert "reservation-b" not in admission.state["queue"]
    # Cancelling the timed-out head removes its durable blocked reservation and
    # runs the next FIFO grant pass under the same control lock.
    assert admission.handle({**common_b, "kind": "reservation.cancel",
        "reservationId": "reservation-b"}) == {"cancelled": True}
    assert "reservation-b" not in admission.state["reservations"]

    # Clients cannot smuggle host paths or Docker HostConfig through control.
    for create in (
        {"image": "image:test", "attemptId": "attempt-a", "mounts": [{"source": "/host"}]},
        {"image": "image:test", "attemptId": "attempt-a", "hostConfig": {"Binds": ["/host:/x"]}},
    ):
        try:
            admission.handle({**common, "kind": "container.create", "reservationId": "reservation-a", "create": {"intent": "workload", "create": create}})
        except watchdog.ProtocolError as error:
            assert error.code == "container-create-host-input"
        else:
            raise AssertionError("host path input must fail closed")

    try:
        admission.handle({**common, "kind": "container.create", "reservationId": "reservation-a", "create": {"intent": "workload", "create": {
            "image": "image:test", "attemptId": "attempt-a",
            "tmpfs": {"/var/lib/docker/cache": "rw,size=16m"},
        }}})
    except watchdog.ProtocolError as error:
        assert error.code == "container-create-invalid"
    else:
        raise AssertionError("Docker data-root descendants must not be client tmpfs")

    # A timeout after daemon acceptance is reconciled by the full provision-token labels.
    admission.fake_ambiguous_create = True
    create_a = {
        "image": "image:test", "attemptId": "attempt-a", "command": ["true"],
        "tmpfs": {
            "/tmp": "rw,nosuid,nodev,size=16m",
            "/root": "rw,nosuid,nodev,size=8m",
            "/opt/fixture-secrets": "rw,nosuid,nodev,size=8m",
        },
    }
    created_container = admission.handle({**common, "kind": "container.create",
        "reservationId": "reservation-a", "create": {"intent": "workload", "create": create_a}})
    assert created_container == {"containerId": "container-a", "networkId": "network-a", "state": "active"}
    assert admission.handle({**common, "kind": "container.create",
        "reservationId": "reservation-a", "create": {"intent": "workload", "create": create_a}}) == created_container
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
        "create": {"intent": "workload", "create": {"image": "image:test", "attemptId": "attempt-c"}}})
    (slot_path / "orphaned").write_text("data", encoding="utf-8")
    restarted.fake_query_failure = True
    assert restarted.handle({**common_c, "kind": "lease.drain"}) == {"state": "draining"}
    assert "reservation-c" in restarted.state["reservations"]
    assert restarted.state["slots"]["slot-0000"]["state"] == "active"
    assert any(item.startswith("recovery blocked for reservation-c:")
               for item in restarted.state["degraded"])
    assert restarted.state["admissionOpen"] is False
    restarted.fake_query_failure = False
    restarted._recover_once()
    assert restarted.state["leases"]["invocation-c"]["state"] == "recovered"
    assert not any(item.startswith("recovery blocked for reservation-c:")
                   for item in restarted.state["degraded"])
    assert restarted.state["slots"]["slot-0000"]["generation"] == 2
    assert list(slot_path.iterdir()) == []
    assert restarted.state["admissionOpen"] is True

    # Build context and all daemon lifecycle operations are control-owned. The
    # client supplies no network ID, builder name, tag, or termination booleans.
    lease_build = restarted.handle({"kind": "lease.create", "profileId": "profile-test",
        "daemonGeneration": challenge["daemonGeneration"], "invocationId": "invocation-build"})
    common_build = {"invocationId": "invocation-build", "leaseToken": lease_build["leaseToken"]}
    restarted.handle({**common_build, "kind": "reservation.acquire",
        "reservationId": "reservation-build", "reservationKind": "build",
        "resources": {"cpus": 0, "memoryBytes": 0, "pids": 0, "containers": 0,
                      "ephemeralDiskBytes": 0}})
    build_key = "a" * 64
    context_path = root / "context.tar"
    context_path.write_bytes(tar_bytes([("Dockerfile", "file", b"FROM scratch\n")]))
    build_request = {**common_build, "kind": "build.create",
        "reservationId": "reservation-build", "contextEncoding": "tar-chunked/v1",
        "build": {"buildKey": build_key, "platform": "linux/amd64",
                  "dockerfile": "Dockerfile", "buildArgs": {}}}
    for invalid_name, invalid_context, expected_code in (
        ("escape", [("Dockerfile", "file", b"FROM scratch\n"),
                    ("../escape", "file", b"host")], "build-context-path-forbidden"),
        ("symlink", [("Dockerfile", "file", b"FROM scratch\n"),
                     ("link", "symlink", b"/etc/passwd")], "build-context-type-forbidden"),
    ):
        invalid_path = root / f"context-{invalid_name}.tar"
        invalid_path.write_bytes(tar_bytes(invalid_context))
        try:
            restarted.handle_build(build_request, invalid_path)
        except watchdog.ProtocolError as error:
            assert error.code == expected_code
        else:
            raise AssertionError("untrusted tar paths/types must fail before Docker sees the context")

    ephemeral_build_request = copy.deepcopy(build_request)
    ephemeral_build_request["build"]["retention"] = "ephemeral"
    restarted.fake_builder_rm_leaves_container = True
    restarted.fake_builder_rm_leaves_volume = True
    built = restarted.handle_build(ephemeral_build_request, context_path)
    assert built == {"locator": "niceeval-build:" + build_key[:32], "state": "terminated"}
    assert restarted.fake_build_runs == 1
    assert restarted.handle_build(ephemeral_build_request, context_path) == built
    assert restarted.fake_build_runs == 1
    assert restarted.__dict__.get("fake_builder_container") is None
    assert restarted.__dict__.get("fake_builder_volume") is None
    assert any(argv[:3] == ("rm", "-f", "builder-container-a") for argv in restarted.fake_commands)
    builder_name = restarted.state["reservations"]["reservation-build"]["builderName"]
    assert any(argv == ("volume", "rm", "-f",
        f"buildx_buildkit_{builder_name}0_state")
        for argv in restarted.fake_commands)
    assert restarted.handle({"kind": "build.lookup", "profileId": "profile-test",
        "daemonGeneration": challenge["daemonGeneration"], "buildKey": build_key}) == {
            "hit": True, "locator": built["locator"],
        }
    try:
        restarted.handle({**common_build, "kind": "reservation.release",
            "reservationId": "reservation-build", "terminationEvidence": {
                "daemonRequestTerminated": True,
            }})
    except watchdog.ProtocolError as error:
        assert error.code == "build-release-client-evidence-forbidden"
    else:
        raise AssertionError("client-supplied build termination evidence must be rejected")
    published_build = restarted._published_state["reservations"]["reservation-build"]
    assert published_build["retention"] == "ephemeral"
    assert published_build["locatorImageId"] == "sha256:" + "1" * 64
    restart_probe = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    journaled_build = restart_probe.state["reservations"]["reservation-build"]
    assert journaled_build["retention"] == "ephemeral"
    assert journaled_build["locatorImageId"] == "sha256:" + "1" * 64
    assert restarted.handle({**common_build, "kind": "reservation.release",
        "reservationId": "reservation-build"}) == {"released": True, "cleanupProven": True}
    assert built["locator"] not in restarted.fake_images
    build_events = [json.loads(line)["event"] for line in journal.read_text(encoding="utf-8").splitlines()]
    assert build_events.index("build-create-intent") < build_events.index("build-network-created")
    assert build_events.index("build-network-created") < build_events.index("build-builder-created")
    assert build_events.index("build-builder-created") < build_events.index("build-terminated")
    assert "build-create-replayed" in build_events

    # build.cancel terminates the in-memory process. A same-generation watchdog
    # restart then cancels any journaled provisioning operation before reopening
    # admission, even while its lease is still active.
    restarted.handle({**common_build, "kind": "reservation.acquire",
        "reservationId": "reservation-cancel", "reservationKind": "build",
        "resources": {"cpus": 0, "memoryBytes": 0, "pids": 0, "containers": 0,
                      "ephemeralDiskBytes": 0}})
    cancel_reservation = restarted.state["reservations"]["reservation-cancel"]
    cancel_reservation.update({
        "state": "provisioning",
        "builderName": "niceeval-build-0123456789abcdef01234567",
        "provisionalRef": "niceeval-build-provisional:cancel",
        "locator": "niceeval-build:" + "b" * 32,
    })
    active_process = FakeActiveProcess()
    restarted.build_processes["reservation-cancel"] = active_process
    restarted._commit("fixture-build-provisioning", {"reservationId": "reservation-cancel"})
    assert restarted.handle({**common_build, "kind": "build.cancel",
        "reservationId": "reservation-cancel"}) == {"cancelRequested": True}
    assert active_process.poll() == 0
    restarted = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    recovered_build = restarted.state["reservations"]["reservation-cancel"]
    assert recovered_build["state"] == "committed"
    assert recovered_build["buildTerminated"] is True
    assert "watchdog restarted" in recovered_build["buildError"]
    assert restarted.state["admissionOpen"] is True
    assert restarted.handle({**common_build, "kind": "reservation.release",
        "reservationId": "reservation-cancel"}) == {"released": True}
    assert restarted.handle({**common_build, "kind": "lease.drain"}) == {"state": "recovered"}
    assert restarted.state["leases"]["invocation-build"]["state"] == "recovered"

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

    # Missing fixed assets fail closed at watchdog startup; status exposes the
    # attested absence rather than attempting a runtime pull.
    assets_host_config = root / "assets-missing.host.json"
    assets_host_config.write_text(json.dumps({"storage": {
        "slotRegistryPath": str(slot_registry), "slotRootPath": str(slot_root),
    }}), encoding="utf-8")
    assets_closed = watchdog.Admission(
        descriptor_path, root / "assets-events.ndjson", str(docker_socket), 5, assets_host_config,
    )
    assert assets_closed.state["admissionOpen"] is False
    assert assets_closed.handle({"kind": "status"})["assets"]["state"] == "missing"

    # A journal may never silently discard a corrupt or unterminated tail.
    for name, contents in (("corrupt", "not-json\n"), ("truncated", '{"state":{}')):
        broken = root / f"{name}.ndjson"
        broken.write_text(contents, encoding="utf-8")
        try:
            watchdog.Admission(descriptor_path, broken, str(docker_socket), 5, host_config)
        except RuntimeError as error:
            assert "fails closed" in str(error)
        else:
            raise AssertionError(f"{name} journal must fail closed")

print("watchdog-smoke ok")
subprocess.run(["pnpm", "exec", "tsx", "test/host/docker-profile-public-smoke.ts"], cwd=ROOT, check=True)
