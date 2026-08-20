# Langfuse schema、兼容读取与 migration

> 观察日期：2026-08-14
>
> 核对源码：`langfuse/langfuse` `7cc6d2c0`；文档仓 `d0a5f34e`
>
> 返回 [目录](README.md)

本页写版本轨道、兼容读取、升级步骤，以及是否改写用户已保存的数据。
当前表形见 [storage.md](storage.md)。

## 公开 semver 轨道

[Versions & Compatibility](https://langfuse.com/self-hosting/upgrade/versioning#scope-of-semantic-versioning) 写明 major bump 只包含：

- 基础设施变化
- 删除或改变已有 Public API

database schemas 与 Frontend APIs 是内部实现细节，不进 major bump。

Server 与 SDK 独立版本。
每个 server major 试图支持当前与上一个 SDK major。
v4 过渡是例外，按矩阵退役旧 SDK。

Cloud 持续部署，始终跑最新 server。
破坏性删除会先公告迁移时段和公开日期。

本次核对的 Python SDK 是 `4.14.4`。
自托管 OSS v4 为 GA；v3 安全补丁到 2027-01。
见 [Migrate v3 to v4](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4)。

## 对象级版本轨道

| 对象 | 版本机制 | 是否改写已保存用户事实 |
|---|---|---|
| DatasetItem | `validFrom` / `validTo` / `isDeleted`；版本身份是时间戳 | 否；新版本另起一行。官方：[Dataset Item Versioning](https://langfuse.com/changelog/2025-12-15-dataset-versioning) |
| EvalTemplate | 整数 `version`；`@@unique([projectId, name, version])` | 否；新版本另起一行 |
| Prompt | Prompt Management 自有版本 | 本方向不展开 |
| Dashboard / Widget 文件 | `$langfuse*` envelope `version: 1` | 否；更高 version 被拒绝 |
| Widget 查询引擎 | `minVersion` 1 或 2 | 否；只选声明，不改观测行 |
| Observation / Score 行 | 无用户可见 schema family | v4 平台 backfill 会改写观测存储，见下 |
| ScoreConfig | 官方称 immutable 可归档；Prisma 无版本列 | 未公开内部哪一侧为准 |
| Dataset 自身 schema 字段 | 官方写：Dataset schema 变化不产生新版本 | 不产生 item 版本 |

`GET` Dataset 默认返回查询时的最新 item 版本。
实验绑到运行当时的 Dataset 状态。
之后改 item 不会改写旧实验看到的题面。

## 兼容 reader

Langfuse 没有面向用户数据的相邻格式 reader。
兼容发生在 Public API 与写模式过渡期。

| 读取面 | v4 `events_only` 行为 |
|---|---|
| `GET /api/public/v2/observations`、`/v2/metrics` | 正式面 |
| `GET /api/public/v3/scores` | 正式面 |
| `GET /api/public/experiments`、`/experiment-items` | 正式面 |
| `GET /api/public/traces`、`/observations`、`/sessions`、`/scores`、`/v2/scores`、`/metrics`、`/datasets/:name/runs` | 404 |
| `GET /api/public/dataset-run-items` | 404 |
| `POST /api/public/ingestion` | 只接受 `score-create` 与 `sdk-log`；其余 400 |
| `POST /api/public/traces`、`/spans`、`/generations`、`/events` | 404 |
| `POST /api/public/dataset-run-items` | 只返回供旧客户端兼容的 object；不得用于新写入 |
| Widget `minVersion` | v2 从 events 派生 traces；旧 `traces` Widget 仍可读，不再作为新建议 |
| Dashboard JSON `version > 1` | 拒绝，并提示当前实例支持到 1 |

见 [API changes](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4#api-changes)。

`legacy` 与 `dual` 写模式期间，旧读取端点继续工作。
切到 `events_only` 后才 404。

ClickHouse 客户端还有按 ClickHouse 服务器版本开关的查询设置。
路径：`packages/shared/src/server/clickhouse/compatibility.ts`。
这是查询引擎对数据库版本的适配，不改用户行。

内部 `eventTypes` 仍接受旧 `observation-create` / `observation-update`，只为兼容旧信封。

## 数据库 migration 目录

| 类 | 何时跑 | 目录或表 |
|---|---|---|
| Prisma | Web 启动时自动 | `packages/shared/prisma/migrations/` |
| ClickHouse SQL | Web 启动时自动 | `packages/shared/clickhouse/migrations/{clustered,unclustered}/` |
| Background | Worker 启动后后台跑 | `worker/src/backgroundMigrations/` + `background_migrations` |

Prisma 本次核对最新目录名包括 `20260807120000_drop_job_execution_configuration_fk`。
`20260723124010_drop_dataset_run_items_table` 删除 Postgres `dataset_run_items`。
前提是 v3 上的 background migration `20250814_1001_migrate_dataset_run_items_rmt_pg_to_ch` 已完成。

ClickHouse clustered 与 unclustered 各 46 对 up/down，编号 `0001`–`0046`。
`0044_drop_event_log.up.sql` 删除 `event_log`。
`0046_drop_dataset_run_items.up.sql` 删除已被 `_rmt` 取代的 `dataset_run_items`。

官方：[Background Migrations](https://langfuse.com/self-hosting/upgrade/background-migrations)。
快 migration 在 Web 启动时直接打到数据库。
长任务在 Worker 启动后执行，直到完成或失败。

`BackgroundMigration` 字段：`name`、`script`、`args`、`state`、`finishedAt`、`failedAt`、`failedReason`、`workerId`、`lockedAt`。

实现要求写在 `worker/src/backgroundMigrations/README.md`：

- 随时可恢复；跨系统要幂等，单库要原子
- 同一时间只跑一条
- 必须假设 Worker 同时在处理新事件
- 可用 `args.envGate` 把行做成休眠，直到对应 `LANGFUSE_BACKGROUND_MIGRATION_*` 为 `"true"`

`LANGFUSE_ENABLE_BACKGROUND_MIGRATIONS=false` 可关闭。
官方不建议：UI 与 API 可能与数据状态不一致。

UI 从版本标签进入 Background Migrations 页查看状态。

没有用户签发的一次性 upgrade CLI。
升级靠换容器镜像，启动时自动打 schema，再靠进程变量切写模式。

## v3 → v4 是否改写已保存数据

会，而且只改观测分析面。

三步，每步都是稳定状态：

1. 先把 ClickHouse 升到 ≥ 25.12，仍跑 Langfuse v3
2. 升服务端到 v4；schema migrations 启动时自动应用；写模式先用 `legacy` 或 `dual`
3. 再切数据模型：升级 SDK、迁移 API 消费者、回填或等观测保留时段结束，最后切 `events_only`

进程变量 `LANGFUSE_MIGRATION_V4_WRITE_MODE`：`legacy` | `dual` | `events_only`。
v4 源码默认 `events_only`。
v3 发行线带 `legacy`。
路径：`worker/src/env.ts`。

`LANGFUSE_MIGRATION_V4_NATIVE_OTEL_BEHAVIOUR`：`dual_write` | `direct`。

历史数据两种官方选择：

| 选择 | 对已保存数据做什么 |
|---|---|
| automated backfill | 后台改写到 `events_full` / `events_core`；约需 3 倍 ClickHouse 磁盘 |
| retention-based rollover | 保持 dual write，直到观测保留时段结束；旧行随保留策略消失 |

Postgres 中的 projects、users、prompts、datasets、ScoreConfig 不受影响。

`legacy` 与 `dual` 是迁移工具，不是长期运行模式。

历史 Trace 以虚拟 root span 出现，类型 `SPAN`，span ID `t-<trace_id>`。
这是平台改写后的查询形状，不是用户当初写入的两表结构。
见 [The new data model](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4#data-model)。

Export 源 `LEGACY_TRACES_OBSERVATIONS` 在 `events_only` 后不再产出数据。
须切到 Enriched observations。
见 [Exports](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4#exports)。

## schema churn

作者增加 score 名字、usage 键、tag、metadata 键或 Widget 时，不发布新的持久格式。
这些扩展落在固定外壳上的 map / 数组 / JSON。

真正改 ClickHouse 表形的是平台 migration，例如 `0039` 建 `events_full`。
这类变化由服务端启动时自动应用，不进公开 major 的默认理由。

查询面可以单独退役。
v2 Metrics 删除 `traces` view。
Widget 用 `minVersion` 选择 v1 或 v2 声明，而不改用户观测行。

## 未公开边界

- Cloud 回填失败时，哪些行保留、哪些行重试；Cloud 内部拓扑未公开
- ScoreConfig：「Configs are immutable but can be archived」与 [FAQ](https://langfuse.com/faq/all/manage-score-configs#update-a-score-config)「may be updated at any time」并存；本次不推断哪一侧对应内部存储
- 自定义 `usage_details` 键如何成为 Dashboard 的一等 measure
- Dashboard JSON `version: 1` 之后如何升版
