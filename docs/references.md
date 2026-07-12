# References —— 从其它项目学到什么

已经落地的借鉴大多分散记在各篇文档自己的"来源"脚注里(比如 [README](README.md) 的整体形状借鉴、[assertions.md](assertions.md#来源) 里逐条断言标来源、[experiments.md](experiments.md#从agent-eval砍掉了什么以及为什么) 里 `defineExperiment` 对照 agent-eval 的 `ExperimentConfig`)。这篇文档不重复那些,专门记录**调研某个外部项目时学到的东西**——抄了什么、还没抄但值得抄什么、调研过判断不值得抄的及理由——方便以后再研究别的项目时按同样的格式续写,也方便回头核对"这个设计当初是照着谁的形状定的"。

每次调研一个外部项目开一个二级标题,格式固定:是什么 → 已经借鉴的 → 这次新学到、值得抄的 → 调研过但不打算抄的(及理由)。

## Vercel agent-eval —— `packages/playground`

**来源路径:** `/Users/ctrdh/Code/agent-eval/packages/playground`(本机另一个项目,不在这个仓库里,记路径方便下次再核对实现有没有变)。

**是什么:** `@vercel/agent-eval-playground`,独立发布的 Next.js 结果查看器。零数据库、零 API 路由——所有页面是 Server Component,`lib/data.ts` 直接 `fs.readdirSync`/`readFileSync` 读 `results/`(实验结果)和 `evals/`(eval fixture)两个目录,`force-dynamic` 保证每次请求都读最新的盘上数据。CLI(`bin.mjs`)把目录路径塞进环境变量后 `spawn` 包内置的 `next start`。

### 已经借鉴的(更早调研,已经在别处记过来源)

`niceeval view` 本身("本地结果查看器")、sandbox / diff 的工程形状、transcript 归一化与可观测、experiment 层——这些在 [README](README.md#niceeval-是什么) 和 [source-map.md](source-map.md) 里已经标了来源,这里不重复。

### 这次新学到、值得抄的

1. **`/compare`——挑两次运行对比。** playground 靠 `results/<experiment>/<ISO-timestamp>/` 天然分层的目录结构,能选任意两个时间戳的 run,对比整体通过率 / 平均耗时 / per-eval 通过率 delta。niceeval 调研时完全没有这个能力——当时的 `aggregateRows` 把所有历史 run 合并成一行,选不出"这次 vs 上次"(2026-07 统计层收编后结果快照身份已保留进 viewData,Compare 只差 UI)。这只是 view 里计划新增的一个小 tab,设计方案见 [View · Compare](view.md#compare-挑两次运行对比)。
2. **eval fixture 目录页(`/evals`)。** 独立于"跑过的结果",单纯浏览 `evals/` 目录下每个 fixture 的 `PROMPT.md` 和文件列表,不用先跑一次才能看"有哪些 eval、prompt 写的什么"。niceeval 的 `view` 目前完全是结果驱动的,没有这种纯浏览eval 定义的入口——值得抄,但优先级低于 compare,先记在这里。
3. **"每次 run 是独立时间戳快照"这个数据原则。** playground 的 `getExperiment` 保留 `timestamps: string[]` 整个历史列表,`/compare` 就是靠这个地基做的。niceeval 要抄的是这个**原则**(不要在聚合时提前合并掉快照身份),不是照搬它的目录 / API 形状。

### 调研过、判断不值得抄的(及理由)

1. **Tool 遥测是固定的 10 项 `ToolName` 枚举** (`file_read`/`shell`/`web_fetch`/…) + Badge 计数(`O11ySummary.tsx`)。niceeval 走的是 OTel GenAI 语义约定的 canonical trace/mapper(见 [Observability](observability.md#标准事件流与-streamevent)),覆盖面和跨 agent 一致性都更好——这块 niceeval 已经比它强,不用倒退抄。
2. **整个架构是"每次请求都读 fs 的 Next.js 多页面 live server"。** 没有数据库、没有 API 路由,但需要一个常驻的 `next start` 进程。niceeval 的 `view` 是"一次性烘焙 HTML+JSON 静态产物"(`src/view/index.ts` 的 `renderHtml`),导出目录扔给任何静态托管就能看,不需要常驻进程。这是刻意的取舍,不打算改成常驻多页应用——如果要抄 `/compare`,数据仍然要在生成 HTML 时一次性烘焙进去,不能假设前端能随时再查 fs。
3. **`bin.mjs` 的 `--watch` flag。** 只把 `WATCH=true` 塞进环境变量,代码里没有看到被消费的地方,像是半成品,没必要照抄这个具体实现。

## 相关阅读

- [View](view.md) —— 上面几条学到的东西,具体设计在这篇(Compare 是其中一个计划中的小功能)。
- [Observability](observability.md#结果可视化niceeval-view) —— `niceeval view` 现有能力全貌,对照着看这篇的"还差什么"更清楚。
- [agent-eval 适配笔记](feature/adapters/reference/agent-eval.md) —— agent-eval 的 adapter 实现(采集 / 转换 / 落地)的源码阅读记录。
- [OTel GenAI 等标准参考](feature/adapters/reference/otel-genai.md) —— "agent 行为怎么记"的行业标准调研,对比 agent-eval 的自定义方案。
- [eve 协议机制](feature/adapters/reference/eve-protocol.md) —— eve 运行时原生事件流的字段与采集机制,StreamEvent 演进的上限参照。
