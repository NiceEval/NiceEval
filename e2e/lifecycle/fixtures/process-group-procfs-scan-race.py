#!/usr/bin/env python3
"""Create a real /proc membership-scan race for ProcessHandle cleanup.

The root starts a detached process group G.  A parent already in G waits for
the root to exit, then forks a child into G after ProcessHandle's /proc
directory snapshot has begun.  The parent exits and is reaped by the Lifecycle
subreaper, so its stale directory entry is skipped while the new child was not
in that snapshot.  Padding processes in another group make the interval between
the snapshot and the parent's stat read wide enough to be reproducible.
"""

import json
import os
import signal
import sys
import time


PADDING_CHILDREN = 96
FORK_DELAY_NS = 1_000_000


def redirect_stdio() -> None:
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    if devnull > 2:
        os.close(devnull)


def write_one(fd: int, label: str) -> None:
    if os.write(fd, b"r") != 1:
        raise RuntimeError(f"{label} could not report readiness")
    os.close(fd)


def write_child_status(path: str, payload: dict[str, int]) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, json.dumps(payload).encode())
    finally:
        os.close(fd)


def padding_supervisor(ready_fd: int) -> None:
    os.setpgid(0, 0)
    workers: list[int] = []

    def stop(_signal: int, _frame: object) -> None:
        for worker in workers:
            try:
                os.kill(worker, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for worker in workers:
            while True:
                try:
                    os.waitpid(worker, 0)
                    break
                except InterruptedError:
                    continue
                except ChildProcessError:
                    break
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGALRM, stop)
    for _ in range(PADDING_CHILDREN):
        worker = os.fork()
        if worker == 0:
            signal.signal(signal.SIGTERM, signal.SIG_DFL)
            signal.signal(signal.SIGALRM, signal.SIG_DFL)
            while True:
                signal.pause()
        workers.append(worker)

    write_one(ready_fd, "procfs scan padding")
    # Crash-safety only; normal E2E cleanup sends SIGTERM to this supervisor.
    signal.alarm(30)
    while True:
        signal.pause()


def race_parent(group_id: int, ready_fd: int, status_path: str) -> None:
    os.setpgid(0, group_id)
    if os.getpgrp() != group_id:
        raise RuntimeError("race parent did not join the owned process group")
    released = False

    def release(_signal: int, _frame: object) -> None:
        nonlocal released
        released = True

    signal.signal(signal.SIGUSR1, release)
    os.write(ready_fd, f"{os.getpid()}\n".encode())
    os.close(ready_fd)
    while not released:
        signal.pause()

    # The test sends SIGUSR1 immediately before calling dispose(). Its
    # synchronous /proc snapshot has started before this short delay; all
    # padding entries are read before this high-PID parent entry.
    deadline = time.monotonic_ns() + FORK_DELAY_NS
    while time.monotonic_ns() < deadline:
        pass

    child_pid = os.fork()
    if child_pid == 0:
        while True:
            signal.pause()

    if os.getpgid(child_pid) != group_id:
        raise RuntimeError("race descendant did not inherit the owned process group")
    write_child_status(status_path, {"childPid": child_pid, "groupId": group_id})
    os._exit(0)


def race_reaper(group_id: int, ready_fd: int, status_path: str) -> None:
    os.setpgid(0, 0)
    race_parent_pid = os.fork()
    if race_parent_pid == 0:
        race_parent(group_id, ready_fd, status_path)
        raise AssertionError("race parent returned")

    os.close(ready_fd)
    while True:
        try:
            os.waitpid(race_parent_pid, 0)
            break
        except InterruptedError:
            continue
    os._exit(0)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("process-group-procfs-scan-race.py requires a status path")
    status_path = sys.argv[1]
    group_id = os.getpid()
    if os.getpgrp() != group_id:
        raise RuntimeError("fixture root was not started as a detached process-group leader")

    padding_ready_read, padding_ready_write = os.pipe()
    padding_pid = os.fork()
    if padding_pid == 0:
        os.close(padding_ready_read)
        redirect_stdio()
        padding_supervisor(padding_ready_write)
        raise AssertionError("padding supervisor returned")
    os.close(padding_ready_write)
    if os.read(padding_ready_read, 1) != b"r":
        raise RuntimeError("procfs scan padding did not report readiness")
    os.close(padding_ready_read)

    race_ready_read, race_ready_write = os.pipe()
    reaper_pid = os.fork()
    if reaper_pid == 0:
        os.close(race_ready_read)
        redirect_stdio()
        race_reaper(group_id, race_ready_write, status_path)
        raise AssertionError("race reaper returned")
    os.close(race_ready_write)
    race_parent_pid = int(os.read(race_ready_read, 32).decode().strip())
    os.close(race_ready_read)

    print(
        json.dumps(
            {
                "groupId": group_id,
                "paddingPid": padding_pid,
                "raceParentPid": race_parent_pid,
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
