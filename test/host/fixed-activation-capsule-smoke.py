#!/usr/bin/env python3
"""Real-process SIGKILL matrix for fixed activation capsule recovery."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "packaging/docker-profile-host/scripts"
ACTIVATE = SCRIPTS / "activate-fixed-images.py"
PROVISION = SCRIPTS / "provision-fixed-images.py"
GENERATOR = SCRIPTS / "generate-descriptor.py"
PREPARE = SCRIPTS / "prepare-loop-storage.sh"
BINDINGS = ("host-config", "descriptor", "manifest", "digest")


def run(command: list[str], expected: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode != expected:
        raise AssertionError(
            f"command returned {result.returncode}, expected {expected}: {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def docker_socket() -> Path:
    for candidate in (Path("/run/docker.sock"), Path("/var/run/docker.sock")):
        if candidate.is_socket():
            return candidate.resolve()
    raise AssertionError("activation crash matrix requires a real Docker Unix socket")


def mounted_backing(mount: Path) -> Path:
    fields = run(["findmnt", "-n", "--raw", "-o", "SOURCE,FSTYPE",
                  "--mountpoint", str(mount)]).stdout.strip().split()
    if len(fields) != 2 or fields[1] != "ext4" or not fields[0].startswith("/dev/loop"):
        raise AssertionError(f"{mount} is not a loop-backed ext4 mount: {fields!r}")
    backing = run(["losetup", "-n", "-O", "BACK-FILE", fields[0]]).stdout.strip()
    if not backing:
        raise AssertionError(f"loop backing is not observable for {mount}: {fields[0]}")
    return Path(backing).resolve()


def current_epoch(generation: Path) -> str:
    pointer = json.loads((generation / "current").read_text(encoding="utf-8"))
    assert pointer["schema"] == "niceeval-docker-profile-current-epoch/v1"
    return str(pointer["epoch"])


def capsule_bindings(generation: Path, epoch: str) -> dict[str, bytes]:
    capsule = generation / "epochs" / epoch
    manifest = json.loads((capsule / "manifest.json").read_text(encoding="utf-8"))
    digest = "sha256:" + hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "host-config": (capsule / "config.json").read_bytes(),
        "descriptor": (capsule / "descriptor.json").read_bytes(),
        "manifest": (capsule / "manifest.json").read_bytes(),
        "digest": (digest + "\n").encode(),
    }


def active_bindings(paths: dict[str, Path]) -> dict[str, bytes]:
    return {name: paths[name].read_bytes() for name in BINDINGS}


def assert_bindings(paths: dict[str, Path], expected: dict[str, bytes]) -> None:
    actual = active_bindings(paths)
    assert actual == expected, {name: actual[name] == expected[name] for name in BINDINGS}


def assert_transition(paths: dict[str, Path], old: dict[str, bytes],
                      new: dict[str, bytes], mutated: int) -> None:
    actual = active_bindings(paths)
    for index, name in enumerate(BINDINGS):
        expected = new[name] if index < mutated else old[name]
        assert actual[name] == expected, (
            f"{name} differs at crash boundary {mutated}; "
            f"old={actual[name] == old[name]} new={actual[name] == new[name]}"
        )


def write_kill_launcher(path: Path) -> None:
    # The launcher calls the production CLI main with real argv. Its only seam
    # stops the process immediately after one selected durable mutation.
    path.write_text(r'''#!/usr/bin/env python3
import importlib.util
import json
import os
import signal
import sys
from pathlib import Path

module_path = Path(os.environ["NE_ACTIVATE_MODULE"])
spec = importlib.util.spec_from_file_location("niceeval_activation_kill_target", module_path)
assert spec and spec.loader
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)
phase = os.environ["NE_KILL_PHASE"]
receipt = Path(os.environ["NE_KILL_RECEIPT"])
targets = {
    "host-config": Path(os.environ["NE_HOST_CONFIG"]).resolve(),
    "descriptor": Path(os.environ["NE_DESCRIPTOR"]).resolve(),
    "manifest": Path(os.environ["NE_MANIFEST"]).resolve(),
    "digest": Path(os.environ["NE_DIGEST"]).resolve(),
    "current": Path(os.environ["NE_CURRENT"]).resolve(),
}

def hit(label):
    if label != phase:
        return
    receipt.write_text(json.dumps({"phase": label, "pid": os.getpid()}) + "\n", encoding="utf-8")
    with receipt.open("rb") as source:
        os.fsync(source.fileno())
    os.kill(os.getpid(), signal.SIGKILL)

original_json = activation.atomic_json
def atomic_json(path, value, mode=0o600):
    result = original_json(path, value, mode)
    resolved = Path(path).resolve()
    for label, target in targets.items():
        if resolved == target:
            hit(label)
    return result
activation.atomic_json = atomic_json

original_text = activation.atomic_text
def atomic_text(path, value, mode=0o600):
    result = original_text(path, value, mode)
    resolved = Path(path).resolve()
    for label, target in targets.items():
        if resolved == target:
            hit(label)
    return result
activation.atomic_text = atomic_text

original_restore_file = activation._restore_file
def restore_file(path, snapshot):
    result = original_restore_file(path, snapshot)
    resolved = Path(path).resolve()
    for label in ("host-config", "descriptor", "manifest", "digest"):
        if resolved == targets[label]:
            hit(label)
    return result
activation._restore_file = restore_file

original_restore_mount = activation.restore_mount
def restore_mount(path, snapshot):
    result = original_restore_mount(path, snapshot)
    hit("mount")
    return result
activation.restore_mount = restore_mount

sys.argv = [str(module_path), *sys.argv[1:]]
activation.main()
''', encoding="utf-8")


def command(paths: dict[str, Path], *, source: Path | None = None,
            rotate: bool = False, rollback: str | None = None,
            verify: bool = False, prepare: bool = False) -> list[str]:
    result = [
        sys.executable, str(ACTIVATE), "--host-config", str(paths["host-config"]),
        "--descriptor", str(paths["descriptor"]),
        "--activation-manifest", str(paths["manifest"]),
        "--activation-digest", str(paths["digest"]), "--lock", str(paths["lock"]),
        "--provisioner", str(PROVISION), "--generator", str(GENERATOR),
        "--prepare-helper", str(PREPARE),
    ]
    if source is not None:
        result += ["--source-host-config", str(source)]
    if rotate:
        result.append("--rotate-seeds")
    if rollback is not None:
        result += ["--rollback-to", rollback]
    if prepare:
        result.append("--prepare-store")
    if verify:
        result.append("--verify-only")
    return result


def kill(command_line: list[str], paths: dict[str, Path], launcher: Path,
         receipt: Path, phase: str) -> None:
    receipt.unlink(missing_ok=True)
    env = os.environ.copy()
    env.update({
        "NE_ACTIVATE_MODULE": str(ACTIVATE), "NE_KILL_PHASE": phase,
        "NE_KILL_RECEIPT": str(receipt),
        "NE_HOST_CONFIG": str(paths["host-config"]),
        "NE_DESCRIPTOR": str(paths["descriptor"]),
        "NE_MANIFEST": str(paths["manifest"]), "NE_DIGEST": str(paths["digest"]),
        "NE_CURRENT": str(paths["generation"] / "current"),
    })
    result = subprocess.run([sys.executable, str(launcher), *command_line[2:]],
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            check=False, env=env)
    if result.returncode not in (-signal.SIGKILL, 128 + signal.SIGKILL):
        raise AssertionError(
            f"{phase} did not SIGKILL at its receipt: rc={result.returncode}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    assert json.loads(receipt.read_text(encoding="utf-8"))["phase"] == phase
    print(f"SIGKILL receipt phase={phase} case={receipt.stem}", flush=True)


def pending_epoch(paths: dict[str, Path]) -> str:
    value = json.loads((paths["generation"] / "activation.pending.json").read_text())
    assert value["state"] == "preparing"
    return str(value["epoch"])


def assert_state(paths: dict[str, Path], bindings: dict[str, bytes],
                 epoch: str, backing: Path) -> None:
    assert_bindings(paths, bindings)
    assert current_epoch(paths["generation"]) == epoch
    assert mounted_backing(paths["data-mount"]) == backing.resolve()


def cleanup_mounts(root: Path) -> None:
    for _ in range(5):
        output = subprocess.run(["findmnt", "-n", "--raw", "-o", "TARGET"],
                                text=True, stdout=subprocess.PIPE, check=False).stdout
        targets = []
        for line in output.splitlines():
            target = Path(line).resolve()
            if target == root or root in target.parents:
                targets.append(target)
        if not targets:
            return
        for target in sorted(targets, key=lambda item: len(item.parts), reverse=True):
            subprocess.run(["umount", "--", str(target)], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    raise AssertionError(f"temporary activation mounts did not cleanly detach below {root}")


def main() -> None:
    if os.geteuid() != 0:
        result = subprocess.run(["sudo", "-n", sys.executable, str(Path(__file__).resolve())])
        raise SystemExit(result.returncode)
    for tool in ("docker", "findmnt", "losetup", "blkid", "mkfs.ext4",
                 "fallocate", "mount", "umount"):
        if shutil.which(tool) is None:
            raise AssertionError(f"activation crash matrix requires host tool: {tool}")
    socket = docker_socket()
    run(["docker", "--host", f"unix://{socket}", "info", "--format", "{{.ID}}"])

    raw = Path(tempfile.mkdtemp(prefix="niceeval-activation-crash-matrix-", dir="/tmp"))
    try:
        store_root, data_mount = raw / "store", raw / "data"
        journal, active_root = raw / "journal", raw / "active"
        for directory in (store_root, data_mount, journal, active_root):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        paths = {
            "host-config": active_root / "host.json",
            "descriptor": active_root / "descriptor.json",
            "manifest": journal / "fixed-image-v1" / "activation.json",
            "digest": journal / "fixed-image-v1" / "activation.sha256",
            "lock": raw / "activation.lock", "generation": journal / "fixed-image-v1",
            "data-mount": data_mount,
        }
        config: dict[str, Any] = {
            "name": "activation-crash-matrix", "userName": "root", "userGroup": "root",
            "securityLevel": "raw-dind-storage/v1",
            "hostMachineIdentity": Path("/etc/machine-id").read_text().strip(),
            "dockerSocket": str(socket), "controlSocket": str(raw / "run/control.sock"),
            "dataMount": str(data_mount), "dockerRootDir": str(data_mount / "docker"),
            "journalDir": str(journal), "aggregateCgroupPath": "/sys/fs/cgroup",
            "activationDependency": {
                "class": "direct-exclusive-process-scan/v1", "cgroupPath": None,
            },
            "capacity": {
                "cpus": 1, "memory": "64M", "pids": 64, "maxContainers": 1,
                "maxBuilds": 1, "ephemeralDiskBytes": "8M",
                "dockerDataAllocationCount": 1, "memorySwapBytes": 0,
            },
            "aggregate": {"cpus": 1, "memory": "64M", "pids": 64,
                          "memorySwapBytes": 0},
            "storage": {
                "size": "48M", "sizeBytes": 48 * 1024 * 1024,
                "backing": "fixed-image-ext4", "rootDir": str(store_root),
                "outerImagePath": str(store_root / "fixed-image-v1/store.img"),
                "legacyOuterImagePath": str(store_root / "legacy.img"),
            },
            "setupPrefix": {"enable": True, "seedCount": 1},
        }
        write_json(paths["host-config"], config)
        # Deployment mounts the initial outer store before starting the explicit
        # activation transaction. Rotations exercise --prepare-store in the CLI.
        base_image = Path(config["storage"]["outerImagePath"])
        run([str(PREPARE), "--image", str(base_image), "--size", str(48 * 1024 * 1024),
             "--mount", str(data_mount), "--fully-allocate"])
        run(["mount", "-t", "ext4", "-o", "loop,noatime,nodev,nosuid", "--",
             str(base_image), str(data_mount)])
        run(["mount", "--make-rprivate", "--", str(data_mount)])
        run(command(paths))
        baseline_epoch = current_epoch(paths["generation"])
        baseline = capsule_bindings(paths["generation"], baseline_epoch)
        baseline_backing = Path(config["storage"]["outerImagePath"]).resolve()
        assert_state(paths, baseline, baseline_epoch, baseline_backing)

        source = raw / "next-host.json"
        next_config = json.loads(paths["host-config"].read_text())
        next_config["capacity"]["cpus"] = 2
        next_config["aggregate"]["cpus"] = 2
        write_json(source, next_config)
        launcher, receipts = raw / "kill-launcher.py", raw / "receipts"
        write_kill_launcher(launcher)
        receipts.mkdir()

        # Current is the sole commit point: each earlier kill restores exactly
        # the old epoch, while a kill immediately after current keeps the new one.
        for index, phase in enumerate((*BINDINGS, "current")):
            cutover = command(paths, source=source, rotate=True, prepare=True)
            kill(cutover, paths, launcher, receipts / f"cutover-{phase}.json", phase)
            new_epoch = pending_epoch(paths)
            new = capsule_bindings(paths["generation"], new_epoch)
            new_backing = Path(json.loads(new["manifest"])["outerImagePath"]).resolve()
            assert mounted_backing(data_mount) == new_backing
            assert_transition(paths, baseline, new, min(index + 1, len(BINDINGS)))
            if phase == "current":
                assert current_epoch(paths["generation"]) == new_epoch
                run(command(paths, verify=True))
                assert_state(paths, new, new_epoch, new_backing)
                run(command(paths, rollback=baseline_epoch, prepare=True))
                # Rollback publishes a fresh epoch capsule rather than moving
                # current backward to the historical epoch identifier.
                baseline_epoch = current_epoch(paths["generation"])
                baseline = capsule_bindings(paths["generation"], baseline_epoch)
            else:
                assert current_epoch(paths["generation"]) == baseline_epoch
                run(command(paths, verify=True))
            assert_state(paths, baseline, baseline_epoch, baseline_backing)

        # Every recovery mutation is itself crashable. A clean retry and a
        # second clean retry must converge on byte-identical bindings/backing.
        for index, phase in enumerate((*BINDINGS, "mount")):
            cutover = command(paths, source=source, rotate=True, prepare=True)
            kill(cutover, paths, launcher, receipts / f"restore-source-{phase}.json", "digest")
            new_epoch = pending_epoch(paths)
            new = capsule_bindings(paths["generation"], new_epoch)
            new_backing = Path(json.loads(new["manifest"])["outerImagePath"]).resolve()
            assert_transition(paths, baseline, new, len(BINDINGS))
            assert mounted_backing(data_mount) == new_backing

            recovery = command(paths, verify=True)
            kill(recovery, paths, launcher, receipts / f"restore-{phase}.json", phase)
            restored = min(index + 1, len(BINDINGS))
            assert_transition(paths, new, baseline, restored)
            assert current_epoch(paths["generation"]) == baseline_epoch
            expected_backing = baseline_backing if phase == "mount" else new_backing
            assert mounted_backing(data_mount) == expected_backing
            run(recovery)
            assert_state(paths, baseline, baseline_epoch, baseline_backing)
            converged = active_bindings(paths)
            run(recovery)
            assert_state(paths, converged, baseline_epoch, baseline_backing)

        expected_receipts = 5 + 5 * 2
        assert len(list(receipts.glob("*.json"))) == expected_receipts
        print(
            "fixed-activation-capsule-smoke ok "
            f"({expected_receipts} SIGKILL receipts; loop/ext4 recovery converged)"
        )
    finally:
        cleanup_mounts(raw)
        shutil.rmtree(raw)


if __name__ == "__main__":
    main()
