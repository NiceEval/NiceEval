---
format: concord.document/v1
id: prepare-commands
title: 内置 prepare 命令:固定生命周期下的具体化声明与复用成本
createdAt: 2026-08-01T18:25:03+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/prepare-commands/README.md
  commit: a390ed2e3b58bad7c6a14a494837804a0d3bc114
kind: design
alternatives:
  - plan-1
  - plan-2
  - plan-3
decision:
  selected: plan-1
  reason: 迁移保留 DECISION.md 中的明确裁决：plan-1
  source:
    path: docs/design/prepare-commands/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:ae2f88f178c9f577fe8af29fd9100d496f6bd6492274cd6f1fb90f27ffe88513
  targets: []
---
# 内置 prepare 命令:固定生命周期下的具体化声明与复用成本

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md) ·
[PLAN-1](plans/plan-1/README.md) · [PLAN-2](plans/plan-2/README.md) · [PLAN-3](plans/plan-3/README.md)

[Sandbox 模型](../environment-model/DECISION.md)已经固定生命周期:每条 Attempt 按 template owner 顺序重新执行两层 `prepare()` 命令,昂贵动作靠真实检查快速命中。
频次与顺序不是本主题的问题;本主题裁决的是**作者怎样具体、便宜地满足这条固定 cadence**。

现状把三件事都留给作者惯用法:昂贵命令的探测写法(`command -v x || install`)、复用周期内的缓存位置(workdir 外目录)、以及哪些命令会在复用下命中的预判。
`shell()` 自带纯数据 identity,却不自带检查语义;写错惯用法的症状是复用不省钱或每题重付网络,且只有跑起来才发现。

本主题回答三个问题:

1. 复用周期内每条命令的预期成本(检查命中还是全额重新执行)怎样在计划面可见。
2. 常见昂贵动作(源码 checkout、工具安装)的检查与缓存,归作者惯用法还是官方内置命令。
3. 官方内置命令 与 memory 旧裁决「不配官方 fixture 装载 API」的关系怎样处理。

三个候选:

- [PLAN-1](plans/plan-1/README.md):官方内置命令库(`checkout` / `installTool`)加 `--dry` 复用成本视图;全部建在 `prepare()` 之上。
- [PLAN-2](plans/plan-2/README.md):给 SandboxCommand 增加意图分类字段,框架按类别推导缓存与展示。
- [PLAN-3](plans/plan-3/README.md):零新 API,惯用法进文档与用例。
