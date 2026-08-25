#!/usr/bin/env python3
"""Real cgroup-v2 boundary checks for fixed backing activation."""
from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "packaging/docker-profile-host/scripts/activate-fixed-images.py"
spec = importlib.util.spec_from_file_location("niceeval_fixed_activation", MODULE)
assert spec and spec.loader
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


def config(path: Path) -> dict[str, object]:
    return {
        "activationDependency": {
            "class": "systemd-profile-slice/v1",
            "cgroupPath": str(path),
        },
    }


self_relative = Path("/proc/self/cgroup").read_text(encoding="utf-8").strip().split("::", 1)[1]
self_cgroup = Path("/sys/fs/cgroup") / self_relative.lstrip("/")
try:
    activation.assert_cgroup_empty(config(self_cgroup))
except RuntimeError as error:
    assert "populated" in str(error) or "owns processes" in str(error)
else:
    raise AssertionError("the live caller cgroup must not attest empty")

empty = None
for events_path in Path("/sys/fs/cgroup").rglob("cgroup.events"):
    try:
        events = dict(line.split(None, 1) for line in events_path.read_text(encoding="utf-8").splitlines())
        members = (events_path.parent / "cgroup.procs").read_text(encoding="utf-8").split()
    except (OSError, ValueError):
        continue
    if events.get("populated") == "0" and not members:
        empty = events_path.parent
        break
assert empty is not None, "host exposes no readable empty cgroup-v2 subtree"
fact = activation.assert_cgroup_empty(config(empty))
assert fact == {
    "class": "systemd-profile-slice/v1",
    "cgroupPath": str(empty.resolve()),
    "emptyAtActivation": True,
}

print("activation-cgroup-smoke ok")

profile_id = "profile-fixed"
detached = {
    "niceeval.profile-id": profile_id,
    "niceeval.ownership-class": "detached-cache/v1",
    "niceeval.resource": "detached-cache",
}
assert activation.classify_labels(detached, profile_id) == "detached"
for kind, active_fact in (
    ("container", {"niceeval.invocation-id": "inv-1"}),
    ("network", {"niceeval.reservation-id": "reservation-1"}),
    ("volume", {"niceeval.provision-token": "token-1"}),
    ("image", {"niceeval.operation-id": "operation-1"}),
):
    assert activation.classify_labels({**detached, **active_fact}, profile_id) == "active-or-ambiguous", kind

print("activation detached-cache ownership smoke ok")
