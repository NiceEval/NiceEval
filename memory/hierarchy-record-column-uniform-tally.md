# 设计裁决:层级表判定构成列不引入 `k/n 通过` 分数形态,每层统一计票/单判定

## 裁决

`ExperimentTable` 层级表(experimentListContent)的判定构成列(`record`)每层都有值,
形态只复用既有两种:有子行的行填判定计票(`1 通过 · 1 失败`,逐票语义色),
attempt 叶子行填单判定(判定符 + 判定词)。没有层级特例组件或特例 Cell 形态,
Table 无逻辑、只按列集显示投影传入的值。契约在
[experiment-table.md](../docs/feature/reports/components/summaries/experiment-table.md)。

## 曾选方案(2026-07-30 同日否决)

Eval 行显示 `✓ 1/2 通过` 分数格:折叠判定 + attempt 计票同格,`verdict` 与 `counts`
同时在场时渲染成 pass@n 分子分母,整格取折叠判定语义色。已实现到两面渲染器后被用户否决。

## 否决理由

- 分数形态是第三种显示形态,和 experiment 行/摘要卡已有的计票词表(`n 通过 · m 失败`)并存,
  同一列两套读法;计票 + 逐票颜色已经表达了构成,分数没带来新信息。
- 「verdict + counts 同在」这个判别落在渲染器里,等于把「这是 Eval 行」的层级语义
  塞进了 Table/Cell 渲染面,违反「组件逻辑无关,只显示外面传进来的值」——
  显示什么由 ExperimentTable 的投影决定,不由格子形态推断。

## 顺手修正(保留)

- text 面 `formatCellText` 的计票与单判定改按 locale 取判定词(原来裸打英文 kind),
  单判定补 `verdictMark` 判定符,与 locator 格同一纪律。
- web 面单判定格判定符统一走 `verdictMark` 单源(errored 原来错并成 `✗`,现为 `!`)。
- 落点 `src/report/components/entity-lists/content.ts`(evalRow/attemptRow 补 `record` 格,
  `tallyVerdicts` 通用化)、`src/report/definition/cell.ts`、`src/report/definition/primitives.tsx`。

适用场景:再想给某层行加"更聪明"的专属显示形态时,先问一句能不能用既有 Cell 形态
由投影填出来;判别新形态的条件如果要读两个字段的组合,大概率是把行语义漏进了渲染面。
