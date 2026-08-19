import json
import os
import signal
import sys
import time


def emit(value: dict[str, object]) -> None:
    print("NICEEVAL_PROCESS_TREE " + json.dumps(value, separators=(",", ":")), flush=True)


def stay_alive() -> None:
    while True:
        time.sleep(1)


mode = sys.argv[1]

if mode == "live-descendant":
    descendant = os.fork()
    if descendant == 0:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        stay_alive()
    emit({"mode": mode, "leader": os.getpid(), "descendant": descendant})
    stay_alive()

if mode == "escaped-pipe":
    escaped = os.fork()
    if escaped == 0:
        os.setsid()
        stay_alive()
    emit({"mode": mode, "leader": os.getpid(), "escaped": escaped})
    os._exit(0)

if mode == "zombie-only":
    original_group = os.getpgrp()
    ready_read, ready_write = os.pipe()
    controller = os.fork()
    if controller == 0:
        os.close(ready_read)
        os.setpgid(0, 0)
        zombie = os.fork()
        if zombie == 0:
            os.setpgid(0, original_group)
            os._exit(0)
        while True:
            try:
                with open(f"/proc/{zombie}/stat", "r", encoding="utf-8") as stat_file:
                    state = stat_file.read().split(") ", 1)[1].split(" ", 1)[0]
                if state == "Z":
                    break
            except FileNotFoundError:
                pass
            time.sleep(0.01)
        os.write(ready_write, b"1")
        os.close(ready_write)
        emit({
            "mode": mode,
            "leader": os.getppid(),
            "controller": os.getpid(),
            "zombie": zombie,
            "group": original_group,
        })
        stay_alive()
    os.close(ready_write)
    os.read(ready_read, 1)
    os.close(ready_read)
    os._exit(0)

raise SystemExit(f"unknown process-tree mode: {mode}")
