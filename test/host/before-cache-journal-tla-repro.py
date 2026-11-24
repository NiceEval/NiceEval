"""An acknowledged watchdog transition must survive reopening the journal."""
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from unittest.mock import patch

module_path = Path(__file__).resolve().parents[2] / "packaging/docker-profile-host/scripts/watchdog.py"
spec = importlib.util.spec_from_file_location("watchdog", module_path)
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)


def journal_session(path):
    session = watchdog.Admission.__new__(watchdog.Admission)
    session.journal = path
    session.profile_id = "test"
    session.lock = threading.RLock()
    session._published_state = {"admissionOpen": True, "generation": "boot", "leases": {}}
    session._draft_state = None
    session._load()
    return session


with TemporaryDirectory() as temp:
    path = Path(temp) / "journal"
    original_write = os.write

    def short_write(fd, data):
        return original_write(fd, data[:max(1, len(data) // 2)])

    with patch.object(os, "write", short_write):
        response = journal_session(path).handle({
            "kind": "lease.create", "invocationId": "first", "profileId": "test", "daemonGeneration": "boot",
        })
    restarted = journal_session(path)
    receipt = restarted.handle({
        "kind": "lease.heartbeat", "invocationId": "first", "leaseToken": response["leaseToken"],
    })
    assert receipt == {"state": "active"}, receipt
