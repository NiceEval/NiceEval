# View 增强

还没定为当前契约的 view 增强提案,见 [Roadmap 约定](README.md)。

### Compare —— 挑两次运行对比

跟 `experiments/compare/`(文档里"一组可对比实验"的示例文件夹名,见 [Experiments](../feature/experiments/library.md#实验怎么组织文件夹--一组可对比的实验))是两回事,别混——这里指 view 里一个新增的小 tab。

**动机:** 报告槽的默认口径是「现刻水位」(对每个实验、每个 eval,从该实验的历史快照里取最新一次判定,跨快照补齐成一份),选不出"这次 vs 上次"。参考对象是 [References](../references.md#vercel-agent-eval--packagesplayground) 记录的 playground `/compare` 页。

**数据模型:** `viewData.snapshots` 已经是**不合并**的快照列表,按 `(experimentId, startedAt)` 索引,每个快照携带 attempt 明细——Compare 需要的历史身份现成保留着。这份数据随 `viewData` 一起烘焙进静态 HTML(不像 playground 能按需查 fs)。

**UI:** 在 `src/view/app/App.tsx` 的 `navItems` 加一个 `compare`。两个下拉选"快照"(`experimentId @ startedAt`,与 Reports 的快照键、`"snapshot"` 维度同一格式),不限制两边必须是同一个 `experimentId`;选完出整体通过率 / 平均耗时 / 总成本三个 KPI delta,加一张 per-eval 并排表,表格与 delta 单元直接用 Reports 的 `DeltaTable`(时间轴对比走快照键)。只跑过一次、没有历史快照时,下拉只有一项,提示"再跑一次才能对比",不报错。

**明确不做的:** 不做时间序列折线图(历史快照一多不适合塞进单个静态 HTML,而且这次要补的是"挑两点"这个最小能力);不改报告槽「现刻水位」的默认口径。

### Eval 目录页

独立于"跑过的结果",单纯浏览 `evals/` 目录下每个 fixture 的 `PROMPT.md` 和文件列表,不用先跑一次才能看"有哪些 eval、prompt 写的什么"(learnings 见 [References](../references.md#vercel-agent-eval--packagesplayground))。没有具体设计,优先级低于 Compare。
