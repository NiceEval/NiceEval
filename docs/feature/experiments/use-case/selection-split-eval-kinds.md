---
format: concord.document/v1
id: selection-split-eval-kinds
title: 拆开通过制与计分制 Eval
createdAt: 2026-07-27T18:06:13+08:00
kind: use-case
feature: docs/feature/experiments/README.md
---

# 拆开通过制与计分制 Eval

一个 Experiment 的实际选择只能全是 `defineEval`，或全是 `defineScoreEval`。通过率与 earned score 没有共同单位，
同时命中两类 Eval 时，`niceeval check`、`niceeval exp --dry` 与普通运行都会在创建 Agent、Sandbox 或 Record 前拒绝，
并分别列出两类 Eval ID。

按 tag、路径前缀或 `evaluationKind` 谓词拆成两个 Experiment 文件。两份文件可以复用同一个 Agent factory、flags 构造函数、
预算或并发常量；共享配置不要求共享 Experiment identity。
语义见[计分粒度](../../assertions/library/score-points.md)。
