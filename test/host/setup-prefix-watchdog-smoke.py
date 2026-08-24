#!/usr/bin/env python3
"""Deterministic host-boundary smoke for dockerData-only snapshot transactions."""
from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "packaging/docker-profile-host/scripts/watchdog.py"
spec = importlib.util.spec_from_file_location("niceeval_setup_prefix_watchdog", MODULE)
assert spec and spec.loader
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)

def allocate_image(path: Path, size: int) -> None:
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_EXCL, 0o600)
    try:
        os.posix_fallocate(fd, 0, size)
        os.fsync(fd)
    finally:
        os.close(fd)


def tree_usage_bytes(root: Path) -> int:
    total = 0
    charged = set()
    for current, _, files in os.walk(root):
        for name in files:
            info = (Path(current) / name).stat(follow_symlinks=False)
            identity = (info.st_dev, info.st_ino)
            if identity not in charged:
                total += info.st_size
                charged.add(identity)
    return total


def coordination_copy(self, source, target, operation_id):
    """Fake only the privileged image/mount boundary, not coordination."""
    source_path, target_path = Path(source["path"]), Path(target["path"])
    if os.listdir(target_path):
        raise RuntimeError("coordination target is dirty")
    subprocess.run(
        ["cp", "--archive", "--reflink=never", "--sparse=always", "--",
         str(source_path) + "/.", str(target_path)],
        check=True,
    )
    source_image, target_image = Path(source["imagePath"]), Path(target["imagePath"])
    temporary = self._temporary_clone_path(target_image, operation_id)
    subprocess.run(
        ["cp", "--sparse=always", "--reflink=never", "--",
         str(source_image), str(temporary)],
        check=True,
    )
    subprocess.run(["fallocate", "-l", str(target["limitBytes"]), "--", str(temporary)], check=True)
    subprocess.run(["sync", "-f", "--", str(temporary)], check=True)
    os.replace(temporary, target_image)
    return self._raw_image_digest(target_image)


def fake_docker(self, *args: str, check: bool = True):
    if args[:2] == ("info", "--format"):
        output = json.dumps({"ID": "setup-prefix-daemon"}) + "\n"
    elif args[:2] == ("image", "inspect") and args[-1] in watchdog.REQUIRED_ASSETS:
        output = "linux/amd64\n"
    elif args[:2] == ("ps", "-aq"):
        output = self.__dict__.get("fake_container", "") + "\n"
    elif args[:3] == ("network", "ls", "-q"):
        output = self.__dict__.get("fake_network", "") + "\n"
    elif args[:2] == ("inspect", "--format") and args[2] == "{{json .}}":
        output = json.dumps({
            "Image": self.__dict__.get("fake_base_identity", "sha256:" + "1" * 64),
            "State": {"Running": bool(self.__dict__.get("fake_running", False)),
                      "Pid": 123 if self.__dict__.get("fake_running", False) else 0},
        }) + "\n"
    else:
        output = ""
    return subprocess.CompletedProcess(args, 0, output, "")


def fake_slot_facts(self, slot):
    return {
        "projectId": int(slot.get("projectId", 0)),
        "usageBytes": tree_usage_bytes(Path(slot["path"])),
        "hardBytes": int(slot["limitBytes"]),
        "uid": int(slot["ownerUid"]),
        "gid": int(slot["ownerGid"]),
        "mode": int(slot["mode"]),
    }


watchdog.Admission._docker = fake_docker
watchdog.Admission._slot_facts = fake_slot_facts
watchdog.Admission._slot_references = lambda self, slot: (["pid:123:fd"]
    if self.__dict__.get("fake_busy", False) else [])


def expect_code(code: str, call) -> None:
    try:
        call()
    except watchdog.ProtocolError as error:
        assert error.code == code, (error.code, str(error))
    else:
        raise AssertionError(f"expected {code}")


def control_roundtrip(admission, path: Path, request: dict) -> dict:
    server = watchdog.Server(str(path), admission)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    worker.start()
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(str(path))
    client.sendall((json.dumps(request) + "\n").encode())
    response = b""
    while not response.endswith(b"\n"):
        response += client.recv(65536)
    client.close()
    server.shutdown()
    worker.join(timeout=10)
    server.server_close()
    path.unlink(missing_ok=True)
    return json.loads(response)


def control_drop_then_retry(admission, path: Path, request: dict) -> dict:
    os.environ["NICEEVAL_TEST_DROP_CAPTURE_PUBLISH_RESPONSE_ONCE"] = "1"
    server = watchdog.Server(str(path), admission)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    worker.start()
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(str(path)); client.sendall((json.dumps(request) + "\n").encode())
    assert client.recv(65536) == b""
    client.close(); server.shutdown(); worker.join(timeout=10); server.server_close()
    path.unlink(missing_ok=True)
    return control_roundtrip(admission, path, request)


with tempfile.TemporaryDirectory(prefix="niceeval-setup-prefix-") as raw:
    root = Path(raw)
    docker_socket = root / "docker.sock"
    docker_socket.touch()
    setup_root = root / "setup-prefix-fs"
    setup_root.mkdir()
    root_stat = root.stat()
    setup_identity = f"dev={root_stat.st_dev}:ino={root_stat.st_ino}"
    slot_root = root / "slots"
    slot_root.mkdir()
    slot_limit = 2 * 1024 * 1024
    slots = []
    fake_identities: dict[Path, str] = {}
    for index in range(8):
        path = slot_root / f"slot-{index:04d}"
        path.mkdir()
        image = root / f"slot-{index:04d}.ext4"
        allocate_image(image, slot_limit)
        slots.append({
            "slotId": path.name,
            "path": str(path),
            "imagePath": str(image),
            "attestation": "independent-fixed-filesystem/v1",
            "filesystemIdentity": f"ext4-uuid:00000000-0000-0000-0000-{index:012d}",
            "projectId": 0,
            "limitBytes": slot_limit,
            "baselineUsageBytes": 0,
            "ownerUid": os.getuid(),
            "ownerGid": os.getgid(),
            "mode": 0o700,
            "fsType": "ext4",
            "mountOptions": ["rw"],
            "generation": 0,
            "state": "free",
        })
        fake_identities[image] = slots[-1]["filesystemIdentity"]
    slot_registry = root / "slots.json"
    slot_registry.write_text(json.dumps({
        "schemaVersion": 1,
        "slotAttestation": "independent-fixed-filesystem/v1",
        "slots": slots,
    }), encoding="utf-8")
    asset_manifest = root / "assets-v1.json"
    asset_manifest.write_text(json.dumps({
        "schemaVersion": 1,
        "platform": "linux/amd64",
        "images": [{"reference": item, "platform": "linux/amd64"}
                   for item in watchdog.REQUIRED_ASSETS],
    }), encoding="utf-8")
    seed_path = setup_root / "seed-fullcopy01"
    seed_path.mkdir()
    seed_image = root / "seed-fullcopy01.ext4"
    allocate_image(seed_image, slot_limit)
    seed_registry = root / "setup-prefix-seeds.json"
    seed_registry.write_text(json.dumps({
        "schemaVersion": 1,
        "slotAttestation": "independent-fixed-filesystem/v1",
        "filesystemIdentity": setup_identity,
        "seeds": [{
            "seedId": "seed-fullcopy01",
            "path": str(seed_path),
            "imagePath": str(seed_image),
            "attestation": "independent-fixed-filesystem/v1",
            "filesystemIdentity": "ext4-uuid:10000000-0000-0000-0000-000000000001",
            "projectId": 0,
            "limitBytes": slot_limit,
            "baselineUsageBytes": 0,
            "ownerUid": os.getuid(),
            "ownerGid": os.getgid(),
            "mode": 0o700,
            "fsType": "ext4",
            "mountOptions": ["ro", "noload"],
        }],
    }), encoding="utf-8")
    fake_identities[seed_image] = "ext4-uuid:10000000-0000-0000-0000-000000000001"
    capability = {
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
        "recoveryRevision": "no-guess-scrub-or-quarantine/v2",
        "manifestSchema": "niceeval-docker-profile-activation/v2",
        "providerIdentity": "pending",
        "executionDomain": "pending",
        "filesystemSizeBytes": slot_limit,
        "filesystemFeatures": [
            "ext4", "fixed-size", "fully-allocated", "independent-image",
        ],
        "seedLimitBytes": slot_limit,
        "filesystemIdentity": setup_identity,
    }
    descriptor = {
        "profileId": "profile-snapshot",
        "securityLevel": "managed-rootless/v1",
        "semanticPolicyRevision": "policy-test",
        "transport": {"hostMachineIdentity": "host-test"},
        "backend": {
            "machineIdentity": "host-test",
            "filesystem": {
                "identity": "docker-data-pool:test",
                "mountPath": str(root),
                "dockerDataPool": {
                    "count": 8,
                    "bytesPerAllocation": slot_limit,
                    "attestation": "independent-fixed-filesystem/v1",
                },
                "setupPrefix": capability,
            },
        },
        "capacity": {
            "cpus": 8,
            "memoryBytes": 8192,
            "pids": 128,
            "maxContainers": 8,
            "maxBuilds": 1,
            "ephemeralDiskBytes": 8 * slot_limit,
        },
    }
    capability["providerIdentity"] = watchdog.canonical_digest({
        "schemaVersion": 1,
        "profileId": descriptor["profileId"],
        "securityLevel": descriptor["securityLevel"],
        "semanticPolicyRevision": descriptor["semanticPolicyRevision"],
        "hostMachineIdentity": descriptor["transport"]["hostMachineIdentity"],
        "backendMachineIdentity": descriptor["backend"]["machineIdentity"],
        "dockerDataFilesystemIdentity": descriptor["backend"]["filesystem"]["identity"],
        "dockerDataPool": descriptor["backend"]["filesystem"]["dockerDataPool"],
        "dockerDataSnapshot": {
            "protocol": capability["protocol"],
            "coverage": capability["coverage"],
            "requiredState": capability["requiredState"],
            "helperRevision": capability["helperRevision"],
            "copyProtocol": capability["copyProtocol"],
            "copyRevision": capability["copyRevision"],
            "quiesceRevision": capability["quiesceRevision"],
            "publicationRevision": capability["publicationRevision"],
            "recoveryRevision": capability["recoveryRevision"],
            "manifestSchema": capability["manifestSchema"],
            "slotAttestation": capability["slotAttestation"],
            "seedPolicy": capability["seedPolicy"],
            "filesystemSizeBytes": capability["filesystemSizeBytes"],
            "filesystemFeatures": capability["filesystemFeatures"],
        },
    })
    capability["executionDomain"] = watchdog.canonical_digest({
        "schemaVersion": 1,
        "profileId": descriptor["profileId"],
        "hostMachineIdentity": descriptor["transport"]["hostMachineIdentity"],
        "backendMachineIdentity": descriptor["backend"]["machineIdentity"],
        "dockerDataFilesystemIdentity": descriptor["backend"]["filesystem"]["identity"],
        "slotAttestation": capability["slotAttestation"],
    })
    descriptor_path = root / "profile.json"
    descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
    host_config = root / "profile.host.json"
    host_config.write_text(json.dumps({
        "storage": {
            "backing": "existing-mount",
            "slotAttestation": "independent-fixed-filesystem/v1",
            "slotRegistryPath": str(slot_registry),
            "slotRootPath": str(slot_root),
        },
        "assets": {"manifestPath": str(asset_manifest)},
        "setupPrefix": {
            "enabled": True,
            "protocol": capability["protocol"],
            "coverage": capability["coverage"],
            "requiredState": capability["requiredState"],
            "helperRevision": capability["helperRevision"],
            "copyProtocol": capability["copyProtocol"],
            "copyRevision": capability["copyRevision"],
            "quiesceRevision": capability["quiesceRevision"],
            "slotAttestation": capability["slotAttestation"],
            "seedPolicy": capability["seedPolicy"],
            "publicationRevision": capability["publicationRevision"],
            "recoveryRevision": capability["recoveryRevision"],
            "manifestSchema": capability["manifestSchema"],
            "seedRegistryPath": str(seed_registry),
            "imageRootPath": str(root),
            "copyStrategy": "raw-image/v1",
            "filesystemIdentity": setup_identity,
            "filesystemSizeBytes": "2M",
            "filesystemFeatures": capability["filesystemFeatures"],
            "filesystemLimitBytes": "64M",
            "seedLimitBytes": "2M",
        },
    }), encoding="utf-8")
    journal = root / "events.ndjson"

    # Only privileged raw-image/mount I/O is replaced at this deterministic
    # host boundary; descriptor, wire, lease, journal, recovery and ownership
    # checks are the production implementation.
    production_copy_raw_image = watchdog.Admission._copy_raw_image
    production_ensure_raw_image_mounted = watchdog.Admission._ensure_raw_image_mounted
    production_raw_image_mount_source = watchdog.Admission._raw_image_mount_source
    production_restore_fixed_slot_allocation = watchdog.Admission._restore_fixed_slot_allocation
    production_raw_image_identity = watchdog.Admission._raw_image_identity
    watchdog.Admission._copy_raw_image = coordination_copy
    watchdog.Admission._ensure_raw_image_mounted = lambda self, record: None
    watchdog.Admission._raw_image_mount_source = lambda self, mountpoint: None
    watchdog.Admission._restore_fixed_slot_allocation = lambda self, slot: subprocess.run(
        ["fallocate", "-l", str(slot["limitBytes"]), "--", str(slot["imagePath"])], check=True,
    )
    watchdog.Admission._raw_image_identity = lambda self, path: fake_identities[Path(path)]
    watchdog.Admission._scrub_setup_prefix_seed = lambda self, seed, **kwargs: self._scrub_slot(seed)

    shared_host_config = root / "shared.host.json"
    shared_raw = json.loads(host_config.read_text(encoding="utf-8"))
    shared_raw["storage"]["backing"] = "loop-ext4"
    shared_host_config.write_text(json.dumps(shared_raw), encoding="utf-8")
    try:
        watchdog.Admission(
            descriptor_path, root / "shared.ndjson", str(docker_socket), 5, shared_host_config,
        )
    except RuntimeError as error:
        assert "shared loop-ext4/project-quota" in str(error)
    else:
        raise AssertionError("shared profile must remain Unsupported")

    admission = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    challenge = admission.handle({"kind": "challenge", "clientNonce": "nonce"})
    lease = admission.handle({
        "kind": "lease.create",
        "profileId": descriptor["profileId"],
        "daemonGeneration": challenge["daemonGeneration"],
        "invocationId": "invocation-a",
    })
    common = {"invocationId": "invocation-a", "leaseToken": lease["leaseToken"]}
    base_identity = "sha256:" + "1" * 64

    def snapshot_request(
        reservation_id: str,
        *,
        kind: str,
        digest_hex: str = "a" * 64,
        slot_generation: int = 0,
    ) -> dict:
        return {
            **common,
            "kind": kind,
            "reservationId": reservation_id,
            "operationId": hashlib.sha256(reservation_id.encode()).hexdigest(),
            "protocol": capability["protocol"],
            "requiredState": "dockerData",
            "descriptorDigest": admission.descriptor_digest,
            "setupPrefixKey": f"prefix:{digest_hex}",
            "setupManifestDigest": f"sha256:{digest_hex}",
            "providerIdentity": capability["providerIdentity"],
            "baseIdentity": base_identity,
            "executionDomain": capability["executionDomain"],
            "helperRevision": capability["helperRevision"],
            "copyProtocol": capability["copyProtocol"],
            "copyRevision": capability["copyRevision"],
            "quiesceRevision": capability["quiesceRevision"],
            "publicationRevision": capability["publicationRevision"],
            "recoveryRevision": capability["recoveryRevision"],
            "manifestSchema": capability["manifestSchema"],
            "filesystemSizeBytes": capability["filesystemSizeBytes"],
            "filesystemFeatures": capability["filesystemFeatures"],
            "daemonGeneration": challenge["daemonGeneration"],
            "slotGeneration": slot_generation,
        }

    def acquire(reservation_id: str):
        return admission.handle({
            **common,
            "kind": "reservation.acquire",
            "reservationId": reservation_id,
            "reservationKind": "container",
            "resources": {"cpus": 1, "memoryBytes": 1024, "pids": 16,
                          "containers": 1, "ephemeralDiskBytes": slot_limit},
        })

    capture_reservation = acquire("capture")
    capture_slot = Path(admission.state["slots"][capture_reservation["slotId"]]["path"])
    sparse = capture_slot / "sparse.layer"
    with sparse.open("wb") as output:
        output.seek(1024 * 1024)
        output.write(b"x")
    regular = capture_slot / "metadata"
    regular.write_text("owner-and-xattr", encoding="utf-8")
    hardlink = capture_slot / "metadata.link"
    os.link(regular, hardlink)
    os.setxattr(regular, "user.niceeval-test", b"preserved", follow_symlinks=False)
    capture_image = Path(admission.state["slots"][capture_reservation["slotId"]]["imagePath"])
    image_stamp = watchdog.canonical_digest({
        "fixture": "outer-docker-data", "bytes": tree_usage_bytes(capture_slot),
    }).encode()
    with capture_image.open("r+b") as output:
        output.write(image_stamp)
        output.flush()
        os.fsync(output.fileno())
    with admission._transition():
        current = admission.state["reservations"]["capture"]
        current.update({"state": "committed", "containerId": "container-capture",
                        "networkId": "network-capture", "attemptId": "attempt-capture"})
        admission.state["slots"][current["slotId"]]["state"] = "active"
        admission._commit("fixture-capture-active", {"reservationId": "capture"})
    admission.fake_container = "container-capture"
    admission.fake_network = "network-capture"

    # A writer crash after durable intent leaves no publishable partial seed.
    operation_id = "f" * 32
    seed_path.joinpath("partial").write_text("partial", encoding="utf-8")
    with admission._transition():
        seed = admission.state["setupPrefix"]["seeds"]["seed-fullcopy01"]
        seed.update({"state": "capturing", "operationId": operation_id,
                     "setupPrefixKey": "writer-crash"})
        admission.state["setupPrefix"]["operations"][operation_id] = {
            "operationId": operation_id, "kind": "capture", "state": "capturing",
            "reservationId": "capture", "seedId": "seed-fullcopy01",
            "setupPrefixKey": "writer-crash", "chargedBytes": slot_limit,
        }
        admission.state["reservations"]["capture"]["setupPrefixOperation"] = operation_id
        admission._commit("fixture-setup-prefix-writer-crash", {"operationId": operation_id})
    expect_code("setup-prefix-operation-active", lambda: admission.handle({
        **common, "kind": "reservation.release", "reservationId": "capture",
    }))
    with admission._transition():
        admission.state["leases"]["invocation-a"]["state"] = "lost"
        admission._commit("fixture-lease-cancel-during-copy", {"operationId": operation_id})
    admission._recover_once()
    assert operation_id in admission.state["setupPrefix"]["operations"]
    assert seed_path.joinpath("partial").is_file()
    with admission._transition():
        admission.state["leases"]["invocation-a"]["state"] = "active"
        admission.state["admissionOpen"] = True
        admission._commit("fixture-lease-resumed-for-restart", {"operationId": operation_id})
    admission = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    admission.fake_container = "container-capture"
    admission.fake_network = "network-capture"
    assert list(seed_path.iterdir()) == []
    assert not admission.state["setupPrefix"]["operations"]
    assert admission.state["setupPrefix"]["seeds"]["seed-fullcopy01"]["state"] == "free", admission.state["setupPrefix"]["seeds"]

    prefix_a = "prefix:" + "a" * 64
    capture = snapshot_request(
        "capture", kind="setup-prefix.capture",
    )
    expect_code("setup-prefix-host-input", lambda: admission.handle({**capture, "rootPath": "/host"}))
    missing_state = dict(capture)
    del missing_state["requiredState"]
    expect_code("setup-prefix-state-required", lambda: admission.handle(missing_state))
    expect_code("setup-prefix-state-unsupported",
                lambda: admission.handle({**capture, "requiredState": "all"}))
    expect_code("setup-prefix-state-unsupported",
                lambda: admission.handle({**capture, "requiredState": "rootfs"}))
    expect_code("setup-prefix-key-invalid", lambda: admission.handle({
        **capture, "setupManifestDigest": "sha256:" + "b" * 64,
    }))
    expect_code("setup-prefix-descriptor-mismatch", lambda: admission.handle({
        **capture, "copyRevision": "niceeval-docker-profile-host/raw-image-copy/v0",
    }))
    expect_code("setup-prefix-descriptor-mismatch", lambda: admission.handle({
        **capture, "publicationRevision": "prepared-copy-client-commit-publish/v3",
    }))
    expect_code("setup-prefix-base-identity", lambda: admission.handle({
        **capture, "baseIdentity": "sha256:" + "4" * 64,
    }))
    expect_code("setup-prefix-state-required", lambda: admission.handle({
        **common, "kind": "setup-prefix.capture", "reservationId": "capture",
    }))
    expect_code("attestation-changed", lambda: admission.handle({**capture, "daemonGeneration": "stale"}))
    failed_wire = control_roundtrip(admission, root / "failed-wire.sock",
                                    {**capture, "daemonGeneration": "stale"})
    assert failed_wire["ok"] is False
    receipt_wire_fields = set(capture) - {
        "kind", "invocationId", "leaseToken", "reservationId", "operationId",
    }
    assert set(failed_wire["error"]) == receipt_wire_fields | {
        "code", "message", "artifact", "status",
    }
    assert failed_wire["error"]["daemonGeneration"] == challenge["daemonGeneration"]
    assert failed_wire["error"]["slotGeneration"] == 0
    assert failed_wire["error"]["requiredState"] == "dockerData"
    assert failed_wire["error"]["setupPrefixKey"] == prefix_a
    assert failed_wire["error"]["setupManifestDigest"] == "sha256:" + "a" * 64
    assert failed_wire["error"]["artifact"] == {"artifactId": None}
    assert set(failed_wire["error"]["artifact"]) == {"artifactId"}
    assert failed_wire["error"]["status"] == {
        "state": "failed", "diagnostic": "attestation-changed",
    }
    assert set(failed_wire["error"]["status"]) == {"state", "diagnostic"}
    admission.fake_running = True
    expect_code("setup-prefix-outer-not-quiesced", lambda: admission.handle(capture))
    admission.fake_running = False
    admission.fake_busy = True
    expect_code("setup-prefix-slot-busy", lambda: admission.handle(capture))
    admission.fake_busy = False
    assert admission.state["setupPrefix"]["seeds"]["seed-fullcopy01"]["state"] == "free", admission.state["setupPrefix"]["seeds"]

    prepared = admission.handle(capture)
    assert prepared["status"]["state"] == "prepared"
    assert prefix_a not in admission.state["setupPrefix"]["artifacts"]
    assert admission.handle(capture)["status"]["state"] == "prepared"
    expect_code("setup-prefix-operation-active", lambda: admission.handle({
        **common, "kind": "reservation.release", "reservationId": "capture",
    }))
    assert prefix_a not in admission.state["setupPrefix"]["artifacts"]
    assert not admission.state["setupPrefix"]["operations"]
    assert admission.state["setupPrefix"]["seeds"]["seed-fullcopy01"]["state"] == "free"
    prepared = admission.handle(capture)
    assert prepared["status"]["state"] == "prepared"
    captured = admission.handle({**capture, "kind": "setup-prefix.capture.publish"})
    assert set(captured) == receipt_wire_fields | {"artifact", "status"}
    assert captured["daemonGeneration"] == challenge["daemonGeneration"]
    assert captured["slotGeneration"] == 0
    assert captured["requiredState"] == "dockerData"
    assert captured["setupPrefixKey"] == prefix_a
    assert captured["setupManifestDigest"] == "sha256:" + "a" * 64
    assert captured["artifact"]["copyProtocol"] == "raw-image/v1"
    assert captured["artifact"]["copyRevision"] == capability["copyRevision"]
    assert captured["artifact"]["artifactId"].startswith("sha256:")
    assert set(captured["artifact"]) == {
        "artifactId", "sizeBytes", "requiredState", "copyProtocol", "copyRevision",
    }
    assert "operationId" not in captured["artifact"]
    assert captured["status"]["state"] == "captured"
    # Host commit is durable before the response; a lost response is safely
    # reconciled by retrying the same operationId and returns already-published.
    retry = control_drop_then_retry(admission, root / "publish-drop.sock",
                                    {**capture, "kind": "setup-prefix.capture.publish"})
    assert retry["ok"] is True and retry["result"]["status"]["state"] == "already-published"
    assert set(captured["status"]) == {"state", "capacity"}
    assert admission.handle(capture)["status"]["state"] == "already-published"
    expect_code("setup-prefix-capacity-exhausted",
                lambda: admission.handle(snapshot_request(
                    "capture", kind="setup-prefix.capture", digest_hex="b" * 64,
                )))

    assert prefix_a in admission.state["setupPrefix"]["artifacts"]

    # A control client may time out while the Host-owned raw copy is still
    # active. Draining its dedicated lease transfers cleanup to the Host; after
    # the copy observes that cancellation, operation/reservation/queue/slot and
    # lease ownership must all retire before fresh admission. Events avoid a
    # long timing sleep.
    timeout_lease = admission.handle({
        "kind": "lease.create",
        "profileId": descriptor["profileId"],
        "daemonGeneration": challenge["daemonGeneration"],
        "invocationId": "invocation-client-timeout",
    })
    timeout_common = {
        "invocationId": "invocation-client-timeout",
        "leaseToken": timeout_lease["leaseToken"],
    }
    timed_restore = admission.handle({
        **timeout_common,
        "kind": "reservation.acquire",
        "reservationId": "restore-client-timeout",
        "reservationKind": "container",
        "resources": {"cpus": 1, "memoryBytes": 1024, "pids": 16,
                      "containers": 1, "ephemeralDiskBytes": slot_limit},
    })
    timed_request = {**snapshot_request(
        "restore-client-timeout", kind="setup-prefix.restore",
        slot_generation=timed_restore["slotGeneration"],
    ), **timeout_common}
    copy_started, copy_continue = threading.Event(), threading.Event()
    unblocked_copy = admission._copy_docker_data_image

    def controlled_copy(source, target, operation_id):
        copy_started.set()
        if not copy_continue.wait(timeout=5):
            raise RuntimeError("controlled host copy was not released")
        return unblocked_copy(source, target, operation_id)

    admission._copy_docker_data_image = controlled_copy
    timeout_socket = root / "restore-client-timeout.sock"
    timeout_server = watchdog.Server(str(timeout_socket), admission)
    timeout_worker = threading.Thread(target=timeout_server.handle_request)
    timeout_worker.start()
    timeout_client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        timeout_client.connect(str(timeout_socket))
        timeout_client.sendall((json.dumps(timed_request) + "\n").encode())
        assert copy_started.wait(timeout=1), "Host copy did not enter the controlled boundary"
        timeout_client.settimeout(0.01)
        try:
            timeout_client.recv(65536)
        except TimeoutError:
            pass
        else:
            raise AssertionError("client timeout must precede the controlled Host copy")
        timeout_client.close()
        expect_code("setup-prefix-operation-active", lambda: admission.handle({
            **timeout_common, "kind": "reservation.release", "reservationId": "restore-client-timeout",
        }))
        expect_code("setup-prefix-operation-active", lambda: admission.handle({
            **timeout_common, "kind": "container.create", "reservationId": "restore-client-timeout",
            "create": {"intent": "workload", "create": {
                "image": base_identity, "attemptId": "timeout-race",
            }},
        }))
        previous_container = admission.fake_container
        previous_network = admission.fake_network
        admission.fake_container = ""
        admission.fake_network = ""
        assert admission.handle({**timeout_common, "kind": "lease.drain"}) == {"state": "draining"}
        assert "invocation-client-timeout" in admission.state["leases"]
    finally:
        copy_continue.set()
        timeout_client.close()
        for _ in range(500):
            if not admission.state["setupPrefix"]["operations"]:
                break
            time.sleep(0.01)
        timeout_worker.join(timeout=10)
        timeout_server.server_close()
        timeout_socket.unlink(missing_ok=True)
        admission._copy_docker_data_image = unblocked_copy
    assert not timeout_worker.is_alive()
    assert admission.handle({**timeout_common, "kind": "lease.drain"}) == {"state": "recovered"}
    timeout_slot = admission.state["slots"][timed_restore["slotId"]]
    assert not admission.state["setupPrefix"]["operations"]
    assert "restore-client-timeout" not in admission.state["reservations"]
    assert "restore-client-timeout" not in admission.state["queue"]
    assert timeout_slot["state"] == "free"
    assert "reservationId" not in timeout_slot
    assert "invocationId" not in timeout_slot
    assert "invocation-client-timeout" not in admission.state["leases"]
    assert admission.state["admissionOpen"] is True

    # The exact next-cold boundary is reusable without an E2E-side grace wait.
    cold_lease = admission.handle({
        "kind": "lease.create", "profileId": descriptor["profileId"],
        "daemonGeneration": challenge["daemonGeneration"],
        "invocationId": "invocation-after-timeout",
    })
    cold_common = {"invocationId": "invocation-after-timeout",
                   "leaseToken": cold_lease["leaseToken"]}
    cold_retry = admission.handle({
        **cold_common, "kind": "reservation.acquire", "reservationId": "after-timeout-cold",
        "reservationKind": "container",
        "resources": {"cpus": 1, "memoryBytes": 1024, "pids": 16,
                      "containers": 1, "ephemeralDiskBytes": slot_limit},
    })
    assert cold_retry["state"] == "granted"
    assert admission.handle({
        **cold_common, "kind": "reservation.release", "reservationId": "after-timeout-cold",
    }) == {"released": True}
    assert admission.handle({**cold_common, "kind": "lease.drain"}) == {"state": "recovered"}
    assert "invocation-after-timeout" not in admission.state["leases"]
    admission.fake_container = previous_container
    admission.fake_network = previous_network

    # A slot scrub failure is durable quarantine, never a reusable/granted
    # reservation. This is the same production release path used by the host.
    scrub_failure = acquire("release-scrub-failure")
    original_cleanup = admission._cleanup_with_deadline
    original_scrub = admission._scrub_slot
    admission._cleanup_with_deadline = lambda reservation: True
    admission._scrub_slot = lambda slot: (_ for _ in ()).throw(RuntimeError("injected scrub failure"))
    expect_code("slot-quarantined", lambda: admission.handle({
        **common, "kind": "reservation.release", "reservationId": "release-scrub-failure",
    }))
    admission._cleanup_with_deadline = original_cleanup
    admission._scrub_slot = original_scrub
    assert admission.state["reservations"]["release-scrub-failure"]["state"] == "quarantined"
    assert admission.state["slots"][scrub_failure["slotId"]]["state"] == "quarantined"

    # Reader cancellation after durable restore publication is harmless; replay
    # returns the same artifact and no half-copy is exposed to container.create.
    restore_reservation = acquire("restore-reader-cancel")
    restore = snapshot_request(
        "restore-reader-cancel", kind="setup-prefix.restore",
        slot_generation=restore_reservation["slotGeneration"],
    )
    socket_path = root / "reader-cancel.sock"
    server = watchdog.Server(str(socket_path), admission)
    worker = threading.Thread(target=server.handle_request)
    worker.start()
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(str(socket_path))
    client.sendall((json.dumps(restore) + "\n").encode())
    client.shutdown(socket.SHUT_RD)
    worker.join(timeout=10)
    assert not worker.is_alive()
    for _ in range(200):
        if admission.state["reservations"]["restore-reader-cancel"].get("restoredSetupPrefix"):
            break
        time.sleep(0.01)
    assert admission.state["reservations"]["restore-reader-cancel"].get("restoredSetupPrefix")
    client.close()
    server.server_close()
    restored = admission.handle(restore)
    assert restored["status"]["state"] == "already-restored", restored
    restored_slot = Path(admission.state["slots"][restore_reservation["slotId"]]["path"])
    assert os.stat(restored_slot / "metadata").st_ino == os.stat(restored_slot / "metadata.link").st_ino
    assert os.getxattr(restored_slot / "metadata", "user.niceeval-test") == b"preserved"
    assert (restored_slot / "sparse.layer").stat().st_blocks * 512 < (restored_slot / "sparse.layer").stat().st_size

    # Concurrent readers copy the immutable raw image directly into distinct
    # fixed slots. The published seed remains unmounted and never becomes a
    # shared writable mount owner.
    concurrent_requests = []
    for suffix in ("one", "two"):
        reservation_id = f"restore-concurrent-{suffix}"
        concurrent = acquire(reservation_id)
        concurrent_requests.append(snapshot_request(
            reservation_id,
            kind="setup-prefix.restore",
            slot_generation=concurrent["slotGeneration"],
        ))
    concurrent_results = []
    concurrent_errors = []

    def concurrent_restore(frame):
        try:
            concurrent_results.append(admission.handle(frame))
        except Exception as error:
            concurrent_errors.append(error)

    readers = [threading.Thread(target=concurrent_restore, args=(frame,))
               for frame in concurrent_requests]
    for reader in readers:
        reader.start()
    for reader in readers:
        reader.join(timeout=10)
    assert not concurrent_errors, concurrent_errors
    assert len(concurrent_results) == 2
    assert {item["status"]["state"] for item in concurrent_results} == {"restored"}
    published_seed = admission.state["setupPrefix"]["seeds"]["seed-fullcopy01"]
    assert published_seed["state"] == "published"
    assert admission._raw_image_mount_source(Path(published_seed["path"])) is None

    # A helper restart during restore quarantines the half-copy destination and
    # retains its fixed capacity charge instead of granting it to a container.
    interrupted = acquire("restore-helper-restart")
    interrupted_slot = Path(admission.state["slots"][interrupted["slotId"]]["path"])
    (interrupted_slot / "half-copy").write_text("partial", encoding="utf-8")
    restore_operation = "d" * 32
    with admission._transition():
        reservation = admission.state["reservations"]["restore-helper-restart"]
        slot = admission.state["slots"][reservation["slotId"]]
        reservation.update({"state": "restoring", "setupPrefixOperation": restore_operation})
        slot["state"] = "restoring"
        admission.state["setupPrefix"]["operations"][restore_operation] = {
            "operationId": restore_operation, "kind": "restore", "state": "restoring",
            "reservationId": reservation["reservationId"], "slotId": slot["slotId"],
            "seedId": "seed-fullcopy01", "setupPrefixKey": prefix_a,
            "chargedBytes": slot_limit,
        }
        admission._commit("fixture-setup-prefix-restore-helper-restart",
                          {"operationId": restore_operation})
    admission = watchdog.Admission(descriptor_path, journal, str(docker_socket), 5, host_config)
    admission.fake_container = "container-capture"
    admission.fake_network = "network-capture"
    assert admission.state["reservations"]["restore-helper-restart"]["state"] == "quarantined"
    assert not admission.state["setupPrefix"]["operations"]
    assert (interrupted_slot / "half-copy").is_file()

    # A dirty target is quarantined before it can be granted to container create.
    dirty = acquire("restore-dirty")
    dirty_slot = Path(admission.state["slots"][dirty["slotId"]]["path"])
    (dirty_slot / "unscrubbed").write_text("hostile", encoding="utf-8")
    dirty_request = {**restore, "reservationId": "restore-dirty"}
    expect_code("setup-prefix-restore-failed", lambda: admission.handle(dirty_request))
    assert admission.state["reservations"]["restore-dirty"]["state"] == "quarantined"
    expect_code("reservation-state", lambda: admission.handle({
        **common, "kind": "container.create", "reservationId": "restore-dirty",
        "create": {"intent": "workload", "create": {"image": "image", "attemptId": "attempt"}},
    }))

    # Corruption is detected before touching a fresh restore target.
    corrupt = acquire("restore-corrupt")
    artifact = admission.state["setupPrefix"]["artifacts"][prefix_a]
    artifact_payload = Path(admission.state["setupPrefix"]["seeds"][artifact["seedId"]]["imagePath"])
    with artifact_payload.open("r+b") as output:
        output.write(b"corrupt")
        output.flush()
        os.fsync(output.fileno())
    corrupt_request = {**restore, "reservationId": "restore-corrupt"}
    expect_code("setup-prefix-artifact-corrupt", lambda: admission.handle(corrupt_request))
    assert admission.state["reservations"]["restore-corrupt"]["state"] == "granted"
    corrupt_slot = Path(admission.state["slots"][corrupt["slotId"]]["path"])
    assert list(corrupt_slot.iterdir()) == []

    status = admission.handle({"kind": "status"})["setupPrefix"]
    assert status["protocol"] == "niceeval-docker-profile-state/docker-data-snapshot/v1"
    assert status["requiredState"] == "dockerData"
    assert status["copyRevision"] == capability["copyRevision"]
    assert status["artifacts"][0]["artifactId"].startswith("sha256:")
    assert status["capacity"]["seedBytes"] > 0
    assert status["capacity"]["activeBytes"] > 0
    assert status["capacity"]["recoveryBytes"] == 3 * slot_limit
    events = [json.loads(line)["event"] for line in journal.read_text(encoding="utf-8").splitlines()]
    assert "setup-prefix-capture-intent" in events
    assert "setup-prefix-capture-prepared" in events
    assert "setup-prefix-captured" in events
    assert "setup-prefix-capture-recovered" in events
    assert "setup-prefix-restore-intent" in events
    assert "setup-prefix-restored" in events
    assert "slot-quarantined" in events
    assert "setup-prefix-artifact-corrupt" in events

    # Artifacts bind the exact daemon generation. A daemon replacement first
    # journals invalidation, scrubs the stale seed, and only then returns it to
    # the free pool; it never silently serves an old-generation hit.
    production_generation = watchdog.Admission._generation
    watchdog.Admission._generation = lambda self: "setup-prefix-daemon-next"
    try:
        admission = watchdog.Admission(
            descriptor_path, journal, str(docker_socket), 5, host_config,
        )
    finally:
        watchdog.Admission._generation = production_generation
    assert admission.state["setupPrefix"]["artifacts"][prefix_a]["state"] == "stale"
    assert admission.state["setupPrefix"]["seeds"]["seed-fullcopy01"]["state"] == "quarantined"
    assert admission.state["admissionOpen"] is False
    generation_events = [
        json.loads(line)["event"]
        for line in journal.read_text(encoding="utf-8").splitlines()
    ]
    assert "setup-prefix-stale-artifact-blocked" in generation_events

    # The production copy boundary uses the benchmarked raw-image recipe. The
    # mount/fsck syscalls are deterministic host fakes; cp/fallocate/sync and
    # inode/space verification run for real.
    watchdog.Admission._copy_raw_image = production_copy_raw_image
    watchdog.Admission._ensure_raw_image_mounted = production_ensure_raw_image_mounted
    watchdog.Admission._raw_image_mount_source = production_raw_image_mount_source
    watchdog.Admission._restore_fixed_slot_allocation = production_restore_fixed_slot_allocation
    watchdog.Admission._raw_image_identity = production_raw_image_identity
    raw_root = root / "raw-image-boundary"
    raw_root.mkdir()
    raw_source_mount, raw_target_mount = raw_root / "source", raw_root / "target"
    raw_source_mount.mkdir()
    raw_target_mount.mkdir()
    raw_size = 4 * 1024 * 1024
    raw_source_image, raw_target_image = raw_root / "source.ext4", raw_root / "target.ext4"
    allocate_image(raw_source_image, raw_size)
    allocate_image(raw_target_image, raw_size)
    for image in (raw_source_image, raw_target_image):
        subprocess.run(["mkfs.ext4", "-F", "-q", str(image)], check=True)
        subprocess.run(["fallocate", "-l", str(raw_size), "--", str(image)], check=True)
        subprocess.run(["sync", "-f", "--", str(image)], check=True)
    raw_source = {
        "path": str(raw_source_mount), "imagePath": str(raw_source_image),
        "limitBytes": raw_size, "fsType": "ext4", "mountOptions": ["rw"],
        "filesystemIdentity": f"ext4-uuid:{subprocess.check_output(['blkid', '-s', 'UUID', '-o', 'value', str(raw_source_image)], text=True).strip().lower()}",
    }
    raw_target = {
        "path": str(raw_target_mount), "imagePath": str(raw_target_image),
        "limitBytes": raw_size, "fsType": "ext4", "mountOptions": ["rw"],
        "filesystemIdentity": f"ext4-uuid:{subprocess.check_output(['blkid', '-s', 'UUID', '-o', 'value', str(raw_target_image)], text=True).strip().lower()}",
    }
    mounted = {str(raw_source_mount), str(raw_target_mount)}
    commands = []
    fault = {"command": None}

    def raw_run(*args, check=True, timeout=30):
        commands.append(args)
        if args[0] == "findmnt":
            mountpoint = args[-1]
            if mountpoint not in mounted:
                return subprocess.CompletedProcess(args, 1, "", "not mounted")
            return subprocess.CompletedProcess(args, 0, f"/dev/loop-test {mountpoint}\n", "")
        if args[0] == "umount":
            mounted.remove(args[-1])
            return subprocess.CompletedProcess(args, 0, "", "")
        if args[0] == "mount":
            if args[1] != "--make-rprivate":
                mounted.add(args[-1])
            return subprocess.CompletedProcess(args, 0, "", "")
        if args[0] == fault["command"]:
            if args[0] == "e2fsck":
                return subprocess.CompletedProcess(args, 4, "", "injected attest failure")
            raise RuntimeError(f"injected raw-image {args[0]} crash")
        return subprocess.run(args, check=check, text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout)

    raw_admission = object.__new__(watchdog.Admission)
    raw_admission.setup_prefix = {"copyStrategy": "raw-image/v1", "imageRootPath": raw_root}
    raw_admission.fake_busy = False
    copy_stages = []
    raw_admission._record_copy_stage = lambda operation_id, stage, facts: copy_stages.append((stage, facts))
    raw_admission._run_host = raw_run
    parent_mount = raw_root.parent
    raw_admission._run_host = lambda *args, **kwargs: subprocess.CompletedProcess(
        args, 0, f"/dev/parent {parent_mount}\n", "",
    )
    assert raw_admission._raw_image_mount_source(raw_source_mount) is None
    raw_admission._run_host = raw_run
    try:
        raw_admission._raw_image_record({**raw_source, "imagePath": str(seed_image)})
    except RuntimeError as error:
        assert "escaped its attested image root" in str(error)
    else:
        raise AssertionError("hostile raw image path must be rejected")
    target_inode = raw_target_image.stat().st_ino
    artifact_id = raw_admission._copy_docker_data_image(
        raw_source, raw_target, "a" * 32
    )
    assert artifact_id == watchdog.Admission._raw_image_digest(raw_target_image)
    assert raw_source_image.read_bytes() != raw_target_image.read_bytes()
    assert raw_admission._raw_image_identity(raw_target_image) == raw_target["filesystemIdentity"]
    assert raw_target_image.stat().st_ino not in (target_inode, raw_source_image.stat().st_ino)
    assert raw_target_image.stat().st_size == raw_size
    assert raw_target_image.stat().st_blocks * 512 >= raw_size
    assert mounted == {str(raw_source_mount), str(raw_target_mount)}
    assert any(command[:3] == ("cp", "--sparse=never", "--reflink=never") for command in commands)
    assert any(command[:3] == ("fallocate", "-l", str(raw_size)) for command in commands)
    assert any(command[:3] == ("sync", "-f", "--") for command in commands)
    assert any(command[:2] == ("e2fsck", "-fn") for command in commands)
    assert [stage for stage, _ in copy_stages[:4]] == ["copied", "reuuid", "attested", "replaced"]
    assert copy_stages[0][1]["sourceArtifactDigest"] == watchdog.Admission._raw_image_digest(raw_source_image)
    assert copy_stages[0][1]["expectedTargetFilesystemIdentity"] == raw_target["filesystemIdentity"]
    assert copy_stages[2][1]["temporaryFinalDigest"] == artifact_id
    assert not any(command[0] == "dd" or "--archive" in command for command in commands)

    # Scrub may release physical blocks from the loop backing. The journaled
    # fixed-slot recovery boundary must restore allocation before reuse.
    subprocess.run([
        "fallocate", "--punch-hole", "--keep-size", "-o", str(raw_size // 2), "-l", str(raw_size // 4),
        "--", str(raw_target_image),
    ], check=True)
    assert raw_target_image.stat().st_blocks * 512 < raw_size
    raw_admission._restore_fixed_slot_allocation({
        **raw_target,
        "attestation": "independent-fixed-filesystem/v1",
        "projectId": 0,
    })
    assert raw_target_image.stat().st_blocks * 512 >= raw_size
    assert str(raw_target_mount) in mounted

    # Restore reads a published seed image without mounting it. Only the
    # private destination slot is unmounted/remounted around atomic replace.
    mounted.remove(str(raw_source_mount))
    immutable_seed = {**raw_source, "mountOptions": ["ro", "noload"]}
    restored_artifact_id = raw_admission._copy_docker_data_image(
        immutable_seed, raw_target, "d" * 32,
    )
    assert restored_artifact_id == watchdog.Admission._raw_image_digest(raw_target_image)
    assert mounted == {str(raw_target_mount)}

    # Every disk phase before replace preserves the published target. The
    # temporary is always removed and the slot is remounted; no failure may be
    # guessed into a publication.
    for phase, command in (("copy", "cp"), ("reuuid", "tune2fs"), ("attest", "e2fsck")):
        operation_id = hashlib.sha256(phase.encode()).hexdigest()[:32]
        stable_inode = raw_target_image.stat().st_ino
        stable_digest = watchdog.Admission._raw_image_digest(raw_target_image)
        fault["command"] = command
        try:
            raw_admission._copy_docker_data_image(immutable_seed, raw_target, operation_id)
        except RuntimeError as error:
            assert "injected" in str(error) or "verification failed" in str(error)
        else:
            raise AssertionError(f"injected {phase} failure must fail")
        finally:
            fault["command"] = None
        assert raw_target_image.stat().st_ino == stable_inode
        assert watchdog.Admission._raw_image_digest(raw_target_image) == stable_digest
        assert not raw_admission._temporary_clone_path(raw_target_image, operation_id).exists()
        assert mounted == {str(raw_target_mount)}

    replace_operation = "e" * 32
    stable_inode = raw_target_image.stat().st_ino
    original_replace = watchdog.os.replace
    watchdog.os.replace = lambda source, target: (_ for _ in ()).throw(
        RuntimeError("injected raw-image replace crash")
    ) if Path(target) == raw_target_image else original_replace(source, target)
    try:
        raw_admission._copy_docker_data_image(immutable_seed, raw_target, replace_operation)
    except RuntimeError as error:
        assert "replace crash" in str(error)
    else:
        raise AssertionError("injected replace failure must fail")
    finally:
        watchdog.os.replace = original_replace
    assert raw_target_image.stat().st_ino == stable_inode
    assert not raw_admission._temporary_clone_path(raw_target_image, replace_operation).exists()

    # A journal commit failure after atomic replace is not rolled forward by
    # the copier. Actual UUID remains the stable target identity; outer capture
    # recovery scrubs unpublished data and outer restore recovery quarantines.
    commit_operation = "f" * 32
    original_record_stage = raw_admission._record_copy_stage
    def fail_replaced_commit(operation_id, stage, facts):
        if stage == "replaced":
            raise RuntimeError("injected publication commit crash")
        original_record_stage(operation_id, stage, facts)
    raw_admission._record_copy_stage = fail_replaced_commit
    try:
        raw_admission._copy_docker_data_image(immutable_seed, raw_target, commit_operation)
    except RuntimeError as error:
        assert "publication commit crash" in str(error)
    else:
        raise AssertionError("injected publication commit failure must fail")
    finally:
        raw_admission._record_copy_stage = original_record_stage
    assert raw_admission._raw_image_identity(raw_target_image) == raw_target["filesystemIdentity"]
    assert not raw_admission._temporary_clone_path(raw_target_image, commit_operation).exists()

    # Failure before atomic replace removes the temporary clone, preserves the
    # prior target inode, restores the destination, and leaves the seed unmounted.
    stable_inode = raw_target_image.stat().st_ino
    fault["command"] = "fallocate"
    try:
        raw_admission._copy_docker_data_image(immutable_seed, raw_target, "b" * 32)
    except RuntimeError as error:
        assert "fallocate crash" in str(error)
    else:
        raise AssertionError("injected raw-image writer crash must fail")
    assert raw_target_image.stat().st_ino == stable_inode
    assert mounted == {str(raw_target_mount)}
    assert not raw_admission._temporary_clone_path(raw_target_image, "b" * 32).exists()
    fault["command"] = None

    raw_admission.setup_prefix["copyStrategy"] = "filesystem-tree/v1"
    try:
        raw_admission._copy_docker_data_image(immutable_seed, raw_target, "c" * 32)
    except RuntimeError as error:
        assert "unsupported dockerData copy strategy" in str(error)
    else:
        raise AssertionError("inode tree copy strategy must remain rejected")

print("setup-prefix-watchdog-smoke ok")
