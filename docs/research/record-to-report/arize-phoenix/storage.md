# Phoenix 的持久对象与权威 / 派生区分

> 观察日期：2026-08-14
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

用户不直接打开数据库。
权威形状仍写在 SQLAlchemy model、REST 资源与 Alembic revision 里。
官方 ERD 见 [`src/phoenix/db/README.md`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/README.md)。
对象总图见 [README.md](README.md)。
谁写入这些行见 [execution.md](execution.md)。

模型类钉到 tag `arize-phoenix-v20.2.0`。
[`models.py`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/models.py)

## 文件与身份

未设置 `PHOENIX_SQL_DATABASE_URL` 时，默认 SQLite 文件是 `{working_dir}/phoenix.db`。
`working_dir` 默认 `~/.phoenix`。
[`get_env_database_connection_str`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/config.py)

PostgreSQL 通过同一 `PHOENIX_SQL_DATABASE_URL` 接入。
本次检查的一手公开面未提供对象存储式的用户事实包或内容寻址 root。

公开 API 身份不是整数主键。
REST 与 GraphQL 使用 Relay `GlobalID`，例如 `Experiment` + 行号再编码。

Client 类型 `Experiment`、`ExperimentRun` 来自生成的 `v1` OpenAPI 模型。
`ExperimentEvaluationRun` 是 Client 本地 dataclass，提交后变成服务端 `ExperimentRunAnnotation`。
[types.py](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/packages/phoenix-client/src/phoenix/client/resources/experiments/types.py)

## Trace 与 Span

| 对象 | 公开身份 | 表 / class | 权威事实 | 派生、索引或 cache |
|---|---|---|---|---|
| Project | 名字唯一 | `projects` / `Project` | `name`、描述、颜色、retention 外键 | 默认插入名为 `default` 的项目 |
| ProjectSession | `session.id` 属性 | `project_sessions` / `ProjectSession` | `session_id` 唯一；`start_time` / `end_time` 随 Trace 伸缩 | 时间范围索引 |
| Trace | OTel `trace_id` | `traces` / `Trace` | `trace_id` 唯一；`project_rowid`；起止时间 | `latency_ms` hybrid，读取时用起止时间计算 |
| Span | OTel `span_id` | `spans` / `Span` | `span_id` 全局唯一；`parent_id`；`attributes` JSON；`events`；`status_code` | `latency_ms` hybrid；token 累计列；`ix_spans_session_id` 索引 `attributes.session.id` |
| SpanCost | 内部行 | `span_costs` / `SpanCost` | daemon 按价目表写入的 USD 与 token | 预置 Metrics 读取这些行 |

产品事实：一次应用运行形成一条 Trace。它由若干 Span 组成。根 Span 表示请求从开始到结束。
[What are Traces](https://arize.com/docs/phoenix/tracing/concepts-tracing/what-are-traces)

产品事实：Span 属性是任意键值对。键必须是非空字符串。
OpenInference 保留 `openinference.span.kind`、`input.value`、`output.value`、`llm.token_count.*` 等键。
[Semantic Conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html)

产品事实：重复写入同一 `span_id` 时，`insert_span` 使用 `OnConflict.DO_NOTHING`。
已存在的 Span 不会被替换。
[`insert_span`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/insertion/span.py)

产品事实：Trace 的起止时间会随后到的 Span 扩展。
已存在 Trace 换项目名时，`insert_span` 忽略新的 `project_name`，沿用原 `project_rowid`。

## Dataset、Example 与 revision

| 对象 | 公开身份 | 表 / class | 权威事实 |
|---|---|---|---|
| Dataset | 名字唯一；REST `Dataset` GlobalID | `datasets` / `Dataset` | `name`、`description`、`metadata` |
| DatasetVersion | REST `DatasetVersion` GlobalID | `dataset_versions` / `DatasetVersion` | 每次 insert、update、delete 新建一行 |
| DatasetExample | REST `DatasetExample` GlobalID；可选 `external_id` | `dataset_examples` / `DatasetExample` | 稳定行；可选 `span_rowid`；`(dataset_id, external_id)` 唯一 |
| DatasetExampleRevision | 内部行 | `dataset_example_revisions` / `DatasetExampleRevision` | `input` / `output` / `metadata` JSON；`revision_kind` 只能是 `CREATE`、`PATCH`、`DELETE`；`(example, version)` 唯一 |
| DatasetSplit | 名字唯一 | `dataset_splits` | 把 example 划进子集 |
| DatasetLabel | 名字唯一 | `dataset_labels` | 给 Dataset 打标签 |

产品事实：Phoenix 没有 Dataset 类型枚举。`inputs` 与 `outputs` 是任意键值对。
[Concepts: Datasets](https://arize.com/docs/phoenix/datasets-and-experiments/concepts-datasets)

产品事实：读取某个 version 时，服务端按 `dataset_version_id <= 目标 version` 取每个 example 的最新 revision。
最新 revision 若是 `DELETE`，该 example 不进入该 version。
符号是 `_build_ranked_revisions_query` 与 `get_dataset_example_revisions`，都在 `src/phoenix/db/helpers.py`。

产品事实：`example_count` 不是 `datasets` 上的存列。
它是 hybrid：`CREATE` 加一，`DELETE` 减一。

产品事实：稳定 `external_id` 可以让后续上传做 diff。
`create_dataset(..., example_id_key=...)` 会按 ID 增、改、删。
`add_examples_to_dataset` 不会因为缺行就删旧 example。
[Updating Datasets](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-datasets/updating-datasets)

## Experiment、Run 与 Evaluation

| 对象 | 公开身份 | 表 / class | 权威事实 | 派生 |
|---|---|---|---|---|
| Experiment | REST `Experiment` GlobalID | `experiments` / `Experiment` | `dataset_id`、`dataset_version_id`、`repetitions`、`metadata`、`project_name`、`is_ephemeral` | 列表上的 run 计数 |
| Experiment snapshot | 无独立公开类型 | `experiments_dataset_examples` / `ExperimentDatasetExample` | 创建时固定 `dataset_example_id` + `dataset_example_revision_id` | 之后 Dataset 再改也不回写这张表 |
| ExperimentRun | REST `ExperimentRun` GlobalID | `experiment_runs` / `ExperimentRun` | `(experiment, example, repetition)` 唯一；`output`；`error`；可选 `trace_id` | `latency_ms` hybrid |
| ExperimentRunAnnotation | REST 类型名是 `ExperimentEvaluation` | `experiment_run_annotations` / `ExperimentRunAnnotation` | `(experiment_run_id, name)` 唯一；`score` / `label` / `explanation` / `error`；可选 evaluator `trace_id` | 无 |
| ExperimentJob | UI badge | `experiment_jobs` / `ExperimentJob` | `status`、`claimed_at`、`type` | 只存在于服务端作业 |

REST 创建信封见 [execution.md](execution.md)。

## Annotation

| 对象 | 表 | 唯一键 | `annotator_kind` / `source` |
|---|---|---|---|
| SpanAnnotation | `span_annotations` | `(name, span_rowid, identifier)` | `annotator_kind`：`LLM` / `CODE` / `HUMAN`；`source`：`API` / `APP` |
| TraceAnnotation | `trace_annotations` | `(name, trace_rowid, identifier)` | 同上 |
| DocumentAnnotation | `document_annotations` | `(name, span_rowid, document_position, identifier)` | 同上 |
| ProjectSessionAnnotation | `project_session_annotations` | `(name, project_session_id, identifier)` | 同上 |

产品事实：UI rubric 类型是 Categorical、Continuous 或 Freeform。
这只约束人在 UI 里怎么打分，不约束 OTel 写入。
[Annotations Concepts](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts)

产品事实：没有不同 `identifier` 时，同名 annotation 会替换旧值。
[Annotating via the Client](https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/capture-feedback)

产品事实：从 Span 建 Dataset 时，常见做法是把 `trace_id` / `span_id` 放进 example `metadata`。
只有显式 span link 才会填充 REST 的 `source.span_id` 与 `source.span_node_id`。
[Linking Examples](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-datasets/linking-examples-to-spans)

## 可计算却仍落库，与读取时计算

| 数据 | 归类 | 为什么这样 |
|---|---|---|
| `Span.llm_token_count_*` 与 cumulative token / error | 权威副本，从 attributes 抽出 | 便于过滤和累计；列只包含官方常用计数 |
| `span_costs` / `span_cost_details` | 服务端算出后落库 | 按当时价目表供 Metrics 使用 |
| `experiments_dataset_examples` | 权威快照 | 把比较分母固定下来 |
| `ExperimentRun.output` | 权威副本 | Trace 被 retention 删掉后比较页仍有输出 |
| `Trace` / `Span` / `ExperimentRun.latency_ms` | 读取时计算 | hybrid，用 `end_time - start_time` |
| Dataset `example_count` | 读取时计算 | `CREATE - DELETE` |
| Experiment 三个 run 计数 | 读取时计算 | GET / 列表时对 runs 与快照计数 |
| Filter / Metrics 聚合 | 查询时计算 | 预置 Dashboard 不是用户声明的持久 Report |

产品事实：Cost 的默认路径是「写 token，由服务端算 USD」。
[Cost Tracking](https://arize.com/docs/phoenix/tracing/how-to-tracing/cost-tracking)
OpenInference 也保留 `llm.cost.*` 键，规范把它们定义为 USD。

产品事实：Span 与对应 `SpanCost` 不是同一事务。
Cost daemon 另开循环，失败只记日志。
[`span_cost_calculator.py`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/daemons/span_cost_calculator.py)

产品事实：`BulkInserter` 按队列批量写 Span 与 annotation。
默认每笔事务最多 1000 次操作。这是服务端批量提交，不是用户可见的多对象事务。

价目表变化会不会重写历史 `span_costs`，见 [schema-and-migration.md](schema-and-migration.md)。
