---
format: concord.document/v1
id: attempt-source-visual-aligns-landing-e2e-owns-styles
title: attempt-source-visual-aligns-landing-e2e-owns-styles
createdAt: 2026-07-20T13:05:32+08:00
createdAtSource:
  kind: first-recorded
  path: memory/attempt-source-visual-aligns-landing-e2e-owns-styles.md
  commit: 3fe97543e5a060141624bc817f4ea23bdedb2d71
description: 裁决:AttemptSource 与 landing 示例卡定为同一视觉语言的两份实现(不共享组件),样式守护从单元层移交 e2e 真实浏览器
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---

**裁决（2026-07-20）**：`AttemptSource` web 面与 landing eval 示例卡
（`site/components/site-home-setup.tsx` + `globals.css` 的 `.eval-code` 族）定为**同一视觉
语言的两份实现**，规范落成 `docs/feature/reports/library/attempt-detail.md`「AttemptSource
web 面视觉规范」（8% 浅染整行 + 2px 左缘、行号位图标顶替行号、sticky 右缘 meta、展开区按
cqw 换行并钉滚动视口左缘、vsDark 系暗色 token）。同批把样式/视觉守护从单元层移交
[E2E 报告域](../docs/engineering/testing/e2e/report.md)真实浏览器验收：删除
`view-report.test.ts` 的 JSDOM computed-style 守护与 `attempt-components.test.tsx` 的
markup 断言（保留 `attemptSourceData` 的 loc 投影 data 级断言），jsdom devDependency 移除。

**曾选方案 1：把 EvalCard 提为共享组件给 `AttemptSource` 用。** 否决理由：
- EvalCard 是 `"use client"` + `useState` 交互，attempt 文档契约是零 JS 静态成立（原生
  `<details>`），共享组件必须重写成第三种东西；
- `dist/report` 是 tsc 编译不打包，import 即发布运行时依赖，EvalCard 依赖
  prism-react-renderer + lucide-react；
- 数据方向相反：EvalCard 的 `highlights`/`notes` 是策划数据的删减形，`AttemptSourceData`
  （一行多断言、四 tone、unmapped/unlocated）才是超集；
- 主题体系不同：landing 暗色单主题品牌色，报告 CSS 必须 `light-dark()` 双主题。

**曾选方案 2（前一轮修法）：JSDOM computed-style + markup 断言守样式。** 否决理由：
JSDOM 只能证明「selector 有规则」，拦不住观感回归——本次「整行 42%/66% 饱和染色 vs 规范
8% 浅染、独立圆圈状态列、meta 不 sticky、展开区跟随横滚」正是在这些测试全绿下存在的。
视觉验收改由 e2e 用真实浏览器做（results 仓库验收计划第 5 条）。

**背景**：`421474f` 弄坏代码视图（见
attempt-detail-components-shipped-without-styles.md），`b34a243` 修回了结构与交互但视觉
仍偏离 landing 语言；本次按定稿规范重写 `src/report/assets/styles.css` source 区并把
`StatusMark` 并入行号位（`AttemptSource.tsx` 的 `LineNo`，内联 SVG 图标）。
