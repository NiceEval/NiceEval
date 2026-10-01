---
format: concord.document/v1
id: metrictable-expand-replaces-default-report-caselist
title: metrictable-expand-replaces-default-report-caselist
createdAt: 2026-07-11T19:39:45+08:00
createdAtSource:
  kind: first-recorded
  path: memory/metrictable-expand-replaces-default-report-caselist.md
  commit: 337d73565f838e93b70fd966aea68f77b9db2cd5
description: 设计裁决——defaultReport 榜单加 MetricTable.data 的 expand
  选项展开逐题明细,取代裸跑报告尾部单独的 CaseList 板块
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---

**裁决**(2026-07-11):`defaultReport`(`src/report/default-report.tsx`,`niceeval view`/`show`
裸跑填充)的榜单 `MetricTable.data(...)` 加 `expand: "eval"`,每个 experiment 行可展开看这个实验
下每道题的判定/原因/同一套指标列;报告尾部原来的独立 `<CaseList data={...} />` 板块删除。

**曾选方案**:保留 `CaseList` 板块不动,失败原因继续集中在报告最下方单独列一遍。

**否决理由**:用户明确要求"实验应该要能点开看 eval,不能分开放"——把某个 experiment 下失败的题
单独摆到页面另一处(哪怕带 `attemptHref` 深链),割裂了"看这个实验的成绩单"与"看它为什么挂"
这两件事本该在一起看的信息;这正是 d0b6718(2026-07-10 report/view 大重构)删掉旧手写
`ExperimentTable`(`ExperimentRow → ExperimentDetail → EvalRow → Attempt` 四层折叠)时丢掉的交互,
新架构补回来才算功能对齐旧页面,不是纯审美调整。

**实现要点**(供后续复盘这个修法是否合理):
- `MetricTable.data` 新增 `expand?: DimensionInput` 选项,不限定 `rows` 必须是 `"experiment"`——
  `TableSubRow` 的 `verdict`/`reason`/`ref`/`runs`/`passedRuns` 对任何展开维度都成立(不是
  eval 维度专属),`cells` 复用与父行同一套 `columns` 在子群体上重算,渲染面直接复用
  `MetricCellView`,子行不是另一种展示。类型见 `src/report/types.ts` 的 `TableSubRow`。
- web 面展开明细用原生 `<details>`(`src/report/react/MetricTable.tsx` 的 `SubRowsDetail`),
  零 JS 也能点开,符合「静态 HTML 内容完整可读」的硬约束;不需要给 `enhance.js` 新增点击处理。
- 但 `enhance.js` 原有的排序(点表头)与过滤(输入框)逻辑按"每个 `<tr>` 独立处理"写的,加了
  展开明细行(`.nre-subrows-row`)后会把它当成普通行参与排序/过滤,导致明细行跟丢父行(排序时
  因为没有 `data-sort-value` 沉到表尾)或独立于父行被隐藏/显示(过滤时按自己的文本内容匹配)。
  两处都改成「主行 + 紧随其后的展开明细行」成对处理,详见 `enhance.js` 里
  `nre-subrows-row` 相关注释。**教训**:给报告表格加任何新的行类型,都要检查 `enhance.js`
  的排序/过滤是不是假设了"每个 `<tr>` 都是独立、可排序、可过滤的主行"这个前提。
- text 面(`niceeval show`,`src/report/text/faces.ts` 的 `tableText`)对应产出:表格本体不变,
  失败/错误的子行渲染成父行下面缩进的明细块(`✗ <id> — <reason>` + `→ niceeval show <id>`),
  取代了原来单独调 `caseListData`/`caseListText` 产出的尾部清单。
- `<DefaultReport />`(大写,`src/report/official-report.tsx` 里给用户在自己报告里当锚点用的
  「官方水位」)**没有改**——它的失败清单仍然是 `CaseList`,这是两个不同的导出
  (`defaultReport` 小写是裸跑填充物,`<DefaultReport />` 是可选摆件),改的范围只到裸跑那一份。
- 文档同步:`docs/reports.md`(`expand` 选项说明)、`docs/view.md`(统计层计算函数表)、
  `docs-site/{zh/,}guides/report-components.mdx`(`MetricTable` 组件用法)、
  `docs-site/{zh/,}guides/custom-reports.mdx`(defaultReport 形态一句话描述)、
  `docs-site/{zh/,}guides/viewing-results.mdx`(`niceeval show` 默认报告示例块,用真实
  `niceeval show --run <fixture>` 输出转录,不是手写猜的格式)。
