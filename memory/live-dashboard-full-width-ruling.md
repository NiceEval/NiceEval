---
format: concord.document/v1
id: live-dashboard-full-width-ruling
title: 裁决:live 面板默认占满终端全宽,ACTIVE 身份列按内容定宽、detail 拿走其余全部
createdAt: 2026-07-23T10:32:20+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-dashboard-full-width-ruling.md
  commit: 51a98f609091e8d9a784e7debcee93a31cb47fc3
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
# 裁决:live 面板默认占满终端全宽,ACTIVE 身份列按内容定宽、detail 拿走其余全部

**日期**:2026-07-23(用户裁定「默认占满,把细节尽可能的展示出来」)

**裁决**:

1. **宽度**:live 面板(原地重绘、从不进入 scrollback)豁免区域框 100 列上限,默认跟随终端全宽;`PLAN` / `FAILURES` / 结束面板等进 scrollback 的照旧封顶 100——上限是阅读宽度规则,对仪表不适用。
2. **列分配**:ACTIVE 行列序 `● eval id  experiment  elapsed  phase/detail`;身份两列按**实际出现过的最长值**定宽(不垫空格、只放宽不回缩、各封顶内容宽 40% / 20%、截尾补 `…`),剩余宽度全部给 detail——detail 是这行存在的理由,任何一帧不许被挤没。
3. **行框同宽纪律**:行内容与外框必须按同一个宽度值计算,写进 layout.md 几何契约——这正是 [live-dashboard-active-row-width-clamp-mismatch](live-dashboard-active-row-width-clamp-mismatch.md) 的根因类别。

**曾选方案与否决理由**:

- **保持 100 上限、只修钳制接线**——修完 detail 也只有 ~20 列可见,用户明确要「把细节尽可能展示出来」,宽终端的列空着不用没有收益;否决。
- **身份列固定比例(55/45)分配**——短 id 垫空格,空白全是 detail 本可用的宽度(用户截图里的大段空白);否决。
- **列宽整场按计划集合预算定**——需要 plan 数据穿进 renderer,复杂度高于「见过的最长值单调放宽」且收益只是前几帧更稳;否决,取单调放宽方案(帧间同样无抖动)。

文档落点:`docs/feature/experiments/cli.md`「框线体裁」「运行中的 live 面板」、`docs/feature/reports/library/layout.md` 几何段;实现 TODO 在 `plan/live-dashboard-full-width-detail.md`。
