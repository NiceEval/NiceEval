---
title: '官方 Bub 镜像声明非 root 用户但运行时安装前缀不可写'
severity: 'major'
---

## Expected Behavior

NiceEval 官方 Bub 镜像在声明 `USER node` 后，Bub 条件需要的标准运行时安装路径应对该用户可写，或官方契约应提供无需临时提权的扩展安装位置。

## Current Behavior

官方 Bub 0.4.0-r2 镜像声明 `USER node`，但 `/usr/local` 仍归 root 所有。MemoryBench lightbox 的 Group setup 需要安装扩展时触发 permission denied，导致正式批次中的相关 slots 必须修镜像后补跑。

## Possible Solution

在镜像构建阶段完成所需安装，或把公开扩展前缀的 ownership/permissions 与声明用户对齐，并为镜像加入非 root 安装 smoke check。

## Minimal Reproducible Example

1. 启动官方 Bub 0.4.0-r2 镜像并保持默认 `USER node`。
2. 在 Group setup 中向 `/usr/local` 执行标准全局安装。
3. 操作以 permission denied 失败；切到预制安装或修正 ownership 后通过。

## Context

MemoryBench Bub 与受影响 lightbox slots 采用修复后的派生镜像完成 fix-forward；原 verdict 不应依赖仓库长期 workaround。
