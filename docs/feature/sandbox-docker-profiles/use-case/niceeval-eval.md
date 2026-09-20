---
format: concord.document/v1
id: niceeval-eval
title: Use Case：NiceEval-Eval 单容器 DinD
createdAt: 2026-08-07T11:42:18+08:00
kind: use-case
feature: docs/feature/sandbox-docker-profiles/README.md
---

# Use Case：NiceEval-Eval 单容器 DinD

本篇不是 nested Docker 的公开验收路径。

NiceEval-Eval 需要 Agent 在 Sandbox 内运行 `docker` 与 `docker compose` 时，走
[声明 Docker 能力](../../sandbox-nested-docker/use-case/nested-docker-capability.md)。
Eval 写 `sandboxRequirements()`，Experiment 写 `incusSandbox()`。

单容器 raw / managed DinD、官方 `docker:<version>-dind` 派生镜像与
`niceeval docker profile doctor default` 不能满足 `dedicated-kernel/v1`。
它们不能作为公开 dogfood 或 fallback。
