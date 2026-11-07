# eval-header-historical-mark-shifts-grid-columns

## 现象

ExperimentList 展开区里,某个 Eval 的**全部 attempt 都是历史执行**(纯携带的题)时,该 Eval 父行整体错位:`↩ <时距>` 占了「n 次 attempt」的格子,attempt 数占了 rollup 的格子,「平均耗时 · 平均成本 · 分」的 rollup 摘要被挤进下一行 20px 宽的判定符列,叠加 `overflow-wrap:anywhere` 后逐字竖排。有新执行的 Eval 行(标注不渲染)完全正常,所以常规冒烟看不到。

## 根因

`.nre-experiment-eval-header` 是**按位置取列的 4 轨 grid**(`styles.css` `grid-template-columns:20px minmax(220px,1fr) minmax(150px,.7fr) minmax(260px,1fr)`),假定恰好 4 个直接子元素。落地 commit `99639f9` 把 `<EvalHistoricalMark>` 作为**条件渲染的第 5 个直接兄弟元素**插在题目名和 attempt 数之间——把 docs 契约「在题目名后标」(布局语义:与题目名同格行内)误译成了 JSX 兄弟顺序。

同一个 commit 里另两处用法对比很说明问题:EvalList 父行同样裸插兄弟元素但容器是 `flex-wrap`,碰巧成立;ExperimentList 的 attempt 子行(同一个 4 轨 grid)则做对了——`HistoricalMark` 嵌进已有的 `.nre-eval-attempt-badges` 包装 span。eval 父行没有现成包装,照抄了 flex 容器里成立的写法。docs(entity-lists.md「时效标注」)与 plan(provenance-over-warnings.md)本身无误。

## 修法

把标注嵌进题目名的格子:`<span className="nre-eval-id">{row.evalId} <EvalHistoricalMark …/></span>`(`src/report/components/entity-lists/ExperimentList.tsx` 的 `EvalAttempts`),与 docs「在题目名后」字面一致。改完须 `pnpm run build:report`(见 [[report-src-changes-need-dist-rebuild]])。

通用教训:**固定轨数、按位置取列的 grid 里不能裸插条件渲染子元素**——多一个子元素不会报错,只会让后续格子静默移轨。往这类容器里加条件元素时,要么嵌进既有格子的包装元素,要么显式 `grid-column` 定位。触发条件依赖数据形态(全携带的题)的布局 bug,text 面/数据面测试都盖不住,web 面缺布局守护是它漏网的另一半原因。
