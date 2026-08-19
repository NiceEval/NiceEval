#!/usr/bin/env python3
"""Run Lifecycle's native tests below a Linux subreaper.

The zombie-only process-group fixture deliberately leaves one child unreaped
until its assertion finishes.  Keeping this supervisor outside the tested
group makes that state independent of whether the host's PID 1 happens to
reap children immediately.
"""

import ctypes
import os
import signal
import sys


PR_SET_CHILD_SUBREAPER = 36


def become_subreaper() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), "prctl(PR_SET_CHILD_SUBREAPER)")


def main() -> int:
    command = sys.argv[1:]
    if not command:
        raise SystemExit("subreaper-runner.py requires a command")

    become_subreaper()
    child_pid = os.fork()
    if child_pid == 0:
        os.execvp(command[0], command)

    child_status: int | None = None

    def reap_children(_signal: int, _frame: object) -> None:
        nonlocal child_status
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if pid == 0:
                return
            if pid == child_pid:
                child_status = status

    signal.signal(signal.SIGCHLD, reap_children)
    reap_children(0, None)
    while child_status is None:
        signal.pause()
    return os.waitstatus_to_exitcode(child_status)


if __name__ == "__main__":
    raise SystemExit(main())
