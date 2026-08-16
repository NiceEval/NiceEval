# W&B 的 schema、版本与 migration

> 观察日期：2026-08-14
>
> 写全部公开的 schema / version 轨道、兼容 reader、数据库 migration、升级命令、是否重写已保存数据。
> 落盘形状见 [storage.md](storage.md)。

## Models

### 轨道

| 轨道 | 公开形状 | 改它会不会重写用户已存事实 |
|---|---|---|
| protobuf `Record` | `wandb_internal.proto`；`HeaderRecord.VersionInfo` 记 `producer` / `min_consumer` | 新 SDK 应能 sync 旧 `.wandb`；字段必须遵守 protobuf 兼容纪律 |
| Artifact manifest | 字面量 `manifest_version = 1` | 本次检查未见 v2 或相邻 migration |
| Artifact 对象版本 | 内容 checksum 后的 `vN` 与可移动 alias | 新内容产生新 version，不改旧 version 字节 |
| SDK 行为 | [BREAKING.md](https://github.com/wandb/wandb/blob/v0.28.2/BREAKING.md) 要求破坏性变更伴随 minor bump | 客户端行为变更；未见「升级 SDK 后重写已同步 Run 字节」的用户 API |
| 自托管 Server | Terraform / Helm 换 `image.tag` 与 license | 官方升级指南不声明重写用户 history |
| GraphQL `Run` | `RunFragment` 字段集 | 完整 IDL 与版本承诺未公开 |
| Workspace / Report 代码 API | `wandb-workspaces` `0.4.5`，文档标 Public Preview | 布局对象的服务端 JSON 未公开 |

`HeaderRecord.VersionInfo` 在 `wandb_internal.proto` @ `dc1ef8be`。
proto 注释写明：producer 与 consumer 版本可以不同，SDK 可以 sync 旧 transaction log。

`ArtifactManifestV1.manifest_version` 固定为 `1`。
`wandb/sdk/artifacts/artifact_manifests/artifact_manifest_v1.py` @ `dc1ef8be`

`v0.28.2` 把 `wandb sync --clean` 换成 `wandb clean`。
`define_metric` 的 `summary="best"` / `"copy"` 已在 BREAKING.md 标记删除。

### 兼容 reader

- 新 SDK 通过 protobuf 兼容规则读旧 `.wandb`。
- Public API 按 run ID 继续读历史 Run。
- 本次检查未见按用户 schema identity 投影的 reader。
- 本次检查未见 Models 侧与 Weave `DeletedRef` 对等的公开类型。
- `resume_from` / `fork_from` / `mode="shared"` 官方标 beta / experimental，不是最终契约。

### 升级命令

自托管升级走 Terraform 或 Helm，改 `wandb_version` / `image.tag` 与 `license`。
[Server upgrade](https://docs.wandb.ai/platform/hosting/server-upgrade-process)
[Helm upgrade](https://github.com/wandb/helm-charts/blob/main/upgrade)

Admin UI 只能换 license，不能换 Server 版本。

`wandb/server` [0.83.0](https://github.com/wandb/server/releases/tag/0.83.0) 有一条修复：通过 API 给已结束 Run 上传的文件可能不出现在 Run 页。
该修复要求 SDK ≥ `v0.28.1`。
它不是通用 schema migration 声明。

用户没有 `wandb migrate` 去把旧 history 键批量改写成新 schema。
能做的是事后改 config / summary，或把分析写进 `job_type="analysis"` 的新 Run。
见 [Public API](https://docs.wandb.ai/models/track/public-api-guide)。
重命名 summary 不会改图表引用的原名。

### 哪些可计算却仍持久化

| 值 | 为何本可计算 | 为何仍落盘 |
|---|---|---|
| `summary` 默认 last / min / max | 可从完整 history 重算 | 列表、搜索、面板需要单值 |
| `historyKeys` / `historyLineCount` | 可扫 history 得到 | GraphQL 列表要用轻量字段 |
| 自动系统指标 | 机器当时的读数 | 事后无法回到当时的 CPU / GPU |
| `wandb-summary.json` | 与 `SummaryRecord` 内容重复 | filestream 把它当作独立流 |

`define_metric(..., summary=)` 接受 `min`、`max`、`mean`、`best`、`last`、`none`。
见 [Log summary](https://docs.wandb.ai/models/track/log/log-summary)。

读取时才计算的项（自动面板、500 点采样、baseline delta、Table stepper 沿用上值）见 [reading-and-comparison.md](reading-and-comparison.md#models)。

用户加一个 metric 名、一列 Table、一个 Artifact type，不发布新的持久格式。
envelope 保持 `Record` / GraphQL `Run` / Artifact manifest v1。

## Weave

### 轨道

| 轨道 | 公开形状 | 改它会不会重写用户已存事实 |
|---|---|---|
| 用户 Object / Op / Dataset / Evaluation 版本 | 内容 digest；VIEW 算 `version_index` / `is_latest` | 新内容产生新 digest，不改旧 version |
| 用户空间 ref | `weave:///`；内部 `weave-trace-internal:///` | 旧 `wandb-artifact:///` 仍出现在内部类型 |
| `CallSchema` 信封 | `trace_server_interface.py` | 加字段走 SQL migration；旧 JSON dump 通常保留 |
| ClickHouse 表 revision | `migrations/001` 至 `039` 的 up/down SQL | **会改 server 表形状**；可能 backfill `calls_complete` |
| SDK semver | `weave/version.py` `VERSION = "0.53.2"` | 在完成核心功能前主要加 PATCH |
| 成本表 | `006_seed_costs` / `027_add_cache_token_costs` | 服务端对照表，不是用户 Object |

Object version 来自内容 digest。
`object_versions_deduped` 按 `created_at` 算出 `version_index` 与 `is_latest`。
`001_init.up.sql` @ `59a9d186`
alias 如 `latest` 可移动。
删除某个 version 不会改写其它 digest。

这与 Models Artifact `vN` 类似，但是 Weave Object 表，不是 `wandb_manifest.json`。

### 数据库 migration

开源 server 用 `clickhouse_trace_server_migrator.py` 跑 `migrations/*.up.sql`。
每份都有对应 `.down.sql`。
cloud / replicated / distributed 三种模式会改写 DDL，revision 编号相同。
`weave/trace_server/clickhouse_trace_server_migrator.py` @ `59a9d186`

这些 migration **会改变 server 保存的表形状**。
例如增加列、换 `calls_complete` 引擎、加 TTL、加索引。
它们不要求用户改自己 `publish` 的 Object JSON。

`022` 注释写明：该文件曾被回溯改成直接建 v2 表。
已跑过旧版的实例由 `024` 做 v1 → v2 升级。
新装的空表跑 `024` 的 rename 是 harmless。
`022_calls_complete.up.sql` @ `59a9d186`

后续 migration 继续加列，而不是换用户 schema 名：

- `deleted_at`、`display_name`、`cost`、`wb_run_step`、`thread_id`、`turn_id`、`otel_dump`
- `tags` / `aliases`、TTL、agent tables、scorer feedback 列、dataset_sources

`calls_complete.source = migration` 表示行来自表迁移，不是用户新写入。

用户没有 `weave migrate` 去改已经 `publish` 的对象。

### 兼容 reader

- `EndedCallSchemaForInsert.trace_id` 对旧客户端可选；server 可从对应 call-start 推导。
- `set_base_object_class` 保留到 `builtin_object_class`，并标 deprecated。
- 旧客户端仍可能只发 start/end；新 SDK 默认走 `calls_complete`。
- 查找已删对象时会出现 `DeletedRef` / `ObjectDeletedError`。
- 当前用户 API 以 `weave:///` 为准；`wandb-artifact:///` 是历史 / 内部格式。
  `dev_docs/REF_SPEC.md` @ `59a9d186`

### 哪些可计算却仍持久化

| 值 | 为何本可计算 | 为何仍落盘 |
|---|---|---|
| `summary.usage` / token | 可从 children 或 provider 响应重算 | `finish_call` 合并后写入 |
| `input_refs` / `output_refs` | 可从 inputs/output JSON 再抽 | start/end 行直接存，供 filter |
| `val_dump` | digest 只证明身份 | 仍要存 payload |
| `otel_dump` | 与 attributes/inputs 可能重叠 | 保留 OTel 原 span |
| scorer 结果既在子 Call output，也可进 Feedback | 重复 | Feedback 平面支持事后查询与 purge |

读取时才计算：`calls_merged` 聚合、`version_index` / `is_latest`、`include_costs` / `include_storage_size` / `include_usernames`、SavedView 列布局、Compare 的并排单元格。
见 [reading-and-comparison.md](reading-and-comparison.md#weave)。

`InMemoryTraceServer` 注释写明：fake backend 要复现 ClickHouse 的 computed summary 行为。
`AGENTS.md` @ `59a9d186`

用户新加一个 Op、一个 scorer、一个 Dataset 列，不发布新的 Call schema。
server 要支持 Agents、TTL、成本时，走编号 migration 加列或加表。

## 未公开边界

| 面 | 观察 |
|---|---|
| 云端 App、查询引擎、Models history 的服务端 table | 无对应应用源码仓库 |
| GraphQL 完整 IDL 与版本承诺 | 本次检查的一手公开面未提供 |
| Workspace / Report 服务端持久 JSON | 未公开；代码 API 为 Public Preview |
| `wandb/server` 应用源码 | 仓库只有 `wandb/local` 镜像与 license 流程。[README](https://github.com/wandb/server/blob/main/README.md) |
| SaaS `trace.wandb.ai` 是否逐条运行开源 `001`–`039` | 官方未承诺 |
| Models 与 Weave 的官方联合查询 | 公开面只有 `wb_run_id` / `wb_run_ids` |
| 升级 Server 后旧 Run 哪些字段保证字节级不变 | 未提供 |

`wandb-workspaces` 的 `pyproject.toml` 同时写了 `license = "Apache-2.0"` 与 classifier `License :: OSI Approved :: MIT License`。
本文只保存这一公开不一致，不裁决哪一条是法律真源。

生产能力（外部 MySQL、云存储、SSO）要向 `contact@wandb.com` 申请。
见 [server README](https://github.com/wandb/server/blob/main/README.md)。
