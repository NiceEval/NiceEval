---
format: concord.document/v1
id: details-ua-slot-breaks-display-contents-tabs
title: "`<details>` 的 UA shadow slot 让 display:contents 布局失效"
createdAt: 2026-07-16T16:18:50+08:00
createdAtSource:
  kind: first-recorded
  path: memory/details-ua-slot-breaks-display-contents-tabs.md
  commit: 3a21458f0679ab66f94b76dd7674da7bf1cdfdb3
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---
# `<details>` 的 UA shadow slot 让 display:contents 布局失效

**现象**：Tabs 渐进增强想用 `display: contents` 让 `<details>` 的子元素直接参与外层 flex 布局（收起 tab 只留标题、展开 tab 换行到下方）。Chrome 实测：子元素的 `order` 不生效，收起的面板残留一个 0 宽的盒子。

**根因**：`<details>` 内容经 UA shadow DOM 的 slot 分发，slot 本身成为 flex item；`display: contents` 只展开元素自己的盒，穿不透 UA slot 这一层，子元素因此不是外层 flex 容器的直接 item。

**修法**：不用 `display: contents`。增强态（`:root.nre-js`）下收起的 `.nre-tab` 缩成首行标题（hairline 下划线），展开的 tab 用 `flex: 1 1 100%; order: 1` 整块换行到 tab 条下方。落点 `src/report/react/styles.css`（Tabs 分区，代码注释里也记了一句）。适用场景：任何想把 `<details>` 组排成单选 tab 条的布局。
