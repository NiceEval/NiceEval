#!/usr/bin/env python3
"""Create one zombie in the detached parent's process group, then exit.

The parent is the ProcessHandle root.  Its helper moves into a sibling group,
keeps the zombie as its child, and reaps it only after the test sends SIGTERM.
The Lifecycle subreaper wrapper reaps that helper, so the fixture has no
dependency on the host PID 1's zombie policy.
"""

import json
import os
import signal
import sys


def write_status(fd: int, payload: dict[str, int | str]) -> None:
    os.write(fd, f"{json.dumps(payload)}\n".encode())
    os.close(fd)


def read_status(fd: int) -> bytes:
    chunks: list[bytes] = []
    while True:
        chunk = os.read(fd, 4096)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        if b"\n" in chunk:
            return b"".join(chunks)


def redirect_stdio() -> None:
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    if devnull > 2:
        os.close(devnull)


def helper(group_id: int, status_fd: int) -> None:
    try:
        # This puts the deliberate non-reaper outside the group being tested
        # while retaining the session required to put its child back in G.
        os.setpgid(0, 0)
        ready_read, ready_write = os.pipe()
        zombie_pid = os.fork()
        if zombie_pid == 0:
            os.close(ready_read)
            os.setpgid(0, group_id)
            os.write(ready_write, b"ready")
            os.close(ready_write)
            os._exit(0)

        os.close(ready_write)
        if os.read(ready_read, len(b"ready")) != b"ready":
            raise RuntimeError("zombie child did not enter the owned process group")
        os.close(ready_read)
        write_status(
            status_fd,
            {
                "groupId": group_id,
                "helperPid": os.getpid(),
                "zombiePid": zombie_pid,
            },
        )

        def reap_then_exit(_signal: int, _frame: object) -> None:
            try:
                os.waitpid(zombie_pid, 0)
            except ChildProcessError:
                pass
            os._exit(0)

        signal.signal(signal.SIGTERM, reap_then_exit)
        signal.signal(signal.SIGALRM, reap_then_exit)
        # This is only a crash-safety backstop.  Normal test cleanup sends TERM.
        signal.alarm(30)
        while True:
            signal.pause()
    except BaseException as error:
        write_status(status_fd, {"error": str(error)})
        os._exit(1)


def main() -> int:
    group_id = os.getpid()
    if os.getpgrp() != group_id:
        raise RuntimeError("fixture root was not started as a detached process-group leader")

    status_read, status_write = os.pipe()
    helper_pid = os.fork()
    if helper_pid == 0:
        os.close(status_read)
        redirect_stdio()
        helper(group_id, status_write)
        raise AssertionError("helper returned")

    os.close(status_write)
    status = read_status(status_read)
    os.close(status_read)
    if not status:
        raise RuntimeError("zombie helper exited before reporting its process identity")
    payload = json.loads(status.decode())
    if "error" in payload:
        raise RuntimeError(f"zombie helper setup failed: {payload['error']}")
    print(json.dumps(payload), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
