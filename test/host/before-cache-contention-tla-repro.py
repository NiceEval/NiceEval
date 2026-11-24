"""Two private captures of the same key can consume one immutable winner."""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading

source = Path(__file__).resolve().parents[2] / "packaging/docker-profile-host/scripts/watchdog.py"
spec = importlib.util.spec_from_file_location("watchdog", source)
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


def session(path):
    host = watchdog.Admission.__new__(watchdog.Admission)
    host.lock = threading.RLock()
    host.journal = path
    host.descriptor_digest = "fixture"
    host.before_cache = {
        "providerIdentity": "test", "executionDomain": "local", "filesystemSizeBytes": 8,
        "filesystemFeatures": ["ext4"], "filesystemLimitBytes": 128,
    }
    host._draft_state = None
    host.state = {
        "generation": "daemon", "leases": {}, "slots": {}, "reservations": {},
        "admissionOpen": True, "degraded": [], "queue": [],
        "beforeCache": {"seeds": {}, "operations": {}, "artifacts": {}},
    }
    # Substitute the physical Docker and raw image operations. Keep the real
    # lease, reservation, generation, operation and publication checks.
    host._attest_capture_quiesced = lambda *args: None
    host._verify_seed_target = lambda seed: None
    host._copy_docker_data_image = lambda source, target, op: "digest-" + target["seedId"]
    host._raw_image_record = lambda seed: (None, seed["seedId"], seed["limitBytes"])
    host._raw_image_digest = lambda seed_id: "digest-" + seed_id
    return host


def allocate(host, index):
    identity = str(index)
    setup = host.state
    setup["leases"][identity] = {
        "invocationId": identity, "tokenDigest": watchdog.token_digest(identity), "state": "active",
        "daemonGeneration": "daemon",
    }
    setup["slots"][identity] = {"state": "active", "slotId": identity, "generation": index, "limitBytes": 8}
    setup["reservations"][identity] = {
        "reservationId": identity, "slotId": identity, "slotGeneration": index,
        "kind": "container", "state": "committed", "invocationId": identity,
    }
    setup["beforeCache"]["seeds"][identity] = {"state": "free", "seedId": identity, "limitBytes": 8}
    return {
        "kind": "before-cache.capture", "operationId": "copy-" + identity,
        "reservationId": identity, "invocationId": identity, "leaseToken": identity,
        "providerIdentity": "test", "executionDomain": "local", "filesystemSizeBytes": 8,
        "filesystemFeatures": ["ext4"], "protocol": watchdog.BEFORE_CACHE_PROTOCOL,
        "helperRevision": watchdog.BEFORE_CACHE_HELPER_REVISION, "copyProtocol": watchdog.BEFORE_CACHE_COPY_PROTOCOL,
        "copyRevision": watchdog.BEFORE_CACHE_COPY_REVISION, "quiesceRevision": watchdog.BEFORE_CACHE_QUIESCE_REVISION,
        "publicationRevision": watchdog.BEFORE_CACHE_PUBLICATION_REVISION,
        "recoveryRevision": watchdog.BEFORE_CACHE_RECOVERY_REVISION,
        "manifestSchema": watchdog.BEFORE_CACHE_MANIFEST_SCHEMA, "requiredState": "dockerData",
        "descriptorDigest": host.descriptor_digest, "daemonGeneration": "daemon", "slotGeneration": index,
        "beforeCacheKey": "prefix:" + "a" * 64, "declarationDigest": "sha256:" + "a" * 64,
        "replacementScope": "c" * 64,
        "baseIdentity": "sha256:" + "b" * 64,
    }


with TemporaryDirectory() as temp:
    for first in (0, 1):
        host = session(Path(temp) / str(first))
        frames = [allocate(host, index) for index in (1, 2)]
        for frame in frames:
            assert host.handle(frame)["status"]["state"] == "prepared"
            frame["kind"] = "before-cache.capture.publish"
        winner = host.handle(frames[first])
        loser = frames[1 - first]
        for _ in range(2):  # lost response, identical publish retry
            receipt = host.handle(loser)
            assert receipt["status"]["state"] == "already-published", receipt
            assert receipt["artifact"] == winner["artifact"]
        try:
            host.handle({**loser, "operationId": "unprepared"})
        except watchdog.ProtocolError:
            pass
        else:
            raise AssertionError("unprepared operation received a publication receipt")

    # An Invocation may own two live Attempt reservations at the same time.
    host = session(Path(temp) / "shared-lease")
    first, second = (allocate(host, index) for index in (1, 2))
    second.update(invocationId=first["invocationId"], leaseToken=first["leaseToken"])
    host.state["reservations"]["2"]["invocationId"] = first["invocationId"]
    host._remove_temporary_clone = lambda *_: None
    host._scrub_before_cache_seed = lambda *_: None
    for frame in (first, second):
        assert host.handle(frame)["status"]["state"] == "prepared"
    try:
        host.handle({**first, "kind": "reservation.release"})
    except watchdog.ProtocolError as error:
        assert error.code == "before-cache-operation-active", error
    else:
        raise AssertionError("expected fenced release to require retry")
    assert host.handle({**second, "kind": "before-cache.capture.publish"})["status"]["state"] == "captured"
    try:
        host.handle({**first, "kind": "before-cache.capture.publish"})
    except watchdog.ProtocolError as error:
        assert error.code == "before-cache-publication-conflict", error
    else:
        raise AssertionError("released operation adopted another reservation's winner")


class RestartedAdmission(watchdog.Admission):
    """Keep journal replay, generation reconciliation and request handling real."""

    daemon = "next-daemon"

    def __init__(self, descriptor, journal, docker_socket, grace, *, daemon="next-daemon", host_config=None):
        self.daemon = daemon
        super().__init__(descriptor, journal, docker_socket, grace, host_config)

    def _before_cache_config(self):
        return {
            "providerIdentity": "test", "executionDomain": "local", "filesystemSizeBytes": 8,
            "filesystemFeatures": ["ext4"], "filesystemLimitBytes": 128,
            "imageRootPath": self.descriptor_path.parent,
            "seedRegistryPath": self.descriptor_path.with_name("seeds.json"),
            "filesystemIdentity": "fixture-filesystem", "seedLimitBytes": 8,
        }

    def _asset_facts(self):
        return [{"present": True}]

    def _generation(self):
        self._docker_socket_epoch = self._docker_socket_incarnation()
        return self.daemon

    def _docker_socket_incarnation(self):
        return (1, 1 if self.daemon == "daemon" else 2)

    def _attest_independent_raw_images(self):
        pass

    def _raw_image_record(self, seed):
        return None, seed["seedId"], seed["limitBytes"]

    def _raw_image_mount_source(self, path):
        return None

    def _verify_seed_target(self, seed):
        pass

    def _scrub_before_cache_seed(self, seed, *, recover_mounted=False):
        self.descriptor_path.with_name(seed["seedId"] + ".data").write_bytes(b"")

    def _cleanup_with_deadline(self, reservation):
        return True

    def _verify_and_free_slot(self, reservation):
        self.state["slots"][reservation["slotId"]]["state"] = "free"
        return True


def check_daemon_rotation(root, held, contradictory, legacy=False, live=False, descriptor_upgrade=False):
    root.mkdir()
    journal = root / "events.ndjson"
    host = session(journal)
    frame = allocate(host, 1)
    seed_id = "seed-00000001"
    seed_folder = root / "seed"
    seed_folder.mkdir()
    seed = root / f"{seed_id}.data"
    seed.write_bytes(b"old seed")
    seed_registry = {
        "seedId": seed_id, "path": str(seed_folder), "imagePath": str(seed),
        "attestation": watchdog.BEFORE_CACHE_SLOT_ATTESTATION, "limitBytes": 8,
        "mountOptions": ["ro", "noload"],
    }
    host.state["beforeCache"]["seeds"] = {seed_id: {**seed_registry, "state": "free"}}
    (root / "seeds.json").write_text(json.dumps({
        "schemaVersion": 1, "filesystemIdentity": "fixture-filesystem",
        "slotAttestation": watchdog.BEFORE_CACHE_SLOT_ATTESTATION, "seeds": [seed_registry],
    }))
    reservation = host.state["reservations"]["1"]
    reservation["resources"] = {}
    host.state.update(admissionOpen=True, degraded=[], queue=[])
    assert host.handle(frame)["status"]["state"] == "prepared"
    assert host.handle({**frame, "kind": "before-cache.capture.publish"})["status"]["state"] == "captured"
    if legacy:
        cache = host.state["beforeCache"]
        for record in (cache["artifacts"][frame["beforeCacheKey"]], cache["seeds"][seed_id]):
            record.pop("replacementScope")
            record["protocol"] = "niceeval-docker-profile-state/docker-data-snapshot/v1"
        cache.pop("replacementHeads")
        host.state["leases"]["1"].pop("beforeCacheHolds")
        host._commit("fixture-legacy-artifact", {})

    # Persist a journaled restore receipt, the same reference shape the real
    # restore handler leaves on the destination reservation until release.
    if held:
        reservation = host.state["reservations"]["1"]
        reservation["restoredBeforeCache"] = {
            "beforeCacheKey": frame["beforeCacheKey"], "artifactId": f"digest-{seed_id}",
            "declarationDigest": frame["declarationDigest"], "slotGeneration": frame["slotGeneration"],
        }
        # A second reservation protects the same seed after the first release.
        host.state["slots"]["2"] = {"state": "active", "slotId": "2", "generation": 2, "limitBytes": 8}
        host.state["reservations"]["2"] = {
            **reservation, "reservationId": "2", "slotId": "2", "slotGeneration": 2,
            "restoredBeforeCache": {**reservation["restoredBeforeCache"], "slotGeneration": 2},
        }
        host._commit("fixture-restore-receipts", {})
    if contradictory:
        host.state["beforeCache"]["seeds"][seed_id]["artifactId"] = "wrong-artifact"
        host._commit("fixture-contradictory-seed", {})

    descriptor = root / "descriptor.json"
    descriptor.write_text(json.dumps({
        "profileId": "fixture",
        "transport": {"hostMachineIdentity": "fixture-host"},
        "backend": {"machineIdentity": "fixture-daemon"},
        "capacity": {"cpus": 1, "memoryBytes": 64, "pids": 8, "maxContainers": 2, "maxBuilds": 1},
    }))
    daemon = "daemon" if legacy and not descriptor_upgrade else "next-daemon"
    host_config = None
    if descriptor_upgrade:
        host_config = root / "host.json"
        host_config.write_text(json.dumps({"storage": {"backing": "fixed-image-ext4"}}))
        host.state["fixedDescriptorDigest"] = "legacy-descriptor"
        host._commit("fixture-legacy-descriptor", {})

    def restart():
        return RestartedAdmission(descriptor, journal, "fixture.sock", 1, daemon=daemon, host_config=host_config)

    if not held and not legacy:
        host._cleanup_with_deadline = lambda _: True
        host._verify_and_free_slot = lambda _: True
        host.handle({**frame, "kind": "reservation.release"})
        host.profile_id = "fixture"
        assert host.handle({**frame, "kind": "lease.drain"})["state"] == "recovered"
    if live:
        host = RestartedAdmission(descriptor, journal, "fixture.sock", 1, daemon="daemon")
        host.daemon = daemon
        assert host.handle({"kind": "challenge"})["daemonGeneration"] == daemon
    else:
        host = restart()
    status = host.handle({"kind": "status"})
    assert status["generation"] == daemon, status
    assert status["admissionOpen"] == (not contradictory), status
    create_lease = {"kind": "lease.create", "profileId": "fixture", "daemonGeneration": daemon,
                    "invocationId": "new-invocation"}
    if contradictory:
        try:
            host.handle(create_lease)
        except watchdog.ProtocolError as error:
            assert error.code == "admission-closed", error
        else:
            raise AssertionError("contradictory seed admitted a new invocation")
        assert seed.read_bytes() == b"old seed"
        assert host.state["beforeCache"]["seeds"][seed_id]["state"] == "quarantined"
        return

    admitted = host.handle(create_lease)
    if held:
        assert status["beforeCache"]["artifacts"][0]["state"] == "pending-reclaim", status
        assert seed.read_bytes() == b"old seed"
        host.handle({**frame, "kind": "reservation.release"})
        assert seed.read_bytes() == b"old seed"
        host = restart()
        assert host.handle({"kind": "status"})["admissionOpen"]
        host.handle({**frame, "kind": "reservation.release", "reservationId": "2"})
        assert seed.read_bytes() == b"old seed"
        assert host.handle({**frame, "kind": "lease.drain"})["state"] == "recovered"
    assert seed.read_bytes() == b""
    host = restart()
    status = host.handle({"kind": "status"})
    assert status["admissionOpen"] and status["beforeCache"]["artifacts"] == [], status
    # The raw image stays preallocated, so the reclaimed capacity is the
    # ability to publish again in the same single-seed pool.
    host._attest_capture_quiesced = lambda *_: None
    host._copy_docker_data_image = lambda *_: f"digest-{seed_id}"
    host._raw_image_digest = lambda seed_id: "digest-" + seed_id
    host.state["reservations"]["new"] = {
        **frame, "reservationId": "new", "slotId": "1", "kind": "container", "state": "committed",
        "resources": {}, "invocationId": admitted["invocationId"],
    }
    host.state["slots"]["1"]["state"] = "active"
    replacement = {**frame, **admitted, "reservationId": "new", "operationId": "fresh-copy",
                   "descriptorDigest": host.descriptor_digest}
    unscoped = {key: value for key, value in replacement.items() if key != "replacementScope"}
    try:
        host.handle(unscoped)
    except watchdog.ProtocolError as error:
        assert error.code == "before-cache-host-input", error
    else:
        raise AssertionError("control service accepted a capture frame without a replacement scope")
    assert host.handle(replacement)["status"]["state"] == "prepared"
    assert host.handle({**replacement, "kind": "before-cache.capture.publish"})["status"]["state"] == "captured"


with TemporaryDirectory() as temp:
    for scenario, setup in (
        ("unreferenced", {}),
        ("referenced", {"held": True}),
        ("contradictory", {"contradictory": True}),
        ("old-protocol", {"legacy": True}),
        ("old-descriptor", {"legacy": True, "descriptor_upgrade": True}),
        ("live-rotation", {"live": True}),
    ):
        check_daemon_rotation(Path(temp) / scenario, **{"held": False, "contradictory": False, **setup})


def check_scope_replacement(journal):
    host = session(journal)
    first, second, third = (allocate(host, index) for index in (1, 2, 3))
    scrubbed = []
    host._scrub_before_cache_seed = lambda seed, **_: scrubbed.append(seed["seedId"])
    host._cleanup_with_deadline = lambda _: True
    host._verify_and_free_slot = lambda _: True
    host._verify_restore_target = lambda _: None
    host._raw_image_identity = lambda _: "fixture-uuid"
    host._copy_docker_data_image = lambda source, target, _: "digest-" + target.get("seedId", "restore")
    for reservation in host.state["reservations"].values():
        reservation["resources"] = {}

    def publish(frame):
        assert host.handle(frame)["status"]["state"] == "prepared"
        return host.handle({**frame, "kind": "before-cache.capture.publish"})

    original = publish(first)
    # Another declaring position can use the same content and immutable seed.
    second["replacementScope"] = "d" * 64
    shared = host.handle(second)
    assert shared["status"]["state"] == "already-published"
    assert shared["artifact"] == original["artifact"]
    assert shared["replacementScope"] == second["replacementScope"]

    # Changing one scope cannot evict the other scope's head.
    second_generation = {**third, "beforeCacheKey": "prefix:" + "b" * 64,
                         "declarationDigest": "sha256:" + "b" * 64}
    publish(second_generation)
    assert first["beforeCacheKey"] in host.state["beforeCache"]["artifacts"]
    assert not scrubbed

    # Once both scopes move, journal the retired seed and keep the outstanding
    # captures' immutable receipts until their owning leases settle.
    final = {**second, "beforeCacheKey": "prefix:" + "e" * 64,
             "declarationDigest": "sha256:" + "e" * 64, "operationId": "next-scope-key"}
    publish(final)
    assert first["beforeCacheKey"] not in host.state["beforeCache"]["artifacts"]
    assert host.state["beforeCache"]["retiredArtifacts"]["1"]["state"] == "pending-reclaim"
    assert not scrubbed
    assert host.handle({**first, "kind": "before-cache.capture.publish"})["artifact"] == original["artifact"]

    # The capture's original operation can still restore its exact artifact
    # into a fresh reservation. A new reader sees a miss for the superseded key.
    host.state["slots"]["1"].update(state="granted", filesystemIdentity="fixture-uuid", imagePath="fixture.img")
    host.state["reservations"]["1"]["state"] = "granted"
    try:
        host.handle({**first, "operationId": "fresh-lookup", "kind": "before-cache.restore"})
    except watchdog.ProtocolError as error:
        assert error.code == "before-cache-miss", error
    else:
        raise AssertionError("new lookup found a superseded seed")
    assert host.handle({**first, "kind": "before-cache.restore"})["artifact"] == original["artifact"]
    for owner, expected in ((first, []), (second, ["1"])):
        host.handle({**owner, "kind": "reservation.release"})
        assert host.handle({**owner, "kind": "lease.drain"})["state"] == "recovered"
        assert scrubbed == expected
    assert host.state["admissionOpen"]


with TemporaryDirectory() as temp:
    check_scope_replacement(Path(temp) / "scope-replacement")
