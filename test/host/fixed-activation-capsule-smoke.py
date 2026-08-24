#!/usr/bin/env python3
"""Public host receipt for activation commit/recovery and revision boundaries."""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "packaging/docker-profile-host/scripts/activate-fixed-images.py"
spec = importlib.util.spec_from_file_location("niceeval_fixed_activation_capsule", MODULE)
assert spec and spec.loader
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


stable_backing = {
    "path": "/data/niceeval/profile/store.img",
    "sizeBytes": 80 * 1024**3,
    "allocatedBytes": 80 * 1024**3,
    "filesystemType": "ext4",
    "filesystemUuid": "11111111-2222-3333-4444-555555555555",
}
# Allocation accounting may grow after loop-mounted writes. It remains an
# attestation fact, while path/size/type/UUID form the stable rollback identity.
activation.assert_same_ext4_backing(
    {**stable_backing, "allocatedBytes": stable_backing["allocatedBytes"] + 4096},
    stable_backing,
)
for changed in (
    {**stable_backing, "filesystemUuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
    {**stable_backing, "sizeBytes": stable_backing["sizeBytes"] + 4096,
     "allocatedBytes": stable_backing["allocatedBytes"] + 4096},
    {**stable_backing, "allocatedBytes": stable_backing["sizeBytes"] - 4096},
):
    try:
        activation.assert_same_ext4_backing(changed, stable_backing)
    except RuntimeError:
        pass
    else:
        raise AssertionError("changed or incompletely allocated outer backing must fail closed")


with tempfile.TemporaryDirectory(prefix="niceeval-activation-recovery-") as raw:
    root = Path(raw)
    active = root / "active.json"
    active.write_text("old\n", encoding="utf-8")
    pointer = root / "current"
    recovery = root / "recovery.json"
    mount_calls: list[object] = []
    original_restore_mount = activation.restore_mount
    original_chown = activation.os.chown
    activation.restore_mount = lambda _path, fact: mount_calls.append(fact)
    activation.os.chown = lambda *_args: None
    try:
        record = {
            "schema": activation.RECOVERY_SCHEMA,
            "state": "pending",
            "epoch": "epoch-new",
            "files": {str(active): activation._snapshot_file(active)},
            "dataMount": str(root / "data"),
            "mount": {"backingImage": "/old.img"},
            "currentPointer": str(pointer),
            "pendingMarker": str(root / "pending.json"),
        }
        active.write_text("partial-new\n", encoding="utf-8")
        activation.atomic_json(recovery, record)
        activation.recover_activation(recovery)
        assert active.read_text(encoding="utf-8") == "old\n"
        assert mount_calls == [{"backingImage": "/old.img"}]

        active.write_text("committed-new\n", encoding="utf-8")
        activation.atomic_json(pointer, {
            "schema": "niceeval-docker-profile-current-epoch/v1",
            "epoch": "epoch-new",
        })
        activation.atomic_json(recovery, record)
        activation.recover_activation(recovery)
        assert active.read_text(encoding="utf-8") == "committed-new\n"
        assert len(mount_calls) == 1

        activation.atomic_json(recovery, {**record, "schema": "niceeval-docker-profile-activation-recovery/v1"})
        try:
            activation.recover_activation(recovery)
        except RuntimeError as error:
            assert "unknown activation recovery schema" in str(error)
        else:
            raise AssertionError("legacy recovery revision must fail closed")
    finally:
        activation.restore_mount = original_restore_mount
        activation.os.chown = original_chown

print("fixed-activation-capsule-smoke ok")
