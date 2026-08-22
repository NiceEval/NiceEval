#!/usr/bin/env python3
"""Attest project quotas and prebuild fixed quota slots; fail closed otherwise."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pwd
import grp
import re
import subprocess
import tempfile
from pathlib import Path


def parse_bytes(value: object) -> int:
    if isinstance(value, int):
        return value
    raw = str(value).strip().lower()
    if raw.endswith("b") and not raw.endswith("ib"):
        raw = raw[:-1]
    multipliers = {"k": 1024, "ki": 1024, "m": 1024**2, "mi": 1024**2,
                   "g": 1024**3, "gi": 1024**3, "t": 1024**4, "ti": 1024**4}
    for suffix in sorted(multipliers, key=len, reverse=True):
        if raw.endswith(suffix):
            return int(raw[:-len(suffix)]) * multipliers[suffix]
    return int(raw)


def run(*args: str) -> str:
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE).stdout.strip()


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, sort_keys=True, indent=2)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        os.chmod(raw, 0o600)
        os.replace(raw, path)
    finally:
        if os.path.exists(raw):
            os.unlink(raw)


def project_quota_row(mount: Path, project_id: int) -> tuple[int, int] | None:
    report = run("repquota", "-P", "-O", "csv", str(mount))
    for line in report.splitlines():
        fields = [field.strip().strip('"') for field in line.split(",")]
        if fields and fields[0].lstrip("#") == str(project_id):
            numbers = [int(field) for field in fields[1:] if field.isdigit()]
            if len(numbers) >= 3:
                return numbers[0] * 1024, numbers[2] * 1024
    return None


def project_usage_bytes(mount: Path, project_id: int) -> int:
    row = project_quota_row(mount, project_id)
    if row is not None:
        return row[0]
    raise SystemExit(f"project quota usage is not reportable for project {project_id}")


def project_paths(mount: Path) -> dict[int, set[Path]]:
    result = subprocess.run(
        ["lsattr", "-p", "-R", str(mount)], check=False, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise SystemExit(f"cannot enumerate project IDs on {mount}: {result.stderr.strip()}")
    assigned: dict[int, set[Path]] = {}
    for line in result.stdout.splitlines():
        match = re.match(r"^\s*(\d+)\s+\S+\s+(.+)$", line)
        if match is None:
            continue
        project_id = int(match.group(1))
        if project_id != 0:
            assigned.setdefault(project_id, set()).add(Path(match.group(2)).resolve())
    return assigned


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-config", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("project-quota slot installation requires root")
    cfg = json.loads(Path(args.host_config).read_text(encoding="utf-8"))
    mount = Path(cfg["dataMount"]).resolve()
    storage = cfg["storage"]
    slot_root = Path(storage["slotRootPath"])
    registry = Path(storage["slotRegistryPath"])
    count = int(cfg["capacity"].get("dockerDataAllocationCount", cfg["capacity"]["maxContainers"]))
    limit = parse_bytes(cfg["capacity"]["ephemeralDiskBytes"])
    owner_uid = pwd.getpwnam(cfg["userName"]).pw_uid
    owner_gid = grp.getgrnam(cfg["userGroup"]).gr_gid

    target, fstype, options = run("findmnt", "-n", "-o", "TARGET,FSTYPE,OPTIONS", "--target", str(mount)).split(maxsplit=2)
    if Path(target).resolve() != mount:
        raise SystemExit(f"dataMount must be its own mount, got {target}")
    if fstype not in ("ext4", "xfs") or not ({"prjquota", "pquota"} & set(options.split(","))):
        raise SystemExit(f"cannot attest project quota on {mount}: {fstype} {options}")
    if run("findmnt", "-n", "-o", "PROPAGATION", "--target", str(mount)) != "private":
        run("mount", "--make-rprivate", str(mount))

    slot_root.mkdir(parents=True, exist_ok=True)
    slots = []
    project_seed = f"niceeval-docker-data-v1:{cfg['name']}:{os.stat(mount).st_dev}"
    base_project = 100_000 + int(hashlib.sha256(project_seed.encode()).hexdigest()[:8], 16) % 1_000_000_000
    assigned_projects = project_paths(mount)
    for index in range(count):
        slot_id = f"slot-{index:04d}"
        project_id = base_project + index
        path = slot_root / slot_id
        path.mkdir(mode=0o700, exist_ok=True)
        current_project = int(run("lsattr", "-p", "-d", str(path)).split()[0])
        existing_quota = project_quota_row(mount, project_id)
        conflicting_paths = assigned_projects.get(project_id, set()) - {path.resolve()}
        if conflicting_paths:
            rendered = ", ".join(str(item) for item in sorted(conflicting_paths))
            raise SystemExit(
                f"project ID {project_id} is already assigned on {mount}: {rendered}"
            )
        if current_project != project_id and existing_quota is not None and existing_quota != (0, 0):
            raise SystemExit(
                f"project ID {project_id} is already allocated on {mount}; refusing to overwrite its quota"
            )
        run("chattr", "-p", str(project_id), "+P", str(path))
        assigned_projects.setdefault(project_id, set()).add(path.resolve())
        # setquota's project mode is supported by Linux quota-tools for ext4/xfs.
        run("setquota", "-P", str(project_id), "0", str(limit // 1024), "0", "0", str(mount))
        os.chown(path, owner_uid, owner_gid)
        os.chmod(path, 0o700)
        baseline = project_usage_bytes(mount, project_id)
        slots.append({"slotId": slot_id, "projectId": project_id, "path": str(path),
                      "limitBytes": limit, "baselineUsageBytes": baseline,
                      "ownerUid": owner_uid, "ownerGid": owner_gid, "mode": 0o700,
                      "generation": 0, "state": "free"})
    atomic_json(registry, {"schemaVersion": 1, "mount": str(mount), "slots": slots})
    os.chown(registry, owner_uid, owner_gid)
    print(f"attested and installed {count} project-quota slots at {slot_root}")


if __name__ == "__main__":
    main()
