---
title: 'OpenCode interactive worker 的 READY 与 idle 状态无法可靠续传 prompt'
severity: 'minor'
---

## Expected Behavior

Herdr 按 flash-max-worker 预设启动 OpenCode run --interactive 后，可以先收到 READY，再通过 herdr agent prompt 下发完整任务；idle 状态与 prompt 的停止指令应准确生效。

## Current Behavior

初始消息只要求回复 READY 时，OpenCode 回复后立即退出，下一条 herdr agent prompt 返回 agent_not_found。改为把完整任务放进初始消息后，Herdr 长期显示 idle，但 worker 仍在连续执行；父 agent 连续两次要求停止写入并只交接，worker 仍继续创建和修改临时校验文件，最终只能发送 Ctrl-C。

## Possible Solution

让 run --interactive 在完成首轮后保持可提示会话；Herdr 的 OpenCode 检测应区分模型采样、等待输入与退出，并让 prompt/中断在消息边界可靠生效。

## Minimal Reproducible Example

1. herdr agent start audit --kind opencode --pane PANE -- run --interactive --model opencode-go/deepseek-v4-flash --variant max --auto 只回复READY
2. herdr agent prompt audit 完整任务
3. 观察 agent_not_found；若首条消息直接给完整任务，则观察 agent_status=idle 与实际持续执行不一致。

## Context

本轮为了取得交接，父 agent 需要重启会话；worker 无视停止指令后又必须用 herdr agent send-keys C-c 强制中止，并手工删除它创建的临时配置与空目录。
