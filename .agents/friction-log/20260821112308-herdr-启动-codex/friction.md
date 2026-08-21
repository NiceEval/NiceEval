---
title: 'Herdr 启动 Codex 只读 worker 时丢失可用认证'
severity: 'minor'
---

## Expected Behavior

父 Codex agent 已正常运行时，Herdr 用同一受支持的 Codex runtime 启动只读设计 worker，应继承或复用可用认证并能接收 prompt；无需伪造新的 secret。

## Current Behavior

`herdr agent start assertion-projection-grill-0821 --kind codex --pane w1Z:p9 --timeout 120000 -- codex -s read-only -a never` 能启动进程，但完整 prompt 下发后 worker 立即以 `Missing environment variable: CODEX_API_KEY` 结束。父 agent 本身仍可正常工作，说明新进程没有取得当前可用认证。设计挑战因此无法执行，只能缩小为不改变持久语义的局部呈现修正。

## Possible Solution

Herdr 的 Codex runtime 启动路径应复用已登录 session，或在启动前给出结构化认证 preflight，明确当前 runtime 只支持哪种认证来源；不要等 prompt 下发后才在 worker 内失败。

## Minimal Reproducible Example

在 `HERDR_ENV=1` 且父 Codex pane 正常运行时，新建空闲 pane，执行：

```sh
herdr agent start repro-codex-readonly --kind codex --pane <pane-id> --timeout 120000 -- codex -s read-only -a never
herdr agent prompt repro-codex-readonly "只读检查并回复 PASS"
herdr agent wait repro-codex-readonly --timeout 120000
herdr agent read repro-codex-readonly
```

worker 输出 `Missing environment variable: CODEX_API_KEY`。

## Context

发生在 NiceEval assertion evidence 设计挑战流程。父侧已按要求读取失败输出、确认没有设计结论并关闭本轮创建的 pane；未改用内置 subagent，也未伪造凭据。
