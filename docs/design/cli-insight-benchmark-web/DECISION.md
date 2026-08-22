**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md)

# Decision

## 定案

采纳 [PLAN-4](PLAN-4/README.md)：以 framework-neutral `BenchmarkBundle` 为用户网页的稳定数据核心，并另发一个严格有界的无样式 React adapter。

同时固定三面分离：

- CLI 通过 `niceeval.query/v1` 自由查询和比较，`show` 只做人读快速查看；
- `view` 改为第一方 `insight` debug UI；
- 用户 benchmark 网站完全拥有页面、路由、样式、图表、交互与部署。

`BenchmarkBundleDefinition` 是受信任 TypeScript 中的有限纯数据 graph。它引用已注册 Analysis descriptor，不接受任意函数、SQL、JavaScript 或浏览器 query。

Static 与 dynamic 共用 `materializeBenchmarkBundle()`。Static 预先写 content-addressed Bundle；dynamic 由用户自己的服务器完整 materialize Bundle。NiceEval 不发布公共 HTTP query server。

## 依据

### CLI 真正 AI-native

Discovery 公布 JSON Schema、descriptor ID / behaviorVersion、类型、Population、单位、Evidence、关系、alignment 与示例。Agent 可以形成、解释和修正请求，不需要读网页组件或源码。

自由比较不等于自由改口径。Alignment 只有 `side-by-side | exact | paired`：

- side-by-side 保留各自分母，不产生跨总体 delta、rank 或 trend；
- exact 需要 exact Population、成员、Measure behavior、producer 与 selection basis；
- paired 只能用具名 Relation，并保留两侧分母、pair denominator、unmatched 与 excluded。

### Insight 不再承担作者平台

Insight 可以为 debug 采用动态 server、lazy detail 与固定第一方 UI。InsightRevision 让每次交互固定到一个 Sample，watcher 只提示新 revision。

因为 Insight 不公开 Page、component、route、theme 或 transport，它可以为排障演进，不再限制 CLI 或用户网站。

### Bundle 是可组合的网页边界

Bundle 对 React、Astro、Vue、Svelte、server script 与任意图表库同样可读。它保存完整 MetricValue、comparability、issues、refs、provenance 和显式 blob，不把 HTML 或 React tree 当数据。

Content identity、digest、schema、预算和原子发布让 static 与 dynamic 共享同一 Bundle 文件语义。Bundle 可重建，不建立持久 migration 负担。

### React adapter 有价值但不拥有产品

有限 adapter 统一 BundleIdentity、异步 resource coherence 与 MetricValue / Evidence 可访问性。它减少 React 项目重复犯错，却不提供 Table、Chart、fetch、router 或 CSS。

Astro hydration 留在用户 `.astro` 编译现场。NiceEval 只发布普通 React ESM，不发布 Astro integration。

## 候选比较

| 候选 | 正确性与 transport | 用户网页所有权 | 可用框架 | 裁决 |
|---|---|---|---|---|
| [PLAN-1：Astro-first](PLAN-1/README.md) | 需要另补中立 Bundle 才能稳定互操作。 | integration 拥有 route、build 与 island。 | 主要限于 Astro。 | 否决。 |
| [PLAN-2：React components-first](PLAN-2/README.md) | Provider 会吸收 fetch、selection、comparison 与 revision。 | 受 NiceEval component model 约束。 | React 为主。 | 否决。 |
| [PLAN-3：data-only](PLAN-3/README.md) | 最干净。 | 完全归用户。 | 最广。 | 可接受第二选择。 |
| [PLAN-4：Bundle + bounded React](PLAN-4/README.md) | Bundle 保持唯一核心，adapter 只消费。 | 页面与样式完全归用户。 | 任意框架，另有 React convenience。 | 采纳。 |

PLAN-3 没有结构性错误。PLAN-4 胜出的唯一理由，是 revision coherence、异步 resource 与完整度可访问性值得一个小而机械受限的 React ABI。

## 否决项

### PLAN-1

Astro 的 `client:*` 属于用户 `.astro` 编译现场，不能作为 NiceEval 数据协议。Astro-first 也无法自然服务普通 React、其它 framework、server consumer 或非网页工具。

### PLAN-2

以 React component 为主会迫使 Provider 拥有数据取得、loading、缓存、selection、route 与图表。它会重新长成旧 Report 平台，并把用户样式自由压回 props。

### PLAN-3

Data-only 仍满足核心目标，但会让每个 React 项目重复处理 Bundle revision、resource Promise 与 MetricValue / Evidence 状态。有限 adapter 可以在不取得业务所有权的前提下消除这段重复。

## 迁移门

本决策进入 Feature 与实现前必须一次完成以下迁移，不能长期维持双轨：

1. 当前总图改为 `Record → Analysis → CLI / BenchmarkBundle / Insight`。
2. `niceeval/report`、`report/host`、`report/built-in`、`report/react`、`report/extension` 与公开 Report CSS / client export 退出。
3. PricingProfile、cost Measure、closed codec 与 Evidence identity 归 Analysis。
4. 第一方浏览器详情、router、语言、图表和无障碍归 Insight 私有实现。
5. `view`、`view --out`、Page、ReportSample、ResolvedPage、ClosedSiteRevision、双面组件、theme、head、作者 script / asset 删除。
6. `show --json` 与 Page machine manifest 删除；machine consumer 统一走 `niceeval.query/v1`。
7. `docs/feature/reports/**` 不再作为当前目标；仍有效的数据语义并入 Analysis、Bundle 与 Insight Feature。
8. [Report authoring](../report-authoring/DECISION.md) 明确被本决策取代；[Report 图表语义内核](../../roadmap/report-chart-kernel/README.md) 取消公共三面方向。

这些删除不允许只换名。实现验收必须证明 public export map、CLI help、docs index 与 installed package 都没有旧入口。

## 实现前硬门

- Definition resource graph 静态有限，parameters 只能填已声明 slot；
- Query protocol、alignment 与 correction 形状按 [PLAN-4 CLI](PLAN-4/cli.md) 定稿；
- Manifest、resource body、identity、schema 与 corruption 按 [PLAN-4 Library](PLAN-4/library.md) 定稿；
- v1 数量、bytes、时间与内存预算按 [PLAN-4 Architecture](PLAN-4/architecture.md) 执行；
- static staging 后原子发布，dynamic 不 lazy refill；
- React core 隔离、BundleHandle hydration 边界与 adapter allowlist 有 package-level 守护。

## 遗留风险

- 用户仍可忽略 side-by-side comparability，自行画误导排名；Bundle 只能保留警示，不能控制用户代码。
- Parameter slot 可能被扩张成旧 Page callback；Definition codec 必须拒绝动态图变化。
- Bundle identity 与动态缓存键若不一致，会出现同 identity 不同 bytes；发布路径必须复验完整 Bundle。
- React adapter 可能从 hooks 膨胀成 UI framework；新增 Table、Chart、fetch、router 或 CSS 必须重新裁决。
- Insight 私有查询可能与 materializer 分叉；跨面一致性验收必须逐字段比较 MetricValue、missing、Evidence 与分母。
