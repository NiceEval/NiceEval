# W&B 的持久结构

> 观察日期：2026-08-14
>
> 精确到公开 type / class、table / model、文件 / 目录、序列化 envelope 或 API resource。
> 标出权威事实、派生值、summary / index / cache。
>
> 生命周期 owner 见 [execution.md](execution.md)。版本与 migration 见 [schema-and-migration.md](schema-and-migration.md)。

本页并列两套持久结构，只为对照研究。
Models 的 transaction log、filestream 与 GraphQL Run，不和 Weave 的 WAL、Call / Object / Feedback 表组成共同 schema。

## Models

### 本地目录

`Settings.wandb_dir` 默认是项目根下的 `wandb/`。
若已存在 `.wandb/`，则用点目录。
一次 Run 的目录名是 `{run_mode}-{YYYYMMDD_HHMMSS}-{run_id}`。
在线是 `run-...`，离线是 `offline-run-...`。
`wandb/sdk/wandb_settings.py` @ `dc1ef8be`

| 路径 | 符号 | 分类 | 内容 |
|---|---|---|---|
| `{wandb_dir}/{run_mode}-{timespec}-{run_id}/` | `Settings.sync_dir` | 权威（本机工作目录） | 该次 Run 的根 |
| `{sync_dir}/run-{run_id}.wandb` | `Settings.sync_file` | 权威（可回放） | protobuf transaction log |
| `{sync_dir}/files/` | `Settings.files_dir` | 权威（待上传文件） | `run.save()` 与内部文件 |
| `{sync_dir}/logs/debug.log` | `Settings.log_user` | 诊断 | 用户进程日志 |
| `{sync_dir}/logs/debug-internal.log` | `Settings.log_internal` | 诊断 | core 内部日志 |
| `{sync_dir}/tmp/code/` | `Settings._tmp_code_dir` | 临时 | code saving |
| `{wandb_dir}/latest-run` | `Settings.sync_symlink_latest` | 便利 symlink | 指向最近一次 sync_dir |
| `{wandb_dir}/wandb-resume.json` | `Settings.resume_fname` | 本机 resume 提示 | `resume="auto"` |
| `{wandb_dir}/settings` | `Settings.settings_workspace` | 本机配置 | workspace settings |

### transaction log envelope

`wandb_internal.proto` 写明：一串 `Record` 完整定义一次 Run。
log 可以回放，用来重新上传或第一次离线上传。
`wandb/proto/wandb_internal.proto` @ `dc1ef8be`

`Record` 的 `oneof record_type`：

- 高频：`HistoryRecord`、`SummaryRecord`、`OutputRecord`、`ConfigRecord`、`FilesRecord`、`StatsRecord`、`ArtifactRecord`、`MetricRecord`
- 低频：`RunRecord`、`RunExitRecord`、`FinalRecord`、`HeaderRecord`、`FooterRecord`、`UseArtifactRecord`、`EnvironmentRecord`

维护者文档区分三类。
[architecture.md](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/docs/sdk/architecture.md)

| 概念 | 作用 | 是否写入 `.wandb` |
|---|---|---|
| `ServerRequest` | Python 到 core 的外层信封 | 否 |
| `Record` | 每次 Run 的持久消息 | 是 |
| `Request` | 需要响应的 run 级消息 | 否 |

`HeaderRecord` 带 `VersionInfo`：`producer` 与 `min_consumer`。
语义见 [schema-and-migration.md](schema-and-migration.md#models)。

### filestream 文件

core 上传这些文件名。
[wandb-core.md](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/docs/sdk/wandb-core.md) @ `dc1ef8be`

| 文件名 | 内容 | 分类 |
|---|---|---|
| `wandb-history.jsonl` | 逐步 metric history | 权威时间序列 |
| `wandb-events.jsonl` | 系统指标 | 权威机器指标 |
| `wandb-summary.json` | 当前 summary | 权威或派生单值摘要 |
| `output.log` | stdout / stderr | 权威控制台 |

HTTP 入口是 `POST /files/{entity}/{project}/{run}/file_stream`。
history JSON 使用扩展 JSON，可以表示 `NaN` 与 inf。

服务端如何把这些文件落成表或对象存储，本次检查的一手公开面未提供。

### GraphQL `Run` 资源

Public API 用 fragment `RunFragment`。
`wandb/apis/public/runs.py` @ `dc1ef8be`

```graphql
fragment RunFragment on Run {
    id tags name displayName sweepName state config
    group jobType commit readOnly createdAt heartbeatAt
    description notes systemMetrics summaryMetrics
    historyLineCount user { name username } historyKeys
}
```

列表查询是 `query Runs(..., $filters: JSONString)`，默认 `perPage = 50`。

| GraphQL 字段 | Public API 属性 | 含义 | 分类 |
|---|---|---|---|
| `name` | `Run.id` | 项目内 run ID | 权威身份 |
| `displayName` | `Run.name` | 可读显示名 | 权威，可变 |
| `id` | `Run.storage_id` | 后端存储 ID | 权威 |
| `config` | `run.config` | 输入超参 | 权威 |
| `summaryMetrics` | `run.summary` | 输出摘要 | 权威或派生 |
| `systemMetrics` | `run.system_metrics` | 最新系统指标 | summary |
| `historyKeys` | `run.history_keys` | 已 log 的 metric 名 | index |
| `historyLineCount` | 列表元数据 | history 行数 | index |

官方含义见 [Public API](https://docs.wandb.ai/models/track/public-api-guide)：

| 属性 | 官方含义 |
|---|---|
| `run.config` | 输入，例如超参或预处理 |
| `run.history()` | `log()` 追加的变化值 |
| `run.summary` | 输出摘要；默认是每个 key 的最后一次 `log` |

### Artifact 与 Table

`ArtifactRecord` 带 `name`、`type`、`digest`、`aliases`、`tags`、`manifest`、`distributed_id`、`finalize`。

`ArtifactManifest` proto 字段：`version`、`storage_policy`、`storage_policy_config`、`contents` 或超大时的 `manifest_file_path`。

Python `ArtifactManifestV1` 把 JSON 写成 `wandb_manifest.json`：
`wandb/sdk/artifacts/artifact_manifests/artifact_manifest_v1.py` @ `dc1ef8be`

```json
{
  "version": 1,
  "storagePolicy": "...",
  "storagePolicyConfig": {},
  "contents": {
    "path/to/file": { "digest": "...", "size": 0 }
  }
}
```

digest：固定头 `wandb-artifact-manifest-v1\n`，再按 path 排序追加 `{path}:{entry.digest}\n`，取 MD5 hex。

`ArtifactState`：`PENDING`、`COMMITTED`、`DELETED`、`GARBAGE_COLLECTED`、`PENDING_DELETION`。
`wandb/sdk/artifacts/artifact_state.py` @ `dc1ef8be`

同名同 type 再次写入时做 checksum；有变化则保存 `v1`。
见 [Create an artifact version](https://docs.wandb.ai/models/artifacts/create-a-new-artifact-version)。
这是对象版本，不是用户 payload 的 schema 版本。

`wandb.Table` 是带列名的二维事实，作为 Artifact 持久化。
文档写上限 200,000 行；源码区分 `MAX_ROWS = 10000` 与 `MAX_ARTIFACT_ROWS = 200000`。
[table.py](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/wandb/sdk/data_types/table.py)

### 权威、派生、index、cache

| 对象 | 分类 | 理由 |
|---|---|---|
| `.wandb` transaction log | 权威 | proto 写明它完整定义一次 Run |
| `wandb-history.jsonl` / `wandb-events.jsonl` / `output.log` | 权威 | filestream 原始流 |
| GraphQL `Run.name` / `state` / `config` | 权威 | 服务端 Run 资源 |
| Artifact `wandb_manifest.json` 与文件 digest | 权威 | checksum 决定 `vN` |
| `wandb-summary.json` / `summaryMetrics` | 权威或派生 | 用户可显式写；默认由 history 或 `define_metric` 得到 |
| `historyKeys` / `historyLineCount` | index | 列表用的轻量字段 |
| Workspace 自动面板 | 派生 | 按 key 生成，读时计算 |
| `run.history(samples=500)` | 采样视图 | 文档写明 sampled |
| `scan_history(use_cache=True)` 的 `WANDB_CACHE_DIR` | cache | 未命中再下载 |
| Artifact file / checksum cache | cache | 本机加速 |
| `latest-run` symlink、`debug.log` | 便利 / 诊断 | 不是用户事实 |

云端或自托管用来存 history 的数据库 table / model，本次检查的一手公开面未提供。
`wandb/server` 只公开 Docker 入口。
[server README](https://github.com/wandb/server/blob/main/README.md)

## Weave

### 用户空间 ref

`Ref.parse_uri` 只接受 `weave:///`。
`weave/trace/refs.py` @ `59a9d186`

| kind | URI | 公开类型 |
|---|---|---|
| object | `weave:///{entity}/{project}/object/{name}:{digest}` | `ObjectRef` |
| op | `weave:///{entity}/{project}/op/{name}:{digest}` | `OpRef` |
| call | `weave:///{entity}/{project}/call/{id}` | `CallRef` |
| table | `weave:///{entity}/{project}/table/{digest}` | `TableRef` |
| agent_turn | `weave:///{entity}/{project}/agent_turn/{trace_id}` | `AgentTurnRef` |
| agent_conversation | `weave:///{entity}/{project}/agent_conversation/{id}` | `AgentConversationRef` |
| agent_span | `weave:///{entity}/{project}/agent_span/{span_id}` | `AgentSpanRef` |

digest 也可用 `vN` 或可移动 alias。
extra path 用 `attr` / `key` / `index` / `id` 进入嵌套值。

内部存储把 `entity/project` 换成 `project_id`，scheme 换成 `weave-trace-internal`。
`weave/shared/refs_internal.py` @ `59a9d186`

### `CallSchema`

`weave/trace_server/trace_server_interface.py` @ `59a9d186`
官方页：[Call schema](https://docs.wandb.ai/weave/guides/tracking/call-schema-reference)

| 字段 | 类型 | 分类 |
|---|---|---|
| `id` / `project_id` / `trace_id` / `parent_id` | str | 权威身份 |
| `op_name` / `display_name` | str | 权威 |
| `thread_id` / `turn_id` | str? | 权威，可选 |
| `started_at` / `ended_at` | datetime | 权威；结束可空 |
| `attributes` | dict | 权威；创建后只读 |
| `inputs` / `output` / `exception` | dict / Any / str? | 权威 |
| `summary` | `SummaryMap`? | 部分权威、部分派生 |
| `wb_user_id` / `wb_run_id` / `wb_run_step` | 可选 | 跨到 Models 的引用 |
| `deleted_at` / `expire_at` | datetime? | 权威删除 / TTL |
| `storage_size_bytes` | int? | 派生 |

`attributes` 在创建后冻结。
`summary` 可在执行中修改，`finish_call` 再与 usage / status deep-merge。

### ClickHouse 表（开源 server）

`001_init.up.sql` @ `59a9d186`

| 表 / 视图 | 引擎或性质 | 分类 |
|---|---|---|
| `call_parts` | MergeTree；一次逻辑 Call 通常两行（start + end） | 权威写入 |
| `calls_merged` | AggregatingMergeTree | 由 view 聚合 start/end |
| `calls_merged_view` | MATERIALIZED VIEW | 派生 |
| `object_versions` | ReplacingMergeTree，`(project_id, kind, object_id, digest)` | 权威 Object / Op |
| `object_versions_deduped` | VIEW | 派生 `version_index` / `is_latest` |
| `table_rows` | ReplacingMergeTree，`(project_id, digest)` | 权威行 |
| `tables` | ReplacingMergeTree；`row_digests` 数组 | 权威表 |
| `files` | ReplacingMergeTree；按 chunk | 权威文件字节 |
| `feedback` | `003_feedback.up.sql` | 权威 Feedback |
| `calls_complete` | `022` / `024`；ReplacingMergeTree + TTL | 权威完整 Call 行 |

短 Call 可直接插入 `calls_complete`，`source` 为 `direct`。
`source` 还有 `dual` 与 `migration`。
`022_calls_complete.up.sql` @ `59a9d186`

`ObjSchema` 字段：`object_id`、`digest`、`version_index`、`is_latest`、`kind`、`base_object_class`、`leaf_object_class`、`val`、`tags`、`aliases`。

`Feedback` / `FeedbackCreateReq` 字段：`id`、`feedback_type`、`weave_ref`、`payload`、`creator`、`wb_user_id`。
`wandb.` 前缀留给官方类型。

后续加列清单见 [schema-and-migration.md](schema-and-migration.md#weave)。
这些 SQL 是开源 server 的权威 schema。
云端是否原样使用，官方未单独承诺。

### digest 与 Dataset 行

`weave.shared.digest` 用 canonical JSON + SHA256，再做 urlsafe base64 变体。
同一套函数算 Object digest、row digest、table digest、file digest。
`weave/shared/digest.py` @ `59a9d186`

Evaluation export 使用 `row_digest`，按行内容而不是位置对齐。
见 [Export evaluation data](https://docs.wandb.ai/weave/guides/evaluation/export_eval)。

### 本机 WAL 与 cache

| 路径 | 符号 | 分类 |
|---|---|---|
| `~/.weave/wal/{project_id}/{timestamp}-{uuid}.wal` | `WALWriter` | 本机权威队列 |
| 同名 `.checkpoint` | `WALConsumer` | 进度，不是用户事实 |
| 同名 `.deadletter` | WAL | 发送失败条目 |
| `settings.server_cache_dir` | 客户端 HTTP cache | cache；默认临时目录，上限约 1GB |
| `~/.cache/wandb/weave-scorers` | scorer 权重 | cache |

WAL record type：`call_start`、`call_end`、`obj_create`、`table_create`、`file_create`。
`weave/durability/wal.py` @ `59a9d186`
