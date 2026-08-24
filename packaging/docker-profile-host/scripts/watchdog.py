#!/usr/bin/env python3
"""Durable admission and orphan-recovery service for a Docker profile.

The protocol is one JSON object per Unix-stream connection.  Every mutating
reply is journaled and fsync'd before it is returned.  Docker resources are
only removed when profile, invocation, reservation and provision-token labels
all match durable journal facts.
"""
from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import hmac
import json
import math
import os
import posixpath
import re
import secrets
import signal
import socket
import socketserver
import stat
import subprocess
import tarfile
import threading
import time
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


LABELS = {
    "profileId": "niceeval.profile-id",
    "invocationId": "niceeval.invocation-id",
    "reservationId": "niceeval.reservation-id",
    "provisionToken": "niceeval.provision-token",
    "attemptId": "niceeval.attempt-id",
}

CREATE_KEYS = {"image", "command", "entrypoint", "environment", "workingDir", "user", "tmpfs", "attemptId"}
FORBIDDEN_CREATE_KEYS = {"binds", "mounts", "volumes", "hostConfig", "devices", "networkMode", "ports", "extraHosts"}
BUILD_KEYS = {"buildKey", "platform", "dockerfile", "buildArgs", "target", "retention"}
MAX_BUILD_CONTEXT_BYTES = 2 * 1024 * 1024 * 1024
MAX_BUILD_CONTEXT_CHUNK_BYTES = 4 * 1024 * 1024
QUEUE_TIMEOUT_SECONDS = 30
CLEANUP_TIMEOUT_SECONDS = 60
REQUIRED_ASSETS = {
    "docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c",
    "moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8",
}
SETUP_PREFIX_PROTOCOL = "niceeval-docker-profile-state/docker-data-snapshot/v1"
SETUP_PREFIX_REQUIRED_STATE = "dockerData"
SETUP_PREFIX_HELPER_REVISION = "niceeval-docker-profile-host/docker-data-snapshot/v1"
SETUP_PREFIX_COPY_PROTOCOL = "raw-image/v1"
SETUP_PREFIX_COPY_REVISION = "niceeval-docker-profile-host/raw-image-copy-reuuid/v2"
SETUP_PREFIX_QUIESCE_REVISION = "niceeval-docker-profile-host/docker-data-quiesce/v1"
SETUP_PREFIX_SLOT_ATTESTATION = "independent-fixed-filesystem/v1"
SETUP_PREFIX_FILESYSTEM_FEATURES = [
    "ext4",
    "fixed-size",
    "fully-allocated",
    "independent-image",
]
SETUP_PREFIX_SEED_POLICY = "immutable-unmounted/v1"
SETUP_PREFIX_PUBLICATION_REVISION = "prepared-copy-client-commit-publish/v4"
SETUP_PREFIX_RECOVERY_REVISION = "no-guess-scrub-or-quarantine/v2"
SETUP_PREFIX_MANIFEST_SCHEMA = "niceeval-docker-profile-activation/v2"
SETUP_PREFIX_WIRE_FIELDS = (
    "protocol", "requiredState", "setupPrefixKey", "setupManifestDigest",
    "providerIdentity", "baseIdentity", "executionDomain", "helperRevision",
    "copyProtocol", "copyRevision", "quiesceRevision", "filesystemSizeBytes",
    "publicationRevision", "recoveryRevision", "manifestSchema",
    "filesystemFeatures", "daemonGeneration", "slotGeneration",
)
SETUP_PREFIX_ARTIFACT_BINDING_FIELDS = tuple(
    field for field in SETUP_PREFIX_WIRE_FIELDS if field != "slotGeneration"
)
DIAGNOSTIC_COMMAND = ["sh", "-ec", "\n".join((
    "set -eu",
    "export DOCKER_HOST=unix:///var/run/docker.sock",
    "dockerd --host=unix:///var/run/docker.sock --shutdown-timeout=2 >/tmp/niceeval-dockerd.log 2>&1 &",
    "daemon=$!; image=niceeval-doctor-inner; inner=niceeval-doctor-inner-run; trap 'docker rm -f \"$inner\" >/dev/null 2>&1 || true; docker image rm -f \"$image\" >/dev/null 2>&1 || true; kill \"$daemon\" 2>/dev/null || true; wait \"$daemon\" 2>/dev/null || true' EXIT",
    "for _ in $(seq 1 120); do docker info >/dev/null 2>&1 && break; sleep 0.25; done; docker info >/dev/null",
    "for table in /proc/net/tcp /proc/net/tcp6; do [ ! -r \"$table\" ] || ! awk '$4 == \"0A\" && ($2 ~ /:0947$/ || $2 ~ /:0948$/) { found = 1 } END { exit found ? 1 : 0 }' \"$table\"; done",
    "cpu_max=$(cat /sys/fs/cgroup/cpu.max); memory_max=$(cat /sys/fs/cgroup/memory.max); swap_max=$(cat /sys/fs/cgroup/memory.swap.max); pids_max=$(cat /sys/fs/cgroup/pids.max)",
    "[ \"$cpu_max\" = '200000 100000' ]; [ \"$memory_max\" = '536870912' ]; [ \"$swap_max\" = '0' ]; [ \"$pids_max\" = '256' ]",
    "rootfs='bin/busybox lib'; [ ! -d /lib64 ] || rootfs=\"$rootfs lib64\"",
    "tar -C / -cf - $rootfs | docker import - \"$image\" >/dev/null",
    "docker run --name \"$inner\" --pull=never --network=none \"$image\" /bin/busybox true; docker rm \"$inner\" >/dev/null",
    "docker image rm --force \"$image\" >/dev/null; ! docker container inspect \"$inner\" >/dev/null 2>&1; ! docker image inspect \"$image\" >/dev/null 2>&1",
    "printf '{\"ok\":true,\"unixOnly\":true,\"nestedDocker\":true,\"limits\":{\"cpuMax\":\"%s\",\"memoryMax\":\"%s\",\"swapMax\":\"%s\",\"pidsMax\":\"%s\"}}\\n' \"$cpu_max\" \"$memory_max\" \"$swap_max\" \"$pids_max\"",
))]


def read_exact(reader: Any, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = reader.read(remaining)
        if not chunk:
            raise ProtocolError("build-context-truncated", "build context ended inside a frame")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _activation_file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(16 * 1024 * 1024), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def _verify_fixed_activation(host_config_path: Path, descriptor_path: Path,
                             expected_manifest_digest: str | None = None) -> tuple[dict[str, Any], Any] | None:
    host = json.loads(host_config_path.read_text(encoding="utf-8"))
    if host.get("storage", {}).get("backing") != "fixed-image-ext4":
        return None
    activation = host.get("activation")
    if not isinstance(activation, dict) or activation.get("schema") != SETUP_PREFIX_MANIFEST_SCHEMA:
        raise RuntimeError("fixed watchdog has no activation manifest binding")
    manifest_path = Path(str(activation.get("manifestPath", "")))
    digest_path = Path(str(activation.get("manifestDigestPath", "")))
    lock_path = Path(str(activation.get("lockPath", "")))
    for path in (manifest_path, digest_path, lock_path):
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise RuntimeError("fixed watchdog activation path is absent or not root-owned")
        info = path.stat()
        if info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise RuntimeError("fixed watchdog activation path owner/mode is invalid")
    marker = manifest_path.with_name("activation.pending.json")
    if marker.exists():
        raise RuntimeError("fixed activation has an unresolved transition marker")
    lock_file = lock_path.open("r+b")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        manifest_digest = "sha256:" + hashlib.sha256(encoded).hexdigest()
        expected_digest = digest_path.read_text(encoding="utf-8").strip()
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        host_dependency = host.get("activationDependency", {})
        expected_empty = True if host_dependency.get("class") == "systemd-profile-slice/v1" else None
        if manifest_digest != expected_digest \
                or expected_manifest_digest not in (None, "", manifest_digest) \
                or manifest.get("schema") != SETUP_PREFIX_MANIFEST_SCHEMA \
                or manifest.get("state") != "committed" or manifest.get("backing") != "fixed-image-ext4" \
                or manifest.get("alias") != host.get("name") \
                or manifest.get("profileId") != descriptor.get("profileId") \
                or manifest.get("hostConfigPath") != str(host_config_path.resolve()) \
                or manifest.get("hostConfigDigest") != _activation_file_digest(host_config_path) \
                or manifest.get("descriptorPath") != str(descriptor_path.resolve()) \
                or manifest.get("descriptorDigest") != _activation_file_digest(descriptor_path) \
                or manifest.get("activationDependency", {}).get("class") \
                    != host.get("activationDependency", {}).get("class") \
                or manifest.get("activationDependency", {}).get("cgroupPath") \
                    != host_dependency.get("cgroupPath") \
                or manifest.get("activationDependency", {}).get("emptyAtActivation") != expected_empty:
            raise RuntimeError("fixed activation manifest does not bind the active profile facts")
        for key, actual_path in (
            ("slotRegistry", Path(host["storage"]["slotRegistryPath"])),
            ("seedRegistry", Path(host["setupPrefix"]["seedRegistryPath"])),
        ):
            fact = manifest.get(key, {})
            if fact.get("path") != str(actual_path.resolve()) \
                    or fact.get("digest") != _activation_file_digest(actual_path):
                raise RuntimeError(f"fixed activation manifest does not bind {key}")
        if manifest.get("outerImagePath") != str(Path(host["storage"]["outerImagePath"]).resolve()) \
                or manifest.get("dataMount") != str(Path(host["dataMount"]).resolve()):
            raise RuntimeError("fixed activation manifest does not bind normalized storage paths")
        return manifest, lock_file
    except BaseException:
        lock_file.close()
        raise


def receive_framed_build_context(reader: Any, output: Any) -> int:
    total = 0
    while True:
        length = int.from_bytes(read_exact(reader, 4), "big")
        if length == 0:
            return total
        if length > MAX_BUILD_CONTEXT_CHUNK_BYTES:
            raise ProtocolError("build-context-frame-too-large", "build context frame exceeds four MiB")
        total += length
        if total > MAX_BUILD_CONTEXT_BYTES:
            raise ProtocolError("build-context-too-large", "build context exceeds two GiB")
        output.write(read_exact(reader, length))


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_digest(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()


def parse_host_bytes(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("byte count must not be boolean")
    if isinstance(value, int):
        return value
    match = re.fullmatch(r"([0-9]+)\s*([kmgt]i?b?|b)?", str(value).strip().lower())
    if match is None:
        raise ValueError(f"invalid byte count {value!r}")
    suffix = match.group(2) or ""
    power = {"": 0, "b": 0, "k": 1, "kb": 1, "ki": 1, "kib": 1,
             "m": 2, "mb": 2, "mi": 2, "mib": 2,
             "g": 3, "gb": 3, "gi": 3, "gib": 3,
             "t": 4, "tb": 4, "ti": 4, "tib": 4}[suffix]
    return int(match.group(1)) * 1024**power


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ProtocolError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


SLOT_STATES = ("free", "preparing", "granted", "attaching", "active", "draining",
               "scrubbing", "verified-free", "quarantined")


class Admission:
    def __init__(self, descriptor: Path, journal: Path, docker_socket: str, grace: float,
                 host_config: Path | None = None) -> None:
        self.descriptor_path = descriptor
        self.descriptor = json.loads(descriptor.read_text(encoding="utf-8"))
        self.descriptor_digest = canonical_digest(self.descriptor)
        self.host_config = (json.loads(host_config.read_text(encoding="utf-8"))
                            if host_config is not None else None)
        self.setup_prefix = self._setup_prefix_config()
        self.profile_id = str(self.descriptor["profileId"])
        self.journal = journal
        self.docker_socket = docker_socket
        self.grace = grace
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.build_processes: dict[str, subprocess.Popen[str]] = {}
        self.asset_facts = self._asset_facts()
        self._published_state: dict[str, Any] = {
            "schemaVersion": 1,
            "generation": self._generation(),
            "admissionOpen": True,
            "leases": {},
            "reservations": {},
            "queue": [],
            "degraded": [],
            "slots": {},
            "setupPrefix": {"artifacts": {}, "operations": {}, "seeds": {}},
        }
        self._draft_state: dict[str, Any] | None = None
        initialization_scope = self._begin_transition_scope()
        self._load()
        self.state.setdefault("setupPrefix", {"artifacts": {}, "operations": {}, "seeds": {}})
        self._load_slots()
        self._load_setup_prefix_seeds()
        if self.setup_prefix is not None:
            self._attest_independent_raw_images()
            capacity = os.statvfs(self.setup_prefix["imageRootPath"])
            physical_bytes = capacity.f_blocks * capacity.f_frsize
            if int(self.setup_prefix["filesystemLimitBytes"]) > physical_bytes:
                raise RuntimeError("setup-prefix configured filesystem limit exceeds physical capacity")
            if self._setup_prefix_ledger()["totalBytes"] > int(self.setup_prefix["filesystemLimitBytes"]):
                raise RuntimeError("setup-prefix fixed slot and seed images exceed configured capacity")
        asset_issue = "fixed Docker profile assets are missing, mismatched, or unsupported"
        self.state["degraded"] = [item for item in self.state["degraded"] if item != asset_issue]
        if not self.asset_facts or not all(item.get("present") is True for item in self.asset_facts):
            self.state["admissionOpen"] = False
            self.state["degraded"].append(asset_issue)
        current = self._generation()
        if self.state.get("generation") != current:
            self.state["admissionOpen"] = False
            self.state["generation"] = current
            self._commit("daemon-generation-changed", {})
            self._recover_setup_prefix_operations()
            self._invalidate_stale_setup_prefix_artifacts()
            self.state["admissionOpen"] = not self.state["degraded"]
            self._commit("daemon-generation-reconciled", {})
        self._reconcile_restarted_builds()
        self._recover_setup_prefix_operations()
        # Recovered leases are not durable tombstones. Reconcile legacy
        # journals and same-generation restarts before the ready boundary so a
        # prior interrupted invocation cannot retain ledger ownership.
        self._recover_once()
        if self._draft_state != self._published_state:
            self._commit("watchdog-initialized", {})
        self._end_transition_scope(initialization_scope)

    @property
    def state(self) -> dict[str, Any]:
        return self._draft_state if self._draft_state is not None else self._published_state

    @state.setter
    def state(self, value: dict[str, Any]) -> None:
        if self._draft_state is None:
            self._published_state = value
        else:
            self._draft_state = value

    def _begin_transition_scope(self) -> bool:
        if self._draft_state is not None:
            return False
        self._draft_state = copy.deepcopy(self._published_state)
        return True

    def _end_transition_scope(self, owner: bool) -> None:
        if owner:
            self._draft_state = None

    @contextmanager
    def _transition(self) -> Any:
        """Hold the state lock only for one durable state mutation.

        Docker side effects deliberately live between these blocks.  In
        particular, a long build must not prevent a heartbeat or cancellation
        from reaching the control service.
        """
        with self.lock:
            owner = self._begin_transition_scope()
            try:
                yield self.state
            finally:
                self._end_transition_scope(owner)

    def _load_slots(self) -> None:
        storage = self.host_config.get("storage", {}) if self.host_config else {}
        pool = self.descriptor.get("backend", {}).get("filesystem", {}).get("dockerDataPool")
        config = ({"registryPath": storage.get("slotRegistryPath"),
                   "rootPath": storage.get("slotRootPath"),
                   "count": pool.get("count") if pool else None}
                  if storage and pool else None)
        if not config:
            return
        if not all(config.values()):
            self.state["admissionOpen"] = False
            self.state["degraded"].append("host quota-slot paths are incomplete")
            return
        registry = Path(config["registryPath"])
        if not registry.is_file():
            self.state["admissionOpen"] = False
            message = "project-quota slot registry is absent; admission fails closed"
            if message not in self.state["degraded"]:
                self.state["degraded"].append(message)
            return
        installed = json.loads(registry.read_text(encoding="utf-8"))
        root = Path(config["rootPath"]).resolve()
        expected_attestation = str(pool["attestation"])
        registry_attestation = installed.get("slotAttestation", "linux-project-quota/v1")
        if registry_attestation != expected_attestation:
            self.state["admissionOpen"] = False
            self.state["degraded"].append("slot registry attestation does not match descriptor")
            return
        existing = self.state.setdefault("slots", {})
        for raw in installed.get("slots", []):
            slot_id = str(raw["slotId"])
            source = Path(str(raw["path"]))
            if source.is_symlink() or source.resolve().parent != root or source.name != slot_id:
                self.state["admissionOpen"] = False
                self.state["degraded"].append(f"slot registry path is not attested for {slot_id}")
                continue
            if raw.get("attestation", registry_attestation) != expected_attestation:
                self.state["admissionOpen"] = False
                self.state["degraded"].append(f"slot attestation is invalid for {slot_id}")
                continue
            immutable = {key: raw.get(key) for key in (
                "path", "imagePath", "filesystemIdentity", "attestation", "limitBytes",
                "baselineUsageBytes", "ownerUid", "ownerGid", "mode", "fsType", "mountOptions",
            )}
            immutable["attestation"] = raw.get("attestation", registry_attestation)
            current = existing.get(slot_id)
            if current is not None and any(current.get(key) != value for key, value in immutable.items()):
                self.state["admissionOpen"] = False
                self.state["degraded"].append(f"slot registry facts changed for {slot_id}")
                continue
            existing.setdefault(slot_id, {**raw, "attestation": expected_attestation,
                                           "state": "free", "generation": int(raw.get("generation", 0))})
        if len(existing) != int(config["count"]):
            self.state["admissionOpen"] = False
            self.state["degraded"].append("project-quota slot count does not match descriptor")

    def _setup_prefix_config(self) -> dict[str, Any] | None:
        capability = self.descriptor.get("backend", {}).get("filesystem", {}).get("setupPrefix")
        raw = (self.host_config or {}).get("setupPrefix")
        if capability is None:
            if isinstance(raw, dict) and raw.get("enabled") is True:
                raise RuntimeError("host setupPrefix is enabled but descriptor capability is absent")
            return None
        if not isinstance(raw, dict) or raw.get("enabled") is not True:
            raise RuntimeError("descriptor setupPrefix capability has no enabled host configuration")
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
            "manifestSchema": SETUP_PREFIX_MANIFEST_SCHEMA,
        }
        if any(capability.get(key) != value or raw.get(key) != value
               for key, value in expected.items()):
            raise RuntimeError("descriptor and host setupPrefix revisions do not match dockerData-only v1")
        storage = (self.host_config or {}).get("storage", {})
        pool = self.descriptor.get("backend", {}).get("filesystem", {}).get("dockerDataPool", {})
        if storage.get("backing") == "loop-ext4" \
                or storage.get("slotAttestation") != SETUP_PREFIX_SLOT_ATTESTATION \
                or pool.get("attestation") != SETUP_PREFIX_SLOT_ATTESTATION:
            raise RuntimeError("setupPrefix is forbidden for shared loop-ext4/project-quota slots")
        registry = Path(str(raw.get("seedRegistryPath", "")))
        if not registry.is_absolute() or registry.is_symlink() or not registry.is_file():
            raise RuntimeError("setupPrefix seedRegistryPath must be an existing real absolute file")
        image_root = Path(str(raw.get("imageRootPath", "")))
        if not image_root.is_absolute() or image_root.is_symlink() or not image_root.is_dir():
            raise RuntimeError("setupPrefix imageRootPath must be an existing real absolute directory")
        image_root = image_root.resolve()
        image_root_stat = image_root.stat()
        actual_filesystem_identity = (
            f"dev={image_root_stat.st_dev}:ino={image_root_stat.st_ino}"
        )
        if raw.get("filesystemIdentity") != actual_filesystem_identity \
                or capability.get("filesystemIdentity") != actual_filesystem_identity:
            raise RuntimeError(
                "setupPrefix filesystem identity does not match the actual image root or descriptor"
            )
        copy_strategy = raw.get("copyStrategy")
        if copy_strategy != "raw-image/v1":
            raise RuntimeError("setupPrefix copy strategy must be raw-image/v1")
        seed_limit = int(capability.get("seedLimitBytes", 0))
        filesystem_limit = parse_host_bytes(raw.get("filesystemLimitBytes", 0))
        filesystem_size = int(capability.get("filesystemSizeBytes", 0))
        configured_size = parse_host_bytes(raw.get("filesystemSizeBytes", 0))
        configured_seed_limit = parse_host_bytes(raw.get("seedLimitBytes", 0))
        pool_size = int(pool.get("bytesPerAllocation", 0))
        if seed_limit <= 0 or configured_seed_limit != seed_limit \
                or filesystem_limit <= 0 or seed_limit > filesystem_limit:
            raise RuntimeError("setupPrefix capacity limits are invalid")
        if filesystem_size <= 0 or configured_size != filesystem_size or pool_size != filesystem_size:
            raise RuntimeError("setupPrefix filesystem size does not match its fixed Docker data allocation")
        if capability.get("filesystemFeatures") != SETUP_PREFIX_FILESYSTEM_FEATURES \
                or raw.get("filesystemFeatures") != SETUP_PREFIX_FILESYSTEM_FEATURES:
            raise RuntimeError("setupPrefix filesystem features are not the fixed raw-image feature set")
        provider_identity = capability.get("providerIdentity")
        execution_domain = capability.get("executionDomain")
        if not isinstance(provider_identity, str) or re.fullmatch(r"sha256:[a-f0-9]{64}", provider_identity) is None \
                or not isinstance(execution_domain, str) or re.fullmatch(r"sha256:[a-f0-9]{64}", execution_domain) is None:
            raise RuntimeError("setupPrefix provider identity or execution domain is invalid")
        filesystem = self.descriptor["backend"]["filesystem"]
        expected_provider_identity = canonical_digest({
            "schemaVersion": 1,
            "profileId": self.descriptor["profileId"],
            "securityLevel": self.descriptor["securityLevel"],
            "semanticPolicyRevision": self.descriptor["semanticPolicyRevision"],
            "hostMachineIdentity": self.descriptor["transport"]["hostMachineIdentity"],
            "backendMachineIdentity": self.descriptor["backend"]["machineIdentity"],
            "dockerDataFilesystemIdentity": filesystem["identity"],
            "dockerDataPool": filesystem["dockerDataPool"],
            "dockerDataSnapshot": {
                **expected,
                "filesystemSizeBytes": filesystem_size,
                "filesystemFeatures": SETUP_PREFIX_FILESYSTEM_FEATURES,
            },
        })
        expected_execution_domain = canonical_digest({
            "schemaVersion": 1,
            "profileId": self.descriptor["profileId"],
            "hostMachineIdentity": self.descriptor["transport"]["hostMachineIdentity"],
            "backendMachineIdentity": self.descriptor["backend"]["machineIdentity"],
            "dockerDataFilesystemIdentity": filesystem["identity"],
            "slotAttestation": pool["attestation"],
        })
        if provider_identity != expected_provider_identity or execution_domain != expected_execution_domain:
            raise RuntimeError("setupPrefix provider identity or execution domain does not match the descriptor")
        return {
            **expected,
            "seedRegistryPath": registry,
            "imageRootPath": image_root,
            "copyStrategy": copy_strategy,
            "seedLimitBytes": seed_limit,
            "filesystemLimitBytes": filesystem_limit,
            "filesystemSizeBytes": filesystem_size,
            "filesystemFeatures": list(SETUP_PREFIX_FILESYSTEM_FEATURES),
            "filesystemIdentity": actual_filesystem_identity,
            "providerIdentity": provider_identity,
            "executionDomain": execution_domain,
        }

    def _load_setup_prefix_seeds(self) -> None:
        if self.setup_prefix is None:
            return
        installed = json.loads(self.setup_prefix["seedRegistryPath"].read_text(encoding="utf-8"))
        if installed.get("schemaVersion") != 1 \
                or installed.get("slotAttestation") != SETUP_PREFIX_SLOT_ATTESTATION \
                or installed.get("filesystemIdentity") != self.setup_prefix["filesystemIdentity"]:
            raise RuntimeError("setup-prefix seed registry attestation is invalid")
        seeds = self.state["setupPrefix"].setdefault("seeds", {})
        total = 0
        installed_ids: set[str] = set()
        for raw in installed.get("seeds", []):
            seed_id = str(raw.get("seedId", ""))
            path = Path(str(raw.get("path", "")))
            if re.fullmatch(r"seed-[a-z0-9]{8,64}", seed_id) is None or not path.is_absolute() \
                    or path.is_symlink() or not path.is_dir() \
                    or raw.get("attestation") != SETUP_PREFIX_SLOT_ATTESTATION:
                raise RuntimeError(f"setup-prefix seed {seed_id!r} is not independently attested")
            try:
                _, _, image_limit = self._raw_image_record(raw)
            except Exception as error:
                raise RuntimeError(f"setup-prefix seed {seed_id!r} raw image is invalid: {error}") from error
            if image_limit != int(self.setup_prefix["filesystemSizeBytes"]):
                raise RuntimeError(f"setup-prefix seed {seed_id!r} does not match the fixed filesystem size")
            if self._raw_image_mount_source(path) is not None:
                owned_recovery = any(
                    operation.get("kind") in ("capture", "stale-artifact")
                    and operation.get("seedId") == seed_id
                    for operation in self.state["setupPrefix"].get("operations", {}).values()
                )
                if not owned_recovery:
                    raise RuntimeError(f"setup-prefix seed {seed_id!r} must remain unmounted")
            seed_options = {str(item) for item in raw.get("mountOptions", [])}
            if not {"ro", "noload"}.issubset(seed_options):
                raise RuntimeError(f"setup-prefix seed {seed_id!r} must be mounted ro,noload")
            limit = int(raw.get("limitBytes", 0))
            if limit <= 0 or limit != image_limit:
                raise RuntimeError(f"setup-prefix seed {seed_id!r} has no fixed size")
            if seed_id in installed_ids:
                raise RuntimeError(f"setup-prefix seed {seed_id!r} is duplicated")
            installed_ids.add(seed_id)
            total += limit
            existing = seeds.get(seed_id)
            immutable = {key: raw.get(key) for key in (
                "path", "imagePath", "filesystemIdentity", "attestation", "limitBytes",
                "baselineUsageBytes", "ownerUid", "ownerGid", "mode", "fsType", "mountOptions",
            )}
            if existing is not None and any(existing.get(key) != value for key, value in immutable.items()):
                raise RuntimeError(f"setup-prefix seed {seed_id!r} registry facts changed across restart")
            seeds.setdefault(seed_id, {**raw, "seedId": seed_id, "limitBytes": limit, "state": "free"})
        if set(seeds) != installed_ids or not seeds or total != int(self.setup_prefix["seedLimitBytes"]):
            raise RuntimeError("setup-prefix fixed seed filesystems do not equal seedLimitBytes")

    def _attest_independent_raw_images(self) -> None:
        assert self.setup_prefix is not None
        expected_size = int(self.setup_prefix["filesystemSizeBytes"])
        image_paths: set[Path] = set()
        image_inodes: set[tuple[int, int]] = set()
        filesystem_identities: set[str] = set()
        records = [*self.state["slots"].values(),
                   *self.state["setupPrefix"]["seeds"].values()]
        for record in records:
            mountpoint, image, limit = self._raw_image_record(record)
            if limit != expected_size:
                raise RuntimeError("independent raw-image registry contains a mismatched fixed size")
            image_path = image.resolve()
            image_info = image.stat()
            image_inode = (image_info.st_dev, image_info.st_ino)
            filesystem_identity = str(record.get("filesystemIdentity", ""))
            if image_info.st_nlink != 1 or image_path in image_paths or image_inode in image_inodes \
                    or filesystem_identity in filesystem_identities:
                raise RuntimeError("slot and seed raw images are not pairwise independent")
            image_paths.add(image_path)
            image_inodes.add(image_inode)
            filesystem_identities.add(filesystem_identity)
            is_seed = "seedId" in record
            options = set(record.get("mountOptions", []))
            if is_seed:
                if not {"ro", "noload"}.issubset(options) \
                        or self._raw_image_mount_source(mountpoint) is not None:
                    raise RuntimeError("published seed policy requires immutable unmounted raw images")
            elif "rw" not in options:
                raise RuntimeError("Docker data slots must have an explicit writable mount policy")
            if not is_seed and record.get("state") == "free":
                facts = self._slot_facts(record)
                expected = {
                    "projectId": int(record.get("projectId", 0)),
                    "usageBytes": int(record.get("baselineUsageBytes", 0)),
                    "hardBytes": expected_size,
                    "uid": int(record["ownerUid"]),
                    "gid": int(record["ownerGid"]),
                    "mode": int(record.get("mode", 0o700)),
                }
                if facts != expected:
                    raise RuntimeError("free independent Docker data slot does not match registry facts")

    def _docker(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", "--host", f"unix://{self.docker_socket}", *args],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
            timeout=30,
        )

    def _generation(self) -> str:
        try:
            info = json.loads(self._docker("info", "--format", "{{json .}}", check=True).stdout)
            daemon_id = str(info.get("ID", "unknown"))
        except Exception as error:
            raise RuntimeError(f"Docker daemon identity is unavailable: {error}") from error
        sock = os.stat(self.docker_socket)
        asset_identity = canonical_digest(self.asset_facts if hasattr(self, "asset_facts") else [])
        return hashlib.sha256(f"{daemon_id}:{sock.st_ino}:{sock.st_ctime_ns}:{asset_identity}".encode()).hexdigest()[:32]

    def _asset_facts(self) -> list[dict[str, Any]]:
        manifest_path = (self.host_config or {}).get("assets", {}).get("manifestPath")
        if not isinstance(manifest_path, str):
            return []
        try:
            manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
            images = manifest.get("images", [])
            if manifest.get("schemaVersion") != 1 or manifest.get("platform") != "linux/amd64" or not isinstance(images, list):
                raise ValueError("images must be a list")
            declared = {item.get("reference") for item in images if isinstance(item, dict)}
            if declared != REQUIRED_ASSETS:
                raise ValueError("manifest must contain exactly the fixed DIND and BuildKit identities")
            facts: list[dict[str, Any]] = []
            for image in images:
                reference = image.get("reference") if isinstance(image, dict) else None
                platform = image.get("platform") if isinstance(image, dict) else None
                if (not isinstance(reference, str) or "@sha256:" not in reference
                        or platform != "linux/amd64"):
                    raise ValueError("image reference must be digest pinned")
                inspect = self._docker("image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", reference, check=False)
                present = inspect.returncode == 0 and inspect.stdout.strip() == platform
                facts.append({"reference": reference, "platform": platform, "present": present})
            return facts
        except Exception as error:
            return [{"reference": "invalid-manifest", "present": False, "error": str(error)}]

    def _load(self) -> None:
        if not self.journal.exists():
            return
        last: dict[str, Any] | None = None
        raw = self.journal.read_text(encoding="utf-8")
        if raw and not raw.endswith("\n"):
            raise RuntimeError("watchdog journal is truncated; admission fails closed")
        for line in raw.splitlines():
            try:
                item = json.loads(line)
                if isinstance(item.get("state"), dict):
                    last = item["state"]
                else:
                    raise ValueError("journal record has no state")
            except (json.JSONDecodeError, ValueError) as error:
                raise RuntimeError("watchdog journal is corrupt; admission fails closed") from error
        if last is not None:
            self._published_state = last
            if self._draft_state is not None:
                self._draft_state = copy.deepcopy(last)

    def _commit(self, event: str, detail: dict[str, Any]) -> None:
        next_state = copy.deepcopy(self.state)
        self.journal.parent.mkdir(parents=True, exist_ok=True)
        record = {"at": now(), "event": event, "detail": detail, "state": next_state}
        encoded = json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n"
        fd = os.open(self.journal, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        offset = os.lseek(fd, 0, os.SEEK_END)
        try:
            os.write(fd, encoded.encode())
            os.fsync(fd)
            # Publish a detached snapshot.  Keep the current draft object so
            # local references held by a multi-stage transition remain valid;
            # its later, uncommitted mutations remain invisible and are
            # discarded when the scope ends.
            self._published_state = copy.deepcopy(next_state)
        except Exception:
            # If append reached the page cache but fsync rejected it, do not
            # leave a readable record that a restart could mistake for a
            # durable transition.
            os.ftruncate(fd, offset)
            self._draft_state = copy.deepcopy(self._published_state)
            raise
        finally:
            os.close(fd)

    def _lease(self, request: dict[str, Any], active: bool = True) -> dict[str, Any]:
        invocation_id = str(request.get("invocationId", ""))
        lease = self.state["leases"].get(invocation_id)
        if lease is None:
            raise ProtocolError("lease-not-found", f"unknown invocation {invocation_id}")
        token = str(request.get("leaseToken", ""))
        if not hmac.compare_digest(lease["tokenDigest"], token_digest(token)):
            raise ProtocolError("lease-auth-failed", "lease token does not match")
        if active and lease["state"] != "active":
            raise ProtocolError("lease-not-active", f"lease is {lease['state']}")
        return lease

    def _capacity(self) -> dict[str, float]:
        cap = self.descriptor["capacity"]
        return {
            "cpus": float(cap["cpus"]),
            "memoryBytes": float(cap["memoryBytes"]),
            "pids": float(cap["pids"]),
            "containers": float(cap["maxContainers"]),
            "builds": float(cap["maxBuilds"]),
            "ephemeralDiskBytes": float(cap.get("ephemeralDiskBytes", 0)),
        }

    def _used(self) -> dict[str, float]:
        used = {"cpus": 0.0, "memoryBytes": 0.0, "pids": 0.0, "containers": 0.0, "builds": 0.0, "ephemeralDiskBytes": 0.0}
        for reservation in self.state["reservations"].values():
            if reservation["state"] not in ("granted", "provisioning", "committed", "restoring", "releasing", "quarantined"):
                continue
            resources = reservation["resources"]
            for key in ("cpus", "memoryBytes", "pids", "containers", "ephemeralDiskBytes"):
                used[key] += float(resources.get(key, 0))
            used["builds"] += 1 if reservation["kind"] == "build" else 0
        return used

    def _fits(self, resources: dict[str, Any], kind: str) -> bool:
        used, cap = self._used(), self._capacity()
        for key in ("cpus", "memoryBytes", "pids", "containers", "ephemeralDiskBytes"):
            if used[key] + float(resources.get(key, 0)) > cap[key]:
                return False
        return used["builds"] + (1 if kind == "build" else 0) <= cap["builds"]

    def _grant_queue(self) -> None:
        while self.state["queue"]:
            reservation = self.state["reservations"].get(self.state["queue"][0])
            if reservation is None or reservation["state"] != "queued":
                self.state["queue"].pop(0)
                continue
            created = datetime.fromisoformat(str(reservation["createdAt"]).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - created).total_seconds() >= QUEUE_TIMEOUT_SECONDS:
                self.state["queue"].pop(0)
                reservation["state"] = "blocked"
                reservation["blockedAt"] = now()
                self._commit("reservation-blocked", {"reservationId": reservation["reservationId"], "reason": "capacity-queue-timeout"})
                continue
            if not self._fits(reservation["resources"], reservation["kind"]):
                break
            if reservation["kind"] == "container":
                available = next((s for s in self.state["slots"].values() if s["state"] == "free"), None)
                if available is None:
                    break
                available["state"] = "preparing"
                available["invocationId"] = reservation["invocationId"]
                available["reservationId"] = reservation["reservationId"]
                available["provisionToken"] = reservation["provisionToken"]
                reservation["slotId"] = available["slotId"]
                reservation["slotGeneration"] = available["generation"]
                self._commit("slot-preparing", {"slotId": available["slotId"], "reservationId": reservation["reservationId"]})
                available["state"] = "granted"
            reservation["state"] = "granted"
            reservation["grantedAt"] = now()
            self.state["queue"].pop(0)
            self._commit("reservation-granted", {"reservationId": reservation["reservationId"]})

    def _quarantine(self, reservation: dict[str, Any], reason: str) -> None:
        slot_id = reservation.get("slotId")
        if slot_id in self.state["slots"]:
            slot = self.state["slots"][slot_id]
            slot["state"] = "quarantined"
            slot["quarantineReason"] = reason
        reservation["state"] = "quarantined"
        if reason not in self.state["degraded"]:
            self.state["degraded"].append(reason)
        self._commit("slot-quarantined", {"slotId": slot_id, "reservationId": reservation["reservationId"], "reason": reason})

    def _run_host(self, *args: str, check: bool = True, timeout: float = 30) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              check=check, timeout=timeout)

    def _slot_facts(self, slot: dict[str, Any]) -> dict[str, Any]:
        path = Path(slot["path"])
        st = path.lstat()
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            raise RuntimeError("slot is not a real directory")
        if slot.get("attestation") == SETUP_PREFIX_SLOT_ATTESTATION:
            _, image, hard = self._raw_image_record(slot)
            source = self._run_host("findmnt", "-n", "-o", "SOURCE", "--target", str(path)).stdout.strip()
            target = self._run_host("findmnt", "-n", "-o", "TARGET", "--target", str(path)).stdout.strip()
            loop_devices = self._run_host("losetup", "-j", str(image), check=False).stdout
            if Path(target).resolve() != path.resolve() or not source.startswith("/dev/loop") \
                    or source not in loop_devices:
                raise RuntimeError("independent slot is not loop-mounted from its attested image")
            filesystem = os.statvfs(path)
            return {
                "projectId": int(slot.get("projectId", 0)),
                "usageBytes": (filesystem.f_blocks - filesystem.f_bfree) * filesystem.f_frsize,
                "hardBytes": hard,
                "uid": st.st_uid,
                "gid": st.st_gid,
                "mode": stat.S_IMODE(st.st_mode),
            }
        project = self._run_host("lsattr", "-p", "-d", str(path)).stdout.split()[0]
        mount = str(Path(self.descriptor["backend"]["filesystem"]["mountPath"]))
        quota = self._run_host("repquota", "-P", "-O", "csv", mount).stdout
        usage: int | None = None
        hard: int | None = None
        for line in quota.splitlines():
            fields = [field.strip().strip('"') for field in line.split(",")]
            if fields and fields[0].lstrip("#") == str(slot["projectId"]):
                numbers = [int(field) for field in fields[1:] if field.isdigit()]
                if len(numbers) >= 3:
                    usage, hard = numbers[0] * 1024, numbers[2] * 1024
                    break
        if usage is None or hard is None:
            raise RuntimeError("project quota usage is not reportable")
        return {"projectId": int(project), "usageBytes": usage, "hardBytes": hard,
                "uid": st.st_uid, "gid": st.st_gid, "mode": stat.S_IMODE(st.st_mode)}

    def _slot_references(self, slot: dict[str, Any]) -> list[str]:
        source = str(Path(slot["path"]).resolve())
        refs: list[str] = []
        for line in Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines():
            fields = line.split()
            # The attested fixed filesystem's own host mount is expected. Any
            # nested/bind mount or namespace-visible source reference is not.
            base_mount = len(fields) > 4 and fields[3] == "/" and fields[4] == source
            if len(fields) > 4 and not base_mount and (
                fields[3] == source or fields[4] == source
                or fields[3].startswith(source + "/") or fields[4].startswith(source + "/")
            ):
                refs.append("mount:" + line)
        for proc in Path("/proc").iterdir():
            if not proc.name.isdigit() or int(proc.name) == os.getpid():
                continue
            for leaf in ("cwd", "root"):
                try:
                    target = os.readlink(proc / leaf)
                    if target == source or target.startswith(source + "/"):
                        refs.append(f"pid:{proc.name}:{leaf}")
                except OSError:
                    pass
            try:
                for fd in (proc / "fd").iterdir():
                    try:
                        target = os.readlink(fd)
                        if target == source or target.startswith(source + "/"):
                            refs.append(f"pid:{proc.name}:fd")
                            break
                    except OSError:
                        pass
            except OSError:
                pass
        return refs

    def _scrub_fd(self, directory_fd: int) -> None:
        for name in os.listdir(directory_fd):
            item = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(item.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
                try:
                    self._scrub_fd(child)
                finally:
                    os.close(child)
                os.rmdir(name, dir_fd=directory_fd)
            else:
                os.unlink(name, dir_fd=directory_fd)

    def _scrub_slot(self, slot: dict[str, Any]) -> None:
        root_fd = os.open(slot["path"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            self._scrub_fd(root_fd)
            os.fsync(root_fd)
        finally:
            os.close(root_fd)

    @staticmethod
    def _raw_image_digest(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(16 * 1024 * 1024), b""):
                digest.update(block)
        return "sha256:" + digest.hexdigest()

    def _raw_image_identity(self, path: Path) -> str:
        result = self._run_host("blkid", "-s", "UUID", "-o", "value", str(path))
        value = result.stdout.strip().lower()
        fstype = self._run_host("blkid", "-s", "TYPE", "-o", "value", str(path)).stdout.strip()
        if fstype != "ext4" or re.fullmatch(r"[0-9a-f-]{16,64}", value) is None:
            raise RuntimeError("raw dockerData image has no attested ext4 UUID")
        return f"ext4-uuid:{value}"

    def _raw_image_record(self, record: dict[str, Any]) -> tuple[Path, Path, int]:
        mountpoint = Path(str(record.get("path", "")))
        image = Path(str(record.get("imagePath", "")))
        limit = int(record.get("limitBytes", 0))
        if not mountpoint.is_absolute() or mountpoint.is_symlink() or not mountpoint.is_dir():
            raise RuntimeError("raw dockerData mountpoint is not an attested real directory")
        if not image.is_absolute() or image.is_symlink() or not image.is_file():
            raise RuntimeError("raw dockerData image is not an attested real file")
        image_root = self.setup_prefix.get("imageRootPath") if self.setup_prefix else None
        if image_root is None or image.resolve().parent != Path(image_root).resolve() \
                or image.parent.is_symlink():
            raise RuntimeError("raw dockerData image escaped its attested image root")
        image_info = image.lstat()
        if not stat.S_ISREG(image_info.st_mode) or image_info.st_size != limit or limit <= 0:
            raise RuntimeError("raw dockerData image does not have its fixed logical size")
        if image_info.st_blocks * 512 < limit:
            raise RuntimeError("raw dockerData image is not fully allocated")
        options = record.get("mountOptions", [])
        allowed_options = {"rw", "ro", "noload", "noatime", "nodev", "nosuid"}
        if record.get("fsType") != "ext4" or not isinstance(options, list) \
                or any(not isinstance(item, str) or item not in allowed_options for item in options) \
                or len({"rw", "ro"} & set(options)) != 1:
            raise RuntimeError("raw dockerData registry lacks fixed ext4 remount facts")
        identity = record.get("filesystemIdentity")
        if not isinstance(identity, str) or not identity.startswith("ext4-uuid:") \
                or identity != self._raw_image_identity(image):
            raise RuntimeError("raw dockerData registry lacks a filesystem identity")
        return mountpoint, image, limit

    def _raw_image_mount_source(self, mountpoint: Path) -> str | None:
        found = self._run_host(
            "findmnt", "-n", "-o", "SOURCE,TARGET", "--mountpoint", str(mountpoint), check=False
        )
        if found.returncode != 0 or not found.stdout.strip():
            return None
        fields = found.stdout.strip().split()
        if len(fields) != 2:
            raise RuntimeError("raw dockerData mountpoint has an invalid findmnt result")
        if Path(fields[1]).resolve() != mountpoint.resolve():
            return None
        return fields[0]

    def _mount_raw_image(
        self,
        record: dict[str, Any],
        mount_options: list[str] | None = None,
    ) -> None:
        mountpoint, image, _ = self._raw_image_record(record)
        options = [
            "loop",
            *(
                mount_options
                if mount_options is not None
                else [str(item) for item in record.get("mountOptions", [])]
            ),
        ]
        self._run_host(
            "mount", "-t", "ext4", "-o", ",".join(options), "--", str(image), str(mountpoint)
        )
        self._run_host("mount", "--make-rprivate", "--", str(mountpoint))

    def _ensure_raw_image_mounted(self, record: dict[str, Any]) -> None:
        mountpoint, _, _ = self._raw_image_record(record)
        if self._raw_image_mount_source(mountpoint) is None:
            self._mount_raw_image(record)

    def _restore_fixed_slot_allocation(self, slot: dict[str, Any]) -> None:
        """Restore physical allocation lost while scrubbing a writable ext4 slot."""
        if slot.get("attestation") != SETUP_PREFIX_SLOT_ATTESTATION:
            return
        mountpoint = Path(str(slot["path"]))
        image = Path(str(slot["imagePath"]))
        limit = int(slot["limitBytes"])
        if self._slot_references(slot):
            raise RuntimeError("fixed slot still has a nested mount or process reference")
        if self._raw_image_mount_source(mountpoint) is not None:
            self._run_host("umount", "--", str(mountpoint))
        try:
            self._run_host("fallocate", "-l", str(limit), "--", str(image))
            info = image.stat()
            if info.st_size != limit or info.st_blocks * 512 < limit:
                raise RuntimeError("fixed slot physical allocation could not be restored after scrub")
        finally:
            if self._raw_image_mount_source(mountpoint) is None:
                self._mount_raw_image(slot)

    def _scrub_setup_prefix_seed(
        self,
        seed: dict[str, Any],
        *,
        recover_mounted: bool = False,
    ) -> None:
        """Scrub an unpublished seed under exclusive journaled ownership.

        Published seeds are never mounted. A failed capture temporarily mounts
        its unpublished target writable, scrubs it, and leaves it unmounted
        before the seed can return to the free pool.
        """
        mountpoint, _, _ = self._raw_image_record(seed)
        if self._raw_image_mount_source(mountpoint) is not None:
            if not recover_mounted:
                raise RuntimeError("setup-prefix seed unexpectedly remained mounted before scrub")
            self._run_host("umount", "--", str(mountpoint))
        if self._slot_references(seed):
            raise RuntimeError("setup-prefix seed has an external mount or process reference")
        mounted = False
        try:
            self._mount_raw_image(seed, ["rw", "noatime", "nodev", "nosuid"])
            mounted = True
            self._scrub_slot(seed)
            if os.listdir(mountpoint):
                raise RuntimeError("setup-prefix seed is not empty after scrub")
        finally:
            if mounted and self._raw_image_mount_source(mountpoint) is not None:
                self._run_host("umount", "--", str(mountpoint))
        if self._raw_image_mount_source(mountpoint) is not None:
            raise RuntimeError("setup-prefix seed remained mounted after scrub")

    @staticmethod
    def _temporary_clone_path(target_image: Path, operation_id: str) -> Path:
        if not isinstance(operation_id, str) or not operation_id \
                or len(operation_id.encode("utf-8")) > 512 \
                or any(ord(character) < 0x20 or ord(character) == 0x7f for character in operation_id):
            raise RuntimeError("raw dockerData operation identity is invalid")
        safe_operation_id = hashlib.sha256(operation_id.encode("utf-8")).hexdigest()[:32]
        return target_image.with_name(f".{target_image.name}.niceeval-{safe_operation_id}.clone")

    def _remove_temporary_clone(self, target: dict[str, Any], operation_id: str) -> None:
        _, target_image, _ = self._raw_image_record(target)
        temporary = self._temporary_clone_path(target_image, operation_id)
        if temporary.is_symlink() or (temporary.exists() and not temporary.is_file()):
            raise RuntimeError("raw dockerData temporary clone is not a regular file")
        temporary.unlink(missing_ok=True)
        parent_fd = os.open(target_image.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)

    def _copy_raw_image(self, source: dict[str, Any], target: dict[str, Any],
                        operation_id: str) -> str:
        source_mount, source_image, source_limit = self._raw_image_record(source)
        target_mount, target_image, target_limit = self._raw_image_record(target)
        if source_limit != target_limit:
            raise RuntimeError("raw dockerData copy requires equal fixed filesystem sizes")
        if source_image.resolve() == target_image.resolve() \
                or source_image.stat().st_ino == target_image.stat().st_ino \
                and source_image.stat().st_dev == target_image.stat().st_dev:
            raise RuntimeError("raw dockerData source and target images are not independent")
        for record in (source, target):
            if self._slot_references(record):
                raise RuntimeError("raw dockerData filesystem still has a nested mount or open process user")

        temporary = self._temporary_clone_path(target_image, operation_id)
        if temporary.exists() or temporary.is_symlink():
            raise RuntimeError("raw dockerData temporary clone already exists")
        target_info = target_image.stat()
        source_identity = self._raw_image_identity(source_image)
        target_identity = self._raw_image_identity(target_image)
        expected_target_identity = str(target["filesystemIdentity"])
        if source_identity != source.get("filesystemIdentity") \
                or target_identity != expected_target_identity \
                or source_identity == target_identity:
            raise RuntimeError("raw dockerData source/target UUID attestation is not independent")
        target_previous_digest = self._raw_image_digest(target_image)
        unmounted: list[dict[str, Any]] = []
        published = False
        try:
            os.sync()
            # Target first prevents an accidental writer from observing a
            # destination while the source is being frozen.
            for record, mountpoint in ((target, target_mount), (source, source_mount)):
                if self._raw_image_mount_source(mountpoint) is not None:
                    self._run_host("umount", "--", str(mountpoint))
                    unmounted.append(record)
            self._run_host(
                "cp", "--sparse=never", "--reflink=never", "--",
                str(source_image), str(temporary), timeout=15 * 60,
            )
            os.chown(temporary, target_info.st_uid, target_info.st_gid)
            os.chmod(temporary, stat.S_IMODE(target_info.st_mode))
            self._run_host("sync", "-f", "--", str(temporary))
            source_digest = self._raw_image_digest(source_image)
            transferred_digest = self._raw_image_digest(temporary)
            if source_digest != transferred_digest:
                raise RuntimeError("raw dockerData image digest verification failed")
            self._record_copy_stage(operation_id, "copied", {
                "sourceArtifactDigest": source_digest,
                "sourceFilesystemIdentity": source_identity,
                "targetPreviousDigest": target_previous_digest,
                "targetPreviousFilesystemIdentity": target_identity,
                "expectedTargetFilesystemIdentity": expected_target_identity,
                "temporaryTransferredDigest": transferred_digest,
            })
            expected_uuid = expected_target_identity.removeprefix("ext4-uuid:")
            self._run_host("tune2fs", "-U", expected_uuid, str(temporary), timeout=15 * 60)
            self._record_copy_stage(operation_id, "reuuid", {
                "expectedTargetFilesystemIdentity": expected_target_identity,
            })
            self._run_host("fallocate", "-l", str(target_limit), "--", str(temporary))
            checked = self._run_host("e2fsck", "-fn", str(temporary), check=False, timeout=15 * 60)
            if checked.returncode not in (0, 1):
                raise RuntimeError("raw dockerData ext4 verification failed")
            clone_info = temporary.stat()
            if clone_info.st_size != target_limit or clone_info.st_blocks * 512 < target_limit:
                raise RuntimeError("raw dockerData temporary image is not fixed-size and fully allocated")
            if self._raw_image_identity(temporary) != expected_target_identity:
                raise RuntimeError("raw dockerData temporary image UUID differs after re-UUID")
            final_digest = self._raw_image_digest(temporary)
            self._record_copy_stage(operation_id, "attested", {
                "temporaryFinalDigest": final_digest,
                "expectedTargetFilesystemIdentity": expected_target_identity,
            })
            os.replace(temporary, target_image)
            parent_fd = os.open(target_image.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            published = True
            if self._raw_image_identity(target_image) != expected_target_identity \
                    or self._raw_image_digest(target_image) != final_digest:
                raise RuntimeError("raw dockerData atomic replacement attestation failed")
            self._record_copy_stage(operation_id, "replaced", {
                "temporaryFinalDigest": final_digest,
                "expectedTargetFilesystemIdentity": expected_target_identity,
            })
            return final_digest
        finally:
            temporary.unlink(missing_ok=True)
            parent_fd = os.open(target_image.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            remount_error: Exception | None = None
            for record in reversed(unmounted):
                try:
                    self._mount_raw_image(record)
                except Exception as error:
                    remount_error = remount_error or error
            if remount_error is not None:
                state = "after atomic publish" if published else "before atomic publish"
                raise RuntimeError(f"raw dockerData remount failed {state}: {remount_error}") from remount_error

    def _record_copy_stage(self, operation_id: str, stage: str, facts: dict[str, Any]) -> None:
        with self._transition():
            operation = self.state["setupPrefix"]["operations"].get(operation_id)
            if operation is None:
                raise RuntimeError("raw dockerData copy lost its journaled operation")
            operation.update({"state": stage, "copyStage": stage, **facts})
            self._commit("setup-prefix-copy-stage", {
                "operationId": operation_id,
                "stage": stage,
                **facts,
            })

    def _copy_docker_data_image(self, source: dict[str, Any], target: dict[str, Any],
                                operation_id: str) -> str:
        assert self.setup_prefix is not None
        strategy = self.setup_prefix["copyStrategy"]
        if strategy != "raw-image/v1":
            raise RuntimeError(f"unsupported dockerData copy strategy {strategy!r}")
        return self._copy_raw_image(source, target, operation_id)

    def _remove_managed_tree(self, parent: Path, name: str) -> None:
        if re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,127}", name) is None:
            raise RuntimeError("setup-prefix managed path name is invalid")
        path = parent / name
        if not path.exists():
            return
        if path.is_symlink() or path.resolve().parent != parent.resolve():
            raise RuntimeError("setup-prefix managed path escaped its parent")
        root_fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            self._scrub_fd(root_fd)
            os.fsync(root_fd)
        finally:
            os.close(root_fd)
        path.rmdir()
        parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)

    def _setup_prefix_ledger(self, extra_temporary: int = 0) -> dict[str, int]:
        if self.setup_prefix is None:
            return {"seedBytes": 0, "slotBytes": 0, "temporaryCloneBytes": 0, "activeBytes": 0,
                    "recoveryBytes": 0, "totalBytes": 0, "limitBytes": 0}
        setup_state = self.state.setdefault("setupPrefix", {"artifacts": {}, "operations": {}, "seeds": {}})
        # Every slot and seed image consumes fixed host capacity even while it
        # is free. Operation clones are a second simultaneous charge until
        # their atomic replacement is published or removed.
        seed = sum(int(item.get("limitBytes", 0))
                   for item in setup_state.get("seeds", {}).values())
        slot_bytes = sum(int(item.get("limitBytes", 0)) for item in self.state["slots"].values())
        temporary = extra_temporary + sum(
            int(item.get("chargedBytes", 0)) for item in setup_state["operations"].values()
            if item.get("state") in ("capturing", "restoring")
        )
        active = 0
        recovery = 0
        for reservation in self.state["reservations"].values():
            if reservation.get("kind") != "container" or not reservation.get("slotId"):
                continue
            charge = int(reservation.get("resources", {}).get("ephemeralDiskBytes", 0))
            if reservation.get("state") in ("quarantined", "releasing"):
                recovery += charge
            elif reservation.get("state") in ("granted", "provisioning", "committed", "restoring"):
                active += charge
        total = seed + slot_bytes + temporary
        return {"seedBytes": seed, "slotBytes": slot_bytes,
                "temporaryCloneBytes": temporary, "activeBytes": active,
                "recoveryBytes": recovery, "totalBytes": total,
                "limitBytes": int(self.setup_prefix["filesystemLimitBytes"])}

    def _check_setup_prefix_capacity(self, size: int, *, capture: bool) -> None:
        assert self.setup_prefix is not None
        ledger = self._setup_prefix_ledger(extra_temporary=size)
        if ledger["totalBytes"] > ledger["limitBytes"]:
            raise ProtocolError("setup-prefix-capacity-exhausted", "setup-prefix filesystem capacity is exhausted")

    def _setup_prefix_response(
        self,
        wire: dict[str, Any],
        artifact: dict[str, Any],
        state: str,
    ) -> dict[str, Any]:
        return {
            **wire,
            "descriptorDigest": self.descriptor_digest,
            "daemonGeneration": self.state["generation"],
            "artifact": {
                "artifactId": artifact["artifactId"],
                "sizeBytes": artifact["sizeBytes"],
                "requiredState": SETUP_PREFIX_REQUIRED_STATE,
                "copyProtocol": SETUP_PREFIX_COPY_PROTOCOL,
                "copyRevision": SETUP_PREFIX_COPY_REVISION,
            },
            "status": {"state": state, "capacity": self._setup_prefix_ledger()},
        }

    @staticmethod
    def _validate_setup_prefix_key(raw: Any) -> str:
        if not isinstance(raw, str) or not raw or len(raw.encode("utf-8")) > 512 \
                or any(ord(character) < 0x20 for character in raw):
            raise ProtocolError("setup-prefix-key-invalid", "setupPrefixKey must be a bounded non-empty string")
        return raw

    @staticmethod
    def _validate_sha256(raw: Any, field: str) -> str:
        if not isinstance(raw, str) or re.fullmatch(r"sha256:[a-f0-9]{64}", raw) is None:
            raise ProtocolError("setup-prefix-identity-invalid", f"{field} must be an exact sha256 digest")
        return raw

    @staticmethod
    def _artifact_matches_wire(artifact: dict[str, Any], wire: dict[str, Any]) -> bool:
        return all(
            artifact.get(field) == wire.get(field)
            for field in SETUP_PREFIX_ARTIFACT_BINDING_FIELDS
        )

    @staticmethod
    def _clear_setup_prefix_seed_state(seed: dict[str, Any]) -> None:
        for field in (*SETUP_PREFIX_WIRE_FIELDS, "operationId", "artifactId", "sizeBytes",
                      "sourceSlotGeneration", "publicationOperationId", "publishedAt",
                      "preparedAt", "quarantineReason", "corruptReason"):
            seed.pop(field, None)

    def _setup_prefix_request(
        self,
        request: dict[str, Any],
        *,
        capture: bool,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
        if self.setup_prefix is None:
            raise ProtocolError("setup-prefix-unsupported", "this host profile has no setup-prefix capability")
        if "requiredState" not in request:
            raise ProtocolError("setup-prefix-state-required", "requiredState=dockerData is required")
        if request.get("requiredState") != SETUP_PREFIX_REQUIRED_STATE:
            raise ProtocolError(
                "setup-prefix-state-unsupported",
                "only sandboxState.dockerData can be captured or restored",
            )
        allowed = {"kind", "invocationId", "leaseToken", "reservationId", "daemonGeneration",
                   "slotGeneration", "protocol", "requiredState", "descriptorDigest",
                   "operationId",
                   "setupPrefixKey", "setupManifestDigest", "providerIdentity", "baseIdentity",
                   "executionDomain", "helperRevision", "copyProtocol", "copyRevision", "quiesceRevision",
                   "publicationRevision", "recoveryRevision", "manifestSchema",
                   "filesystemSizeBytes", "filesystemFeatures"}
        if set(request) != allowed:
            raise ProtocolError("setup-prefix-host-input", "setup-prefix frames accept no host paths or helper controls")
        operation_id = request.get("operationId")
        if not isinstance(operation_id, str) or not operation_id \
                or len(operation_id.encode("utf-8")) > 512 \
                or any(ord(character) < 0x20 or ord(character) == 0x7f for character in operation_id):
            raise ProtocolError("setup-prefix-operation-invalid", "setup-prefix operationId is invalid")
        expected_wire = {
            "protocol": SETUP_PREFIX_PROTOCOL,
            "providerIdentity": self.setup_prefix["providerIdentity"],
            "executionDomain": self.setup_prefix["executionDomain"],
            "helperRevision": SETUP_PREFIX_HELPER_REVISION,
            "copyProtocol": SETUP_PREFIX_COPY_PROTOCOL,
            "copyRevision": SETUP_PREFIX_COPY_REVISION,
            "quiesceRevision": SETUP_PREFIX_QUIESCE_REVISION,
            "publicationRevision": SETUP_PREFIX_PUBLICATION_REVISION,
            "recoveryRevision": SETUP_PREFIX_RECOVERY_REVISION,
            "manifestSchema": SETUP_PREFIX_MANIFEST_SCHEMA,
            "filesystemSizeBytes": self.setup_prefix["filesystemSizeBytes"],
            "filesystemFeatures": self.setup_prefix["filesystemFeatures"],
        }
        if request.get("descriptorDigest") != self.descriptor_digest \
                or any(request.get(field) != value for field, value in expected_wire.items()):
            raise ProtocolError(
                "setup-prefix-descriptor-mismatch",
                "dockerData snapshot wire does not match the attested descriptor",
            )
        if request.get("daemonGeneration") != self.state["generation"]:
            raise ProtocolError("attestation-changed", "daemon generation changed")
        lease = self._lease(request)
        reservation = self.state["reservations"].get(str(request.get("reservationId", "")))
        if reservation is None or reservation.get("invocationId") != lease["invocationId"] \
                or reservation.get("kind") != "container":
            raise ProtocolError("reservation-not-found", "container reservation is not owned by this lease")
        slot = self.state["slots"].get(reservation.get("slotId"))
        if slot is None or int(request.get("slotGeneration", -1)) != int(reservation.get("slotGeneration", -2)) \
                or int(request.get("slotGeneration", -1)) != int(slot.get("generation", -3)):
            raise ProtocolError("setup-prefix-slot-generation", "reservation slot generation is stale")
        expected_reservation = "committed" if capture else "granted"
        expected_slot = "active" if capture else "granted"
        if reservation.get("state") != expected_reservation or slot.get("state") != expected_slot:
            raise ProtocolError("setup-prefix-reservation-state", "reservation slot is not in the required state")
        key = self._validate_setup_prefix_key(request.get("setupPrefixKey"))
        manifest_digest = self._validate_sha256(
            request.get("setupManifestDigest"), "setupManifestDigest"
        )
        if key != f"prefix:{manifest_digest.removeprefix('sha256:')}":
            raise ProtocolError(
                "setup-prefix-key-invalid",
                "setupPrefixKey must be bound to the complete setup manifest digest",
            )
        base_identity = self._validate_sha256(request.get("baseIdentity"), "baseIdentity")
        wire = {
            **expected_wire,
            "requiredState": SETUP_PREFIX_REQUIRED_STATE,
            "setupPrefixKey": key,
            "setupManifestDigest": manifest_digest,
            "baseIdentity": base_identity,
            "daemonGeneration": self.state["generation"],
            "slotGeneration": int(slot["generation"]),
        }
        return lease, reservation, slot, wire

    def _attest_capture_quiesced(
        self,
        reservation: dict[str, Any],
        slot: dict[str, Any],
        base_identity: str,
    ) -> None:
        containers, _ = self._resource_ids(reservation)
        if containers != [reservation.get("containerId")]:
            raise ProtocolError("setup-prefix-outer-not-quiesced", "outer container is not uniquely attested")
        result = self._docker(
            "inspect", "--format", "{{json .}}", str(reservation["containerId"]), check=False,
        )
        try:
            inspected = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError):
            inspected = None
        state = inspected.get("State") if isinstance(inspected, dict) else None
        if result.returncode != 0 or not isinstance(state, dict) \
                or state.get("Running") is not False or int(state.get("Pid", -1)) != 0:
            raise ProtocolError(
                "setup-prefix-outer-not-quiesced",
                "outer container and inner dockerd/containerd/shim must be fully stopped",
            )
        if inspected.get("Image") != base_identity:
            raise ProtocolError(
                "setup-prefix-base-identity",
                "outer container base image does not match the exact request identity",
            )
        references = self._slot_references(slot)
        if references:
            raise ProtocolError("setup-prefix-slot-busy", "slot still has a mount or open process user")

    def _verify_restore_target(self, slot: dict[str, Any]) -> None:
        if self._slot_references(slot):
            raise RuntimeError("restore target still has a mount or open process user")
        if os.listdir(slot["path"]):
            raise RuntimeError("restore target is not fresh or scrubbed")
        facts = self._slot_facts(slot)
        if int(facts["usageBytes"]) != int(slot.get("baselineUsageBytes", 0)):
            raise RuntimeError("restore target usage is not at its scrubbed baseline")

    def _verify_seed_target(self, seed: dict[str, Any]) -> None:
        mountpoint, _, limit = self._raw_image_record(seed)
        if limit != int(self.setup_prefix["filesystemSizeBytes"]):
            raise RuntimeError("setup-prefix seed has the wrong fixed filesystem size")
        if self._raw_image_mount_source(mountpoint) is not None:
            raise RuntimeError("setup-prefix seed must be immutable and unmounted")
        if self._slot_references(seed):
            raise RuntimeError("setup-prefix seed has an external mount or process reference")

    def _load_artifact(self, artifact: dict[str, Any]) -> dict[str, Any]:
        seed = self.state["setupPrefix"]["seeds"].get(artifact.get("seedId"))
        if seed is None or seed.get("state") != "published" \
                or seed.get("setupPrefixKey") != artifact.get("setupPrefixKey"):
            raise RuntimeError("setup-prefix artifact has no independently published seed filesystem")
        self._verify_seed_target(seed)
        _, image, limit = self._raw_image_record(seed)
        expected_artifact_id = self._raw_image_digest(image)
        if artifact.get("artifactId") != expected_artifact_id \
                or int(artifact.get("sizeBytes", -1)) != limit:
            raise RuntimeError("setup-prefix raw image artifactId or fixed size is corrupt")
        return seed

    def _clear_setup_operation(self, operation_id: str, reservation_id: str, event: str,
                               detail: dict[str, Any]) -> None:
        operation = self.state["setupPrefix"]["operations"].pop(operation_id, None)
        reservation = self.state["reservations"].get(reservation_id)
        if reservation is not None and reservation.get("setupPrefixOperation") == operation_id:
            reservation.pop("setupPrefixOperation", None)
        self._commit(event, {"operationId": operation_id, "reservationId": reservation_id,
                             **detail, "operation": operation})

    def _fence_cancelled_captures(self, invocation_id: str, reason: str) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        fenced: list[str] = []
        for operation in self.state["setupPrefix"].get("operations", {}).values():
            if operation.get("kind") != "capture" or operation.get("invocationId") != invocation_id:
                continue
            operation["cancelRequested"] = True
            operation["cancelReason"] = reason
            operation["cancelFencedAt"] = now()
            fenced.append(str(operation.get("operationId", "")))
            if operation.get("state") == "prepared":
                prepared.append(copy.deepcopy(operation))
        if fenced:
            self._commit("setup-prefix-capture-cancel-fenced", {
                "invocationId": invocation_id,
                "operationIds": fenced,
                "reason": reason,
            })
        return prepared

    def _scrub_cancelled_prepared_captures(self, operations: list[dict[str, Any]]) -> None:
        for operation in operations:
            operation_id = str(operation["operationId"])
            seed = self.state["setupPrefix"]["seeds"].get(operation.get("seedId"))
            if seed is None:
                raise RuntimeError("cancelled prepared capture lost its seed")
            self._remove_temporary_clone(seed, operation_id)
            self._scrub_setup_prefix_seed(seed)
            self._verify_seed_target(seed)
            seed["state"] = "free"
            self._clear_setup_prefix_seed_state(seed)
            self._clear_setup_operation(
                operation_id,
                str(operation["reservationId"]),
                "setup-prefix-capture-cancelled",
                {"status": "scrubbed-unpublished-seed", "seedId": seed["seedId"],
                 "seedScrubbed": True},
            )

    def _handle_setup_prefix_capture(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._transition():
            _, reservation, slot, wire = self._setup_prefix_request(request, capture=True)
            key = wire["setupPrefixKey"]
            existing = self.state["setupPrefix"]["artifacts"].get(key)
            if existing is not None:
                if not self._artifact_matches_wire(existing, wire):
                    raise ProtocolError(
                        "setup-prefix-artifact-mismatch",
                        "published artifact identity does not match this dockerData request",
                    )
                return self._setup_prefix_response(wire, existing, "already-published")
            operation_id = str(request["operationId"])
            active_operation_id = reservation.get("setupPrefixOperation")
            if active_operation_id == operation_id:
                active_operation = self.state["setupPrefix"]["operations"].get(operation_id)
                candidate = active_operation.get("candidateArtifact") if isinstance(active_operation, dict) else None
                if active_operation is not None and active_operation.get("state") == "prepared" \
                        and isinstance(candidate, dict) and self._artifact_matches_wire(candidate, wire):
                    return self._setup_prefix_response(wire, candidate, "prepared")
            if active_operation_id:
                raise ProtocolError("setup-prefix-operation-active", "reservation already has a setup-prefix operation")
            seed = next((item for item in self.state["setupPrefix"]["seeds"].values()
                         if item.get("state") == "free"
                         and int(item["limitBytes"]) == int(slot["limitBytes"])), None)
            if seed is None:
                raise ProtocolError("setup-prefix-capacity-exhausted",
                                    "no free equal-size independent seed filesystem is available")
            if operation_id in self.state["setupPrefix"]["operations"]:
                raise ProtocolError("setup-prefix-operation-active", "setup-prefix operationId is already active")
            operation = {
                "operationId": operation_id, "kind": "capture", "state": "capturing",
                "invocationId": reservation["invocationId"], "reservationId": reservation["reservationId"],
                "slotId": slot["slotId"], "slotGeneration": slot["generation"],
                "setupPrefixKey": key, "seedId": seed["seedId"],
                "chargedBytes": int(seed["limitBytes"]), "startedAt": now(),
                "temporaryClone": {"targetId": seed["seedId"],
                                   "bytes": int(seed["limitBytes"])},
                "wire": copy.deepcopy(wire),
            }
            self._check_setup_prefix_capacity(int(seed["limitBytes"]), capture=True)
            self.state["setupPrefix"]["operations"][operation_id] = operation
            reservation["setupPrefixOperation"] = operation_id
            seed.update({"state": "capturing", "operationId": operation_id,
                         "setupPrefixKey": key, "setupManifestDigest": wire["setupManifestDigest"]})
            self._commit("setup-prefix-capture-intent", {"operationId": operation_id,
                                                           "reservationId": reservation["reservationId"],
                                                           "setupPrefixKey": key,
                                                           "seedId": seed["seedId"]})
            reservation_snapshot, slot_snapshot, seed_snapshot = (
                copy.deepcopy(reservation), copy.deepcopy(slot), copy.deepcopy(seed)
            )

        copy_started = False
        try:
            self._attest_capture_quiesced(
                reservation_snapshot,
                slot_snapshot,
                wire["baseIdentity"],
            )
            self._verify_seed_target(seed_snapshot)
            with self._transition():
                current = self.state["setupPrefix"]["operations"].get(operation_id)
                if current is None:
                    raise ProtocolError("setup-prefix-operation-cancelled", "capture intent is no longer current")
                current.update({"state": "capturing"})
                self._commit("setup-prefix-capture-copying", {"operationId": operation_id,
                                                                "sizeBytes": int(seed_snapshot["limitBytes"])})
            copy_started = True
            artifact_id = self._copy_docker_data_image(slot_snapshot, seed_snapshot, operation_id)
            self._verify_seed_target(seed_snapshot)
            size = int(seed_snapshot["limitBytes"])
            artifact = {**wire, "seedId": seed_snapshot["seedId"],
                        "sourceSlotGeneration": wire["slotGeneration"],
                        "artifactId": artifact_id, "sizeBytes": size,
                        "chargedBytes": int(seed_snapshot["limitBytes"]),
                        "state": "prepared", "preparedAt": now()}
            with self._transition():
                current = self.state["setupPrefix"]["operations"].get(operation_id)
                reservation = self.state["reservations"].get(reservation_snapshot["reservationId"])
                lease = self.state["leases"].get(reservation_snapshot["invocationId"])
                slot = self.state["slots"].get(slot_snapshot["slotId"])
                if current is None or reservation is None or lease is None or slot is None \
                        or lease.get("state") != "active" \
                        or current.get("cancelRequested") is True \
                        or reservation.get("setupPrefixOperation") != operation_id \
                        or int(slot.get("generation", -1)) != int(slot_snapshot["generation"]) \
                        or self.state["generation"] != wire["daemonGeneration"]:
                    raise ProtocolError(
                        "setup-prefix-operation-cancelled",
                        "capture ownership, lease, or slot generation changed before staging",
                    )
                seed = self.state["setupPrefix"]["seeds"][seed_snapshot["seedId"]]
                seed.update({**wire, "state": "prepared", "setupPrefixKey": key,
                             "artifactId": artifact_id, "sizeBytes": size})
                current.update({"state": "prepared", "candidateArtifact": artifact})
                self._commit("setup-prefix-capture-prepared", {
                    "operationId": operation_id,
                    "reservationId": reservation_snapshot["reservationId"],
                    "setupPrefixKey": key,
                    "artifactId": artifact_id,
                    "sizeBytes": size,
                    "seedId": seed["seedId"],
                })
                return self._setup_prefix_response(wire, artifact, "prepared")
        except Exception as error:
            scrub_error: Exception | None = None
            if copy_started:
                try:
                    self._scrub_setup_prefix_seed(seed_snapshot)
                    self._verify_seed_target(seed_snapshot)
                except Exception as cleanup_error:
                    scrub_error = cleanup_error
            with self._transition():
                if operation_id in self.state["setupPrefix"]["operations"]:
                    seed = self.state["setupPrefix"]["seeds"][seed_snapshot["seedId"]]
                    if scrub_error is None:
                        seed.clear()
                        seed.update({**seed_snapshot, "state": "free"})
                        self._clear_setup_prefix_seed_state(seed)
                    else:
                        seed.update({"state": "quarantined", "quarantineReason": str(scrub_error)})
                    self._clear_setup_operation(operation_id, reservation_snapshot["reservationId"],
                                                "setup-prefix-capture-failed",
                                                {"setupPrefixKey": key, "reason": str(error)[-2000:],
                                                 "seedScrubbed": scrub_error is None})
            if isinstance(error, ProtocolError):
                raise
            raise ProtocolError("setup-prefix-capture-failed", str(error)[-2000:]) from error

    def _handle_setup_prefix_capture_publish(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._transition():
            lease, reservation, slot, wire = self._setup_prefix_request(request, capture=True)
            key = wire["setupPrefixKey"]
            operation_id = str(request["operationId"])
            existing = self.state["setupPrefix"]["artifacts"].get(key)
            if existing is not None:
                if existing.get("publicationOperationId") != operation_id \
                        or not self._artifact_matches_wire(existing, wire):
                    raise ProtocolError(
                        "setup-prefix-publication-conflict",
                        "published artifact does not belong to this capture commit",
                    )
                return self._setup_prefix_response(wire, existing, "already-published")
            operation = self.state["setupPrefix"]["operations"].get(operation_id)
            candidate = operation.get("candidateArtifact") if isinstance(operation, dict) else None
            if operation is None or operation.get("kind") != "capture" \
                    or operation.get("state") != "prepared" \
                    or operation.get("cancelRequested") is True \
                    or operation.get("reservationId") != reservation["reservationId"] \
                    or operation.get("slotId") != slot["slotId"] \
                    or operation.get("wire") != wire \
                    or reservation.get("setupPrefixOperation") != operation_id \
                    or not isinstance(candidate, dict):
                raise ProtocolError(
                    "setup-prefix-publication-not-prepared",
                    "capture commit has no matching uncancelled prepared copy",
                )
            seed = self.state["setupPrefix"]["seeds"].get(operation.get("seedId"))
            if seed is None or seed.get("state") != "prepared" \
                    or seed.get("operationId") != operation_id \
                    or seed.get("artifactId") != candidate.get("artifactId"):
                raise ProtocolError("setup-prefix-publication-corrupt", "prepared seed ownership is invalid")
            self._verify_seed_target(seed)
            _, seed_image, seed_size = self._raw_image_record(seed)
            if self._raw_image_digest(seed_image) != candidate.get("artifactId") \
                    or seed_size != int(candidate.get("sizeBytes", -1)):
                raise ProtocolError("setup-prefix-publication-corrupt", "prepared seed digest is invalid")
            published = {
                **candidate,
                "state": "published",
                "publishedAt": now(),
                "publicationOperationId": operation_id,
            }
            seed.update({"state": "published", "publishedAt": published["publishedAt"],
                         "publicationOperationId": operation_id})
            seed.pop("operationId", None)
            self.state["setupPrefix"]["artifacts"][key] = published
            self._clear_setup_operation(
                operation_id,
                reservation["reservationId"],
                "setup-prefix-captured",
                {"setupPrefixKey": key, "artifactId": published["artifactId"],
                 "sizeBytes": published["sizeBytes"], "seedId": seed["seedId"]},
            )
            return self._setup_prefix_response(wire, published, "captured")

    def _handle_setup_prefix_restore(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._transition():
            _, reservation, slot, wire = self._setup_prefix_request(request, capture=False)
            key = wire["setupPrefixKey"]
            restored = reservation.get("restoredSetupPrefix")
            if isinstance(restored, dict):
                if restored.get("setupPrefixKey") != key:
                    raise ProtocolError("setup-prefix-restore-conflict", "reservation already restored another artifact")
                artifact = self.state["setupPrefix"]["artifacts"].get(key)
                if artifact is None or artifact.get("artifactId") != restored.get("artifactId") \
                        or not self._artifact_matches_wire(artifact, wire):
                    raise ProtocolError("setup-prefix-artifact-corrupt", "restored artifact is no longer journaled")
                return self._setup_prefix_response(wire, artifact, "already-restored")
            artifact = self.state["setupPrefix"]["artifacts"].get(key)
            if artifact is None or artifact.get("state") != "published":
                raise ProtocolError("setup-prefix-miss", "no published setup-prefix artifact matches the key")
            if not self._artifact_matches_wire(artifact, wire):
                raise ProtocolError(
                    "setup-prefix-artifact-mismatch",
                    "published artifact identity does not match this dockerData request",
                )
            if reservation.get("setupPrefixOperation"):
                raise ProtocolError("setup-prefix-operation-active", "reservation already has a setup-prefix operation")
            reservation_snapshot, slot_snapshot = copy.deepcopy(reservation), copy.deepcopy(slot)
            artifact_snapshot = copy.deepcopy(artifact)

        try:
            self._load_artifact(artifact_snapshot)
        except Exception as error:
            with self._transition():
                current = self.state["setupPrefix"]["artifacts"].get(key)
                if current is not None:
                    current["state"] = "corrupt"
                    current["corruptReason"] = str(error)[-2000:]
                    seed = self.state["setupPrefix"]["seeds"].get(current.get("seedId"))
                    if seed is not None:
                        seed["state"] = "corrupt"
                        seed["corruptReason"] = str(error)[-2000:]
                    self._commit("setup-prefix-artifact-corrupt", {"setupPrefixKey": key,
                                                                    "artifactId": current.get("artifactId"),
                                                                    "reason": str(error)[-2000:]})
            raise ProtocolError("setup-prefix-artifact-corrupt", str(error)[-2000:]) from error

        size = int(artifact_snapshot["sizeBytes"])
        operation_id = secrets.token_hex(16)
        with self._transition():
            _, reservation, slot, current_wire = self._setup_prefix_request(request, capture=False)
            if current_wire != wire:
                raise ProtocolError("attestation-changed", "dockerData snapshot wire changed before restore")
            seed = self.state["setupPrefix"]["seeds"].get(artifact_snapshot["seedId"])
            if seed is None or seed.get("state") != "published":
                raise ProtocolError("setup-prefix-artifact-corrupt", "artifact seed is no longer published")
            self._check_setup_prefix_capacity(int(slot["limitBytes"]), capture=False)
            operation = {
                "operationId": operation_id, "kind": "restore", "state": "restoring",
                "invocationId": reservation["invocationId"], "reservationId": reservation["reservationId"],
                "slotId": slot["slotId"], "slotGeneration": slot["generation"],
                "setupPrefixKey": key, "seedId": artifact_snapshot["seedId"],
                "chargedBytes": int(slot["limitBytes"]), "startedAt": now(),
                "temporaryClone": {"targetId": slot["slotId"],
                                   "bytes": int(slot["limitBytes"])},
                "wire": copy.deepcopy(wire),
            }
            self.state["setupPrefix"]["operations"][operation_id] = operation
            reservation["setupPrefixOperation"] = operation_id
            reservation["state"] = "restoring"
            slot["state"] = "restoring"
            self._commit("setup-prefix-restore-intent", {"operationId": operation_id,
                                                          "reservationId": reservation["reservationId"],
                                                          "setupPrefixKey": key,
                                                          "sourceSeedId": artifact_snapshot["seedId"],
                                                          "sourceArtifactId": artifact_snapshot["artifactId"],
                                                          "targetSlotId": slot["slotId"]})
            reservation_snapshot, slot_snapshot, seed_snapshot = (
                copy.deepcopy(reservation), copy.deepcopy(slot), copy.deepcopy(seed)
            )
        try:
            self._verify_restore_target(slot_snapshot)
            restored_slot_digest = self._copy_docker_data_image(seed_snapshot, slot_snapshot, operation_id)
            if self._raw_image_identity(Path(str(slot_snapshot["imagePath"]))) \
                    != slot_snapshot["filesystemIdentity"]:
                raise RuntimeError("dockerData raw-image restore target UUID verification failed")
            with self._transition():
                reservation = self.state["reservations"].get(reservation_snapshot["reservationId"])
                slot = self.state["slots"].get(slot_snapshot["slotId"])
                operation = self.state["setupPrefix"]["operations"].get(operation_id)
                lease = self.state["leases"].get(reservation_snapshot["invocationId"])
                if reservation is None or slot is None or operation is None \
                        or lease is None or lease.get("state") != "active" \
                        or reservation.get("setupPrefixOperation") != operation_id \
                        or int(slot.get("generation", -1)) != int(slot_snapshot["generation"]) \
                        or self.state["generation"] != wire["daemonGeneration"]:
                    raise RuntimeError("restore ownership changed before publication")
                reservation["state"] = "granted"
                slot["state"] = "granted"
                reservation["restoredSetupPrefix"] = {
                    "setupPrefixKey": key, "artifactId": artifact_snapshot["artifactId"],
                    "setupManifestDigest": wire["setupManifestDigest"],
                    "slotGeneration": slot["generation"],
                }
                self._clear_setup_operation(operation_id, reservation["reservationId"],
                                            "setup-prefix-restored",
                                            {"setupPrefixKey": key,
                                             "sourceSeedId": artifact_snapshot["seedId"],
                                             "sourceArtifactId": artifact_snapshot["artifactId"],
                                             "targetSlotId": slot["slotId"],
                                             "restoredSlotDigest": restored_slot_digest,
                                             "sizeBytes": size})
                return self._setup_prefix_response(wire, artifact_snapshot, "restored")
        except Exception as error:
            with self._transition():
                reservation = self.state["reservations"].get(reservation_snapshot["reservationId"])
                if reservation is not None:
                    reservation.pop("setupPrefixOperation", None)
                    self.state["setupPrefix"]["operations"].pop(operation_id, None)
                    self._quarantine(reservation, f"setup-prefix restore failed for {key}: {error}")
            if isinstance(error, ProtocolError):
                raise
            raise ProtocolError("setup-prefix-restore-failed", str(error)[-2000:]) from error

    def _recover_setup_prefix_operations(self) -> None:
        if self.setup_prefix is None:
            return
        operations = list(self.state.setdefault("setupPrefix", {"artifacts": {}, "operations": {}, "seeds": {}})["operations"].values())
        for operation in operations:
            operation_id = str(operation.get("operationId", ""))
            reservation_id = str(operation.get("reservationId", ""))
            try:
                if operation.get("kind") == "capture":
                    seed = self.state["setupPrefix"]["seeds"].get(operation.get("seedId"))
                    slot = self.state["slots"].get(operation.get("slotId"))
                    if seed is None:
                        raise RuntimeError("capturing seed filesystem disappeared from its registry")
                    self._remove_temporary_clone(seed, operation_id)
                    if slot is not None:
                        self._ensure_raw_image_mounted(slot)
                    self._scrub_setup_prefix_seed(seed, recover_mounted=True)
                    self._verify_seed_target(seed)
                    seed["state"] = "free"
                    self._clear_setup_prefix_seed_state(seed)
                    self._clear_setup_operation(operation_id, reservation_id,
                                                "setup-prefix-capture-recovered",
                                                {"status": "scrubbed-unpublished-seed",
                                                 "seedId": seed["seedId"],
                                                 "seedScrubbed": True})
                elif operation.get("kind") == "restore":
                    reservation = self.state["reservations"].get(reservation_id)
                    slot = self.state["slots"].get(operation.get("slotId"))
                    seed = self.state["setupPrefix"]["seeds"].get(operation.get("seedId"))
                    if slot is not None:
                        self._remove_temporary_clone(slot, operation_id)
                        self._ensure_raw_image_mounted(slot)
                    if seed is not None:
                        self._verify_seed_target(seed)
                    self.state["setupPrefix"]["operations"].pop(operation_id, None)
                    if reservation is not None:
                        reservation.pop("setupPrefixOperation", None)
                        self._quarantine(
                            reservation,
                            f"setup-prefix restore interrupted by helper restart for {operation.get('setupPrefixKey')}",
                        )
                elif operation.get("kind") == "stale-artifact":
                    key = str(operation.get("setupPrefixKey", ""))
                    seed = self.state["setupPrefix"]["seeds"].get(operation.get("seedId"))
                    if seed is None:
                        raise RuntimeError("stale setup-prefix seed disappeared from its registry")
                    seed["state"] = "quarantined"
                    seed["quarantineReason"] = "published seed belongs to a stale daemon generation"
                    raise RuntimeError(
                        f"published seed {seed['seedId']} is immutable; explicit offline disposition is required"
                    )
                else:
                    raise RuntimeError("journaled setup-prefix operation kind is invalid")
            except Exception as error:
                self.state["admissionOpen"] = False
                message = f"setup-prefix recovery blocked for {operation_id}: {error}"
                if message not in self.state["degraded"]:
                    self.state["degraded"].append(message)
                self._commit("setup-prefix-recovery-blocked", {"operationId": operation_id,
                                                                "reason": str(error)[-2000:]})

    def _invalidate_stale_setup_prefix_artifacts(self) -> None:
        if self.setup_prefix is None:
            return
        current_generation = self.state["generation"]
        for key, artifact in list(self.state["setupPrefix"]["artifacts"].items()):
            if artifact.get("daemonGeneration") == current_generation:
                continue
            seed = self.state["setupPrefix"]["seeds"].get(artifact.get("seedId"))
            if seed is None:
                self.state["admissionOpen"] = False
                reason = f"stale setup-prefix artifact {key} has no seed"
                self.state["degraded"].append(reason)
                self._commit("setup-prefix-stale-artifact-blocked", {
                    "setupPrefixKey": key, "reason": reason,
                })
                continue
            artifact["state"] = "stale"
            artifact["staleReason"] = "daemon generation changed"
            seed["state"] = "quarantined"
            seed["quarantineReason"] = "published seed belongs to a stale daemon generation"
            self.state["admissionOpen"] = False
            reason = f"published setup-prefix seed {seed['seedId']} is immutable across daemon generations"
            if reason not in self.state["degraded"]:
                self.state["degraded"].append(reason)
            self._commit("setup-prefix-stale-artifact-blocked", {
                "setupPrefixKey": key,
                "seedId": seed["seedId"],
                "artifactDaemonGeneration": artifact.get("daemonGeneration"),
                "daemonGeneration": current_generation,
                "reason": reason,
            })

    def _verify_and_free_slot(self, reservation: dict[str, Any]) -> bool:
        slot_id = reservation.get("slotId")
        if slot_id is None:
            return True
        slot = self.state["slots"][slot_id]
        prior_quarantine_reason = slot.get("quarantineReason")
        slot["state"] = "scrubbing"
        self._commit("slot-scrubbing", {"slotId": slot_id})
        try:
            if self._slot_references(slot):
                raise RuntimeError("slot still has mount or process references")
            self._scrub_slot(slot)
            if os.listdir(slot["path"]):
                raise RuntimeError("slot is not empty after scrub")
            self._restore_fixed_slot_allocation(slot)
            os.chown(slot["path"], int(slot["ownerUid"]), int(slot["ownerGid"]))
            os.chmod(slot["path"], int(slot.get("mode", 0o700)))
            facts = self._slot_facts(slot)
            expected = {"projectId": int(slot["projectId"]), "usageBytes": int(slot.get("baselineUsageBytes", 0)),
                        "hardBytes": int(slot["limitBytes"]), "uid": int(slot["ownerUid"]),
                        "gid": int(slot["ownerGid"]), "mode": int(slot.get("mode", 0o700))}
            if facts != expected:
                raise RuntimeError(f"slot attestation mismatch: {facts!r}")
            slot["state"] = "verified-free"
            self._commit("slot-verified-free", {"slotId": slot_id, "generation": slot["generation"]})
            slot["generation"] = int(slot["generation"]) + 1
            slot["state"] = "free"
            for field in ("invocationId", "reservationId", "provisionToken", "quarantineReason"):
                slot.pop(field, None)
            if prior_quarantine_reason is not None:
                self.state["degraded"] = [
                    reason for reason in self.state["degraded"] if reason != prior_quarantine_reason
                ]
            self._commit("slot-free", {"slotId": slot_id, "generation": slot["generation"]})
            return True
        except Exception as error:
            self._quarantine(reservation, f"slot {slot_id} verified-free failed: {error}")
            return False

    def _resource_ids(self, reservation: dict[str, Any]) -> tuple[list[str], list[str]]:
        filters: list[str] = []
        for field, label in LABELS.items():
            if field == "attemptId" and not reservation.get(field):
                continue
            value = reservation["profileId"] if field == "profileId" else reservation[field]
            filters.extend(["--filter", f"label={label}={value}"])
        # Docker's quiet list output is abbreviated unless --no-trunc is
        # explicit. Journal ownership records the full create-returned IDs, so
        # every reconciliation/attestation comparison must use full identities.
        container_query = self._docker("ps", "-aq", "--no-trunc", *filters, check=False)
        network_query = self._docker("network", "ls", "-q", "--no-trunc", *filters, check=False)
        if container_query.returncode != 0 or network_query.returncode != 0:
            raise RuntimeError("Docker resource query failed; refusing to infer absence")
        containers = container_query.stdout.split()
        networks = network_query.stdout.split()
        return containers, networks

    def _destroy(self, reservation: dict[str, Any]) -> bool:
        containers, networks = self._resource_ids(reservation)
        for resource_id in containers:
            self._docker("rm", "-f", resource_id, check=False)
        for resource_id in networks:
            self._docker("network", "rm", resource_id, check=False)
        remaining = self._resource_ids(reservation)
        return not remaining[0] and not remaining[1]

    def _cleanup_with_deadline(self, reservation: dict[str, Any]) -> bool:
        deadline = time.monotonic() + CLEANUP_TIMEOUT_SECONDS
        while True:
            if reservation["kind"] == "build":
                proven = self._destroy_build(reservation) and self._build_resources_absent(
                    reservation, require_ephemeral_locator_absent=reservation.get("retention") == "ephemeral",
                )
            else:
                proven = self._destroy(reservation)
            if proven:
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.1)

    def _validate_create(self, raw: Any) -> dict[str, Any]:
        if isinstance(raw, dict) and raw.get("intent") == "diagnostic":
            if set(raw) != {"intent"}:
                raise ProtocolError("container-create-diagnostic-client-input", "diagnostic requests accept intent only")
            assets = self.asset_facts
            dind = next((item for item in assets if item.get("reference", "").startswith("docker:29-dind@sha256:")), None)
            if dind is None or dind.get("present") is not True:
                raise ProtocolError("container-create-diagnostic-asset", "verified DIND diagnostic asset is unavailable")
            return {
                "image": dind["reference"], "attemptId": "doctor-diagnostic",
                "command": DIAGNOSTIC_COMMAND,
                "tmpfs": {"/run": "rw,exec,nosuid,nodev,size=64m", "/tmp": "rw,nosuid,nodev,size=64m,mode=1777"},
            }
        if not isinstance(raw, dict) or raw.get("intent") != "workload" or set(raw) != {"intent", "create"}:
            raise ProtocolError("container-create-intent-invalid", "container requests require workload or diagnostic intent")
        raw = raw["create"]
        if not isinstance(raw, dict) or not raw.get("image") or not raw.get("attemptId"):
            raise ProtocolError("container-create-invalid", "image and attemptId are required")
        keys = set(raw)
        if keys & FORBIDDEN_CREATE_KEYS or not keys <= CREATE_KEYS:
            raise ProtocolError("container-create-host-input", "host paths and host/network configuration are control-owned")
        if not isinstance(raw.get("command", []), list) or not isinstance(raw.get("environment", []), list):
            raise ProtocolError("container-create-invalid", "command and environment must be arrays")
        tmpfs = raw.get("tmpfs", {})
        invalid_tmpfs = not isinstance(tmpfs, dict) or any(
            not isinstance(path, str)
            or not isinstance(options, str)
            or not path.startswith("/")
            or path == "/"
            or posixpath.normpath(path) != path
            or path == "/var/lib/docker"
            or path.startswith("/var/lib/docker/")
            for path, options in (tmpfs.items() if isinstance(tmpfs, dict) else ())
        )
        if invalid_tmpfs:
            raise ProtocolError("container-create-invalid", "tmpfs paths are not permitted")
        return copy.deepcopy(raw)

    def _validate_build(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict) or set(raw) - BUILD_KEYS:
            raise ProtocolError("build-create-host-input", "build accepts only normalized context metadata")
        build_key = raw.get("buildKey")
        platform = raw.get("platform")
        dockerfile = raw.get("dockerfile")
        build_args = raw.get("buildArgs", {})
        target = raw.get("target")
        retention = raw.get("retention", "cache")
        if not isinstance(build_key, str) or re.fullmatch(r"[a-f0-9]{64}", build_key) is None:
            raise ProtocolError("build-create-invalid", "buildKey must be a sha256 hex digest")
        if not isinstance(platform, str) or re.fullmatch(r"linux/[A-Za-z0-9_.-]+", platform) is None:
            raise ProtocolError("build-create-invalid", "platform must be a normalized Linux platform")
        if (not isinstance(dockerfile, str) or not dockerfile or dockerfile.startswith("/")
                or posixpath.normpath(dockerfile) != dockerfile
                or dockerfile == ".." or dockerfile.startswith("../")):
            raise ProtocolError("build-create-host-input", "Dockerfile must be a normalized context-relative path")
        if not isinstance(build_args, dict) or any(
            not isinstance(key, str) or not key or not isinstance(value, str)
            for key, value in build_args.items()
        ):
            raise ProtocolError("build-create-invalid", "buildArgs must contain string keys and values")
        if target is not None and (not isinstance(target, str) or not target or "\n" in target or "\r" in target):
            raise ProtocolError("build-create-invalid", "target must be one non-empty line")
        if retention not in ("cache", "ephemeral"):
            raise ProtocolError("build-create-invalid", "build retention must be cache or ephemeral")
        return copy.deepcopy(raw)

    def validate_build_context(self, spec: dict[str, Any], context_path: Path) -> None:
        names: set[str] = set()
        total = 0
        try:
            with tarfile.open(context_path, mode="r:*") as archive:
                for member in archive:
                    name = member.name
                    if (not name or name.startswith("/") or "\\" in name
                            or posixpath.normpath(name) != name
                            or name in (".", "..") or name.startswith("../")):
                        raise ProtocolError("build-context-path-forbidden", "tar entries must be normalized relative paths")
                    if name in names:
                        raise ProtocolError("build-context-duplicate", f"duplicate tar entry {name!r}")
                    names.add(name)
                    if not member.isfile() or member.issparse():
                        raise ProtocolError("build-context-type-forbidden", "build context accepts regular files only")
                    total += member.size
                    if member.size < 0 or total > MAX_BUILD_CONTEXT_BYTES:
                        raise ProtocolError("build-context-too-large", "expanded build context exceeds two GiB")
        except ProtocolError:
            raise
        except (tarfile.TarError, OSError) as error:
            raise ProtocolError("build-context-invalid-tar", f"build context is not a valid tar archive: {error}") from error
        if spec["dockerfile"] not in names:
            raise ProtocolError("build-context-dockerfile-missing", "declared Dockerfile is absent from build context")

    def _build_locator(self, build_key: str) -> str:
        return "niceeval-build:" + build_key[:32]

    def _build_labels(self, reservation: dict[str, Any]) -> dict[str, str]:
        labels = {
            label: str(self.profile_id if field == "profileId" else reservation[field])
            for field, label in LABELS.items()
            if field != "attemptId"
        }
        operation_id = reservation.get("operationId")
        if not isinstance(operation_id, str) or not re.fullmatch(r"[a-f0-9]{32}", operation_id):
            raise RuntimeError("build operation ID is not control-derived")
        labels["niceeval.operation-id"] = operation_id
        return labels

    def _builder_container_name(self, reservation: dict[str, Any]) -> str:
        builder = str(reservation.get("builderName", ""))
        if re.fullmatch(r"niceeval-build-[a-f0-9]{24}", builder) is None:
            raise RuntimeError("journaled builder name is not control-derived")
        return "buildx_buildkit_" + builder + "0"

    def _builder_volume_name(self, reservation: dict[str, Any]) -> str:
        return self._builder_container_name(reservation) + "_state"

    def _builder_container_ids(self, reservation: dict[str, Any]) -> list[str]:
        name = self._builder_container_name(reservation)
        result = self._docker("ps", "-aq", "--filter", f"name=^/{name}$", check=False)
        if result.returncode != 0:
            raise RuntimeError("Docker builder-container query failed; refusing to infer absence")
        return result.stdout.split()

    def _builder_volume_names(self, reservation: dict[str, Any]) -> list[str]:
        name = self._builder_volume_name(reservation)
        result = self._docker("volume", "ls", "-q", "--filter", f"name=^{name}$", check=False)
        if result.returncode != 0:
            raise RuntimeError("Docker builder-volume query failed; refusing to infer absence")
        names = result.stdout.split()
        if any(item != name for item in names):
            raise RuntimeError("Docker builder-volume query returned a non-exact name")
        return names

    @staticmethod
    def _process_start_time(pid: int) -> str | None:
        try:
            fields = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8").rpartition(") ")[2].split()
            return fields[19]
        except (FileNotFoundError, IndexError, OSError):
            return None

    @staticmethod
    def _process_cgroup_path(pid: int) -> str | None:
        try:
            for line in Path(f"/proc/{pid}/cgroup").read_text(encoding="utf-8").splitlines():
                if line.startswith("0::"):
                    relative = line[3:].lstrip("/")
                    root = Path("/sys/fs/cgroup").resolve()
                    path = (root / relative).resolve()
                    if path != root and root not in path.parents:
                        raise RuntimeError("builder cgroup escaped /sys/fs/cgroup")
                    return str(path)
        except FileNotFoundError:
            return None
        raise RuntimeError(f"cannot attest cgroup v2 path for pid {pid}")

    def _builder_process_facts(self, container_ids: list[str]) -> list[dict[str, Any]]:
        facts: list[dict[str, Any]] = []
        for container_id in container_ids:
            result = self._docker("inspect", "--format", "{{.State.Pid}}", container_id, check=False)
            if result.returncode != 0 or not result.stdout.strip().isdigit():
                raise RuntimeError(f"cannot attest builder container process for {container_id}")
            pid = int(result.stdout.strip())
            start_time = self._process_start_time(pid)
            cgroup_path = self._process_cgroup_path(pid)
            if pid <= 0 or start_time is None or cgroup_path is None:
                raise RuntimeError(f"builder container {container_id} has no stable process/cgroup identity")
            facts.append({
                "containerId": container_id,
                "pid": pid,
                "startTime": start_time,
                "cgroupPath": cgroup_path,
            })
        return facts

    def _record_builder_resources(self, reservation: dict[str, Any]) -> None:
        container_ids = self._builder_container_ids(reservation)
        if len(container_ids) != 1:
            raise RuntimeError("control-derived builder must have exactly one container")
        volume_names = self._builder_volume_names(reservation)
        if volume_names != [self._builder_volume_name(reservation)]:
            raise RuntimeError("control-derived builder must have exactly one state volume")
        reservation["builderContainerIds"] = container_ids
        reservation["builderProcesses"] = self._builder_process_facts(container_ids)
        reservation["builderVolumeNames"] = volume_names
        self._commit("build-builder-resources", {
            "reservationId": reservation["reservationId"],
            "containerIds": container_ids,
            "volumeNames": volume_names,
        })

    def _terminate_build_process(self, reservation: dict[str, Any]) -> bool:
        process = self.build_processes.get(reservation["reservationId"])
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        identity = reservation.get("buildProcess")
        if identity is None:
            return True
        if not isinstance(identity, dict) or not isinstance(identity.get("pid"), int) \
                or not isinstance(identity.get("startTime"), str):
            raise RuntimeError("journaled build process identity is invalid")
        pid = identity["pid"]
        expected = identity["startTime"]
        if self._process_start_time(pid) == expected:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 5
            while self._process_start_time(pid) == expected and time.monotonic() < deadline:
                time.sleep(0.05)
            if self._process_start_time(pid) == expected:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                deadline = time.monotonic() + 5
                while self._process_start_time(pid) == expected and time.monotonic() < deadline:
                    time.sleep(0.05)
        absent = self._process_start_time(pid) != expected
        if absent:
            reservation.pop("buildProcess", None)
        return absent

    def _builder_processes_absent(self, reservation: dict[str, Any]) -> bool:
        for fact in reservation.get("builderProcesses", []):
            if not isinstance(fact, dict):
                return False
            pid, start_time, cgroup_path = fact.get("pid"), fact.get("startTime"), fact.get("cgroupPath")
            if not isinstance(pid, int) or not isinstance(start_time, str) or not isinstance(cgroup_path, str):
                return False
            if self._process_start_time(pid) == start_time or Path(cgroup_path).exists():
                return False
        return True

    def _build_resources_absent(self, reservation: dict[str, Any], *, require_ephemeral_locator_absent: bool = False) -> bool:
        process = self.build_processes.get(reservation["reservationId"])
        if process is not None and process.poll() is None:
            return False
        identity = reservation.get("buildProcess")
        if isinstance(identity, dict) and isinstance(identity.get("pid"), int) \
                and isinstance(identity.get("startTime"), str) \
                and self._process_start_time(identity["pid"]) == identity["startTime"]:
            return False
        builder = str(reservation.get("builderName", ""))
        provisional = str(reservation.get("provisionalRef", ""))
        if builder and self._docker("buildx", "inspect", builder, check=False).returncode == 0:
            return False
        if builder and self._builder_container_ids(reservation):
            return False
        if builder and self._builder_volume_names(reservation):
            return False
        if not self._builder_processes_absent(reservation):
            return False
        if provisional and self._docker("image", "inspect", provisional, check=False).returncode == 0:
            return False
        if require_ephemeral_locator_absent and reservation.get("retention") == "ephemeral":
            locator = str(reservation.get("locator", ""))
            if not locator or self._docker("image", "inspect", locator, check=False).returncode == 0:
                return False
        containers, networks = self._resource_ids(reservation)
        return not containers and not networks

    def _destroy_build(self, reservation: dict[str, Any]) -> bool:
        process_absent = self._terminate_build_process(reservation)
        builder_attested = True
        builder = str(reservation.get("builderName", ""))
        provisional = str(reservation.get("provisionalRef", ""))
        if builder:
            current_ids = self._builder_container_ids(reservation)
            if current_ids and not reservation.get("builderProcesses"):
                try:
                    reservation["builderContainerIds"] = current_ids
                    reservation["builderProcesses"] = self._builder_process_facts(current_ids)
                except Exception:
                    builder_attested = False
            try:
                self._docker("buildx", "rm", "--force", builder, check=False)
            except Exception:
                pass
            for container_id in self._builder_container_ids(reservation):
                self._docker("rm", "-f", container_id, check=False)
            for volume_name in self._builder_volume_names(reservation):
                self._docker("volume", "rm", "-f", volume_name, check=False)
        if provisional:
            self._docker("image", "rm", "--force", provisional, check=False)
        _, networks = self._resource_ids(reservation)
        for network in networks:
            self._docker("network", "rm", network, check=False)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if process_absent and builder_attested and self._build_resources_absent(reservation):
                return True
            time.sleep(0.1)
        return process_absent and builder_attested and self._build_resources_absent(reservation)

    def _run_build(self, reservation: dict[str, Any], spec: dict[str, Any], context_path: Path) -> None:
        args = [
            "docker", "--host", f"unix://{self.docker_socket}",
            "buildx", "build", "--builder", reservation["builderName"], "--load",
            "--platform", spec["platform"], "--file", spec["dockerfile"],
            "--tag", reservation["provisionalRef"],
        ]
        if spec.get("retention") == "ephemeral":
            args += ["--network=none", "--no-cache"]
        for key, value in self._build_labels(reservation).items():
            args += ["--label", f"{key}={value}"]
        for key, value in sorted(spec.get("buildArgs", {}).items()):
            args += ["--build-arg", f"{key}={value}"]
        if spec.get("target"):
            args += ["--target", spec["target"]]
        args.append("-")
        with context_path.open("rb") as context:
            process = subprocess.Popen(
                args,
                stdin=context,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            start_time = self._process_start_time(process.pid)
            if start_time is None:
                process.terminate()
                process.wait(timeout=5)
                raise ProtocolError("build-process-attestation-failed", "cannot journal build process identity")
            with self._transition():
                self.build_processes[reservation["reservationId"]] = process
                current = self.state["reservations"].get(reservation["reservationId"])
                if current is None or current.get("state") != "provisioning":
                    process.terminate()
                    raise ProtocolError("build-cancelled", "build reservation is no longer provisioning")
                current["buildProcess"] = {"pid": process.pid, "startTime": start_time}
                self._commit("build-process-started", {
                    "reservationId": reservation["reservationId"],
                    "pid": process.pid,
                    "startTime": start_time,
                })
            try:
                _, stderr = process.communicate(timeout=15 * 60)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    _, stderr = process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    _, stderr = process.communicate(timeout=5)
                raise ProtocolError("build-create-timeout", "control-owned build exceeded 15 minutes")
            finally:
                with self.lock:
                    self.build_processes.pop(reservation["reservationId"], None)
            if process.returncode != 0:
                raise ProtocolError("build-create-failed", (stderr or "Docker build failed")[-65536:])

    def authorize_build_header(self, request: dict[str, Any]) -> None:
        with self.lock:
            if request.get("kind") != "build.create" or request.get("contextEncoding") != "tar-chunked/v1":
                raise ProtocolError("build-create-invalid", "build context framing must be tar-chunked/v1")
            lease = self._lease(request)
            reservation = self.state["reservations"].get(str(request.get("reservationId", "")))
            if reservation is None or reservation["invocationId"] != lease["invocationId"]:
                raise ProtocolError("reservation-not-found", "reservation is not owned by this lease")
            if reservation["kind"] != "build" or reservation["state"] not in ("granted", "provisioning", "committed"):
                raise ProtocolError("reservation-state", "build reservation is not createable")
            self._validate_build(request.get("build"))

    def handle_build(self, request: dict[str, Any], context_path: Path) -> dict[str, Any]:
        return self._handle_build(request, context_path)

    def _handle_build(self, request: dict[str, Any], context_path: Path) -> dict[str, Any]:
        self.authorize_build_header(request)
        spec = self._validate_build(request.get("build"))
        self.validate_build_context(spec, context_path)
        reservation_id = str(request["reservationId"])
        digest = canonical_digest(spec)
        with self._transition():
            reservation = self.state["reservations"][reservation_id]
            if reservation["state"] == "committed":
                if reservation.get("buildSpecDigest") != digest:
                    raise ProtocolError("build-create-conflict", "retry does not match journaled build intent")
                if reservation.get("buildTerminated") is True and reservation.get("locator"):
                    self._commit("build-create-replayed", {"reservationId": reservation_id})
                    return {"locator": reservation["locator"], "state": "terminated"}
                raise ProtocolError("build-create-failed", str(reservation.get("buildError", "prior build failed")))
            if reservation["state"] == "provisioning":
                if reservation.get("buildSpecDigest") != digest:
                    raise ProtocolError("build-create-conflict", "retry does not match journaled build intent")
                raise ProtocolError("build-create-active", "the control-owned build operation is still active")
            reservation["buildSpecDigest"] = digest
            reservation["operationId"] = hashlib.sha256(
                f"{reservation_id}:{reservation['provisionToken']}".encode()
            ).hexdigest()[:32]
            reservation["builderName"] = "niceeval-build-" + reservation["operationId"][:24]
            reservation["provisionalRef"] = "niceeval-build-provisional:" + reservation["operationId"]
            reservation["locator"] = self._build_locator(spec["buildKey"])
            reservation["retention"] = spec.get("retention", "cache")
            reservation["state"] = "provisioning"
            self._commit("build-create-intent", {
                "reservationId": reservation_id,
                "operationId": reservation["operationId"],
                "specDigest": digest,
                "provisionalRef": reservation["provisionalRef"],
            })
            operation = copy.deepcopy(reservation)

        retention = spec.get("retention", "cache")
        image_id = ""
        failure: Exception | None = None
        try:
            labels = self._build_labels(operation)
            network_args = [
                "network", "create", "--driver", "bridge", "--opt",
                "com.docker.network.bridge.enable_icc=false",
            ]
            for key, value in labels.items():
                network_args += ["--label", f"{key}={value}"]
            network_args.append("niceeval-build-" + operation["provisionToken"][:20])
            with self._transition():
                self._commit("build-network-create-intent", {"reservationId": reservation_id})
            network_id = self._docker(*network_args).stdout.strip()
            with self._transition():
                current = self.state["reservations"].get(reservation_id)
                if current is None or current.get("state") != "provisioning":
                    raise ProtocolError("build-cancelled", "build reservation is no longer provisioning")
                current["networkId"] = network_id
                self._commit("build-network-created", {
                    "reservationId": reservation_id, "networkId": network_id,
                })
            self._docker(
                "buildx", "create", "--driver", "docker-container",
                "--driver-opt", f"network={network_id}",
                "--driver-opt", "image=moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8",
                "--name", operation["builderName"],
            )
            with self._transition():
                self._commit("build-builder-created", {
                    "reservationId": reservation_id, "builderName": operation["builderName"],
                })
            self._docker("buildx", "inspect", "--bootstrap", operation["builderName"])
            with self._transition():
                current = self.state["reservations"].get(reservation_id)
                if current is None:
                    raise ProtocolError("build-cancelled", "build reservation disappeared")
                self._record_builder_resources(current)
            self._run_build(operation, spec, context_path)
            with self.lock:
                current = self.state["reservations"].get(reservation_id)
                if current is None or current.get("state") != "provisioning" or current.get("cancelRequested"):
                    raise ProtocolError("build-cancelled", "build cancellation won before image publication")
            self._docker("tag", operation["provisionalRef"], operation["locator"])
            if retention == "ephemeral":
                image_id = self._docker("image", "inspect", "--format", "{{.Id}}", operation["locator"]).stdout.strip()
                if not image_id.startswith("sha256:"):
                    raise RuntimeError("ephemeral build did not yield an exact image identity")
        except Exception as error:
            failure = error
        try:
            with self.lock:
                cleanup_snapshot = copy.deepcopy(self.state["reservations"].get(reservation_id, operation))
            terminated = self._destroy_build(cleanup_snapshot)
        except Exception as error:
            terminated = False
            if failure is None:
                failure = error
        with self._transition():
            reservation = self.state["reservations"].get(reservation_id)
            if reservation is None:
                raise ProtocolError("build-cancelled", "build reservation disappeared during cleanup")
            reservation["buildTerminated"] = terminated
            if not terminated:
                self._quarantine(reservation, f"build {reservation_id} termination could not be proven")
                raise ProtocolError("build-termination-unproven", "control could not prove the build operation terminated")
            if image_id:
                reservation["locatorImageId"] = image_id
            reservation["state"] = "committed"
            if failure is not None:
                reservation["buildError"] = str(failure)[-65536:]
            self._commit("build-terminated", {
                "reservationId": reservation_id,
                "operationId": reservation["operationId"],
                "locator": reservation["locator"],
                "outcome": "failed" if failure is not None else "succeeded",
            })
        if failure is not None:
            if isinstance(failure, ProtocolError):
                raise failure
            if isinstance(failure, subprocess.CalledProcessError):
                detail = (failure.stderr or failure.stdout or str(failure)).strip()[-65536:]
            else:
                detail = str(failure)
            raise ProtocolError("build-create-failed", detail)
        return {"locator": reservation["locator"], "state": "terminated"}

    def _create_container(self, reservation: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
        slot = self.state["slots"][reservation["slotId"]]
        reservation["attemptId"] = str(spec["attemptId"])
        labels = {label: str(reservation[field] if field != "profileId" else self.profile_id)
                  for field, label in LABELS.items()}
        reservation["createSpecDigest"] = canonical_digest(spec)
        reservation["state"] = "provisioning"
        slot["state"] = "attaching"
        self._commit("container-create-intent", {"reservationId": reservation["reservationId"],
                                                  "specDigest": reservation["createSpecDigest"]})
        network_name = "niceeval-" + reservation["provisionToken"][:20]
        network_args = [
            "network", "create", "--driver", "bridge", "--opt",
            "com.docker.network.bridge.enable_icc=false",
        ]
        for key, value in labels.items():
            network_args += ["--label", f"{key}={value}"]
        network_args.append(network_name)
        self._commit("container-network-create-intent", {"reservationId": reservation["reservationId"],
                                                          "networkName": network_name})
        try:
            network_id = self._docker(*network_args).stdout.strip()
        except subprocess.CalledProcessError as error:
            _, networks = self._resource_ids(reservation)
            if len(networks) != 1:
                detail = (error.stderr or error.stdout or str(error)).strip()[-2000:]
                raise ProtocolError("container-network-create-failed", detail)
            network_id = networks[0]
        except Exception:
            _, networks = self._resource_ids(reservation)
            if len(networks) != 1:
                self._quarantine(reservation, "ambiguous network create could not be reconciled by provision token")
                raise ProtocolError("container-create-ambiguous", "network create outcome is ambiguous")
            network_id = networks[0]
        reservation["networkId"] = network_id
        self._commit("container-network-created", {"reservationId": reservation["reservationId"], "networkId": network_id})
        memory = str(int(reservation["resources"]["memoryBytes"]))
        args = ["create", "--network", network_id, "--privileged", "--read-only", "--memory", memory,
                "--memory-swap", memory, "--pids-limit", str(int(reservation["resources"]["pids"])),
                "--cpus", str(reservation["resources"]["cpus"]), "--mount",
                f"type=bind,src={slot['path']},dst=/var/lib/docker,bind-propagation=rprivate"]
        for key, value in labels.items():
            args += ["--label", f"{key}={value}"]
        for path, options in spec.get("tmpfs", {}).items():
            args += ["--tmpfs", f"{path}:{options}"]
        for value in spec.get("environment", []):
            args += ["--env", str(value)]
        policy = self.descriptor.get("policy", {})
        if policy.get("level") == "managed-rootless/v1":
            for server in policy.get("network", {}).get("dns", {}).get("servers", []):
                args += ["--dns", str(server)]
        if spec.get("workingDir"):
            args += ["--workdir", str(spec["workingDir"])]
        if spec.get("user"):
            args += ["--user", str(spec["user"])]
        if spec.get("entrypoint"):
            args += ["--entrypoint", str(spec["entrypoint"])]
        args.append(str(spec["image"]))
        args += [str(item) for item in spec.get("command", [])]
        try:
            container_id = self._docker(*args).stdout.strip()
        except subprocess.CalledProcessError as error:
            containers, _ = self._resource_ids(reservation)
            if len(containers) != 1:
                detail = (error.stderr or error.stdout or str(error)).strip()[-2000:]
                raise ProtocolError("container-create-failed", detail)
            container_id = containers[0]
        except Exception:
            containers, _ = self._resource_ids(reservation)
            if len(containers) != 1:
                self._quarantine(reservation, "ambiguous container create could not be reconciled by provision token")
                raise ProtocolError("container-create-ambiguous", "container create outcome is ambiguous")
            container_id = containers[0]
        reservation["containerId"] = container_id
        self._commit("container-created", {"reservationId": reservation["reservationId"], "containerId": container_id})
        reservation["state"] = "committed"
        slot["state"] = "active"
        self._commit("container-active", {"reservationId": reservation["reservationId"]})
        return {"containerId": container_id, "networkId": network_id, "state": "active"}

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        if request.get("kind") == "setup-prefix.capture":
            return self._handle_setup_prefix_capture(request)
        if request.get("kind") == "setup-prefix.capture.publish":
            return self._handle_setup_prefix_capture_publish(request)
        if request.get("kind") == "setup-prefix.restore":
            return self._handle_setup_prefix_restore(request)
        with self.lock:
            scope_owner = self._begin_transition_scope()
            try:
                return self._handle(request)
            finally:
                self._end_transition_scope(scope_owner)

    def _handle(self, request: dict[str, Any]) -> dict[str, Any]:
            kind = request.get("kind")
            if kind == "challenge":
                return {
                    "protocol": "niceeval-docker-profile-control/v1",
                    "schemaVersion": 1,
                    "profileId": self.profile_id,
                    "descriptorDigest": self.descriptor_digest,
                    "hostMachineIdentity": self.descriptor["transport"]["hostMachineIdentity"],
                    "backendMachineIdentity": self.descriptor["backend"]["machineIdentity"],
                    "daemonGeneration": self.state["generation"],
                    "clientNonce": request.get("clientNonce"),
                    "admissionOpen": self.state["admissionOpen"],
                }
            if kind == "status":
                used = self._used()
                assets = self.asset_facts
                result = {"profileId": self.profile_id, "generation": self.state["generation"],
                        "admissionOpen": self.state["admissionOpen"], "used": used,
                        "capacity": self._capacity(), "leases": list(self.state["leases"].values()),
                        "reservations": list(self.state["reservations"].values()),
                        "queue": [
                            {"reservationId": reservation_id,
                             "invocationId": self.state["reservations"][reservation_id]["invocationId"]}
                            for reservation_id in self.state["queue"]
                            if reservation_id in self.state["reservations"]
                        ],
                        "slots": list(self.state["slots"].values()),
                        "availableQuotaSlots": sum(1 for s in self.state["slots"].values() if s["state"] == "free"),
                        "degraded": list(self.state["degraded"]),
                        "journal": {"state": "healthy", "durableTransitions": True},
                        "assets": {"state": "verified" if assets and all(item["present"] for item in assets) else "missing", "images": assets}}
                if self.setup_prefix is not None:
                    result["setupPrefix"] = {
                        "protocol": SETUP_PREFIX_PROTOCOL,
                        "coverage": SETUP_PREFIX_REQUIRED_STATE,
                        "requiredState": SETUP_PREFIX_REQUIRED_STATE,
                        "helperRevision": SETUP_PREFIX_HELPER_REVISION,
                        "copyProtocol": SETUP_PREFIX_COPY_PROTOCOL,
                        "copyRevision": SETUP_PREFIX_COPY_REVISION,
                        "quiesceRevision": SETUP_PREFIX_QUIESCE_REVISION,
                        "slotAttestation": SETUP_PREFIX_SLOT_ATTESTATION,
                        "providerIdentity": self.setup_prefix["providerIdentity"],
                        "executionDomain": self.setup_prefix["executionDomain"],
                        "filesystemSizeBytes": self.setup_prefix["filesystemSizeBytes"],
                        "filesystemFeatures": self.setup_prefix["filesystemFeatures"],
                        "capacity": self._setup_prefix_ledger(),
                        "artifacts": [
                            {key: value for key, value in artifact.items() if key != "seedId"}
                            for artifact in self.state["setupPrefix"]["artifacts"].values()
                        ],
                        "operations": list(self.state["setupPrefix"]["operations"].values()),
                    }
                return result
            if kind == "build.lookup":
                if request.get("profileId") != self.profile_id or request.get("daemonGeneration") != self.state["generation"]:
                    raise ProtocolError("attestation-changed", "profile or daemon generation changed")
                build_key = request.get("buildKey")
                if not isinstance(build_key, str) or re.fullmatch(r"[a-f0-9]{64}", build_key) is None:
                    raise ProtocolError("build-lookup-invalid", "buildKey must be a sha256 hex digest")
                locator = self._build_locator(build_key)
                hit = self._docker("image", "inspect", locator, check=False).returncode == 0
                return {"hit": hit, "locator": locator}
            if kind == "lease.create":
                if not self.state["admissionOpen"]:
                    degraded = "; ".join(str(reason) for reason in self.state["degraded"])
                    raise ProtocolError("admission-closed", degraded or "profile recovery has not converged")
                if request.get("profileId") != self.profile_id or request.get("daemonGeneration") != self.state["generation"]:
                    raise ProtocolError("attestation-changed", "profile or daemon generation changed")
                invocation_id = str(request.get("invocationId", ""))
                if not invocation_id or invocation_id in self.state["leases"]:
                    raise ProtocolError("lease-invalid", "invocation ID is empty or already exists")
                token = secrets.token_urlsafe(32)
                created = now()
                self.state["leases"][invocation_id] = {
                    "invocationId": invocation_id, "profileId": self.profile_id,
                    "daemonGeneration": self.state["generation"], "tokenDigest": token_digest(token),
                    "createdAt": created, "lastHeartbeatAt": created, "state": "active",
                }
                self._commit("lease-created", {"invocationId": invocation_id})
                return {"invocationId": invocation_id, "leaseToken": token,
                        "daemonGeneration": self.state["generation"]}
            lease = self._lease(request, active=kind not in ("reservation.release", "lease.drain"))
            if kind == "lease.heartbeat":
                lease["lastHeartbeatAt"] = now()
                self._commit("lease-heartbeat", {"invocationId": lease["invocationId"]})
                return {"state": lease["state"]}
            if kind == "lease.drain":
                lease["state"] = "draining"
                prepared = self._fence_cancelled_captures(
                    lease["invocationId"], "lease drain before capture publication commit",
                )
                self._commit("lease-draining", {"invocationId": lease["invocationId"]})
                self._scrub_cancelled_prepared_captures(prepared)
                self._recover_once()
                return {"state": lease["state"]}
            if kind == "reservation.acquire":
                reservation_id = str(request.get("reservationId", ""))
                reservation_kind = str(request.get("reservationKind", ""))
                resources = request.get("resources")
                if reservation_kind not in ("container", "build") or not isinstance(resources, dict):
                    raise ProtocolError("reservation-invalid", "invalid reservation kind or resources")
                cap = self._capacity()
                resource_fields = ("cpus", "memoryBytes", "pids", "containers", "ephemeralDiskBytes")
                if set(resources) != set(resource_fields):
                    raise ProtocolError("reservation-invalid", "resource vector must contain only the complete known fields")
                normalized: dict[str, float] = {}
                for field in resource_fields:
                    raw_value = resources[field]
                    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                        raise ProtocolError("reservation-invalid", f"{field} must be numeric")
                    value = float(raw_value)
                    if not math.isfinite(value) or value < 0 or value > cap[field]:
                        raise ProtocolError("reservation-exceeds-capacity", f"{field} exceeds allocatable capacity")
                    if field != "cpus" and not value.is_integer():
                        raise ProtocolError("reservation-invalid", f"{field} must be an integer")
                    normalized[field] = value
                if reservation_kind == "container" and (
                    normalized["cpus"] <= 0 or normalized["memoryBytes"] <= 0 or normalized["pids"] <= 0
                ):
                    raise ProtocolError("reservation-invalid", "CPU, memory and PID resources must be positive")
                if reservation_kind == "container" and (
                    normalized["containers"] != 1 or normalized["ephemeralDiskBytes"] <= 0
                ):
                    raise ProtocolError("reservation-invalid", "container requires containers=1 and positive ephemeralDiskBytes")
                allocation_limit = float(
                    self.descriptor["backend"]["filesystem"]["dockerDataPool"]["bytesPerAllocation"]
                )
                if reservation_kind == "container" and normalized["ephemeralDiskBytes"] > allocation_limit:
                    raise ProtocolError(
                        "reservation-exceeds-capacity",
                        "container ephemeralDiskBytes exceeds one Docker data allocation",
                    )
                if reservation_kind == "build" and normalized["containers"] != 0:
                    raise ProtocolError("reservation-invalid", "build requires containers=0")
                if reservation_id in self.state["reservations"]:
                    raise ProtocolError("reservation-exists", "reservation already exists")
                provision = secrets.token_urlsafe(24)
                reservation = {
                    "reservationId": reservation_id, "invocationId": lease["invocationId"],
                    "profileId": self.profile_id, "provisionToken": provision,
                    "kind": reservation_kind, "resources": resources, "state": "queued", "createdAt": now(),
                }
                self.state["reservations"][reservation_id] = reservation
                self.state["queue"].append(reservation_id)
                self._commit("reservation-queued", {"reservationId": reservation_id})
                self._grant_queue()
                return copy.deepcopy(reservation)
            reservation_id = str(request.get("reservationId", ""))
            reservation = self.state["reservations"].get(reservation_id)
            if reservation is None or reservation["invocationId"] != lease["invocationId"]:
                raise ProtocolError("reservation-not-found", "reservation is not owned by this lease")
            if kind == "reservation.get":
                self._grant_queue()
                return copy.deepcopy(reservation)
            if kind == "reservation.cancel":
                if reservation["state"] not in ("queued", "blocked"):
                    raise ProtocolError("reservation-state", "only a queued or blocked reservation can cancel")
                if reservation_id in self.state["queue"]:
                    self.state["queue"].remove(reservation_id)
                del self.state["reservations"][reservation_id]
                self._commit("reservation-cancelled", {"reservationId": reservation_id})
                self._grant_queue()
                return {"cancelled": True}
            if kind == "reservation.commit":
                raise ProtocolError("control-create-unimplemented", "container create must be owned by the control service; client-supplied IDs are forbidden")
            if kind == "container.create":
                if reservation.get("setupPrefixOperation"):
                    raise ProtocolError("setup-prefix-operation-active", "container create cannot race setup-prefix restore")
                if reservation["kind"] != "container" or reservation["state"] not in ("granted", "provisioning", "committed"):
                    raise ProtocolError("reservation-state", "container reservation is not createable")
                spec = self._validate_create(request.get("create"))
                if reservation["state"] == "committed":
                    if reservation.get("createSpecDigest") != canonical_digest(spec):
                        raise ProtocolError("container-create-conflict", "replay does not match journaled create intent")
                    containers, networks = self._resource_ids(reservation)
                    if containers != [reservation.get("containerId")] or networks != [reservation.get("networkId")]:
                        raise ProtocolError("container-create-replay-incomplete", "committed container resources are not uniquely visible")
                    self._commit("container-create-replayed", {"reservationId": reservation_id})
                    return {"containerId": containers[0], "networkId": networks[0], "state": "active"}
                if reservation["state"] == "provisioning":
                    if reservation.get("createSpecDigest") != canonical_digest(spec):
                        raise ProtocolError("container-create-conflict", "retry does not match journaled create intent")
                    containers, networks = self._resource_ids(reservation)
                    if len(containers) == 1 and len(networks) == 1:
                        reservation["containerId"], reservation["networkId"] = containers[0], networks[0]
                        reservation["state"] = "committed"
                        self.state["slots"][reservation["slotId"]]["state"] = "active"
                        self._commit("container-create-reconciled", {"reservationId": reservation_id})
                        return {"containerId": containers[0], "networkId": networks[0], "state": "active"}
                return self._create_container(reservation, spec)
            if kind == "build.cancel":
                if reservation["kind"] != "build" or reservation["state"] != "provisioning":
                    raise ProtocolError("reservation-state", "only an active build can cancel")
                reservation["cancelRequested"] = True
                process = self.build_processes.get(reservation_id)
                if process is not None and process.poll() is None:
                    process.terminate()
                self._commit("build-cancel-requested", {"reservationId": reservation_id})
                return {"cancelRequested": True}
            if kind == "reservation.release":
                if reservation.get("setupPrefixOperation"):
                    prepared = self._fence_cancelled_captures(
                        lease["invocationId"], "reservation release before capture publication commit",
                    )
                    self._scrub_cancelled_prepared_captures(prepared)
                    raise ProtocolError("setup-prefix-operation-active", "reservation release cannot race setup-prefix operation")
                if reservation["kind"] == "build":
                    if "terminationEvidence" in request:
                        raise ProtocolError("build-release-client-evidence-forbidden", "build termination proof is control-owned")
                    if reservation.get("retention") == "ephemeral":
                        locator = str(reservation.get("locator", ""))
                        expected_image_id = str(reservation.get("locatorImageId", ""))
                        actual_image_id = self._docker("image", "inspect", "--format", "{{.Id}}", locator).stdout.strip()
                        operation_label = self._docker(
                            "image", "inspect", "--format", "{{index .Config.Labels \"niceeval.operation-id\"}}", locator,
                        ).stdout.strip()
                        if (not expected_image_id or actual_image_id != expected_image_id
                                or operation_label != reservation.get("operationId")):
                            raise ProtocolError("build-release-unproven", "ephemeral locator no longer names the control-owned image")
                        self._docker("image", "rm", "--force", locator)
                    if reservation.get("buildTerminated") is not True or not self._build_resources_absent(
                        reservation, require_ephemeral_locator_absent=True,
                    ):
                        raise ProtocolError("build-still-active", "control has not proven complete build termination")
                    if reservation.get("retention") == "ephemeral":
                        reservation["ephemeralCleanupProven"] = True
                reservation["state"] = "releasing"
                self._commit("reservation-release-intent", {"reservationId": reservation_id})
                if reservation["kind"] == "container" and not self._cleanup_with_deadline(reservation):
                    self.state["degraded"].append(f"could not prove resources absent for {reservation_id}")
                    self._commit("reservation-release-blocked", {"reservationId": reservation_id})
                    raise ProtocolError("recovery-blocked", "container/network are still visible")
                if reservation["kind"] == "container" and not self._verify_and_free_slot(reservation):
                    raise ProtocolError("slot-quarantined", "slot could not be proven verified-free")
                del self.state["reservations"][reservation_id]
                self._commit("reservation-released", {"reservationId": reservation_id})
                self._grant_queue()
                return {"released": True, **({"cleanupProven": True} if reservation.get("ephemeralCleanupProven") else {})}
            raise ProtocolError("request-unknown", f"unknown request kind {kind!r}")

    def _reconcile_restarted_builds(self) -> None:
        with self.lock:
            scope_owner = self._begin_transition_scope()
            try:
                self._reconcile_restarted_builds_impl()
            finally:
                self._end_transition_scope(scope_owner)

    def _reconcile_restarted_builds_impl(self) -> None:
        with self.lock:
            active = [
                reservation for reservation in self.state["reservations"].values()
                if reservation["kind"] == "build" and reservation["state"] == "provisioning"
            ]
            if not active:
                return
            reopen = bool(self.state["admissionOpen"])
            self.state["admissionOpen"] = False
            self._commit("build-restart-recovery-started", {
                "reservationIds": [reservation["reservationId"] for reservation in active],
            })
            for reservation in active:
                reservation_id = reservation["reservationId"]
                try:
                    terminated = self._destroy_build(reservation)
                except Exception as error:
                    terminated = False
                    reason = str(error)
                else:
                    reason = "watchdog restarted before the control-owned build completed"
                reservation["buildTerminated"] = terminated
                if terminated:
                    reservation["state"] = "committed"
                    reservation["buildError"] = reason
                    self._commit("build-restart-reconciled", {
                        "reservationId": reservation_id,
                        "outcome": "cancelled",
                    })
                else:
                    self._quarantine(reservation, f"build {reservation_id} restart recovery failed: {reason}")
            self.state["admissionOpen"] = reopen and not self.state["degraded"]
            self._commit("build-restart-recovery-finished", {
                "admissionOpen": self.state["admissionOpen"],
            })

    def _recover_once(self) -> None:
        with self.lock:
            scope_owner = self._begin_transition_scope()
            try:
                self._recover_once_impl()
            finally:
                self._end_transition_scope(scope_owner)

    def _recover_once_impl(self) -> None:
        with self.lock:
            changed = False
            for invocation_id, lease in list(self.state["leases"].items()):
                if lease["state"] not in ("lost", "draining", "recovered"):
                    continue
                owned = [r for r in self.state["reservations"].values() if r["invocationId"] == lease["invocationId"]]
                unresolved = False
                for reservation in owned:
                    recovery_error = f"recovery blocked for {reservation['reservationId']}"
                    if reservation.get("setupPrefixOperation"):
                        # The setup-prefix transaction owns cleanup until its
                        # copy boundary publishes or rolls back. Concurrent
                        # lease recovery must not scrub its source/target.
                        unresolved = True
                        continue
                    if reservation["kind"] == "build" and reservation["state"] == "provisioning":
                        process = self.build_processes.get(reservation["reservationId"])
                        if process is not None:
                            if process.poll() is None:
                                process.terminate()
                            reservation["cancelRequested"] = True
                            unresolved = True
                            continue
                    try:
                        if reservation["kind"] == "build" and not self._destroy_build(reservation):
                            unresolved = True
                            continue
                        if reservation["kind"] == "container" and not self._destroy(reservation):
                            unresolved = True
                            continue
                        if reservation["kind"] == "container" and not self._verify_and_free_slot(reservation):
                            unresolved = True
                            continue
                    except Exception as error:
                        message = f"{recovery_error}: {error}"
                        self.state["degraded"] = [
                            item for item in self.state["degraded"] if not item.startswith(f"{recovery_error}:")
                        ]
                        self.state["degraded"].append(message)
                        self._commit("recovery-blocked", {
                            "reservationId": reservation["reservationId"],
                            "reason": str(error),
                        })
                        unresolved = True
                        continue
                    self.state["degraded"] = [
                        item for item in self.state["degraded"] if not item.startswith(f"{recovery_error}:")
                    ]
                    self.state["reservations"].pop(reservation["reservationId"], None)
                    if reservation["reservationId"] in self.state["queue"]:
                        self.state["queue"].remove(reservation["reservationId"])
                    changed = True
                if not unresolved:
                    # `recovered` is a terminal receipt, not a durable ledger
                    # owner. Set the detached object for an in-flight
                    # lease.drain response, then atomically retire the entry.
                    lease["state"] = "recovered"
                    self.state["leases"].pop(invocation_id, None)
                    changed = True
                else:
                    self.state["admissionOpen"] = False
                    changed = True
            if changed:
                self._grant_queue()
                if not self.state["degraded"]:
                    self.state["admissionOpen"] = True
                self._commit("recovery-converged", {})

    def recovery_loop(self) -> None:
        while not self.stop.wait(1.0):
            try:
                cutoff = time.time() - self.grace
                with self._transition():
                    for lease in self.state["leases"].values():
                        if lease["state"] != "active":
                            continue
                        stamp = datetime.fromisoformat(lease["lastHeartbeatAt"].replace("Z", "+00:00")).timestamp()
                        if stamp < cutoff:
                            lease["state"] = "lost"
                            self._commit("lease-lost", {"invocationId": lease["invocationId"]})
                self._recover_once()
            except Exception as error:
                with self._transition():
                    message = f"recovery loop blocked: {error}"
                    self.state["admissionOpen"] = False
                    self.state["degraded"] = [
                        item for item in self.state["degraded"] if not item.startswith("recovery loop blocked:")
                    ]
                    self.state["degraded"].append(message)
                    try:
                        self._commit("recovery-loop-blocked", {"reason": str(error)})
                    except Exception:
                        pass


class Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        context_path: Path | None = None
        request: dict[str, Any] | None = None
        admission: Admission | None = None
        try:
            raw = self.rfile.readline(1024 * 1024)
            if not raw.endswith(b"\n"):
                raise ProtocolError("request-invalid", "request header exceeds one MiB or is unterminated")
            request = json.loads(raw.decode("utf-8"))
            if not isinstance(request, dict):
                raise ProtocolError("request-invalid", "request must be an object")
            admission = self.server.admission  # type: ignore[attr-defined]
            if request.get("kind") == "build.create":
                admission.authorize_build_header(request)
                admission.journal.parent.mkdir(parents=True, exist_ok=True)
                fd, raw_path = tempfile.mkstemp(prefix="build-context-", suffix=".tar", dir=admission.journal.parent)
                context_path = Path(raw_path)
                with os.fdopen(fd, "wb") as context:
                    receive_framed_build_context(self.rfile, context)
                    context.flush()
                    os.fsync(context.fileno())
                response = {"ok": True, "result": admission.handle_build(request, context_path)}
            else:
                response = {"ok": True, "result": admission.handle(request)}
        except ProtocolError as error:
            response = {"ok": False, "error": {"code": error.code, "message": str(error)}}
            if request is not None and str(request.get("kind", "")).startswith("setup-prefix."):
                setup_key = request.get("setupPrefixKey")
                artifact = None
                if admission is not None and isinstance(setup_key, str):
                    artifact = admission.state.get("setupPrefix", {}).get("artifacts", {}).get(setup_key)
                response["error"].update({
                    "protocol": request.get("protocol"),
                    "requiredState": request.get("requiredState"),
                    "descriptorDigest": admission.descriptor_digest if admission is not None else None,
                    "providerIdentity": request.get("providerIdentity"),
                    "baseIdentity": request.get("baseIdentity"),
                    "executionDomain": request.get("executionDomain"),
                    "helperRevision": request.get("helperRevision"),
                    "copyProtocol": request.get("copyProtocol"),
                    "copyRevision": request.get("copyRevision"),
                    "quiesceRevision": request.get("quiesceRevision"),
                    "publicationRevision": request.get("publicationRevision"),
                    "recoveryRevision": request.get("recoveryRevision"),
                    "manifestSchema": request.get("manifestSchema"),
                    "filesystemSizeBytes": request.get("filesystemSizeBytes"),
                    "filesystemFeatures": request.get("filesystemFeatures"),
                    "daemonGeneration": admission.state["generation"] if admission is not None else None,
                    "slotGeneration": request.get("slotGeneration"),
                    "setupPrefixKey": setup_key,
                    "setupManifestDigest": request.get("setupManifestDigest"),
                    "artifact": {"artifactId": artifact.get("artifactId") if artifact else None},
                    "status": {"state": "failed", "diagnostic": error.code},
                })
        except Exception as error:
            response = {"ok": False, "error": {"code": "internal", "message": str(error)}}
        finally:
            if context_path is not None:
                context_path.unlink(missing_ok=True)
        try:
            if (request is not None and request.get("kind") == "setup-prefix.capture.publish"
                    and os.environ.pop("NICEEVAL_TEST_DROP_CAPTURE_PUBLISH_RESPONSE_ONCE", "") == "1"
                    and response.get("ok") is True):
                # Test-only transport fault: commit has completed, but the
                # response is lost.  The client must retry the same operationId.
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            self.wfile.write((json.dumps(response, separators=(",", ":")) + "\n").encode())
        except BrokenPipeError:
            pass


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, path: str, admission: Admission) -> None:
        self.admission = admission
        super().__init__(path, Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--control-socket", required=True)
    parser.add_argument("--descriptor", required=True)
    parser.add_argument("--host-config", required=True)
    parser.add_argument("--docker-socket", required=True)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--socket-mode", default="0o660")
    parser.add_argument("--ready-file")
    parser.add_argument("--orphan-grace-seconds", type=float, default=15.0)
    parser.add_argument("--activation-manifest-digest",
                        default=os.environ.get("NICEEVAL_ACTIVATION_MANIFEST_DIGEST"))
    args = parser.parse_args()
    path = Path(args.control_socket)
    path.parent.mkdir(parents=True, exist_ok=True)
    if args.ready_file:
        Path(args.ready_file).unlink(missing_ok=True)
    activation = _verify_fixed_activation(
        Path(args.host_config), Path(args.descriptor), args.activation_manifest_digest,
    )
    if path.exists() or path.is_socket():
        path.unlink()
    admission = Admission(Path(args.descriptor), Path(args.journal), args.docker_socket,
                          args.orphan_grace_seconds, Path(args.host_config))
    server = Server(str(path), admission)
    os.chmod(path, int(args.socket_mode, 0))
    if args.ready_file:
        ready = admission.state["generation"] + "\n"
        if activation is not None:
            activation_manifest_digest = "sha256:" + hashlib.sha256(
                json.dumps(activation[0], sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            ready += json.dumps({
                "activationEpoch": activation[0]["epoch"],
                "manifestDigest": activation_manifest_digest,
                "copyRevision": SETUP_PREFIX_COPY_REVISION,
            }, sort_keys=True) + "\n"
        Path(args.ready_file).write_text(ready, encoding="utf-8")
    thread = threading.Thread(target=admission.recovery_loop, daemon=True)
    thread.start()
    def stop(*_: object) -> None:
        admission.stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever(poll_interval=0.2)
    server.server_close()
    if path.exists():
        path.unlink()
    if args.ready_file:
        Path(args.ready_file).unlink(missing_ok=True)
    if activation is not None:
        activation[1].close()


if __name__ == "__main__":
    main()
