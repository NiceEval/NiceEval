---
title: 'Coding Agent E2E 未闭合官方 Docker image 配对且三家引用缺失 Dockerfile'
severity: 'major'
---

## Expected Behavior
六个官方 coding-agent Adapter 的 live E2E 应分别使用当前 `NICEEVAL_*_DOCKER_IMAGE` 指向的官方版本锁定镜像，并通过真实 Adapter、真实模型与公开 CLI 读回完成组合验收。任何自建 E2E 镜像都应在叶子 Repo 中签入可从干净 runner 构建的 Dockerfile。

## Current Behavior
Claude Code 与 Codex E2E 使用官方仓库，但硬编码旧 tag `niceeval/claude-code:v0.9.1` 与 `niceeval/codex:v0.9.1`，没有覆盖当前导出常量。Bub、OpenCode、Hermes、OpenClaw 使用本地 E2E tag而非官方公共镜像；其中 Bub、OpenCode、Hermes 的 `scripts/build-docker-env.ts` 都执行 `docker build ... docker`，但仓库中没有对应 `docker/Dockerfile`，只有 Docker daemon 恰好缓存同名 tag 时才会跳过这个缺口。官方镜像发布 workflow 只做镜像构建、Agent 入口 smoke 与共用工具面自检，不运行 NiceEval Adapter E2E。

## Possible Solution
让六个 live E2E 都从 `niceeval/sandbox` 导入对应 `NICEEVAL_*_DOCKER_IMAGE`，删除旧 tag 与本地空白镜像构建路径；若仍需单独证明 fallback installer，则另设明确的 installer case，不让它替代官方镜像 × Adapter 的组合验收。

## Minimal Reproducible Example
```sh
rg -n "source:.*image" e2e/adapter/{claude-code,codex-cli,bub,opencode,hermes,openclaw}/sandbox.ts
find e2e/adapter/{bub,opencode,hermes} -path "*/docker/Dockerfile" -print
rg -n "NICEEVAL_.*DOCKER_IMAGE" e2e/adapter
```

## Context
盘点官方 Adapter 与 Docker image 的 E2E 对应关系时发现。六家都有 Adapter live E2E，但没有一家明确消费当前版本锁定常量；只有 Claude Code 与 Codex 使用官方 repository，且仍是旧版库 tag。
