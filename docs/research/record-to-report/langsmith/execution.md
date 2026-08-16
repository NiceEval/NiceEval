# LangSmith 实验执行与失败语义

本页按 LangSmith 的 Experiment / Project / Run / Feedback 原生对象写一次实验的真实顺序。字段与介质见 [storage.md](storage.md)，历史读取见 [reading-and-comparison.md](reading-and-comparison.md)。源码固定核对官方 SDK commit [`345a522`](https://github.com/langchain-ai/langsmith-sdk/commit/345a52252af163abe33699fb361038f5783c9024)（2026-08-13 UTC）。

## 发起入口与调度 owner

| 发起面 | 调度 owner | 可验证行为 |
| --- | --- | --- |
| Python `evaluate` / `aevaluate` | caller 进程中的 SDK runner | 规范化 examples，创建/reuse Project，按并发执行 target 与 evaluators，写 Run / Feedback，返回本地 results handle |
| Playground / Studio / UI | LangSmith 托管的后台执行面 | 用户选 Dataset 与 target 后可离开页面，UI 显示后台进度；官方 [Studio guide](https://docs.langchain.com/langsmith/observability-studio) 明确实验在后台继续，但内部 job / transaction 未公开 |
| REST API | caller 自己 | caller GET examples、POST session、逐例 POST/PATCH runs、POST feedback、最后 PATCH session `end_time`；官方给出完整 [REST 顺序](https://docs.langchain.com/langsmith/run-evals-api-only) |
| CLI | typed CLI 只负责资源管理/读取；raw `langsmith api` 由 caller 编排 | typed 面有 `experiment list/get` 而无通用 run 命令；raw API 可复现 REST 路径，见 [CLI command list](https://docs.langchain.com/langsmith/langsmith-cli) |

## Python SDK 的真实顺序

以下不是概念图，而是 `evaluation/_runner.py` 当前同步实现的调用序列。

1. **规范化 data 并创建 manager。** `_evaluate` 接受 Dataset 名/ID、Example iterable，或已有 runs/experiment；它创建 `_ExperimentManager`，收集 evaluator keys 与 repetition count，然后调用 `.start()`。若设置 `LANGSMITH_TEST_CACHE`，target/evaluator 的外部 HTTP 可进入 `<cache-dir>/<dataset_id>.yaml` VCR cache，但 LangSmith API host 被排除。[`_evaluate`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1088-L1145)
2. **创建 Experiment / Project。** `start()` 先取得第一个 Example；若没有传入已有 Project，`_create_experiment` 调 `Client.create_project`，POST `/sessions`，写 name、description、metadata 与 `reference_dataset_id`。预期 example 数、repetitions、evaluator keys 是 progress transport hints，不在 `TracerSession` response round-trip。名称冲突会换后缀，最多尝试十次。[manager start/create](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1297-L1329)；[`Client.create_project`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L5191-L5262)
3. **展开 repetitions 并调度 target。** `examples` 在 `num_repetitions > 1` 时重复；`_predict` 在 `max_concurrency == 0` 时顺序执行，否则用 `ContextThreadPoolExecutor` 为各 Example 提交 `_forward`，并按 future 完成顺序产出。[examples/predict](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1470-L1495) [并发路径](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1615-L1657)
4. **执行应用并形成 Run tree。** `_forward` 把 target 包成 traceable，在 experiment project 下运行。root Run 带 `reference_example_id`（或成功后才补）和 `example_version` metadata，子步骤通过 tracing context 形成 child Runs。`RunTree.post()` 调 `create_run` 发送开始事实。结束时 `end()` 写 outputs/error/end time，`patch()` 调 `update_run`。[`_forward`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1961-L2009)；[`RunTree.post/patch`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/run_trees.py#L798-L941)
5. **行级 evaluator 逐 Run 评分。** runner 在名为 `evaluators` 的 tracing project/context 执行 judge，将 evaluator trace ID 作为 Feedback 的 source lineage，再由 `_log_evaluation_feedback` 写目标 Run 的 Feedback。target pipeline 与 judge pipeline 因而不是同一 trace tree。[`_run_evaluators`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1659-L1749)
6. **summary evaluator 消费全体 rows。** runner 先把 runs/examples 收集到内存，再执行 summary evaluators；每个成功结果通过 `create_feedback(run_id=None, project_id=experiment.id)` 成为 Project-level Feedback。[`_apply_summary_evaluators`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1796-L1848)
7. **runner 收尾 Project metadata。** target generator 耗尽后 `_end()` 计算本次 examples 的最大 `modified_at`，写为 `metadata.dataset_version`，并写 `dataset_splits`。在所核对 commit 中，它调用 `update_project(metadata=...)`，**没有传 `end_time`**；`Client.update_project` 会发送 `end_time: null`。所以 Python `evaluate()` 返回或 `wait()` 完成，不能据此宣称服务端 Session 已按 REST 协议关闭。[`_get_dataset_version/_end`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1850-L1891)；[`update_project`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L5264-L5311)
8. **本地 results handle 停稳。** blocking 模式直接消费 generators；non-blocking 模式另起 thread。`ExperimentResults.wait()` 只 `join()` 这条本地 thread 并重抛本地 processing error；它不调用服务端 completion/index barrier。[`ExperimentResults`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L534-L656)

异步版 `aevaluate` 用 task/semaphore 而不是 thread pool，但资源关系与“本地完成不等于服务端索引完成”的边界相同；官方并发差异见 [Experiment configuration](https://docs.langchain.com/langsmith/experiment-configuration)。

## REST 的显式协议

REST caller 没有 SDK 帮其补齐约束，官方顺序是：

1. `GET /examples?dataset=<id>`，固定本轮输入集合。
2. `POST /sessions`，body 含 `reference_dataset_id`，取得 Experiment/Session ID。
3. 每个 Example 先 `POST /runs`，至少写 Run ID、inputs、start time、`session_id` 与 `reference_example_id`；child Run 另写 `parent_run_id`。
4. 应用真实执行后，`PATCH /runs/{id}` 写 outputs 与 `end_time`；错误路径应同样结束 Run 并写 error。
5. `POST /feedback` 写 evaluator 结果，run-level Feedback 还要给对应 `session_id`。
6. `PATCH /sessions/{id}` 写 `end_time`，这是官方 REST 流程的 Experiment close 标识。
7. pairwise 时另 `POST /datasets/comparative`，再为同一 Example 的各 Run 写共享 `feedback_group_id` 与 `comparative_experiment_id` 的 Feedback。

完整 request examples 与 endpoint 由官方 [How to use the REST API](https://docs.langchain.com/langsmith/run-evals-api-only) 给出。REST request 成功只证明 API 接受了该 resource；self-hosted queue 对 Trace/Feedback 仍是异步落库。

## Run / Feedback 写入 owner 与 envelope

Tracing client 有同步单条与后台批量两条路径：

- `create_run` 在有 `trace_id` + `dotted_order` 且 batch queue/compression 可用时，把 `SerializedRunOperation("post")` 入队；否则同步 `POST /runs`。`update_run` 默认补当前 UTC `end_time`，形成 `patch`，同步路径是 `PATCH /runs/{id}`。[`create_run`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L2553-L2853) [`update_run`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L3702-L3960)
- 非 multipart batch 把 operations 还原成 JSON `{"post": [...], "patch": [...]}`，按 byte limit 切批，POST `/runs/batch`。multipart 路径把 Run 的 inputs、outputs、events、extra、error、serialized、attachments 分成 parts；Feedback 也可与 Run op 共用后台队列。[serialization](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_internal/_operations.py#L20-L218) [batch envelope](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L2977-L3055)
- `create_feedback` 要求 Run/Trace/Project 至少一个 target；显式 `trace_id` 才能进入 latency-sensitive batch/background path。同步路径 POST `/feedback`，默认最多十次并对 NotFound retry；默认 `extend_trace_retention=True`。[`create_feedback`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L8158-L8429)
- server side 的 LangSmith queue owner 负责 incoming Trace/Feedback 的 integrity check、数据库故障 retry 与最终插入。这一职责见官方 [self-hosted component contract](https://docs.langchain.com/langsmith/self-hosted)。queue record schema、exactly-once 机制和 transaction isolation 未公开。

## 四种不能混用的“完成”

| 信号 | 证明什么 | 不证明什么 |
| --- | --- | --- |
| Run `end_time` / v2 `status` 不再 `PENDING` | 单个 span 已结束或报错 | sibling Runs、Feedback 或 Experiment 已结束 |
| Session `end_time` | REST contract 下 Experiment/Project 已 close | 所有异步 batch 已落库、query index 已更新 |
| `ExperimentResults.wait()` 返回 | caller 进程的 prediction/evaluator generator/thread 已停稳 | Session close、client queue flush、server durability、read-after-write |
| `Client.flush()` 返回 | 本地 tracing queue 已 drain，compressed futures 在给定 timeout 内尽量完成 | timeout 时可能仍有 unfinished tasks；也没有服务端 query-index barrier。实现见 [`flush`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L4045-L4127) |
| query 能读到期望 Run/Feedback 数 | 当前 query projection 已可见 | 未来不会再有迟到 Feedback，或整个 Experiment 是原子的 |

UI 的 progress bar 是另一种 projection。官方说明它综合 run/evaluation status，并依赖 SDK 传入 expected counts/evaluator keys。它是进度提示，不是公开 commit token，见 [Track experiment progress](https://docs.langchain.com/langsmith/analyze-an-experiment#track-experiment-progress)。

## 失败、partial 与原子性

LangSmith 的一次 Experiment 是多个独立 resources 的 saga，不是一个公开的跨资源 transaction。

| 失败点 | 当前行为 | 可见的 partial |
| --- | --- | --- |
| target 抛错 | `_forward` 写入 error 并继续其它 Example；`error_handling="log"` 从开始就写 `reference_example_id`，`"ignore"` 只在成功 callback 补该引用 | `log` 保留 errored aligned Run；`ignore` 的失败 Run 仍可在 tracing project 中存在，但会从按 Example 对齐的 experiment 读取中消失 |
| row evaluator 抛错 | runner 为能够确定的 feedback keys 生成 `comment=repr(error)`、`extra.error=true`、无 score 的 error Feedback，然后继续 | Run 存在，Feedback 也是一条显式错误事实；不是“0 分” |
| summary evaluator 抛错 | 只写 client log，继续其它 summary evaluator；不构造 summary error Feedback | Project-level summary key 缺失；公开资源中没有等价 error row |
| project 名冲突 | 换随机后缀，最多十次 | 尚未进入 Run 执行；最终仍冲突则整体抛错 |
| 单条 Run POST/PATCH 最终失败 | 同步 path 抛错；create 的 conflict 被忽略以容许 caller-supplied UUID 重送 | 先前 Run 或其它 Example 已可能成功，没有 rollback |
| batch `/runs/batch` 最终失败 | 每 endpoint 最多三次；最终只 warning、error callback，方法不再抛出 | caller 若不监听 callback，可能误以为 tracing 成功；见 [`_post_batch_ingest_runs`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L3216-L3285) |
| 本地 tracing queue 满 | `_put_tracing_queue` 使用 `put_nowait`，满时写 drop 日志 | 对应 op 根本未入 client queue；flush 无法恢复已 drop 项。见 [`_put_tracing_queue`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L2543-L2551) |
| 批量 Example upload 中某批失败 | SDK 按 payload size 切批并可并行提交；future error 向 caller 抛出 | 较早批次已经落库，没有全 Dataset rollback；各批有各自 `as_of`，只返回最大值。[`create_examples`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/client.py#L6866-L7055) |
| server datastore 暂时失败 | self-hosted queue contract 表示会 retry | API 接受后，query 可能暂时不可见；exact retry count/poison queue 未公开 |

## Retry、repair 与 resume

- **资源级重送：** Run / Feedback ID 可由 client 预先生成；create Run conflict 被客户端忽略，适合至少一次传输下的重复 POST，但公开资料没有承诺整个 POST+PATCH+Feedback 序列 exactly-once。不要把 UUID 去重推广成 Experiment 事务幂等。
- **本地 drain：** 调 `Client.flush()` 可减少进程退出前遗留的后台 tracing ops；必须检查 timeout 与 error callback。它不是 resume checkpoint。
- **追加评价：** `evaluate_existing(experiment, evaluators, summary_evaluators)` 重新读取已有 Experiment 的 root Runs。它按 Project metadata 的 `dataset_version` 取回 Examples，然后只新增 Feedback，不重跑 target。这是公开代码中最明确的 repair/resume 面。[`evaluate_existing`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L416-L525) [versioned example load](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1212-L1221)
- **补缺 target：** SDK 可 reuse 传入的 Project 与自行选择的 Example iterable，因此 caller 能有意补跑一部分；但没有公开的“从最后成功 Example 自动续跑”游标、checkpoint 或 all-or-nothing resume API。补跑者必须自己盘点 `reference_example_id`、repetition 与 Run status，避免重复。
- **pairwise repair：** comparative runner 只处理所有 Experiment 都有 Run 的 Example 交集；它不会为缺失一侧产生错误 Feedback或补跑，具体风险见 [reading-and-comparison.md](reading-and-comparison.md)。

因此，Experiment 的可靠收尾需要 caller 组合检查 Run 终态、期望 Example×repetition 的命中情况、Feedback key 的命中情况、client flush、Session close 与可查询性。LangSmith 没有公开一个能替代这些检查的单一 completion marker。
