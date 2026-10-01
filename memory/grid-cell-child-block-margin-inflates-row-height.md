---
format: concord.document/v1
id: grid-cell-child-block-margin-inflates-row-height
title: 格子里的区块自带 1rem 块间距,每格比内容高出一圈
createdAt: 2026-07-29T13:06:10+08:00
createdAtSource:
  kind: first-recorded
  path: memory/grid-cell-child-block-margin-inflates-row-height.md
  commit: bbd40c22bcedf364909601575159dff12401e8e7
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [grid-cell-child-block-margin-inflates-row-height](grid-cell-child-block-margin-inflates-row-height.md) — 摘要条每格比内容高出一圈:根因是 `Stat` 以 `.niceeval-report` 打底、带着 `margin: 1rem 0` 进格子,格子有 padding 挡住折叠;修为 `.niceeval-grid-cell > .niceeval-report { margin: 0 }`,格内留白只由 Grid 给;单测量不到高度,真实产物截图才看得见"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 格子里的区块自带 1rem 块间距,每格比内容高出一圈

**现象**:摘要条每一格都比内容高出约 32px,矮格底部留一大片空白。散格形态下读成「六张卡各自
没填满」;合并成一片面板后仍然是行高不匀。真实产物上才看得见——单测断言的是结构与文本,不量高度。

**根因**:`.niceeval-report` 带 `margin: 1rem 0`(顶层报告区块之间的块间距),而 `Stat` 渲染的是
`<div class="niceeval-report niceeval-stat …">`。放进格子后这 16px 上下外边距照旧生效,且格子有
padding、margin 不会穿过它折叠,于是每格凭空高出 32px。`Grid` 自己算出来的 `--grid-cell-padding`
是对的,多出来的那一圈不在 Grid 的账上。

**修法**:`src/report/assets/styles.css` 加一条
`.niceeval-grid-cell > .niceeval-report { margin: 0 }`——格内留白由 Grid 给,直接放进格子的区块
不再自带块间距。任何以 `niceeval-report` 打底的组件放进格子都适用,不是给 `Stat` 打的补丁。

同类的下一个候选:别处「容器 padding + 子块 `.niceeval-report` 外边距」的组合都会有这一圈,
看到某块内容莫名比它该有的高一圈时先查这个,不要先去调容器 padding。
相关:[[grid-has-no-props-geometry-single-source]]
