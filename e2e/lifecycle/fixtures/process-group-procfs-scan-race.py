#!/usr/bin/env python3
"""Create a deterministic post-snapshot process-group race.

The Testkit E2E hook writes ``snapshot_path`` only after the implementation
under test has captured its complete /proc directory listing. The member in
the owned group then forks a live descendant, reports it, and exits. Its
external subreaper reaps that stale parent, so the captured listing has no
live entry even though the newly forked group member is still running.

The padding supervisor and its workers deliberately live outside the owned
group. They prove the test's own cleanup is complete rather than relying on
PID ordering to make the race likely.
"""

import ctypes
import json
import os
import signal
import sys
import time


PADDING_CHILDREN = 4
PR_SET_CHILD_SUBREAPER = 36


def redirect_stdio() -> None:
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    if devnull > 2:
        os.close(devnull)


def write_json(path: str, payload: object) -> None:
    temporary = f"{path}.{os.getpid()}.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, json.dumps(payload).encode())
    finally:
        os.close(fd)
    os.rename(temporary, path)


def write_pipe(fd: int, payload: object) -> None:
    encoded = json.dumps(payload).encode()
    if os.write(fd, encoded) != len(encoded):
        raise RuntimeError("fixture readiness pipe truncated")
    os.close(fd)


def read_pipe(fd: int) -> object:
    chunks: list[bytes] = []
    while True:
        chunk = os.read(fd, 4096)
        if not chunk:
            break
        chunks.append(chunk)
    os.close(fd)
    payload = b"".join(chunks)
    if not payload:
        raise RuntimeError("fixture readiness pipe was empty")
    return json.loads(payload.decode())


def become_subreaper() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), "prctl(PR_SET_CHILD_SUBREAPER)")


def wait_for(path: str, label: str) -> None:
    deadline = time.monotonic() + 30
    while not os.path.exists(path):
        if time.monotonic() >= deadline:
            raise RuntimeError(f"timed out waiting for {label}")
        time.sleep(0.001)


def padding_supervisor(ready_fd: int) -> None:
    os.setpgid(0, 0)
    redirect_stdio()
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
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGALRM, stop)
    for _ in range(PADDING_CHILDREN):
        worker = os.fork()
        if worker == 0:
            os.close(ready_fd)
            signal.signal(signal.SIGTERM, signal.SIG_DFL)
            signal.signal(signal.SIGINT, signal.SIG_DFL)
            signal.signal(signal.SIGALRM, signal.SIG_DFL)
            while True:
                signal.pause()
        workers.append(worker)

    write_pipe(ready_fd, {"supervisorPid": os.getpid(), "workerPids": workers})
    signal.alarm(60)
    while True:
        signal.pause()


def race_parent(group_id: int, snapshot_path: str, child_path: str) -> None:
    os.setpgid(0, group_id)
    if os.getpgrp() != group_id:
        raise RuntimeError("race parent did not join the owned process group")
    redirect_stdio()
    # TERM has already established the cleanup boundary when the tested scan
    # reaches its hook. Ignore it so the fixture can exercise the race that
    # requires a subsequent independent scan (KILL remains unignorable).
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    wait_for(snapshot_path, "Testkit procfs snapshot hook")
    child_pid = os.fork()
    if child_pid == 0:
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        while True:
            signal.pause()

    if os.getpgid(child_pid) != group_id:
        raise RuntimeError("race descendant did not inherit the owned process group")
    write_json(child_path, {"childPid": child_pid, "groupId": group_id})
    os._exit(0)


def race_reaper(group_id: int, snapshot_path: str, child_path: str, ready_fd: int) -> None:
    os.setpgid(0, 0)
    redirect_stdio()
    become_subreaper()

    def stop(_signal: int, _frame: object) -> None:
        try:
            os.kill(-group_id, signal.SIGKILL)
        except ProcessLookupError:
            pass
        while True:
            try:
                pid, _status = os.waitpid(-1, os.WNOHANG)
            except InterruptedError:
                continue
            except ChildProcessError:
                break
            if pid == 0:
                break
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGALRM, stop)
    parent_pid = os.fork()
    if parent_pid == 0:
        os.close(ready_fd)
        race_parent(group_id, snapshot_path, child_path)
        raise AssertionError("race parent returned")

    write_pipe(ready_fd, {"raceParentPid": parent_pid, "raceReaperPid": os.getpid()})
    while True:
        try:
            pid, _status = os.waitpid(-1, 0)
        except InterruptedError:
            continue
        if pid == parent_pid:
            break

    # The subreaper now owns the post-snapshot descendant. Waiting here makes
    # a successful Testkit KILL observable as physical group disappearance.
    while True:
        try:
            os.waitpid(-1, 0)
            break
        except InterruptedError:
            continue
        except ChildProcessError as error:
            raise RuntimeError("race reaper lost the post-snapshot descendant") from error
    os._exit(0)


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("process-group-procfs-scan-race.py requires snapshot and child-status paths")
    snapshot_path = sys.argv[1]
    child_path = sys.argv[2]
    group_id = os.getpid()
    if os.getpgrp() != group_id:
        raise RuntimeError("fixture root was not started as a detached process-group leader")

    padding_read, padding_write = os.pipe()
    padding_pid = os.fork()
    if padding_pid == 0:
        os.close(padding_read)
        padding_supervisor(padding_write)
        raise AssertionError("padding supervisor returned")
    os.close(padding_write)
    padding = read_pipe(padding_read)

    race_read, race_write = os.pipe()
    reaper_pid = os.fork()
    if reaper_pid == 0:
        os.close(race_read)
        race_reaper(group_id, snapshot_path, child_path, race_write)
        raise AssertionError("race reaper returned")
    os.close(race_write)
    race = read_pipe(race_read)

    print(
        json.dumps(
            {
                "groupId": group_id,
                "paddingSupervisorPid": padding["supervisorPid"],
                "paddingWorkerPids": padding["workerPids"],
                "raceParentPid": race["raceParentPid"],
                "raceReaperPid": race["raceReaperPid"],
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
