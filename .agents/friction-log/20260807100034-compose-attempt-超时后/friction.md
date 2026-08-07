---
title: 'Compose attempt 超时后 finalizer 复用已 abort signal 导致资源泄漏'
severity: 'major'
---

## Expected Behavior

Docker Compose sandbox 的 attempt timeout/cancel 后，provider finalizer 应使用独立且有界的 cleanup signal 执行整组 `docker compose down --volumes --remove-orphans`；清理失败应保留可重试所有权并追加诊断，不覆盖原 verdict。

## Current Behavior

`materializeDockerComposeProviderCase` 的 finalizer 把已经 abort 的 attempt signal 继续传给 `runDockerCompose`。超时路径会在 `down` 真正执行前立即 abort，且旧 finalizer 吞掉错误、注销状态并删除 overlay，Compose project 容器、网络和卷可能遗留。

## Possible Solution

finalizer 使用新的短时 signal；stop 采用 Open → Stopping → Stopped 状态机，成功后才注销 registry，失败回 Open；`runDockerCompose` 的 abort 采用 TERM→KILL 有界拒绝；down 带 `--volumes --remove-orphans`。

## Minimal Reproducible Example

创建任意 Docker Compose sandbox，在 materialization 成功后 abort attempt signal，再调用 `materialized.group.stop()`。修复前 `down` 继承已 abort signal，项目资源仍存在。新增 opt-in 真机测试 `src/sandbox/compose.docker.test.ts` 覆盖容器、网络、匿名/自有卷删除与 external volume 保留。

## Context

把 NiceEval-Eval 从 E2B 改为 Docker/DinD 时，真实 timeout/cancel 清理是防止后续评估被残留容器污染的前置条件。
