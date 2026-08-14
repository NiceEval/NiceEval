# LangSmith

## 产品是什么

LangSmith 是 LangChain 提供的 AI 应用工程平台，与本研究直接相关的产品面有两块。Observability 用 Project、Trace、Run、Thread 和 Feedback 保存并检查应用执行；离线评测则使用 Dataset、Example、Experiment、Evaluator 和 Comparative Experiment。

它不是只产出最终分数的 benchmark runner。用户保留每次应用调用的 trace tree，把 Dataset 中的 Example 当作共同对照单位，再把评分保存成 Feedback。随后，用户可在同一产品里重开、筛选、分组和比较。

官方对这两块产品面的定义分别见 [Observability concepts](https://docs.langchain.com/langsmith/observability-concepts) 与 [Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)。

## 用户心智模型

- **Project 装 Trace，Trace 由 Run 组成。** Run 是一个 span；根 Run 代表 Trace，子 Run 代表模型、工具、检索或应用步骤。带相同 `thread_id` 的多个 Trace 才会组成 Thread。
- **Dataset 装 Example。** Example 保存输入、可选 reference output、metadata、split、attachment，并可用 `source_run_id` 指回生产 Run。
- **Experiment 不是另一套执行事实。** API 中它是一个引用 Dataset 的 Project / `TracerSession`；实验的根 Run 同时以 project/session ID 指向 Experiment，以 `reference_example_id` 指向本次输入对应的 Example。官方 REST 指南也明确称 experiment 为 session，并要求这两个引用。
- **Evaluator 的 durable 输出是 Feedback。** 行级 Feedback 挂 Run；summary Feedback 挂 Experiment/Project。pairwise 结果再以 `comparative_experiment_id` 与 `feedback_group_id` 把同一例上的多条偏好评分关联起来。
- **“Experiment result”主要是读取投影。** 公开的 SmithDB-backed 查询返回“一个 Example 加其 `runs[]`”，而 Python `ExperimentResults` 是本地流式容器；公开契约中没有独立、可写的 `ExperimentResult` 持久资源。

这些身份与别名可由官方 Python schema 中的 [`RunBase`、`TracerSession`、`Dataset`、`Example`、`Feedback` 与 `ComparativeExperiment`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L82-L999) 核对。生成自官方 OpenAPI 的 [`Trace`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/trace.py#L1-L20) 与 [`ExperimentRunQueryResponse`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/datasets/experiment_run_query_response.py#L1-L42) 提供另一组证据。

## 原生对象总图

```text
Tracing Project ──contains──> Trace (= root Run)
                                 │
                                 ├──contains──> child Run(s)
                                 └──groups by thread_id──> Thread
Run / Trace / Thread / Project <──scored by── Feedback

Dataset ──contains──> Example
   │                    ▲
   └──referenced by── Experiment (= Project / TracerSession)
                            │
                            └──contains──> root Run
                                   ├──session/project_id──> Experiment
                                   └──reference_example_id──> Example

ComparativeExperiment ──references──> Experiment(s)
       └──scopes──> grouped comparative Feedback on their Runs
```

Thread、Trace 与 experiment row 都是从 Run 及其引用关系形成的产品视图。Dataset、Example、Project/Session、Run、Feedback 和 ComparativeExperiment 则在公开 API 中有各自的 durable identity 或写入 resource。物理数据库表是否一一对应并未公开，不能从这张对象图反推。

## 研究页导航

- [layers.md](layers.md)：LangSmith 自己的产品面、resource、服务组件、owner、引用和依赖关系。
- [execution.md](execution.md)：SDK / UI / REST 的实验发起路径，真实调度与写入顺序，完成信号、失败、partial、retry 与 resume。
- [storage.md](storage.md)：公开 type/class、API resource 与 envelope，物理存储证据，权威事实、派生 summary、index 和本地 cache 的区别。
- [reading-and-comparison.md](reading-and-comparison.md)：历史 Trace / Experiment 的重开、query、filter、align、group、compare、render，以及缺测如何被隐藏或暴露。
- [schema-and-migration.md](schema-and-migration.md)：对象/API/SDK/chart/database/SmithDB/dataset-version 各条演进轨道，兼容 reader、升级与数据迁移边界。

## 与 NiceEval 的相似、差异与可吸收约束

| 观察 | LangSmith | 对 NiceEval 的约束 |
| --- | --- | --- |
| 共同对照键 | 用 `reference_example_id` 将 Experiment Run 对齐到 Example | 对齐键必须是稳定 ID，不能靠数组位置、名称或展示顺序 |
| 原始执行与评分 | Run/Trace 与 Feedback 是可独立更新、查询的资源 | 评分不应改写原始执行事实；应保留 judge lineage 与错误状态 |
| 实验身份 | Experiment 复用 Project/Session，而不是额外复制结果 | 若复用通用容器，必须有明确 discriminator 与完成语义，不能只靠 UI 命名 |
| 结果读取 | Example + Runs + Feedback 在读取时形成表格和比较视图 | 不必持久化第二份 result row，但读取投影必须显式呈现 missing，而非只取交集 |
| 完成与可见性 | runner、Run、Session、异步摄取/索引各有不同完成信号 | 必须拆开 execution done、durably accepted、indexed/readable 与 experiment sealed |
| 版本固定 | Experiment metadata 保存时间型 `dataset_version`；并非内容 digest | 复现实验要固定不可歧义的输入快照和 projection 版本，不能只保存“最新修改时间” |
| 冗余与 churn | `trace_id`、`dotted_order`、引用 ID 等在写入时固化；统计多在读取时聚合 | 只持久化重建身份与语义所必需的冗余；summary/index 应可重建并独立版本化 |
| 历史寿命 | Trace 有 retention；Dataset 可比其生产 Trace 活得更久 | lineage 必须允许“生产 Trace 已过期”，报告不能假定所有深链证据永久可重开 |
| 迁移 | SDK reader 迁移与底层 ClickHouse→SmithDB 数据迁移是两件事 | API 兼容迁移、物理数据 backfill 与用户逻辑 schema 迁移必须分轨说明 |

LangSmith 最值得吸收的不是其服务划分，而是三条硬约束：用持久 ID 建立 Example↔Run↔Feedback lineage；把原始事实、可重建 projection 和 cache 分开；对每一种“完成”和“缺测”给出机器可观察的状态。NiceEval 不应照搬 LangSmith 当前 Python comparative runner 的交集对齐，也不应把可移动的时间标签当作不可变版本。
