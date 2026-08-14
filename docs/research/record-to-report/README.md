# Record → Report 产品研究

本方向研究一类用户路径：产品先保存 Run、Trace、Experiment 或 Evaluation 的事实，随后让用户重新打开、查询、比较并形成 Dashboard 或 Report。
研究重点是这些事实怎样被人看见和理解，不是通用对象存储、内容寻址、透明日志或分布式提交算法。

`record-to-report/` 是 NiceEval 对研究问题的命名，不是外部产品的共同架构。
每个子目录按研究对象自己的产品模型写作；只有本页把它们映射到 NiceEval。

> 主要观察日期：2026-08-09 至 2026-08-13
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 为什么研究这些产品

NiceEval 需要回答五组连续问题：

1. 运行结束后，用户怎样通过 `niceeval show`、`niceeval view` 或静态导出进入结果，而不是打开 `.niceeval/` 检查内部文件。
2. 用户怎样找到并看懂 Run、Attempt、事件、评价与 Evidence，并从人读摘要下钻到精确事实。
3. 多次运行怎样筛选、对齐、分组和比较，missing、partial 与 unsupported 怎样显现。
4. 已完成的计算怎样进入 Table、Chart、Page、静态站和终端，而不丢失分母、问题面与复核路径。
5. 功能、查询和呈现持续演进时，怎样保持持久 schema 稳定；确实无法兼容时，怎样通过显式 `niceeval migrate` 升级。

入选对象至少对其中一组问题提供真实产品面。
只提供存储、hash、proof、lease 或 GC 机制的系统不属于本方向。

## 产品索引

| 产品 | 它是什么 | 主要用途 | 与 NiceEval 的相似性 | 研究入口 |
|---|---|---|---|---|
| Langfuse | LLM observability 与 evaluation 平台 | 查看 Trace、Score、Metrics 和 Dashboard | 执行事实与评价分开，并从明细进入聚合展示 | [Langfuse](langfuse/README.md) |
| MLflow | ML 与 GenAI 的 experiment tracking 平台 | 保存 Run、Metric、Artifact、Trace，随后搜索和比较 | 同一产品完成事实写入、查询与 UI 呈现 | [MLflow](mlflow/README.md) |
| Weights & Biases | ML experiment、Artifact 与协作报告平台 | 实时查看 Run、比较实验并编排 Report | 从运行事实到 Workspace、Report 的链路最完整 | [W&B](weights-and-biases/README.md) |
| Arize Phoenix | 开源 LLM tracing 与 evaluation 平台 | 查看 Trace、Dataset、Experiment、Annotation 和 Metrics | 评价可下钻到被评 Trace 与 evaluator Trace | [Phoenix](arize-phoenix/README.md) |
| ClearML | Experiment manager 与 MLOps 平台 | 查看 Task、Event、Artifact、Dashboard 和 Report | Task 事实可以在同一产品中比较并形成报告 | [ClearML](clearml/README.md) |
| LangSmith | LLM observability、dataset 与 evaluation 平台 | 查看 Trace、Feedback、Dataset 和评测结果 | 同时提供友好的 Messages 视图与原始 Details | [LangSmith](langsmith/README.md) |
| Braintrust | AI evaluation 与 observability 平台 | 查询 Dataset、Experiment、Span、Feedback 和历史版本 | 运行事实、评价、数据集沿用与实验比较相连 | [Braintrust](braintrust/README.md) |
| TanStack Table / Charts | Headless 表格与图表内核 | 让应用控制状态、语义模型和最终 renderer | 对应 NiceEval Report 的表格、图表和多媒介投影边界 | [TanStack](tanstack/README.md) |
| Vercel `design.md` | 报告网站的设计工作流 | 用读者任务、证据关系和真实渲染组织报告页 | 对应 NiceEval Report 的信息架构与视觉验收 | [Vercel](vercel/README.md) |

## 产品目录怎样组织

产品目录不使用统一的 `record.md`、`query.md`、`report.md` 模板。
产品只有一套紧密相连的公开模型时，用一份 `README.md` 说明完整路径。

产品确有独立产品面时，才按它自己的边界增加页面：

- MLflow 主页面之外，另有 [Tracing 与 Assessment](mlflow/tracing-and-assessments.md)。
- W&B Models 主页面之外，另有 [W&B Weave](weights-and-biases/weave.md)。
- Phoenix 主页面之外，另有 [Evaluator 可观察性](arize-phoenix/evaluator-observability.md)。

这些拆分分别来自 MLflow、W&B 与 Phoenix 自己的产品边界，不表示其它产品也应具有相同层次。

## 用户从哪里查看结果

本轮平台都通过产品 UI、查询 API 或 SDK 提供 Run、Trace、Experiment 与 Report。
普通用户不需要理解数据库表、对象存储布局或服务端 migration 表。

NiceEval 对应的受支持入口是：

```console
niceeval show
niceeval show --run <run-id>
niceeval view
niceeval view --run <run-id>
niceeval view --out ./report-site
```

`<project>/.niceeval/record/` 是可整体复制、进入 Git 并交给 CLI 的 portable Record root。
它对产品用户保持 opaque；用户不通过文件管理器、JSON 工具或 `niceeval/record` API 阅读内部结构。

`--record <root>` 只选择另一个完整 Record root，不把其目录布局变成用户接口。
CLI 负责识别版本、验证完成状态、形成 Sample、运行 Analysis 并呈现 Report。
规范入口见 [Record](../../feature/record/README.md) 与 [Reports CLI](../../feature/reports/cli.md)。

## Record 怎样展示

### 既要快速理解，也要下钻原始事实

LangSmith 的 Messages、Turns 与 Details 是最清楚的双面产品样本。
普通读者先看到对话和关键步骤，诊断者再下钻完整 Run tree。

Phoenix、Langfuse、MLflow 和 Braintrust 也都提供 Trace 或 Span 明细。
它们说明面向人的视图与原始事实视图都需要存在；友好视图不能成为唯一权威事实。

### 执行事实与评价应能分别查看

MLflow Assessment、Phoenix Annotation、LangSmith Feedback 和 Langfuse Score 都把评价放在执行对象之外。
用户既能查看发生了什么，也能查看谁或什么 evaluator 给出了怎样的判断。

Phoenix 进一步让 evaluator invocation 生成独立 Trace。
用户可以从 Annotation 下钻 Judge 的 request、response、token、latency 和错误。

这些平台通常允许评价后补、更新或删除。
它们提供了展示先例，但没有共同承诺 NiceEval 式不可变 Claim、完整 evidence basis 或固定 Record revision。

### lineage 应允许双向导航

Phoenix 的 source Span、LangSmith 的 `source_run_id` 和 Braintrust 的 Dataset origin 都把生产 Trace 与后续 Dataset 或 Experiment 连接起来。
这比只复制 input 文本更有用：读者可以从评测样本回到生产事实，也能从生产事实看到它被怎样沿用。

## Query 与比较怎样工作

Langfuse 提供行级 Observations API 和聚合 Metrics API。
MLflow 用 `search_runs` 与 Tracking UI 查询 Param、Metric 和 Tag。
W&B 用 Public API、Runset 与 Table compare；Phoenix 用 Filter Expression、`SpanQuery` 与 Experiment Compare。

这些产品共同证明，查询、比较和展示可以属于同一产品，而不必把事实交给外部 BI。
它们的共同弱点是分母经常隐含在当前筛选结果中，缺值可能表现为 `NaN`、`None` 或空集合。

NiceEval 需要保留更明确的 Sample、denominator、coverage、missing、partial 与 unsupported。
外部产品的查询 UX 可以借鉴，但不能取代这些评测语义。

## Report 怎样形成

### 平台型产品

W&B 同时提供自动 Workspace、交互式 Report 和代码生成 API，是本轮最完整的报告作者面。
ClearML 提供 Task compare、Dashboard 与 Markdown Report。
Langfuse 和 Phoenix 主要提供 Dashboard 与 Experiment compare；MLflow 和 LangSmith 更偏向产品内置视图，而不是独立 Report 声明。

这组差异说明“能画图”“有 Dashboard”和“存在可交付 Report”是三个不同承诺。
产品页分别说明作者使用 UI、代码还是产品内置页面，不把它们统称为报告系统。

### 表格与图表内核

TanStack Table 展示了 headless 状态、row model、算法和 markup 的边界。
TanStack Charts 展示了 mark、channel、scale、guide、scene 与 renderer 的边界。

NiceEval 不需要复制它们的产品模型，也不直接依赖这些包。
可吸收的是：语义事实、浏览状态、派生模型和最终媒介不应混在同一个 renderer 中。

### 报告网站

Vercel `design.md` 研究的是官方报告、比较、benchmark、数据叙事页和计算器的设计流程。
它从读者要判断什么开始，让证据关系决定页面几何，再用真实渲染检查首屏、层级、响应式和可访问性。

NiceEval 借鉴的是读者任务、证据构图和视觉验收，不采用 Vercel 品牌外壳、Geist、固定网格或 CSS API。

## 怎样防止功能演进牵动 schema

外部平台普遍拥有少量稳定写入对象，由平台升级自己的 store。
用户增加 metric 名字、score、tag、artifact 或 dashboard 配置时，通常不发布一套新的持久格式。

NiceEval 需要把同样的稳定性变成明确门槛：

| 变化 | 默认处理 | 是否改变持久 schema |
|---|---|---|
| 新增 Table、Chart、Page、排序或视觉样式 | 从已有 Analysis 结果重新呈现 | 否 |
| 新增查询、聚合、分组或格式化 | 发布新的 Analysis field、Calculation 或 projector | 否 |
| 作者 API、matcher 或算法重构，持久语义不变 | 更新代码；必要时更新 behavior identity | 否 |
| 新增可映射到既有事实信封的 Metric、Score 或 Artifact | 在既有信封内发布新 identity | 否 |
| Attachment payload、blob ref 或 closure 的 shape 或语义改变 | 发布相邻 Attachment schema | 是，只改变该 Attachment |
| Record owner、引用、Core shape 或完成判断改变 | 发布新的 Record major | 是，且必须单独裁决 |

新增功能必须先证明现有事实不能表达它，才能讨论新的 durable schema。
“新页面需要一个字段”或“查询代码更方便”都不是修改磁盘格式的理由。

这张门槛表只总结研究对 NiceEval 的约束。
唯一契约仍见 [Record 的演进矩阵](../../feature/record/README.md) 与 [上层变化不改持久格式](../../feature/record/use-case/上层变化不改持久格式.md)。

## migrate 是最后手段

`niceeval migrate` 不是每次功能升级后的例行步骤，也不用于重算 Report、修正 evaluator 判断或把旧事实解释成新含义。
只要 current reader 仍能正确读取原 bytes，新功能就应直接重做 Analysis 与 Report，不迁移 Record。

只有同时满足以下条件时才进入 migrate：

1. 已发布的 durable schema 确实必须改变，不能由新 projector、Calculation、Report 或新事实 identity 表达。
2. 用户请求 current schema 时，现有 bytes 已不能按 current 契约直接使用。
3. NiceEval 拥有从旧版本到 current 的完整相邻转换链，并能无损保留 identity、Evidence refs 与 blob closure。
4. 用户先运行只读 `niceeval migrate` 查看 exact plan，再显式运行 `niceeval migrate --yes`。

普通 `show` 和 `view` 不静默改写 Record。
存在完整无损转换链时，它们返回 `migration-required` 并提示 migrate；没有无损转换时返回 `migration-unavailable`，保留旧 bytes，也不反复提示命令。

历史错误使用追加 correction 或新 fact identity 表达，不能伪装成 schema migration。
完整命令与失败边界见 [Record CLI](../../feature/record/cli.md#migrate)。

## 对 NiceEval 的研究判断

外部产品没有共同使用 Record → Analysis → Report 这套词。
NiceEval 可以用自己的结构吸收它们解决过的问题：

```text
Record       保存一次运行及其评价事实，并提供人读视图与证据下钻
    ↓
Sample       固定进入比较的对象与分母
    ↓
Analysis     选择、对齐、聚合，并显式处理缺测和问题面
    ↓
Report       用同一语义结果产生终端、Web 与静态交付面
```

用户只通过 CLI、终端输出、Web 页面和静态报告站消费这条链路。
`.niceeval/record` 是内部 substrate 的 portable root，不是第四个阅读界面。

这张映射只存在于本方向入口。
单个产品页继续使用 Trace、Run、Task、Dataset、Experiment、Workspace、Dashboard 等原生概念。

## 不属于本方向

- Nix、Bazel、OCI、IPLD/IPFS：主要说明内容寻址、闭包或对象搬运。
- Certificate Transparency、Trillian、Rekor：主要说明透明日志和 inclusion proof。
- Datomic、KurrentDB、Temporal、Flink、Iceberg、etcd：主要说明历史、stream、snapshot、commit 或 lease。
- OpenTelemetry 的采集协议与 semantic convention：属于 [Adapter 研究](../adapters/README.md)。
- Assertion、Scorer 与 Judge 的作者 API：属于 [Assertion 研究](../assertion-api-dx/README.md)。

这些系统可能为其它架构裁决提供局部先例，但不能回答本方向最主要的用户问题：运行事实怎样被看懂、比较并交付成报告。

## 证据纪律

产品事实只采用官方规范、官方文档、官方仓库和正式 migration 文档。
SaaS 没有公开存储格式或稳定性保证时，只描述公开 API 能观察到的行为。

产品页中的 NiceEval 建议是研究者推论。
它们进入 Feature、Roadmap 或 Design 并完成裁决后，才成为 NiceEval 契约。
