---
title: '只读 design_grill 无法发送强制完成通知'
severity: 'minor'
---

## Expected Behavior

只读 design_grill 应能在不取得文件写权限的前提下，按 AGENTS.md 约定向父 pane 发送唯一一次 WORKER_READY_FOR_ACCEPTANCE 通知。

## Current Behavior

worker 使用 gpt-5.6-sol、max、read-only、approval never 完成设计挑战后，执行授权的 herdr agent prompt 仍返回 Operation not permitted。父 agent 只能依赖主动 wait/get/read 回收，强制完成通知无法作为第二道保险。

## Possible Solution

把向既有父 pane 发送一次受限完成通知从文件系统只读权限中分离，或为 design_grill 提供仅允许目标父 pane 与固定消息前缀的通知 capability。

## Minimal Reproducible Example

以 read-only、approval never 启动 Codex worker，在 prompt 中授权它只执行一次 herdr agent prompt 父 pane。worker 完成后执行该命令，Herdr 返回 Operation not permitted。

## Context

polish-assert 的 Assertion API 重大设计挑战中稳定复现。worker 的设计输出完整，只有完成通知失败；父 agent 已通过 wait/get/read 正常回收。
