# Roadmap

这里放仍有开放分歧、尚未定稿的候选设计。
Roadmap 表示设计成熟度，不表示代码是否实现；正文讨论希望解决的问题、候选契约和待裁决分歧，不用 `未实现` 描述代码状态。

设计定稿后按目标形态重写并移入 [`../feature/`](../feature/)，不在原文追加 `现已定稿` 一类的时间线说明。

## 结构

Roadmap 与 Feature、Design 候选共用 [Feature Design Package](../_template/feature-design/README.md):

- `README.md` 必备,写问题、候选心智、范围与待裁决分歧。
- `library.md`、`cli.md`、`architecture.md` 与 `use-case/` 按需使用,体裁与 Feature 完全相同。
- 开放分歧只改变契约成熟度,不改变文件职责,也不另建 Roadmap 专用模板。

一个方向出现多个需要正式比较的候选时,移入 [`../design/`](../design/README.md),让每个候选成为独立 `PLAN-N/`。

- [Multi-Agent](multi-agent/README.md) —— 多 agent eval 的三种场景
- [Adapters](adapters/README.md) —— Cursor Agent SDK、vm0 与其它等待上游稳定的候选接入
- [E2E 验收断言 DSL 与 vitest 验收库](e2e-acceptance-dsl/README.md) —— 等待按测试作者面决策重写的 Report 媒介 adapter 候选
- [结果携带与 Sandbox 复用反馈](reuse-feedback/README.md) —— 消除 `reused` 一词两义，并补齐 Sandbox 复用的运行级反馈
- [Agent 进程契约](agent-process-contract/README.md) —— 进程寿命唯一边界是沙箱、agent 非零退出记 `errored`;多容器环境决策的先行前提
