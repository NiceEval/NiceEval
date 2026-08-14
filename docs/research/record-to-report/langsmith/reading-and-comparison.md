# LangSmith 历史读取、对齐与比较

本页从“历史事实怎样重新组成用户看到的视图”出发。Run、Feedback 与 Example 的保存字段见 [storage.md](storage.md)；这里只讨论 query/filter/align/group/compare/render，以及 missing 如何出现。源码固定核对官方 SDK commit [`345a522`](https://github.com/langchain-ai/langsmith-sdk/commit/345a52252af163abe33699fb361038f5783c9024)（2026-08-13 UTC）。

## 重开入口

| 用户入口 | Trace / Thread | Experiment / comparison |
| --- | --- | --- |
| LangSmith UI | Projects 中打开 tracing Project；Threads / Traces / Runs 三个 tab，选中后看 Messages / Turns / Details | Dataset 的 Experiments / Pairwise Experiments，或 Project 的 experiment view；打开单实验、选择两个以上实验比较 |
| CLI | `langsmith trace list/get`, `run list/get`, `thread list/get`, `project list/get`，并可导出 | `dataset` / `example` / `experiment list/get`; 复杂 projection 用 `langsmith api`。官方命令与 filter flags 见 [LangSmith CLI](https://docs.langchain.com/langsmith/langsmith-cli) |
| Python / TypeScript SDK | `read_run`, `list_runs`, v2 `query_runs`, `query_traces`，按 ID/project/time/filter 查询 | `read_project`, `list_projects(reference_dataset_id=...)`, `list_examples(as_of=...)`, v2 experiment-runs query；`evaluate_existing` 可在旧 Runs 上追加评价 |
| REST | Run/Trace query 与 Feedback endpoints | Session/Project、Dataset/Example、comparative endpoints；v2 `/api/v2/datasets/{dataset_id}/experiment-runs` 返回对齐投影 |

UI 导航和 panel 的公开行为见 [View traces](https://docs.langchain.com/langsmith/view-traces) 与 [Analyze an experiment](https://docs.langchain.com/langsmith/analyze-an-experiment)。CLI 不是另一套存储：这些入口最终读取同一 logical resources，CLI typed surface 不完整时 raw API 只暴露已有 endpoint。

## Trace 与 Thread 怎样重建

1. **先定 Project 与时间窗。** v2 Run query 接受 `project_ids` 或 `reference_dataset_id`、`min_start_time` / `max_start_time`、cursor、`selects` 和 filter；两种 scope 不能同时给。一般不传时间时下界默认最近 24 小时、上界默认 now；但以 `reference_dataset_id` 查询且省略下界时，服务端改从最早 Session 创建时间推导。未传 `selects` 时只保证 `id`。见 [`RunsResource.query_v2`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/resources/runs/runs.py#L123-L257)。
2. **以 root 与 ordering 还原树。** 同一 `trace_id` 是一个 Trace；root Run 的 `id == trace_id`。`parent_run_ids`/legacy `parent_run_id` 给依赖边，`dotted_order` 给稳定的层级顺序。v2 Trace query 直接返回 root Run 加 trace aggregates，但仍没有独立 Trace 写入事实。[`Run`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/run.py#L159-L370) [`TracesResource.query`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/resources/traces.py#L171-L268)
3. **以 `thread_id` 组成 conversation。** 相同 Project 中带同一 `thread_id` 的 root traces 才能出现在 Threads/Turns。没有这个 metadata/field，Trace 仍能查看，但不会自动变成 Thread；官方 instrumentation 要求见 [Manage threads](https://docs.langchain.com/langsmith/manage-trace#group-traces-into-threads)。
4. **按选择的 render mode 投影。** Details 显示 Run tree、inputs/outputs、metadata、feedback、tokens/cost/latency；Messages 尝试把 inputs/outputs 解释为消息；Turns 按 thread 展示。数据不是可识别 message schema 时 Messages view 会不可用，用户仍可回到 raw/structured details。[View traces](https://docs.langchain.com/langsmith/view-traces)

### 三种 filter scope

| Filter | 匹配对象 | 用途与陷阱 |
| --- | --- | --- |
| `filter` | 返回的单个 Run | 找满足自身 name/type/status/metadata/feedback 等条件的 Run |
| `trace_filter` | Trace 的 root Run | 用 root 条件选中 trace，再返回其中满足主 filter 的 Run |
| `tree_filter` | trace tree 内任一 Run | 用任意 ancestor/descendant 条件选 trace；不能当作关系数据库任意 join |

UI/SDK 还支持 metadata、tags、latency、tokens、cost、feedback、full-text 等组合；语法与 scope 由 [Filter traces](https://docs.langchain.com/langsmith/filter-traces-in-application) 定义。Full-text 只索引字段开头最多 250 characters，token 至少 2 characters；key/value 搜索最多追踪 100 个 unique keys 且 value 只取前 250 characters。因此 filter 命中集合是索引 projection，不应拿“零命中”证明原 Run 不含某段较后文本。

## Experiment 怎样重建

一次历史 Experiment 不依赖本地 `ExperimentResults`：

1. 读取带 `reference_dataset_id` 的 Project / `TracerSession`，取得 Experiment ID、Dataset ID、metadata、start/end time。
2. 读取该 Project 下的 root Runs；每个 Run 的 `reference_example_id` 是行对齐键，重复实验允许一个 Example 对应多个 Runs。
3. 按 Project metadata 的 `dataset_version`（时间 `as_of`）读取当时 Examples；没有该 metadata 的旧实验只能落到 endpoint/SDK 的默认版本行为。
4. 按 Run ID 读取 row Feedback，按 Project ID 读取 summary Feedback；token/cost/latency/status 可从 Run/aggregate 字段显示。
5. v2 endpoint 可直接把上述 join 投影为一页 `Example fields + runs[]`，但它没有创建新 result resource。[`ExperimentRunQueryResponse`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types/datasets/experiment_run_query_response.py#L1-L42)

Python `evaluate_existing` 正是这条读取路线：按 experiment 读取 Runs，再以 Project 保存的 `dataset_version` 加载 Examples，最后只写新 Feedback，不执行 target。源码见 [`evaluate_existing`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L416-L525) 与 [`_load_examples_map`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1204-L1223)。

## 单实验的 filter、group 与 render

官方 experiment table 同时展示 Example input/reference output、Run output、feedback、status、latency、tokens 与 cost。用户可：

- 选列、排序、按 metadata/feedback/status 等筛选；Compact 显示紧凑行，Full 展开完整值，Diff 突出候选与 reference 的字段差异；
- 点开一行查看 target Trace、Feedback comment/correction 和 judge source trace；
- 以 Example metadata 分组，比较每组 feedback average、latency、tokens、cost；旧实验兼容有时间边界：官方说明 2025-02-20 之后的实验可按 Example metadata 分组，此前实验只支持 trace metadata；
- 查看 repetitions：同一 `reference_example_id` 下保留多个 Runs，而不是用后一个替换前一个；
- 配置 baseline，展示相对该参照实验的 improvement/regression，并导出 CSV。

这些都是读取/展示投影，不会重写 Run、Example 或 Feedback。行为和历史分组限制见 [Analyze an experiment](https://docs.langchain.com/langsmith/analyze-an-experiment) 与 [Filter experiment results](https://docs.langchain.com/langsmith/filter-experiments-ui)。

## 多实验对齐与 compare

### 产品 UI / v2 query 的对齐键

多实验必须引用同一 Dataset；稳定 join key 是 `Example.id == Run.reference_example_id`。一个 Example 可以在每个 Experiment 有零、一个或多个 Runs，因而正确的逻辑形状是：

```text
Example.id
  ├── Experiment A: Run[] + each Run's Feedback[]
  ├── Experiment B: Run[] + each Run's Feedback[]
  └── missing / repetitions are explicit cardinalities
```

UI 允许选两个以上 Experiment，复用 filters；Compact/Full 可比较多个，Diff 只支持两个。用户可看各 feedback key、latency/token/cost、打开各侧 Trace，并把某实验设为 baseline。官方行为见 [Compare experiment results](https://docs.langchain.com/langsmith/compare-experiment-results)。

### Python comparative runner 的更窄语义

`evaluate_comparative` 先确认所有 Project 的 `reference_dataset_id` 相同，然后：

1. 读取各 Project 的 Runs；
2. 对各侧 `reference_example_id` 集合做**交集**；
3. 只加载交集中 Examples，且 `as_of` 取第一个 Experiment 的 `metadata.dataset_version`；源码留有 `TODO`，尚未警告不同 Experiment 使用了不同 dataset versions；
4. 以 Example ID 收集各侧 Runs，执行 pairwise evaluator；同一比较组写共享 `feedback_group_id` 与 `comparative_experiment_id` 的 Feedback。

这不是 outer alignment：任一侧缺 Run 的 Example 会被静默排除，不会得到 “missing” row 或 error Feedback。权威实现见 [`evaluate_comparative`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L861-L951)。

### Align Evaluator 不是 Experiment 行对齐

产品的 Align Evaluator 流程是 evaluator 校准：从一个或多个 Experiment 选择 Runs，送入 Annotation Queue 取得 human Feedback。用户在 Playground 测 judge，再计算 judge labels 与 human labels 的一致百分比，迭代 prompt。它对齐的是**judge 与人类标签**，不是替代 `reference_example_id` 的行 join。见 [Improve LLM-as-judge evaluators](https://docs.langchain.com/langsmith/improve-judge-evaluator-feedback)。

## 缺测怎样出现或被隐藏

| 缺口成因 | 持久事实 / 读取表现 | 用户会看到什么，或为什么看不到 |
| --- | --- | --- |
| target 失败，`error_handling="log"` | errored root Run 仍有 `reference_example_id` | 实验行能按 Example 对齐，Run status/error 可呈现；该行的正常 score 可能缺失 |
| target 失败，`error_handling="ignore"` | runner 只在成功 callback 补 `reference_example_id` | 失败 Run 可留在 Project，但从 Example-keyed experiment projection 消失；不是成功，也不是显式 missing cell。实现见 [`_forward`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1961-L2009) |
| row evaluator 抛错 | runner 写 `extra.error=true`、error comment、无 score 的 Feedback | feedback key 有一条 error record；必须按 error/null 处理，不能折成 0 分 |
| summary evaluator 抛错 | runner 只写 client log，不写 Project Feedback | 历史 UI/API 中该 summary key 缺席，无法只凭资源区分“未配置”和“执行失败”。实现见 [`_apply_summary_evaluators`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1796-L1848) |
| 某 Experiment 少 Example Run | 对 v2 已返回的 Example，可按 `runs[].project_id` 识别某一实验为 0；完整 Dataset outer join 仍须另读 Examples。Python comparative 则先取交集 | UI/API 是否显式占位取决于所用 projection；comparative runner 会完全丢掉该 Example |
| repetitions 不齐 | 同 Example 每侧 `Run[]` 数量不同 | 不能只取“第一条”后宣称已对齐；需显示期望数与实际数 |
| Feedback 晚到/批量 op drop | Run 已 query 到，但期望 Feedback key 尚无对应 Feedback | 暂时空白与永久缺测在没有 completion/index barrier 时不可仅凭一次读取区分 |
| query 默认时间窗/字段 projection | Project-scoped v2 query 默认最近 24 小时；`reference_dataset_id` scope 可从最早 Session 推导下界；未请求字段只返回 ID | caller 误用默认 scope 时历史存在却没进结果，或 UI/代码误把未选择字段当 null |
| full-text / KV index 截断 | 原 payload 存在但索引未包含后段/更多 keys | search 零命中；直接按 ID 重开仍可能看到内容 |
| Thread/message contract 缺失 | 没 `thread_id` 或 inputs/outputs 不是可识别消息 | Trace/Details 可见，而 Threads/Turns/Messages 视图缺席 |
| retention 到期 | source Trace/Run payload 被 TTL 清除；Dataset 默认可长期保留 | Example 与 `source_run_id` lineage 可能仍在，但生产 Trace/Run 详情不可重开。见 [Data purging](https://docs.langchain.com/langsmith/data-purging-compliance) |

## 可靠比较前的最小读取检查

LangSmith 没有公开单一 “comparison complete” resource。历史比较至少应先核对：

1. 所有 Project 的 `reference_dataset_id` 相同，并保存每个 Project 的 `dataset_version`；版本不同时不能无提示混用第一侧快照。
2. 以 Dataset Example 集合做 outer join，逐侧报告每个 Example 的 Run 数、terminal/error status 与期望 repetitions；不要先取交集。
3. 对每个 terminal Run 按期望 evaluator keys 区分 score、evaluator error Feedback、尚未可见与永久 missing；summary keys 同理，但承认旧失败可能无 durable error record。
4. 明确 query time window、`selects`、filters 与 index 限制；比较证据应能通过 ID 读取回源。
5. 保存/显示 judge `source_run_id`、Feedback group/comparative ID 与 baseline，避免只留下聚合平均值。

这套检查是从公开 resource 语义推导的安全读法，不是 LangSmith 已公开实现的原子 snapshot 或 sealed-report 协议。
