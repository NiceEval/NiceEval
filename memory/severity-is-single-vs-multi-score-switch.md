---
format: concord.document/v1
id: severity-is-single-vs-multi-score-switch
title: 裁决（已被同日后续裁决替代）：severity 当单分/多分开关
createdAt: 2026-07-22T11:45:06+08:00
createdAtSource:
  kind: first-recorded
  path: memory/severity-is-single-vs-multi-score-switch.md
  commit: 6a9011c66f9efeff8709fb58768fb75f5bb89392
kind: memory
memoryKind: decision
state: superseded
epoch: 0
promotions: []
history:
  - at: 2026-09-14T15:00:25.173Z
    action: supersede
    reason: "- 已被同日裁决替代
      [severity-is-single-vs-multi-score-switch](severity-is-single-vs-multi-sc\
      ore-switch.md) — 裁决(2026-07-22 上午):severity 当单分/多分开关;装不下自定分值 rubric
      被下条替代,但「gate 不进质量分」「soft 无权均值」「组 gate 读数=失败定位」被继承
      [pass-vs-score-eval-two-modes](pass-vs-score-eval-two-modes.md)"
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
    eventAt: 2026-07-22
supersession:
  statement: "- 已被同日裁决替代
    [severity-is-single-vs-multi-score-switch](severity-is-single-vs-multi-scor\
    e-switch.md) — 裁决(2026-07-22 上午):severity 当单分/多分开关;装不下自定分值 rubric
    被下条替代,但「gate 不进质量分」「soft 无权均值」「组 gate 读数=失败定位」被继承"
  source:
    path: memory/INDEX.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 裁决（已被同日后续裁决替代）：severity 当单分/多分开关

**日期**：2026-07-22 上午。**替代者**：[pass-vs-score-eval-two-modes](pass-vs-score-eval-two-modes.md)（同日下午定稿）。

**当时的裁决**：计分粒度按「severity 即单分/多分机制」定稿——gate 折叠成榜单那一分，soft 断言按 `t.group` 组名聚成得分点（组软分 = soft 断言无权均值）。

**为何被替代**：用户下午给出三模型框架（通过制 / 检查点制 / 计分制）后暴露此设计装不下「部分完成给部分分」「rubric 自定分值」——soft 均值天然等权且归一化，表达不了「正确性 60 分、精简 20 分」这类作者声明的分量。最终形态是独立题型 `defineScoreEval` + 叠加给分，见替代条目。

**本条仍然有效的部分**（被最终设计继承）：

- gate 不进质量分/软列——10 条全过 gate + 一个 0.6 judge 均值 0.96，质量差被淹没（当日上午同场翻案「gate 0/1 进软列均值」的理由，最终设计沿用）。
- 质量分 = soft 断言无权均值：过线比例是均值对 0/1 分数的退化情形；默认加权是替作者发明无原则化取值的参数。
- 组级 gate 读数是失败定位不是分。
- 否决过线比例、severity 加权、`t.scorePoint()` 新 API。
