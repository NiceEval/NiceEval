"""Two private captures of the same key can consume one immutable winner."""
import importlib.util
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
