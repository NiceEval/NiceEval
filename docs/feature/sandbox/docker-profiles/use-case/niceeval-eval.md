---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Use Case：NiceEval-Eval 单容器 DinD

本篇不是 nested Docker 的公开验收路径。

NiceEval-Eval 需要 Agent 在 Sandbox 内运行 `docker` 与 `docker compose` 时，走
[声明 Docker 能力](../../nested-docker/use-case/声明Docker能力.md)。
Eval 写 `sandboxRequirements()`，Experiment 写 `incusSandbox()`。

单容器 raw / managed DinD、官方 `docker:<version>-dind` 派生镜像与
`niceeval docker profile doctor default` 不能满足 `dedicated-kernel/v1`。
它们不能作为公开 dogfood 或 fallback。
