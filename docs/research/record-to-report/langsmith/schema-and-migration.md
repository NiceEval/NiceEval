# LangSmith schema、兼容与 migration

LangSmith 不用单一 schema version 管理所有对象。需要分别追踪 Dataset 内容时间、wire/API generation、SDK package、self-hosted chart/app、PostgreSQL/ClickHouse migrations 与 ClickHouse→SmithDB 数据搬迁。本页固定核对官方 SDK commit [`345a522`](https://github.com/langchain-ai/langsmith-sdk/commit/345a52252af163abe33699fb361038f5783c9024)（2026-08-13 UTC）和 Helm commit [`e5fd3cf`](https://github.com/langchain-ai/helm/commit/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0)（2026-08-12 UTC）。

## 六条独立 version 轨道

| 轨道 | 公开 version / discriminator | compatibility owner | 是否改写用户保存的数据 |
| --- | --- | --- | --- |
| Run / Feedback / Dataset / Example 等 resource schema | 公开 models 没有统一 `schema_version`；类型变化靠 endpoint generation、字段 optionality 与 SDK version | 服务端 endpoint + 各语言 SDK reader | 单纯升级 SDK 不改服务端数据；写新字段当然会更新对应 resource |
| Dataset 内容历史 | `DatasetVersion{as_of, tags}`；每次 Example add/update/delete 形成新时间版本 | Dataset API 的 temporal reader；`list_examples(as_of=timestamp_or_tag)` | mutation 改当前 Dataset，同时历史 `as_of` 可读；tag 是时间版本的人类别名，不是内容 digest |
| legacy API → SmithDB-backed v2 API | legacy `/api/v1`/client methods 与 `/api/v2/runs`, traces, threads, experiment-runs queries | caller 迁移；新生成 clients；部分 Python 内部 adapter | 变更读取方法、参数、response projection，不自动重写 Run/Feedback |
| SDK package | Python/TS/Java/Go/CLI 各自 semver | package manager + application code | 不改服务端历史；可能要求 call-site/schema/error-handling 改造 |
| self-hosted release | Helm chart `0.X.Y` 与独立 `appVersion`；stable/preview channel | Helm/operator；backend migration hooks | patch 不含 data migration；preview/新 major 可执行 migration/backfill，可能改变物理保存数据 |
| datastore | PostgreSQL schema、ClickHouse schema、SmithDB metastore、SmithDB data migration task state | 镜像内 migration entrypoint / Helm Jobs | PG/CH/SmithDB migrations 可改 schema/backfill；CH→SmithDB 会复制/转换历史 trace/feedback 到新物理表示 |

这几条不能互相替代：Experiment 的 `metadata.dataset_version` 不是 Run schema version；SDK `0.10.15` 也不是 LangSmith server `0.16`；chart `0.15.17` 也不要求 `appVersion` 等于 `0.15.17`。官方 release policy 明确 chart 与 app 两个 patch number 独立，见 [Release policy](https://docs.langchain.com/langsmith/release-versions)。

## Resource schema 没有对象内 version envelope

公开 [`schemas.py`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py) 与生成的 [OpenAPI types](https://github.com/langchain-ai/langsmith-sdk/tree/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_openapi_client/types) 中，Run、Trace、Feedback、Dataset、Example、Project 和 ComparativeExperiment 都没有统一 `schema_version` / `format_version` 字段。服务端兼容历史资源的 reader/backfill 细节未公开；可验证的外部兼容手段只有：

- endpoint/version 与 SDK package version；
- response 字段可选并由 v2 `selects` 显式请求；
- legacy/v2 字段映射，如 `session_id → project_id`、single `parent_run_id → parent_run_ids`、`serialized/manifest_id → manifest`；
- 未知 JSON 留在 `extra`/metadata、inputs/outputs/events 等开放 payload 中。

因此不能声称历史每条 Run 带 self-describing migration envelope，也不能从 optional field 推断旧 record 的物理 schema revision。

## Dataset 的时间版本与 compatibility reader

官方 [Manage datasets](https://docs.langchain.com/langsmith/manage-datasets#version-a-dataset) 定义：每次增加、更新或删除 Example 都创建一个新 Dataset version，默认以变化 timestamp 标识；过去版本只读，可查看它与最新版本之间的 operations。`DatasetVersion` 的公开 shape 只有 `as_of: datetime` 与可选 `tags`。[schema](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/schemas.py#L293-L300)

兼容读取用 `list_examples(..., as_of=<timestamp-or-tag>)`。Experiment runner 收尾时把本轮 Examples 的最大 `modified_at` 转成字符串写入 Project `metadata.dataset_version`；`evaluate_existing` 再把它作为 `as_of` 读回。这提供了时间快照复现，但有三个边界：

1. 它不是所有 Example 内容的 hash/digest，无法只凭版本值证明集合内容；
2. runner 保存的是本轮 iterable 中最大 `modified_at`，不是独立 DatasetVersion resource ID；
3. comparative runner 遇到不同 versions 只使用第一侧版本，源码明确留有 `TODO: Warn if different dataset versions`。

实现见 [`_get_dataset_version/_end`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1850-L1891)、[`evaluate_existing` example load](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L1204-L1223) 与 [`evaluate_comparative`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/evaluation/_runner.py#L903-L930)。这条 version 轨道会保留 Dataset 的用户编辑历史；给 version 加/改 tag 只改变别名关联，不把已有 Experiment 自动重绑到另一份内容。

## SmithDB-backed API / SDK migration

官方 [SmithDB SDK migration](https://docs.langchain.com/langsmith/smithdb-sdk-migration) 给出的迁移窗为：Cloud 2026 年 7 月底 deprecated、2027-01-31 remove；self-hosted `v0.16` deprecated、`v0.18` remove。新方法要求 self-hosted `>=0.16`，并有以下 SDK floors：

| client | 最低版本 |
| --- | --- |
| Python `langsmith` | `>=0.10.15` |
| TypeScript `langsmith` | `>=0.8.9` |
| Java `langsmith-java` | `0.1.0-beta.22` |
| Go `langsmith-go` | `v0.25.4` |
| `langsmith-cli` | `v0.2.44` |

官方没有一个跨语言统一的 `langsmith migrate-sdk` 命令；升级对应 dependency 后必须逐 call site 改方法、参数、字段与 exception handling。迁移面不是简单 URL 替换：

| 面 | legacy | SmithDB-backed v2 / 影响 |
| --- | --- | --- |
| Run query | `list_runs`, `/api/v1/runs/query`; 可用 project name、offset/limit 等 | `runs.query_v2`, `POST /api/v2/runs/query`; scope 用 `project_ids`，cursor/page size，按 `selects` 返回；`query`, `parent_run_id`, legacy `limit/order/execution_order` 等没有一一等价。完整矩阵见 [Migrate run queries](https://docs.langchain.com/langsmith/smithdb-sdk-migration-query-runs) |
| Run retrieve | `read_run(run_id)`, 可 `load_child_runs` | v2 retrieve 还要求 `project_id`，可给精确 `start_time` 加速；child Runs 改为列整条 Trace 后按 `parent_run_ids` 组装。见 [Migrate run retrieval](https://docs.langchain.com/langsmith/smithdb-sdk-migration-runs) |
| Run response | `session_id`, `parent_run_id`, `child_runs`, `serialized`, `manifest_id`, internal S3 URL fields | `project_id`, full `parent_run_ids`, `manifest`, presigned attachment/share URL；一些 legacy/internal fields 被移除；默认只 select `ID` |
| Trace | 从 root Run / legacy Run query 组合 | `traces.query` 固定 root scope，返回 `Trace{root_run, trace_aggregates}`；`traces.list_runs` 再列 tree。见 [Migrate traces](https://docs.langchain.com/langsmith/smithdb-sdk-migration-traces) |
| Thread | legacy thread methods | `threads.query` + `threads.list_traces`，显式 thread projection。见 [Migrate threads](https://docs.langchain.com/langsmith/smithdb-sdk-migration-threads) |
| Experiment runs | legacy experiment results/export，语言间 public surface 不一致 | `/api/v2/datasets/{dataset_id}/experiment-runs` cursor JSON，按 Example 返回 `runs[]`; `format=csv` 与 annotator-detail projection 没有新 JSON 等价。见 [Migrate experiment runs](https://docs.langchain.com/langsmith/smithdb-sdk-migration-experiments) |
| Feedback / sharing | create Feedback 的 `session_id` 可选；share/read 参数是旧 contract | SmithDB-backed create Feedback 要求 owning Project `session_id`; public retrieve 需要 share token、Run ID 与精确 start time；annotation queue 优先发送 Run identity objects，run-ID-only path deprecated。见 [Migrate feedback and sharing](https://docs.langchain.com/langsmith/smithdb-sdk-migration-feedback) |

新 Python/TypeScript generated clients 还更换 exception classes；feedback-formula SDK methods 没有一一替代，官方规定 composite evaluator 为产品替代。这些都属于 caller compatibility churn，不是保存数据 migration。

### 公开的 compatibility reader

Python SDK 内部 [`_v2_migration_utils.py`](https://github.com/langchain-ai/langsmith-sdk/blob/345a52252af163abe33699fb361038f5783c9024/python/langsmith/_internal/_v2_migration_utils.py#L1-L180) 读取 `/info.instance_flags`：

```text
ch_query_enabled=true,  sdb_query_enabled=false/absent -> CLICKHOUSE_ONLY
ch_query_enabled=true,  sdb_query_enabled=true         -> DUAL
ch_query_enabled=false, sdb_query_enabled=true          -> SMITHDB_ONLY
```

旧 backend 没 flag 时默认 ClickHouse-only。评测旧实验等内部路径在 SmithDB-only 时会用 v2 query。随后，`_v2_run_to_schema` 把 `project_id → session_id`、`parent_run_ids[-1] → parent_run_id`、status casing 与 detail objects 映射回 legacy `schemas.Run`。它证明某些 SDK code path 有兼容 adapter；不证明所有已移除参数/字段都有兼容实现。官方也明确：关闭 ClickHouse 后 deprecated methods 会停止工作。

这条 adapter 只转换读取对象，没有 POST/PATCH 用户历史，**不会改写保存的 Runs**。真正的数据搬迁是下文的 operator 流程。

## Self-hosted release 与数据库 migrations

官方 [Release policy](https://docs.langchain.com/langsmith/release-versions) 把 stable patch 限制为关键修复/安全补丁。stable patch 不含 feature、data migration 或 infrastructure change。preview 和下一 major 可含 migration/backfill，只有下一 major 可增删服务或引入 breaking change。chart version 与 `appVersion` 独立，必须分别核对。

官方 [Upgrade an installation](https://docs.langchain.com/langsmith/self-host-upgrades) 给出的命令是：

```bash
helm repo update
helm search repo langchain/langsmith --versions
helm upgrade <release-name> langchain/langsmith \
  --version <version> --values <path-to-values-file> --wait --debug
helm status <release-name>
kubectl get pods
```

升级后需确认 `langsmith-pg-migrations-*` 与 `langsmith-ch-migrations-*` 为 `Completed`，并以 `/api/info` 核对 application version。**不能跳 major**；例如 `0.13 → 0.15` 必须先经 `0.14`。Downgrade 官方不支持，因为数据库/其它变更可能不向后兼容。

公开 chart 能确认的 migration lifecycle：

| Job | hook / command | 能确认的作用 | 不能确认的细节 |
| --- | --- | --- | --- |
| PostgreSQL backend migration | `post-install, pre-upgrade`; `./pg_migration_entrypoint.sh`; backoff 3 | 每次安装/升级的 PG schema/data migration owner | Alembic revisions、SQL、table、是否逐条 rewrite 未开源。模板：[`postgres-migrations.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/templates/backend/postgres-migrations.yaml) |
| backfill gate | pre-upgrade `./backfill_check_entrypoint.sh` | 在 Alembic migration 前阻止尚有 asynq backfill 的升级 | job type、checkpoint/data transform 未公开。配置：[`values.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/values.yaml#L2034-L2123) |
| ClickHouse migration | `post-install, pre-upgrade`; `./ch_migration_entrypoint.sh`; backoff 2 | CH schema/data migration owner | DDL、materialized views、mutation/backfill 顺序未开源。模板：[`clickhouse-migrations.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/templates/backend/clickhouse-migrations.yaml) |

这些 Jobs 位于 backend image，chart 只有 command/env/hook；因此不能满足到 database table/revision 的逐项映射。对 Cloud 更没有 operator-visible migration command 或 table history。

## ClickHouse → SmithDB：两种 migration 不要混淆

Helm chart 公开了 SmithDB rollout 的三个独立开关：`smithdb.langsmith.ingestion.enabled`、`.migration.enabled`、`.query.enabled`。当 ClickHouse 仍启用且 SmithDB ingestion 开启时，chart 注释明确 ingestion **写两边**；query 可单独切换。见 [`values.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/values.yaml#L1376-L1395)。

历史数据 migration job 由 [`smithdb/migration-job.yaml`](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/templates/smithdb/migration-job.yaml) 证明以下真实边界：

1. source connection 是 ClickHouse，并可读取旧 blob store；output 是 SmithDB 的 S3/GCS object store，root folder 明示为 `smithdb`；
2. `startTime` / `endTime` 给半开时间窗，默认 end=now、start=end-400 days；
3. 独立 taskdb PostgreSQL 保存 migration task state，明确禁止复用主 LangSmith PG 或 SmithDB metastore；
4. 默认 entrypoint 先迁 taskdb schema，再执行 one-shot `migrate-all`：发现 tenants、注册不重叠 jobs、drain global queue、退出；Job 有 parallelism/backoff/deadline/TTL 配置；
5. SmithDB metastore 另有 pre-install/pre-upgrade `./smithdb metastore-migrate` Job。[template](https://github.com/langchain-ai/helm/blob/e5fd3cf1f3bb39d0ae8962c2308f82419b8e10a0/charts/langsmith/templates/smithdb/metastore-migration.yaml)

这是**会触及用户已保存 trace/feedback 的物理 migration**：历史 ClickHouse/旧 blob 数据被读取并写成 SmithDB object-store 表示，migration window 外的数据不会因这个 job 自动出现于新 store。dual ingest 负责 rollout 期间的新 writes，taskdb 负责搬迁进度。公开证据没有说明逐字段 transform、checksum/reconciliation、删除旧 ClickHouse 数据、rollback 或 exact cutover barrier，所以不能承诺逻辑 ID 之外的 byte-for-byte identity，也不能声称 job 会删除源数据。

相反，应用从 `list_runs` 改为 `runs.query_v2` 只是**API reader migration**；它不触发上述 Job、也不重写数据。两者唯一交点是 server flags/query backend 与 v2 projection。

## 对用户数据的影响矩阵

| 动作 | 已保存逻辑数据 | 物理数据 / 索引 | 需要的 compatibility 行为 |
| --- | --- | --- | --- |
| 升级 SDK、改 v2 call sites | 不改 | 不改 | caller 处理 renamed/removed params、select-only fields、new errors |
| 给 Dataset version 加 tag | Example 历史不改；更新 tag→`as_of` 关联 | backend index/metadata 可能更新，未公开 | reader 应把 tag 求值为 timestamp；Experiment 应保存求值后的固定时间而非只存可移动名称 |
| 新增/改/删 Example | 创建新的时间版本；旧 `as_of` 仍可读 | 服务端保存 history 的具体模型未公开 | history reader 按 `as_of`; past UI read-only |
| self-host stable patch | policy 保证无 data migration/backfill | code/image 更新 | chart/app version 分开验证 |
| self-host preview/major | 可能 schema change/backfill/breaking | PG/CH Jobs 实际执行 | 逐 major、等 Jobs 完成；不支持 downgrade |
| ClickHouse→SmithDB migrate-all | 逻辑 Run/Feedback 预期继续由新 query 读取；exact equivalence contract 未公开 | 读取 CH/旧 blob，写 SmithDB object store；taskdb 保存任务状态 | dual write、window coverage、query cutover 与计数/抽样回读需 operator 验收 |
| TTL / purge | 可能永久删除 historic Run payload/trace | store/blob/index 相应删除 | 这不是 schema migration，不能靠 compatibility reader 恢复 |

## 仍不可验证的部分

截至固定 commit/date，官方没有公开以下材料：

- LangSmith backend 源码与 Cloud schema history；
- PostgreSQL SQL/Alembic revisions 与 ClickHouse DDL/mutations；
- SmithDB record format 与 migrate-all transform 实现。

因而以下问题不能可靠回答：

- 具体哪些 table/column 在某 major 改动，以及 migration 是否在单 transaction 内；
- 旧值怎样 backfill，失败后怎样逐 record resume/idempotency；
- 源 CH 何时或是否删除，以及 logical resource 与 SmithDB objects 的精确映射。

能够验证的只有官方 release contract、SDK wire schemas/adapter、Helm Jobs/flags/env 与 UI/API 可观察结果。其余必须标注未公开，而不是按常见数据库实践推测。
