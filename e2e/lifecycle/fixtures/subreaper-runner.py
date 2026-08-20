#!/usr/bin/env python3
"""Run Lifecycle's native tests below a Linux subreaper.

The zombie-only process-group fixture deliberately leaves one child unreaped
until its assertion finishes.  Keeping this supervisor outside the tested
group makes that state independent of whether the host's PID 1 happens to
reap children immediately.
"""

import ctypes
import os
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
    # A blocking waitpid is the wakeup: it atomically observes an exited child
    # or sleeps until one exits.  SIGCHLD + check-then-pause can lose the
    # signal after the check and leave this supervisor paused forever.
    while child_status is None:
        try:
            pid, status = os.waitpid(-1, 0)
        except InterruptedError:
            continue
        except ChildProcessError as error:
            raise RuntimeError("subreaper lost its command child wait status") from error
        if pid == child_pid:
            child_status = status

    # Keep the old handler's best-effort reaping of any fixture child that
    # became waitable alongside the command child, without waiting on a live
    # fixture after the native test command has completed.
    while True:
        try:
            pid, _status = os.waitpid(-1, os.WNOHANG)
        except InterruptedError:
            continue
        except ChildProcessError:
            break
        if pid == 0:
            break
    return os.waitstatus_to_exitcode(child_status)


if __name__ == "__main__":
    raise SystemExit(main())
