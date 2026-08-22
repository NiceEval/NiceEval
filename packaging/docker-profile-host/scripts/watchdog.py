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
import hashlib
import hmac
import json
import math
import os
import posixpath
import secrets
import signal
import socketserver
import stat
import subprocess
import threading
import time
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


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_digest(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()


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
        self.profile_id = str(self.descriptor["profileId"])
        self.journal = journal
        self.docker_socket = docker_socket
        self.grace = grace
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.state: dict[str, Any] = {
            "schemaVersion": 1,
            "generation": self._generation(),
            "admissionOpen": True,
            "leases": {},
            "reservations": {},
            "queue": [],
            "degraded": [],
            "slots": {},
        }
        self._load()
        self._load_slots()
        current = self._generation()
        if self.state.get("generation") != current:
            self.state["admissionOpen"] = False
            self.state["generation"] = current
            self._commit("daemon-generation-changed", {})
            self._recover_once()
            self.state["admissionOpen"] = not self.state["degraded"]
            self._commit("daemon-generation-reconciled", {})

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
        existing = self.state.setdefault("slots", {})
        for raw in installed.get("slots", []):
            slot_id = str(raw["slotId"])
            source = Path(str(raw["path"]))
            if source.is_symlink() or source.resolve().parent != root or source.name != slot_id:
                self.state["admissionOpen"] = False
                self.state["degraded"].append(f"slot registry path is not attested for {slot_id}")
                continue
            existing.setdefault(slot_id, {**raw, "state": "free", "generation": int(raw.get("generation", 0))})
        if len(existing) != int(config["count"]):
            self.state["admissionOpen"] = False
            self.state["degraded"].append("project-quota slot count does not match descriptor")

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
        return hashlib.sha256(f"{daemon_id}:{sock.st_ino}:{sock.st_ctime_ns}".encode()).hexdigest()[:32]

    def _load(self) -> None:
        if not self.journal.exists():
            return
        last: dict[str, Any] | None = None
        for line in self.journal.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
                if isinstance(item.get("state"), dict):
                    last = item["state"]
            except json.JSONDecodeError:
                break
        if last is not None:
            self.state = last

    def _commit(self, event: str, detail: dict[str, Any]) -> None:
        self.journal.parent.mkdir(parents=True, exist_ok=True)
        record = {"at": now(), "event": event, "detail": detail, "state": self.state}
        encoded = json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n"
        fd = os.open(self.journal, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        try:
            os.write(fd, encoded.encode())
            os.fsync(fd)
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
            if reservation["state"] not in ("granted", "provisioning", "committed", "releasing", "quarantined"):
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

    def _run_host(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              check=True, timeout=30)

    def _slot_facts(self, slot: dict[str, Any]) -> dict[str, Any]:
        path = Path(slot["path"])
        st = path.lstat()
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            raise RuntimeError("slot is not a real directory")
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
            if len(fields) > 4 and (fields[3] == source or fields[4] == source or fields[3].startswith(source + "/")):
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
        container_query = self._docker("ps", "-aq", *filters, check=False)
        network_query = self._docker("network", "ls", "-q", *filters, check=False)
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

    def _validate_create(self, raw: Any) -> dict[str, Any]:
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
        network_args = ["network", "create", "--driver", "bridge"]
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
        with self.lock:
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
                return {"profileId": self.profile_id, "generation": self.state["generation"],
                        "admissionOpen": self.state["admissionOpen"], "used": used,
                        "capacity": self._capacity(), "leases": list(self.state["leases"].values()),
                        "reservations": list(self.state["reservations"].values()),
                        "slots": list(self.state["slots"].values()),
                        "availableQuotaSlots": sum(1 for s in self.state["slots"].values() if s["state"] == "free"),
                        "degraded": list(self.state["degraded"])}
            if kind == "lease.create":
                if not self.state["admissionOpen"]:
                    raise ProtocolError("admission-closed", "profile recovery has not converged")
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
                self._commit("lease-draining", {"invocationId": lease["invocationId"]})
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
                return copy.deepcopy(reservation)
            if kind == "reservation.cancel":
                if reservation["state"] != "queued":
                    raise ProtocolError("reservation-state", "only a queued reservation can cancel")
                self.state["queue"].remove(reservation_id)
                del self.state["reservations"][reservation_id]
                self._commit("reservation-cancelled", {"reservationId": reservation_id})
                return {"cancelled": True}
            if kind == "reservation.commit":
                raise ProtocolError("control-create-unimplemented", "container create must be owned by the control service; client-supplied IDs are forbidden")
            if kind == "container.create":
                if reservation["kind"] != "container" or reservation["state"] not in ("granted", "provisioning"):
                    raise ProtocolError("reservation-state", "container reservation is not createable")
                spec = self._validate_create(request.get("create"))
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
            if kind == "reservation.release":
                if reservation["kind"] == "build":
                    evidence = request.get("terminationEvidence", {})
                    required = ("daemonRequestTerminated", "buildkitSessionGone", "processActivityZero", "provisionalRefResolvedOrRemoved")
                    if not all(evidence.get(item) is True for item in required):
                        raise ProtocolError("build-still-active", "complete build termination evidence is required")
                reservation["state"] = "releasing"
                self._commit("reservation-release-intent", {"reservationId": reservation_id})
                if reservation["kind"] == "container" and not self._destroy(reservation):
                    self.state["degraded"].append(f"could not prove resources absent for {reservation_id}")
                    self._commit("reservation-release-blocked", {"reservationId": reservation_id})
                    raise ProtocolError("recovery-blocked", "container/network are still visible")
                if reservation["kind"] == "container" and not self._verify_and_free_slot(reservation):
                    raise ProtocolError("slot-quarantined", "slot could not be proven verified-free")
                del self.state["reservations"][reservation_id]
                self._commit("reservation-released", {"reservationId": reservation_id})
                self._grant_queue()
                return {"released": True}
            raise ProtocolError("request-unknown", f"unknown request kind {kind!r}")

    def _recover_once(self) -> None:
        with self.lock:
            changed = False
            for lease in self.state["leases"].values():
                if lease["state"] not in ("lost", "draining"):
                    continue
                owned = [r for r in self.state["reservations"].values() if r["invocationId"] == lease["invocationId"]]
                unresolved = False
                for reservation in owned:
                    recovery_error = f"recovery blocked for {reservation['reservationId']}"
                    if reservation["kind"] == "build" and reservation["state"] in ("committed", "releasing"):
                        message = f"build {reservation['reservationId']} lacks termination evidence"
                        if message not in self.state["degraded"]:
                            self.state["degraded"].append(message)
                        unresolved = True
                        continue
                    try:
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
                    lease["state"] = "recovered"
                    changed = True
            if changed:
                self._grant_queue()
                self._commit("recovery-converged", {})

    def recovery_loop(self) -> None:
        while not self.stop.wait(1.0):
            try:
                cutoff = time.time() - self.grace
                with self.lock:
                    for lease in self.state["leases"].values():
                        if lease["state"] != "active":
                            continue
                        stamp = datetime.fromisoformat(lease["lastHeartbeatAt"].replace("Z", "+00:00")).timestamp()
                        if stamp < cutoff:
                            lease["state"] = "lost"
                            self._commit("lease-lost", {"invocationId": lease["invocationId"]})
                self._recover_once()
            except Exception as error:
                with self.lock:
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
        try:
            raw = self.rfile.readline(1024 * 1024)
            request = json.loads(raw.decode("utf-8"))
            if not isinstance(request, dict):
                raise ProtocolError("request-invalid", "request must be an object")
            response = {"ok": True, "result": self.server.admission.handle(request)}  # type: ignore[attr-defined]
        except ProtocolError as error:
            response = {"ok": False, "error": {"code": error.code, "message": str(error)}}
        except Exception as error:
            response = {"ok": False, "error": {"code": "internal", "message": str(error)}}
        self.wfile.write((json.dumps(response, separators=(",", ":")) + "\n").encode())


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
    args = parser.parse_args()
    path = Path(args.control_socket)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_socket():
        path.unlink()
    admission = Admission(Path(args.descriptor), Path(args.journal), args.docker_socket,
                          args.orphan_grace_seconds, Path(args.host_config))
    server = Server(str(path), admission)
    os.chmod(path, int(args.socket_mode, 0))
    if args.ready_file:
        Path(args.ready_file).write_text(admission.state["generation"] + "\n", encoding="utf-8")
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


if __name__ == "__main__":
    main()
