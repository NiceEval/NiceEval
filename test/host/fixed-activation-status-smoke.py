#!/usr/bin/env python3
"""Public status receipt for durable fixed-image seed capacity."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "packaging/docker-profile-host/scripts/activate-fixed-images.py"
spec = importlib.util.spec_from_file_location("niceeval_fixed_activation_status", MODULE)
assert spec and spec.loader
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


def status(host_config: Path, descriptor: Path, lock: Path) -> dict[str, object]:
    argv = sys.argv
    output = io.StringIO()
    try:
        sys.argv = [
            str(MODULE),
            "--host-config", str(host_config),
            "--descriptor", str(descriptor),
            "--lock", str(lock),
            "--status",
        ]
        with contextlib.redirect_stdout(output):
            activation.main()
    finally:
        sys.argv = argv
    return json.loads(output.getvalue())


def append_watchdog_state(journal: Path, event: str, seeds: dict[str, dict[str, object]]) -> None:
    state = {
        "schemaVersion": 1,
        "setupPrefix": {"artifacts": {}, "operations": {}, "seeds": seeds},
    }
    with journal.open("a", encoding="utf-8") as output:
        output.write(json.dumps({"event": event, "state": state}, sort_keys=True) + "\n")
        output.flush()


with tempfile.TemporaryDirectory(prefix="niceeval-fixed-status-") as raw:
    root = Path(raw)
    journal_root = root / "journal"
    generation = journal_root / "fixed-image-v1"
    epoch_root = generation / "epochs" / "epoch-active"
    epoch_root.mkdir(parents=True)
    registry = root / "seeds.json"
    registry.write_text(json.dumps({
        "schemaVersion": 1,
        "seeds": [
            {"seedId": "seed-00000001", "state": "free"},
            {"seedId": "seed-00000002", "state": "free"},
        ],
    }), encoding="utf-8")
    (epoch_root / "capsule.json").write_text(json.dumps({
        "outerImage": {"sizeBytes": 64 * 1024**3},
        "seedRegistry": {"path": str(registry)},
    }), encoding="utf-8")
    host_config = root / "host.json"
    host = {
        "name": "status-smoke",
        "journalDir": str(journal_root),
        "storage": {"backing": "fixed-image-ext4"},
    }
    host_config.write_text(json.dumps(host), encoding="utf-8")
    descriptor = root / "descriptor.json"
    descriptor.write_text("{}\n", encoding="utf-8")
    lock = root / "activation.lock"

    original_geteuid = activation.os.geteuid
    original_chown = activation.os.chown
    original_load_current = activation.load_current
    activation.os.geteuid = lambda: 0
    activation.os.chown = lambda *_args: None
    activation.load_current = lambda _generation: (
        {"epoch": "epoch-active"}, host, b"{}\n", {"previousEpoch": None},
    )
    try:
        watchdog_journal = generation / "events.ndjson"
        try:
            status(host_config, descriptor, lock)
        except RuntimeError as error:
            assert "durable watchdog state is absent" in str(error)
        else:
            raise AssertionError("status must not infer active capacity from the immutable registry alone")

        append_watchdog_state(watchdog_journal, "setup-prefix-captured", {
            "seed-00000001": {"seedId": "seed-00000001", "state": "published"},
            "seed-00000002": {"seedId": "seed-00000002", "state": "free"},
        })
        published = status(host_config, descriptor, lock)
        assert published["activeSeedRemaining"] == 1
        assert published["activeSeeds"] == {
            "total": 2, "free": 1, "published": 1, "quarantined": 0, "other": 0,
        }
        assert any(item["code"] == "active-seed-capacity-low" for item in published["warnings"])

        append_watchdog_state(watchdog_journal, "setup-prefix-stale-artifact-blocked", {
            "seed-00000001": {"seedId": "seed-00000001", "state": "published"},
            "seed-00000002": {"seedId": "seed-00000002", "state": "quarantined"},
        })
        quarantined = status(host_config, descriptor, lock)
        assert quarantined["activeSeedRemaining"] == 0
        assert quarantined["activeSeeds"] == {
            "total": 2, "free": 0, "published": 1, "quarantined": 1, "other": 0,
        }
        assert any(item["code"] == "active-seed-capacity-exhausted"
                   for item in quarantined["warnings"])

        append_watchdog_state(watchdog_journal, "watchdog-initialized", {
            "seed-00000001": {"seedId": "seed-00000001", "state": "published"},
            "seed-00000002": {"seedId": "seed-00000002", "state": "quarantined"},
        })
        restarted = status(host_config, descriptor, lock)
        assert restarted["activeSeedRemaining"] == 0
        assert restarted["activeSeeds"] == quarantined["activeSeeds"]
        assert restarted["retainedEpochBytes"] == 0
        assert restarted["retirableBytes"] == 0
        assert restarted["reclaimableBytes"] == 0
    finally:
        activation.os.geteuid = original_geteuid
        activation.os.chown = original_chown
        activation.load_current = original_load_current

print("fixed-activation-status-smoke ok")
