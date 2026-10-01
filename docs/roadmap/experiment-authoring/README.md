---
format: concord.document/v1
id: experiment-authoring
title: Experiment Authoring
createdAt: 2026-08-14T13:42:59+08:00
createdAtSource:
  kind: first-recorded
  path: docs/roadmap/experiment-authoring/README.md
  commit: 44685a9360d68e5d227ac6b758a1e6c993fa464d
kind: roadmap
state: planned
---
# Experiment Authoring

本方向补齐 Experiment 的稳定作者身份与人类可读名称。identity 决定发现、选择和历史关联；display name 只服务展示，不能参与缓存或定位。

## 子方向

- [展示名](display-names/README.md) —— 为列表、运行反馈和报告保存不参与 identity 的稳定名称。
- [具名 Experiment 族](families/README.md) —— 用 keyed record 从一个入口展开多个稳定 Experiment ID。

两者共同约束同一作者面，但可以独立采用：族成员没有展示名时仍以 ID 显示；展示名也不要求入口必须声明多个 Experiment。
