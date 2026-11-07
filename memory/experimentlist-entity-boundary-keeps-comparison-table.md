# ExperimentList 的实体边界不等于卡片布局

**裁决（2026-07-13）**：`ExperimentList` 继续保持“一项一个 experiment、展开到 Eval、Eval 下列出全部 Attempt”的实体语义；web 面使用固定八列 experiment 比较表，列为 Experiment、Model、Agent、Avg duration、Pass rate、Tokens、Est. cost、Result，并提供成功率默认降序、表头排序与文本过滤。web 展开区与 text 面都必须把 Eval 渲染为独立父行，Attempt 用 `├─` / `└─` 子行展开，不能把一对多关系压平为重复 Eval id 的 Attempt 表。text 面先给八列 experiment 比较表，再逐 experiment 给状态、Eval / Attempt、结果、耗时、成本明细表，统一复用标准 text table renderer 做窄屏折行与隐藏列提示。列表只显示 locator 与 verdict，不附加证据能力字母；打开 Attempt 后由 `available` 列出实际可执行的证据命令。内置报告按整份报告回答的问题命名为 `ExperimentComparison`，由成本 × 通过率 `MetricScatter` 与 `ExperimentList` 组成；裸 `show` 与裸 `view` 分别渲染同一 definition 的 text / web 面。散点只有一个可绘实验时仍正常画点，只有零个可绘点才显示缺数据空态。

**被纠正的推论**：`c8a61e2` 用 `ExperimentList` / `EvalList` / `AttemptList` 替换混合实体的 `ExperimentTable`，正确收敛了数据和下钻职责，却把“组件只表达一个实体层级”进一步误推成“web 面也必须是无表头的 flex/card 列表”。结果是默认 view 丢失固定列头、Tokens、判定构成、排序和过滤，多个无标签数字挤在一行，无法完成人工横向比较。

**实现边界**：本次没有恢复旧 `ExperimentTable` API、计算类型或三级混合树。视觉基线复用其删除前版本 `5c973a0a679e505551aba88007f389f9af771e28:src/report/react/ExperimentTable.tsx`、同 commit 的 `src/report/react/styles.css` 与 `enhance.js`；数据仍来自 `ExperimentList.data()` / `ExperimentListItem`，下钻仍使用 `AttemptLocator` 与三个实体列表。组件名规定数据实体，不规定 HTML 必须是 `<ul>` 或视觉必须是卡片。

**护栏**：web 测试必须断言八个列头、默认成功率降序标记、过滤入口、判定摘要、flags、Eval 父行、Attempt 子行连接符和单点散点；text 测试必须断言比较表、明细表、同一 Eval 只出现一次且其多个 Attempt 使用 `├─` / `└─`；宿主测试必须断言裸 `show` 选择 `ExperimentComparison` 而不是另造默认索引。仅断言类名或文本出现不足以防止同类退化。
