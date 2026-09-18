---
format: concord.document/v1
id: environment-model
title: Sandbox 模型：Sandbox 起点与三方准备顺序
createdAt: 2026-07-31T12:23:19+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/environment-model/README.md
  commit: 6f67cf2c6126f9dc632f45a697d7e9b9087b5c5d
kind: design
alternatives:
  - plan-1
  - plan-10
  - plan-11
  - plan-2
  - plan-3
  - plan-4
  - plan-6
  - plan-7
  - plan-8
  - plan-9
decision:
  selected: plan-10
  reason: 迁移保留 DECISION.md 中的明确裁决：plan-10
  source:
    path: docs/design/environment-model/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:41667408907db77b5d3c7cae39ccc429d87a60d549ff7789d3872c1dc29ea2eb
  targets: []
---
# Sandbox 模型：Sandbox 起点与三方准备顺序

Eval、Experiment 与 Agent 都可能需要准备同一个主 Sandbox。
一次 Attempt 只激活一个逻辑起点，由对应 Provider 读取成完整 `Sandbox Case`，再按候选定义的 owner 顺序执行准备。
对 Sandbox Agent，每个实际 Eval × Experiment pair 必须在创建资源前读取出唯一 root/template；不同 pair 可以使用不同 Provider 和起点。

这个决策主题回答三个问题:

- Eval 或 Experiment 谁为这条 Attempt 提供 active root/template。
- 起点 owner 怎样决定 Eval、Experiment 与 Agent 的准备顺序。
- 现场安装不可行时,作者怎样改用一份已经融合条件的完整 template，而不是让 Runner 合并两个起点。

本主题保留完整 `Sandbox Case` 与 Agent Ensure 的领域义务。
候选必须保留 `SandboxTemplate`、完整 `Sandbox Case` 与运行中的 Sandbox 的边界，不要求普通作者学习 Sandbox source builder 注册或通用 Requirement/Base 组合语言。

十个 PLAN 都按 Feature Design Package 独立给出 Library、Architecture、Lifecycle 与 Use Case。
[Cases](CASES.md) 固定共同输入和验收结果;候选用例只说明各自怎样守护,不能改写 Case 来降低要求。
最终裁决与选型理由见 [DECISION](DECISION.md);定稿契约在 [Feature · Sandbox Layer](../../feature/sandbox/layers.md)。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[CASES](CASES.md) ·
[DECISION](DECISION.md) ·
[PLAN-1](plans/plan-1/README.md) ·
[PLAN-2](plans/plan-2/README.md) ·
[PLAN-3](plans/plan-3/README.md) ·
[PLAN-4](plans/plan-4/README.md) ·
[PLAN-6](plans/plan-6/README.md) ·
[PLAN-7](plans/plan-7/README.md) ·
[PLAN-8](plans/plan-8/README.md) ·
[PLAN-9](plans/plan-9/README.md) ·
[PLAN-10](plans/plan-10/README.md) ·
[PLAN-11](plans/plan-11/README.md)
