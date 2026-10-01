---
format: concord.document/v1
id: cell-key-must-match-column-set
title: 格子写在没有这一列的 key 上：判定被静默丢掉，两面都不报错
createdAt: 2026-07-30T11:12:01+08:00
createdAtSource:
  kind: first-recorded
  path: memory/cell-key-must-match-column-set.md
  commit: 3cfa79fe4bba6529d964b004c7bc23a50fa325eb
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
    statement: "- 已修 [cell-key-must-match-column-set](cell-key-must-match-column-set.md) — 共用行构造函数把判定写在 key `verdict` 下,而层级表的状态列叫 `record`,attempt 行判定与失败摘要被静默丢成 `—`(真机导出站复现);修为判定长在 locator 格上,并补 CLAUDE.md「key 与消费侧同源」半条规则"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 格子写在没有这一列的 key 上：判定被静默丢掉，两面都不报错

## 现象

网页层级表（`ExperimentTable`）里 passed / failed / errored 的 attempt 行长得一模一样：
状态列恒为 `—`，attempt 的失败摘要也不见了。终端 `niceeval show` 同一份数据看得见判定。
真机复现：MemoryBench 导出站，`@1ck8mbkn` 那行八个格子只有 locator 与耗时，末列 `—`。

## 根因

`experimentListContent` 的状态列 key 是 `record`（实验行、组行填判定构成），
而 `evalRow()` / `attemptRow()` 把判定写在 key `verdict` 下、失败摘要写在 `result` 下——
这两个 key 只存在于 `evalListContent` / `attemptListContent` 的列集里。
`attemptRow()` 被两种列集共用，所以在层级表里它产出的两个格子落到不存在的列上，
渲染面按列集取格、取不到就回落成 `—`。

`cells` 是 `Record<string, Cell>`，key 与列集之间没有类型关系：
写多了不报错，写错名也不报错，`pnpm run typecheck` 全绿。这与
[optional-field-additions-need-call-site-census](optional-field-additions-need-call-site-census.md)
是同一类漏，但方向相反——那条是构造点漏填，这条是构造点填了、消费侧没有对应的列。

## 修法

判定改为长在 locator 格上（`Cell` 的 locator 分支加可选 `verdict`），
web 面输出判定符加 `niceeval-verdict-*` 语义色，text 面在定位符前打同一个判定符：
一个格子跟着行走，不依赖某张表恰好声明了某个列 key。落点
`src/report/definition/cell.ts`、`src/report/definition/primitives.tsx`、
`src/report/components/entity-lists/content.ts`，契约在
[experiment-table.md](../docs/feature/reports/components/summaries/experiment-table.md)。

适用场景：给共用的行构造函数加格子、或给某张表加列时，核对 **key 与列集同源**——
grep 该 key 出现在哪几个列集里，逐个判定「这张表该有这一列吗」。
共用行构造函数被 N 种列集消费时，写进去的每个 key 都要在这 N 份列集里各有交代。

2026-07-30 结构性收口：`validatedTable` 递归校验每行 cells key 集合与列集双向相等
（多写 / 漏写都按完整用户反馈报错），entity-lists 改为 CellBag + 按目标列集裁剪投影，
这类漏从「运气好没暴露」变成「校验必红」。契约在
[table.md「Content 协议」](../docs/feature/reports/components/primitives/table.md)。
