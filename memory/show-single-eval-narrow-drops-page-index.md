---
format: concord.document/v1
id: show-single-eval-narrow-drops-page-index
title: show-single-eval-narrow-drops-page-index
createdAt: 2026-07-22T08:08:25+08:00
createdAtSource:
  kind: first-recorded
  path: memory/show-single-eval-narrow-drops-page-index.md
  commit: 4de42b0162238fb9d0583f6df47d8bca1f2d732d
description: 位置参数把 show 收窄到恰好 1 个 eval 时，报告页切换成单题详情视图，尾部完全不附「Other pages」多页索引
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

**现象**：`niceeval show <多个 eval 都命中的前缀> --results <root>` 会在尾部打印
`Other pages:` 索引块（列出未渲染的 attempts/traces 页及可复制命令，见
`docs/feature/reports/show/reports.md` Case 2）。但换成一个**恰好只命中一个 eval**
的前缀（如仓库里唯一以 `tool-call` 开头的 eval），输出变成一段完全不同的单题详情视图
（题描述 + 该题下各 experiment 的 attempt 明细 + `artifacts:`/`attempt locator:`/`next:`
三行），从头到尾没有 `Other pages:` 索引块。

**根因**：`ExperimentComparison`（内建 report 页的主体）的 text 面在当前 Scope 只剩
一个 eval 时会自动"钻进"这道题的聚焦视图，这是一个真实存在、文档未单独章节化的展示
分支，不是页索引逻辑的 bug——只是这个分支恰好没有走到追加页索引的代码路径。

**修法/适用场景**：写 E2E 断言（`show --page` 相关的多页索引验收）时，选用一个会命中
**多个 eval** 的前缀（或干脆不收窄）来触发标准报告页 + 页索引的正常路径；只有测「单
eval 聚焦视图长什么样」这件事本身时才特意用单 eval 前缀，且不要断言它也带页索引。
已知会踩这个坑的场景：`e2e/report/scripts/verify-readback.ts`（B2，测 `--page`
索引命令），后续 B3（渲染结构/排版）、B5（自定义报告多页验收）如果也用位置参数收窄
到单一 eval 再检查页索引，会复现同一个"断言失败但其实是正常分支"的困惑。

## 已失效（2026-07-24 复核）

现象消失，但不是被修的——承载它的那条分支随 show 管线重写整个没了。判据：
`src/show/index.ts` 里已找不到任何「Scope 只剩一个 eval 就换渲染分支」的判定
（`length === 1` 只出现在无关的 per-attempt 折叠与 usage 表头复数处理上）；页索引尾块
现在是无条件的——只要 `report.pages` 里还剩可导航的其它页就追加 `otherPagesText`
（`src/show/index.ts:1138-1149`），与收窄到几个 eval 无关。背景是
[show-slices-are-components-ruling](show-slices-are-components-ruling.md)：show 切片收敛为
报告组件装配，「自动钻进单题聚焦视图」这种隐式分支不再存在。

写 `--page` 相关 E2E 断言时的选前缀建议因此作废；但**反过来仍值得留意**——现在单 eval 前缀
也会走标准报告页，如果某条老断言是按「单 eval = 聚焦视图」写的，它现在测的是另一样东西。
