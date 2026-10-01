---
format: concord.document/v1
id: experimentlist-text-column-order-and-wrap-instability
title: experimentlist-text-column-order-and-wrap-instability
createdAt: 2026-07-22T08:50:49+08:00
createdAtSource:
  kind: first-recorded
  path: memory/experimentlist-text-column-order-and-wrap-instability.md
  commit: 031ce196afdc67380ab6ccbeb8308168b74ee9bc
description: ExperimentList 的 text 面真实列顺序是 Results 排在 Tokens/Cost 之前,与
  entity-lists.md 自己给的 ASCII 范例(Tokens/Cost/Results)不一致;哪个单元格在 width 80
  折行也随其它单元格的真实数值内容变化,不是固定的某一列
kind: memory
memoryKind: insight
state: captured
epoch: 0
promotions: []
history: []
---

**现象一（doc/code 列顺序不一致）**：`docs/feature/reports/library/entity-lists.md` 里
`ExperimentList` 的 web 列表格与紧随其后的 text 面 ASCII 范例都把列顺序写成
`Experiment | Model | Agent | Avg. time | Pass rate | Tokens | Cost | Results`（Results
在最后）。但用当前 HEAD 真实跑 `niceeval show`（`e2e/report/` 的真实 3-Experiment 结果），
无论 en 还是 zh-CN，text 面表头都是：

```
Experiment  Model  Agent  Avg. time  Pass rate  Results  Tokens  Cost
```

`Results` 排在 `Pass rate` 之后、`Tokens`/`Cost` 之前——用宽 pty（160 列）复核过，不是窄终端
折行/丢列造成的错觉，是真实、稳定的渲染顺序。这次任务（e2e/report B3 渲染面验收）没有去改
`entity-lists.md` 或 `src/report/components/entity-lists/ExperimentList.tsx`——修哪一边（文档
补「text 面列序其实是…」还是代码改成和文档一致）没有定论，留给下一个碰到这块的 A 阶段/设计
agent 裁决；这里只记现象，避免下一个人重新排查一遍。

**现象二（折行随内容漂移，非固定列）**：同一张表在 CLI 非 TTY 回退宽度（80 列，`show` 没有
`--width` flag，`process.stdout.columns` 拿不到时硬编码回退到 80）下哪个单元格换行，**不是
固定的某一列**——8 列共享 80 列预算，分配算法会依据当次真实的 duration/tokens/cost 文本长度
（这些都是真实网关调用产出的、逐次运行会变的数字）重新分配空间。同一份代码、同一份三态证据，
在不同真实运行里观察到过：`results-mechanism`（Agent 列）有时整段不折行，有时折成
`results-` + `mechanis` + `m` 三行；`deepseek-chat`（Model 列）同理。**真正稳定折行的只有
`deliberate-error`/`deliberate-fail` 这两个 Experiment id**——它们是 17/16 字符的固定字符串，
在任何观察到的真实运行里都放不进给 `main`（4 字符）共享的 Experiment 列宽度，必定折成
`delibera` + `te-error`/`te-fail`。写 E2E 断言时用这两个固定 id 的折行做「Table 折行机制生效」
的证据，不要断言 Agent/Model 这类列「一定」折行或「一定」不折行。

**现象三（聚合值可以是小数）**：`ExperimentList`/`ScopeSummary` 的 `tokens` 是跨 attempt 聚合
的显示值，真实观察到过 `804.5 tokens` 这种非整数（2 个 attempt 的真实 token 数取平均，奇偶不
一定整除）。断言 tokens 时正则要留 `(?:\.\d+)?`，不要假设恒为整数。

**修法/适用场景**：`e2e/report/scripts/verify-render-structure.ts`（B3）已经按这三条踩坑点写：
列顺序断言只认「按已知列名找到该值」，不依赖固定左右位置；折行断言只锚定
`deliberate-error`/`deliberate-fail` 这两个恒定 id；数值正则统一允许小数。后续给 `show`/`view`
文本面写新的 E2E 断言时，同样别把「这次真实运行观察到的具体折行/顺序」当成契约本身——契约以
`docs/feature/reports/library/` 为准，观察到偏差就记在这里或推回裁决，断言只锁「机制在生效」
这类不随具体数值变化的事实。
