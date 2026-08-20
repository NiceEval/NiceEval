# W&B Weave：独立的 LLM 与 agent 产品面

> 观察日期：2026-08-14
>
> 观察对象：W&B Weave 的原生产品面，以及已经核对的 SDK、ClickHouse 与 migration 证据
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

Weave 是 W&B 面向 LLM 与 agent 的 observability and evaluation platform。
它与 W&B Models 共用账号、entity 与 project 名，但不是 Models Run 的一个视图。

Models 使用 Run、transaction log、filestream、Artifact、Workspace 与 Report。
Weave 使用 Op、Call、Trace、Object、Feedback、独立 HTTP API 与 trace server。
`CallSchema.wb_run_id` 只提供跨产品引用。
两边的持久结构和读取链不能合成一个 schema 或一个 reader。

本页只保留 Weave 的独立产品承诺、与 Models 的边界和证据索引。
字段、顺序、查询与 migration 语义由五个标准页分别维护：

| 机制 | 唯一正文 |
|---|---|
| component、owner、引用 | [layers.md](layers.md#weave) |
| Call / Evaluation 的发起、完成、partial 与 retry | [execution.md](execution.md#weave) |
| ref、`CallSchema`、ClickHouse 表、digest、WAL | [storage.md](storage.md#weave) |
| Traces / Evaluations、`get_calls`、对齐与缺测 | [reading-and-comparison.md](reading-and-comparison.md#weave) |
| 对象版本、兼容 reader 与编号 migration | [schema-and-migration.md](schema-and-migration.md#weave) |

## 原生产品面

### 两条工作流

[What is Weave?](https://docs.wandb.ai/weave/concepts/what-is-weave) 把 Weave 分成两条工作流：

| 工作流 | 用户动作 | 原生阅读面 |
|---|---|---|
| Trace an Agent | 按 OpenTelemetry 与 GenAI conventions 发送 session、turn、LLM call、tool call | Agents 与 Traces |
| Instrument functions as Ops | 用 `@weave.op` 跟踪任意函数 | Op、Call、Trace 与 Call 详情 |

两条工作流进入同一个 Weave 产品，但保留各自的输入形状。
任意 OTel span 可以进入 Traces；符合 GenAI agent conventions 的 span 还会进入 Agents。
见 [OTel integration](https://docs.wandb.ai/weave/guides/tracking/otel)。

### 产品资源与用户界面

| 产品面 | 原生对象 | 用户完成的任务 |
|---|---|---|
| Traces | Op、Call、Trace | 查看调用树、输入、输出、耗时、异常与 Feedback |
| Agents | session、turn、agent span | 按对话结构查看 agent 行为 |
| Evaluations | Dataset、Evaluation、evaluate Call、scorer Call | 运行评测、查看逐行结果、比较多次评测 |
| Objects | versioned Object / Op / Dataset / Model / Prompt | 固定可复用定义与数据的版本 |
| Feedback | 挂在 `weave_ref` 上的 reaction、note、annotation、scorer result | 事后添加、查询或 purge 评价 |
| SavedView | builtin Object | 保存 Call 表的列、过滤与排序 |

原生名词、owner 与引用图见 [layers.md](layers.md#weave)。
这里不再复制 `CallSchema` 字段、Evaluation 执行顺序或查询参数。

### Evaluation 是蓝图，运行仍是 Call

[Evaluations](https://docs.wandb.ai/weave/guides/core-types/evaluations) 把 `Evaluation` 定义为 dataset、scorers 与可选 preprocess 的蓝图。
调用 `.evaluate(model)` 才产生一次 evaluation run；该次运行落成 `Evaluation.evaluate` Call 与子 Call 树。

[Export evaluation data](https://docs.wandb.ai/weave/guides/evaluation/export_eval) 用 `row_digest` 对齐多次评测的同一数据行。
这条行级身份与 Models history step、Runset 或 Table join key 都不是同一对象。

## 与 W&B Models 的边界

| 边界 | W&B Models | W&B Weave |
|---|---|---|
| 执行身份 | project 内的 Run ID | Call ID；`trace_id` 把 Call 组成 Trace |
| 用户写入 | `wandb.init()`、`run.log()`、config、summary、Artifact | `weave.init()`、`@weave.op`、OTLP、Feedback |
| 本机耐久 | Run 目录与 `run-{id}.wandb` | `~/.weave/wal/{project_id}/` |
| 服务端公开结构 | GraphQL Run 可观察；Models 表实现未公开 | 开源 trace server 提供 Call / Object / Table / File / Feedback 的 ClickHouse DDL |
| 历史读取 | `wandb.Api`、Workspace、Report、Run history | `get_calls`、Evaluation REST、Traces、Agents、Evaluations |
| 跨产品连接 | Run 被引用 | Call 可选写 `wb_run_id` / `wb_run_step` |

[Call schema reference](https://docs.wandb.ai/weave/guides/tracking/call-schema-reference) 公开了 `wb_run_id` 等可选字段。
它没有把 Models config、history、summary 或 Artifact manifest 加入 Weave 信封。

开源 [`001_init.up.sql`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/migrations/001_init.up.sql) 也没有 Models Run 表。
因此 `wb_run_id` 是外键式关联，不是共同持久格式。
`CallsFilter.wb_run_ids` 只能筛选相关 Call，也不是 Models `api.runs` 的联合查询。

## 已核对版本

| 对象 | 版本或观察点 | 固定点 |
|---|---|---|
| Python `weave` | `0.53.2`（2026-07-16） | [tag](https://github.com/wandb/weave/releases/tag/v0.53.2) · `59a9d186afaf9e3c020cd8a0fedd0ee439a7f101` |
| Python `wandb` | `v0.28.2`（2026-08-12） | [tag](https://github.com/wandb/wandb/releases/tag/v0.28.2) · `dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c` |
| `wandb-workspaces` | `0.4.5`（2026-08-04） | [tag](https://github.com/wandb/wandb-workspaces/releases/tag/v0.4.5) · `ed5390c1a70279dadeefb6365b89d3fb0ba894bb` |
| 官方文档仓 `wandb/docs` | 观察日 `main` | `66c54438e7833c9643a328d8bdc17e0c4cc12b5c`（2026-08-13） |

文档站会持续变化。
SDK 行为冲突时，以表中的 tag 源码为准。

## SDK 证据索引

| 一手证据 | 已核对的边界 | 机制正文 |
|---|---|---|
| [`WeaveClient`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace/weave_client.py) | `create_call`、`finish_call`、`get_calls` 分别拥有写入结束与读取入口 | [execution](execution.md#发起一条-op) · [reading](reading-and-comparison.md#weave) |
| [`CallSchema`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/trace_server_interface.py) | Call 身份、树、输入输出、summary、删除、TTL 与可选 Models 引用属于一个公开信封 | [storage](storage.md#callschema) |
| [`Ref`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace/refs.py) 与 [`refs_internal`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/shared/refs_internal.py) | 用户空间使用 `weave:///`；内部使用 `weave-trace-internal:///` 与 `project_id` | [storage](storage.md#用户空间-ref) |
| [`Evaluation`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/evaluation/eval.py) | 蓝图、`.evaluate()`、scorer 子 Call 与历史 evaluate Call 的关系 | [execution](execution.md#执行-evaluation) |
| [`WAL`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/durability/wal.py) | 本机队列、checkpoint、deadletter 与至少一次重新发送 | [storage](storage.md#本机-wal-与-cache) · [execution](execution.md#weave) |
| [`digest.py`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/shared/digest.py) | Object、row、table 与 file 使用 canonical JSON 和 SHA256 digest | [storage](storage.md#digest-与-dataset-行) |
| [Query model](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/interface/query.py) | Call 查询提供 Mongo aggregation 子集，不等于 Models Run filter | [reading](reading-and-comparison.md#weave) |

## ClickHouse 与 migration 证据索引

| 一手证据 | 已核对的事实 | 机制正文 |
|---|---|---|
| [Trace server README](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/README.md) | `RemoteHTTPTraceServer` 到 `ClickHouseTraceServer` 的 Call 写入链 | [layers](layers.md#客户端到-server) · [execution](execution.md#发起一条-op) |
| [`001_init.up.sql`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/migrations/001_init.up.sql) | 初始 schema 分开保存 call parts、object versions、table rows、tables 与 files | [storage](storage.md#clickhouse-表开源-server) |
| [`022_calls_complete.up.sql`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/migrations/022_calls_complete.up.sql) | `calls_complete` 提供完整 Call 行，并区分 `direct`、`dual`、`migration` | [storage](storage.md#clickhouse-表开源-server) |
| [`024` migration](https://github.com/wandb/weave/tree/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/migrations) | 已运行旧 `022` 的实例通过 `024` 从 v1 表升级到 v2；新安装实例执行同一步也安全 | [schema](schema-and-migration.md#数据库-migration) |
| [`clickhouse_trace_server_migrator.py`](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/clickhouse_trace_server_migrator.py) | `001`–`039` 各有 up/down SQL；cloud、replicated、distributed 模式共享 revision 序列 | [schema](schema-and-migration.md#数据库-migration) |

编号 migration 会改变开源 server 的表形状，也可能回填 `calls_complete`。
它不要求用户改写已经 `publish` 的 Object JSON。
对象 digest 版本与数据库 revision 是两条不同版本轨道。

## 可验证边界

| 面 | 本次检查能确认什么 |
|---|---|
| Python SDK、Node SDK、trace server 接口 | 在 `wandb/weave` 开源仓中可核对 |
| ClickHouse DDL 与 `001`–`039` migration | 开源 server 的权威 schema |
| SaaS `trace.wandb.ai` 的部署拓扑、多租户与权限表 | 一手公开面未提供 |
| Weave UI 完整前端源码与 SavedView 服务端 JSON | 一手公开面未提供 |
| 云端是否逐条运行开源 migration | 官方未单独承诺 |
| Models Workspace 与 Weave Traces 的联合查询 | 一手公开面只提供 `wb_run_id` / `wb_run_ids` |

开源 server 的 SQL 可以证明 Weave 自己的持久边界。
它不能证明 SaaS 物理部署与开源表逐字相同，也不能补出 Models 的闭源服务端 schema。
