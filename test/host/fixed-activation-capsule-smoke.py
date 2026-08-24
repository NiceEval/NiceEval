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
