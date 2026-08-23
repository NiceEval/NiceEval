#!/usr/bin/env python3
"""Idempotently preload or verify the fixed offline Docker-profile assets.

Deployment may either supply a local OCI archive or explicitly allow this
administrator command to pull exact digests.  Runtime control and doctor only
inspect these images and never invoke pull.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", *args], check=check, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--load-archive", type=Path)
    source.add_argument("--pull", action="store_true", help="deployment-only explicit digest pull")
    args = parser.parse_args()
    if args.load_archive is not None:
        docker("load", "--input", str(args.load_archive))
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("platform") != "linux/amd64":
        raise SystemExit("unsupported asset manifest platform")
    for item in manifest.get("images", []):
        reference, platform = item.get("reference"), item.get("platform")
        if not isinstance(reference, str) or "@sha256:" not in reference or platform != "linux/amd64":
            raise SystemExit("asset manifest contains an invalid fixed identity")
        inspected = docker("image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", reference, check=False)
        if inspected.returncode != 0 and args.pull:
            docker("pull", reference)
            inspected = docker("image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", reference, check=False)
        if inspected.returncode != 0 or inspected.stdout.strip() != platform:
            raise SystemExit(f"asset missing or mismatched: {reference}")
        print(f"verified {reference} {platform}")


if __name__ == "__main__":
    main()
