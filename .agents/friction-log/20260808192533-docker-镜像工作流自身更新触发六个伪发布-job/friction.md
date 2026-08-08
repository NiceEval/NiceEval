---
title: 'Docker 镜像工作流自身更新触发六个伪发布 job'
severity: 'minor'
---

## Expected Behavior

只有 Docker 基线配方或对应 Agent 版本发生变化时，镜像发布工作流才启动；仅升级 GitHub Action 的版本不应制造看起来像六个发布的 job。

## Current Behavior

`.github/workflows/docker-image.yml` 把自身列在 `push.paths`。因此提交 `2406801c` 仅将 `actions/checkout` 和 `actions/setup-node` 从 v4 升为 v6，仍触发全部六个 `Publish niceeval/*` matrix job。tag gate 正确发现现有 tag（HTTP 200）并跳过登录、构建和 `push: true`，但 GitHub UI 只显示成功的 Publish job，容易误判为自动发版。

## Possible Solution

缩小触发路径至实际影响镜像内容和版本的文件，或将 workflow 自身改动走显式 `workflow_dispatch` / 独立验证路径；同时把 gate 后的 job/step 命名改成能明确显示“已跳过、未推送”。

## Minimal Reproducible Example

1. 修改并推送 `.github/workflows/docker-image.yml` 中与镜像内容无关的 Action 版本。
2. 查看 Publish Docker image run：六个 matrix job 启动。
3. 查看任一 job：`Decide whether to publish` 输出 `<image>:<version> 已发布，跳过`，且 `Build and push multi-platform image` 为 skipped。

## Context

2026-08-08 的 run `31254622038` 由 `2406801c` 触发；六个镜像均未实际推送。
