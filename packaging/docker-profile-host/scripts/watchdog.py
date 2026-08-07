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
import os
import secrets
import signal
import socketserver
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
}


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


class Admission:
    def __init__(self, descriptor: Path, journal: Path, docker_socket: str, grace: float) -> None:
        self.descriptor_path = descriptor
        self.descriptor = json.loads(descriptor.read_text(encoding="utf-8"))
        self.descriptor_digest = canonical_digest(self.descriptor)
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
        }
        self._load()
        current = self._generation()
        if self.state.get("generation") != current:
            self.state["admissionOpen"] = False
            self.state["generation"] = current
            self._commit("daemon-generation-changed", {})
            self._recover_once()
            self.state["admissionOpen"] = not self.state["degraded"]
            self._commit("daemon-generation-reconciled", {})

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
        except Exception:
            daemon_id = "unavailable"
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
        }

    def _used(self) -> dict[str, float]:
        used = {"cpus": 0.0, "memoryBytes": 0.0, "pids": 0.0, "containers": 0.0, "builds": 0.0}
        for reservation in self.state["reservations"].values():
            if reservation["state"] not in ("granted", "committed", "releasing"):
                continue
            resources = reservation["resources"]
            for key in ("cpus", "memoryBytes", "pids", "containers"):
                used[key] += float(resources.get(key, 0))
            used["builds"] += 1 if reservation["kind"] == "build" else 0
        return used

    def _fits(self, resources: dict[str, Any], kind: str) -> bool:
        used, cap = self._used(), self._capacity()
        for key in ("cpus", "memoryBytes", "pids", "containers"):
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
            reservation["state"] = "granted"
            reservation["grantedAt"] = now()
            self.state["queue"].pop(0)
            self._commit("reservation-granted", {"reservationId": reservation["reservationId"]})

    def _resource_ids(self, reservation: dict[str, Any]) -> tuple[list[str], list[str]]:
        filters: list[str] = []
        for field, label in LABELS.items():
            value = reservation["profileId"] if field == "profileId" else reservation[field]
            filters.extend(["--filter", f"label={label}={value}"])
        containers = self._docker("ps", "-aq", *filters, check=False).stdout.split()
        networks = self._docker("network", "ls", "-q", *filters, check=False).stdout.split()
        return containers, networks

    def _destroy(self, reservation: dict[str, Any]) -> bool:
        containers, networks = self._resource_ids(reservation)
        for resource_id in containers:
            self._docker("rm", "-f", resource_id, check=False)
        for resource_id in networks:
            self._docker("network", "rm", resource_id, check=False)
        remaining = self._resource_ids(reservation)
        return not remaining[0] and not remaining[1]

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
            if kind == "reservation.commit":
                if reservation["state"] != "granted":
                    raise ProtocolError("reservation-state", "only a granted reservation can commit")
                reservation["state"] = "committed"
                reservation["attemptId"] = request.get("attemptId")
                reservation["containerId"] = request.get("containerId")
                reservation["networkId"] = request.get("networkId")
                self._commit("reservation-committed", {"reservationId": reservation_id})
                return copy.deepcopy(reservation)
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
                    if reservation["kind"] == "build" and reservation["state"] in ("committed", "releasing"):
                        message = f"build {reservation['reservationId']} lacks termination evidence"
                        if message not in self.state["degraded"]:
                            self.state["degraded"].append(message)
                        unresolved = True
                        continue
                    if reservation["kind"] == "container" and not self._destroy(reservation):
                        unresolved = True
                        continue
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
    admission = Admission(Path(args.descriptor), Path(args.journal), args.docker_socket, args.orphan_grace_seconds)
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
