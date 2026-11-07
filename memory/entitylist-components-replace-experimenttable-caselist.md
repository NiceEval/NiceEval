# 设计裁决:实体列表 ExperimentList/EvalList/AttemptList 取代混合实体的 ExperimentTable + CaseList + MetricTable.expand

**裁决**(2026-07-12):报告组件里"从聚合下钻到 Attempt 证据"这条路径收拢成三个组件,每个对应一个实体层级——`ExperimentList`(每项一个 experiment)、`EvalList`(每项一个 experiment × eval)、`AttemptList`(每项一个 Attempt)。三者都用既有 `defineComponent({ resolve, web, text })` 机制(该机制本身不变、已实现),`.data(selection)` 返回普通、可 `.filter()`/`.slice()` 的 JS 数组(`ExperimentListItem[]` / `EvalListItem[]` / `AttemptListItem[]`),报告作者用原生数组方法收窄展示范围,组件不提供查询 DSL,不静默丢弃传入项。`MetricTable` 收窄回「纯维度 × 指标」,不再承担实体下钻职责,`expand`/`TableSubRow` 一并删除。

**曾选方案**:
- 混合实体的 `ExperimentTable`——单个组件内嵌 `ExperimentRow → ExperimentDetail → EvalRow → Attempt` 四层折叠树(`d0b6718` 引入)。
- 独立的 `CaseList` 板块,报告尾部单独列失败/通过 Attempt 清单,与聚合表格分开摆放。
- `MetricTable.data` 的 `expand` 选项 + `TableSubRow`(2026-07-11 才定案,见 [[metrictable-expand-replaces-default-report-caselist]]):给榜单表格加第三种子行展开机制,在 experiment 行下面展开这个实验的逐题明细,用来取代 `CaseList`。

**否决理由**:三个机制各自认领了「从聚合下钻到 Attempt 详情」这件事的一个局部切面,却互相重叠又互不统一——`ExperimentTable` 把三级实体嵌进同一个组件自己的折叠树里;`CaseList` 是脱离聚合表格、单独放的失败清单;`MetricTable.expand`/`TableSubRow` 是给任意维度表格加的第三种子行下钻,`meta.subRows` 又只是 `TableRowMeta` 上的附属字段。三套各有一套「一行/一项代表什么」的语义,每次要展示"这一层实体的固定事实"都要在三个地方里选一个,行为还不保证一致。收拢成「每个实体层级正好一个组件」后,`ExperimentList`/`EvalList`/`AttemptList` 各自展示该层级的固定身份事实(judgement、原因摘要、evidence capability),`MetricTable` 只剩「任意维度 × 任意指标」——实体列表与指标表两类职责不再共享同一个组件,也不用同时维护三套下钻机制。

**日期**:2026-07-12。设计出处:`plan/attempt-evidence-feedback-loop.md`。这次决定推翻了仅一天前(2026-07-11)才定案的 `MetricTable.expand` 方案(见 [[metrictable-expand-replaces-default-report-caselist]]),连同它当时取代的 `CaseList` 一并被 `AttemptList` 取代,`ExperimentTable` 同批删除。

**已实现**(2026-07-12,同日):`src/report/types.ts`(三个 `*ListItem` 类型)、`src/report/compute.ts`(`experimentListData`/`evalListData`/`attemptListData`)、`src/report/components.tsx` + `src/report/react/{ExperimentList,EvalList,AttemptList}.tsx` + `src/report/text/faces.ts`(双面组件)、`src/report/built-ins/cost-pass-rate-comparison.tsx`(默认报告改用 `ExperimentList`)。初版还把证据可用性复制进 `AttemptListItem` 并渲染成字母缩写；该字段和展示后来一起删除，列表只保留 locator，证据页按实际 artifact 列出可执行命令。
