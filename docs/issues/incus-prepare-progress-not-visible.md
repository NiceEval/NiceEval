# Incus 准备阶段只显示 Attempt 排队，无法判断当前步骤与进展

## Observation

NiceEval 0.19.0 的 Incus development 全矩阵运行，在派发 Attempt 前超过五分钟持续输出 `running: 0, queued: 12`。`niceeval invocation show <id> --json` 也仅显示同样的排队计数，未显示当前准备阶段、action、耗时或最近活动。同期 `niceeval sandbox provider doctor incus --development` 通过，显示执行容量从 4 个空闲变为 2 个空闲、artifact intents 从 18 增至 20，因此仅凭排队计数无法判断准备进展或阻塞。

## Expected behavior and impact

公开 CLI 应让使用者区分正在准备 sandbox 与真正等待调度，并定位当前准备步骤及耗时。否则长时间没有 Attempt 开始时，无法在不绕过公共结果读取边界的前提下判断正常构建、网络等待或卡死，也难以评价 provider 是否可用。本条不声称已定位耗时根因。

## Reproduction

在配置 Incus development 和多层 before actions 的 NiceEval-Eval 下游项目中：

```sh
pnpm --silent exec niceeval exp --experiment install/v0.19.0 --experiment harness/v0.19.0 --experiment install/canary --experiment harness/canary --rerun all --json
pnpm --silent exec niceeval invocation show <invocation-id> --json
pnpm --silent exec niceeval sandbox provider doctor incus --development
```

矩阵共 12 Attempts，maxConcurrency=2。观察到 elapsedMs=330352 时仍 running=0, queued=12，未收到准备步骤事件。

## Identity and provenance

直接下游 dogfood；宿主包 npm niceeval@0.19.0；候选版本 0.19.0 与 0.19.1-canary.101。Linux x86_64, Node 24.19.0, pnpm 11.12.0。观察时间 2026-10-23，来源 NiceEval-Eval 的全范围运行验收。内容已脱敏，不含凭证、私有地址或原始对话。

搜重：GitHub open/closed 搜索 Incus progress、prepare、progress；本地 draft 标题搜索 progress/准备/排队/可观测，未见相同观察。#287 涉及不同 experiment owner 的 SetupPrefix 复用及重复存储，不等同于本条准备进度呈现缺口。

建议标签：enhancement, area:cli, area:runner, needs-triage。
