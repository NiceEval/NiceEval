#!/usr/bin/env python3
"""Run an installed NiceEval CLI as a deliberate, externally held zombie.

The wrapper waits for the experiment fixture's public-run boundary marker,
kills the CLI without reaping it, and reports only after /proc confirms Z.
On Testkit cleanup it reaps the child before exiting, so the E2E owns the
otherwise deliberate zombie resource.
"""

import json
import os
import signal
import sys
import time


def write_status(path: str, payload: object) -> None:
    temporary = f"{path}.{os.getpid()}.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, json.dumps(payload).encode())
    finally:
        os.close(fd)
    os.rename(temporary, path)


def process_state(pid: int) -> str:
    with open(f"/proc/{pid}/stat", encoding="utf-8") as stat_file:
        stat = stat_file.read()
    closing = stat.rfind(")")
    if closing < 0 or closing + 2 >= len(stat) or stat[closing + 1] != " ":
        raise RuntimeError(f"cannot parse /proc/{pid}/stat")
    fields = stat[closing + 2 :].split()
    if not fields or len(fields[0]) != 1:
        raise RuntimeError(f"cannot parse state from /proc/{pid}/stat")
    return fields[0]


def wait_for(path: str, label: str) -> None:
    deadline = time.monotonic() + 60
    while not os.path.exists(path):
        if time.monotonic() >= deadline:
            raise RuntimeError(f"timed out waiting for {label}")
        time.sleep(0.01)


def reap_then_exit(child_pid: int) -> None:
    try:
        os.waitpid(child_pid, 0)
    except ChildProcessError:
        pass
    os._exit(0)


def main() -> int:
    if len(sys.argv) < 4:
        raise SystemExit("shared-state-zombie-owner.py requires a status path and NiceEval command")
    status_path = sys.argv[1]
    command = sys.argv[2:]
    barrier_root = os.environ.get("NICEEVAL_SHARED_STATE_ZOMBIE_BARRIER")
    if barrier_root is None:
        raise RuntimeError("NICEEVAL_SHARED_STATE_ZOMBIE_BARRIER is required")

    child_pid = os.fork()
    if child_pid == 0:
        os.execvp(command[0], command)

    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    signal.signal(signal.SIGTERM, lambda _signal, _frame: reap_then_exit(child_pid))
    signal.signal(signal.SIGINT, lambda _signal, _frame: reap_then_exit(child_pid))
    signal.signal(signal.SIGALRM, lambda _signal, _frame: reap_then_exit(child_pid))

    wait_for(os.path.join(barrier_root, "zombie-owner-agent-started"), "installed NiceEval owner")
    os.kill(child_pid, signal.SIGKILL)
    deadline = time.monotonic() + 10
    while True:
        if process_state(child_pid) == "Z":
            break
        if time.monotonic() >= deadline:
            raise RuntimeError("NiceEval owner did not become a zombie")
        time.sleep(0.001)

    write_status(status_path, {"pid": child_pid, "state": "Z"})
    signal.alarm(90)
    while True:
        signal.pause()


if __name__ == "__main__":
    raise SystemExit(main())
