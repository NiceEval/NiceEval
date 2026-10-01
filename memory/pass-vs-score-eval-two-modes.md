---
format: concord.document/v1
id: pass-vs-score-eval-two-modes
title: 裁决：两种题型 defineEval/defineScoreEval，计分制叠加给分无满分，实验内不混型
createdAt: 2026-07-22T11:45:06+08:00
createdAtSource:
  kind: first-recorded
  path: memory/pass-vs-score-eval-two-modes.md
  commit: 6a9011c66f9efeff8709fb58768fb75f5bb89392
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history:
  - at: 2026-09-14T15:00:25.173Z
    action: revise
    reason: "- 给分词汇与 strict 部分被新裁决替代
      [pass-vs-score-eval-two-modes](pass-vs-score-eval-two-modes.md) —
      裁决(2026-07-22 定稿):两种题型 defineEval/defineScoreEval
      与叠加给分无满分继续保留；`.points`、severity 与 strict 由 Evaluation Fact 新模型替代"
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
    eventAt: 2026-07-22
---
# 裁决：两种题型 defineEval/defineScoreEval，计分制叠加给分无满分，实验内不混型

**日期**：2026-07-22（一天内四轮迭代定稿，前三轮见「曾选方案」）

**裁决**（契约落 `docs/feature/experiments/score-points.md`，题型形状落 `docs/feature/eval/README.md`）：

1. **题型是定义函数**：`defineEval` = 通过制（一题一分，读通过率）；`defineScoreEval` = 计分制（题内叠加挣分，读总分）。题型进 `EvalDescriptor.scoring`（`"pass" | "points"`），发现期可知——榜单列形态、errored 时分数显示 null 还是不参与，都不依赖执行 `test()`。
2. **计分制 = 叠加制、无满分声明**：分从 0 往上挣、分值非负、不做扣分。给分词汇仅两个且只在 score eval 的 `t` 上（通过制里写给分是类型错误）：`.points(n)` 断言条件给分（judge 按连续分比例挣 `n × score`）、`t.score(label, n)` 自算后直接累加。对比是相对的（同一 eval 代码 = 同一把尺子），不需要分母；不声明满分也就没有「Σpoints 与声明对不上」要守护。
3. **前置中止挣 0，基础设施 errored 得 null**：`t.require` 挂了后面给分代码不执行、分自然没挣到（agent 的责任）；沙箱炸/judge 缺 key 整题分数 null 不折 0。
4. **实验内不混型**：通过率与总分不能相加，混型选择是启动期配置错误（列两类 id、给收窄建议）；两类都跑写两个实验文件。与 keep×reuse、异构沙箱批次同一「异构组合创建前报错」风格。
5. 判定面（verdict 四态、severity 边属性、--strict 全层同一旋钮）、质量分（soft 无权均值）、得分点 = 组（groupPath 字面对齐、共享函数约定）不变。

**曾选方案（同日连环翻案，各自的否决理由）**：

- ~~severity 当单分/多分开关~~（上午）——见 [severity-is-single-vs-multi-score-switch](severity-is-single-vs-multi-score-switch.md)；装不下自定分值 rubric。
- ~~`defineEval({ score: n })` 满分声明 + `.points` 分值 + Σpoints 完整性守护~~（下午一轮）——用户否决上限声明：对比是相对的不需要分母，满分声明与守护是官僚机制；给分改为 t API 纯累加。
- ~~计分制靠用法推断（用了给分 API 就是）~~（下午二轮）——发现期不可知：题目早挂时无法回答「这题参与总分列吗」；且类型面无法把给分词汇挡在通过制外。
- ~~混型横截面「通过制 = 挣 1 分退化态」参与总分~~（下午二轮）——那个 1 分是数学凑巧不是作者声明的分量，混合总分语义虚；改为实验内同型强制。

**教训**：先写 use case 再反推 API（用户方法论）连续两轮直接暴露了纸面设计的洞——「满分声明」在 use case 里写起来就是多余步骤，「用法推断」在 errored 场景一问就穿。
