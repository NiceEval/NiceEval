---
title: 'Sandbox 物理规划错误吞掉 profile 根因'
severity: 'major'
---

## Expected Behavior

`niceeval exp harness --dry` 在 managed-rootless profile 未注册时，应列出失败 pair、缺失 alias `default`，并给出 `niceeval docker profile doctor default` 的下一步；Roadmap 已要求物理规划错误可诊断。

## Current Behavior

CLI 只输出 `SandboxPhysicalPlanningError: Sandbox physical planning failed for 6 pairs` 和堆栈。用户必须另行猜测并运行 profile list/doctor，才能发现 profiles 为空；公开错误没有携带规划器已经知道的根因。

## Possible Solution

让 planning error 保留每个 pair 的结构化 reason，human renderer 去重后显示 profile alias、失败阶段与 doctor 命令；JSON 模式保留逐 pair 诊断。

## Minimal Reproducible Example

在没有注册 Docker execution profile 的主机上，让 experiment 使用 `dockerAccess: { mode: "dind", isolation: "managed-rootless", profile: "default" }`，运行 `pnpm exec niceeval exp harness --dry`。当前只显示 pair 数量；`pnpm exec niceeval docker profile doctor default` 才显示 alias 未注册。

## Context

NiceEval-Eval Harness 的 6 个 physical pairs 在任何 sandbox 或付费调用前正确 fail closed，但缺少根因文本使真实 dogfood 无法从首次错误直接修复环境。
