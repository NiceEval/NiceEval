#!/usr/bin/env python3
"""Validate capacity (allocatable) vs aggregate hard limits for a profile host config.

capacity = already-deducted allocatable pool granted to Attempt reservations
aggregate = systemd cgroup hard limit (must be >= each allocatable field)
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any


def parse_bytes(value: Any) -> int:
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        raise ValueError(f"size must be int or string, got {type(value).__name__}")
    s = value.strip().lower()
    if s.endswith("b") and not s.endswith("ib"):
        s = s[:-1]
    mult = 1
    for suffix, m in (
        ("ti", 1024**4),
        ("t", 1024**4),
        ("gi", 1024**3),
        ("g", 1024**3),
        ("mi", 1024**2),
        ("m", 1024**2),
        ("ki", 1024),
        ("k", 1024),
    ):
        if s.endswith(suffix):
            mult = m
            s = s[: -len(suffix)]
            break
    return int(s) * mult


def parse_cpus(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != int(value):
            raise ValueError(f"cpus must be whole number, got {value}")
        return int(value)
    return int(str(value))


def validate(cfg: dict[str, Any]) -> dict[str, Any]:
    cap = cfg["capacity"]
    agg = cfg["aggregate"]
    name = cfg.get("name", "<profile>")

    cap_cpus = parse_cpus(cap["cpus"])
    agg_cpus = parse_cpus(agg["cpus"])
    cap_mem = parse_bytes(cap["memory"] if "memory" in cap else cap["memoryBytes"])
    agg_mem = parse_bytes(agg["memory"] if "memory" in agg else agg["memoryBytes"])
    cap_pids = int(cap["pids"])
    agg_pids = int(agg["pids"])
    max_containers = int(cap["maxContainers"])
    max_builds = int(cap["maxBuilds"])
    cap_swap = int(cap.get("memorySwapBytes", 0))
    agg_swap = int(agg.get("memorySwapBytes", 0))

    errors: list[str] = []
    if agg_cpus < cap_cpus:
        errors.append(
            f"{name}: aggregate.cpus ({agg_cpus}) < capacity.cpus/allocatable ({cap_cpus})"
        )
    if agg_mem < cap_mem:
        errors.append(
            f"{name}: aggregate.memory ({agg_mem}) < capacity.memory/allocatable ({cap_mem})"
        )
    if agg_pids < cap_pids:
        errors.append(
            f"{name}: aggregate.pids ({agg_pids}) < capacity.pids/allocatable ({cap_pids})"
        )
    if cap_swap != 0:
        errors.append(f"{name}: capacity.memorySwapBytes must be 0")
    if agg_swap != 0:
        errors.append(f"{name}: aggregate.memorySwapBytes must be 0")
    if max_containers < 1:
        errors.append(f"{name}: capacity.maxContainers must be >= 1")
    if max_builds < 1:
        errors.append(f"{name}: capacity.maxBuilds must be >= 1")

    if errors:
        raise SystemExit("\n".join(errors))

    return {
        "capacity": {
            "cpus": cap_cpus,
            "memoryBytes": cap_mem,
            "memorySwapBytes": 0,
            "pids": cap_pids,
            "maxContainers": max_containers,
            "maxBuilds": max_builds,
        },
        "aggregate": {
            "cpus": agg_cpus,
            "memoryBytes": agg_mem,
            "memorySwapBytes": 0,
            "pids": agg_pids,
            "cpuQuotaPercent": agg_cpus * 100,
        },
        "headroom": {
            "cpus": agg_cpus - cap_cpus,
            "memoryBytes": agg_mem - cap_mem,
            "pids": agg_pids - cap_pids,
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("config", help="host config JSON path (or - for stdin)")
    p.add_argument("--json", action="store_true", help="print normalized JSON")
    args = p.parse_args()

    if args.config == "-":
        cfg = json.load(sys.stdin)
    else:
        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)

    result = validate(cfg)
    if args.json:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    else:
        h = result["headroom"]
        print(
            "OK capacity=allocatable "
            f"cpus={result['capacity']['cpus']} "
            f"mem={result['capacity']['memoryBytes']} "
            f"pids={result['capacity']['pids']} "
            f"maxContainers={result['capacity']['maxContainers']} "
            f"maxBuilds={result['capacity']['maxBuilds']}"
        )
        print(
            "OK aggregate=hard "
            f"cpus={result['aggregate']['cpus']} "
            f"mem={result['aggregate']['memoryBytes']} "
            f"pids={result['aggregate']['pids']} "
            f"CPUQuota={result['aggregate']['cpuQuotaPercent']}%"
        )
        print(
            "OK headroom "
            f"cpus={h['cpus']} mem={h['memoryBytes']} pids={h['pids']}"
        )


if __name__ == "__main__":
    main()
