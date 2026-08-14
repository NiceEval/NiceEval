# MLflow Schema 与 Migration

> 观察日期：2026-08-14
>
> 核对：`v3.15.1` / `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页写版本轨道、兼容 reader、升级命令，以及会不会改写已保存数据。
当前表和目录形状见 [Storage](storage.md)。

## 版本轨道

MLflow 同时有几条互不替代的轨道。

| 轨道 | 谁拥有 | 何时变 | 是否改写用户已保存的数据 |
| --- | --- | --- | --- |
| 产品 semver | 发布 | major 用于删公开 API 或破坏性改参数 | 不直接改用户 key |
| Tracking 数据库 schema | Alembic | 可随 minor 追加表或改列 | 改产品列；不重写 param / metric 的 key |
| FileStore 目录信封 | `FileStore` reader | 维护模式，不再演进 | reader 消化旧字段，不改写文件 |
| SDK ↔ Server | 双方进程 | 最好同版本 | 不改磁盘；端点缺失会让新客户端失败 |
| Scorer version | 按 Experiment + name 递增 | 作者重新注册 | 不重写历史 Feedback |
| Logged Model / Trace V2→V3 字段名 | 公开 entity | V3 改对外名 | SQL 列名常保留旧名 |
| 用户 param / metric / tag / artifact 名字 | 作者 | 随时新增 key | 不发布新的持久格式 |

产品事实：语义化版本里，**数据库 schema 变更不要求 major bump**。
major 只用于架构变化、删除公开 API、以破坏方式改公开参数。
新增 API、新增可选参数、删除实验性 API 走 minor。
见 [How to Upgrade MLflow](https://mlflow.org/docs/latest/self-hosting/migration/)。

产品事实：SDK 与 Server 最好同版本。
Server 对旧 SDK 做 best-effort，最多差一个 major，例如 2.x 客户端可以打 3.x 服务。
新 SDK 打旧 Server 可能失败，例如 Tracing 端点不存在。

产品事实：Scorer 按 Experiment + name 递增 version。
第一次注册是 version 1。这是评估定义版本，不是把历史 Feedback 重写成新 schema。
见 [Registering and Versioning Scorers](https://mlflow.org/docs/latest/genai/eval-monitor/scorers/versioning/)。

## 数据库 migration

产品事实：自托管升级步骤是停服务、升级包、若用数据库则跑 schema 迁移、再启动。
官方不支持原地热升级。为减少停机，要用滚动替换和负载均衡。
见 [How to Upgrade MLflow](https://mlflow.org/docs/latest/self-hosting/migration/)。

```bash
mlflow db upgrade <backend-store-uri>
```

该命令用 Alembic 把库升到当前最新 schema。
官方写明：迁移可能很慢，且不保证事务性。必须先备份。
见 [`mlflow/db.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/db.py) 与 [`mlflow/store/db_migrations/README.md`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/db_migrations/README.md)。

产品事实：`v3.15.1` 的 Alembic head 是 `6f8d9c3b2a1e`（给 Experiment 外键补 cascade）。
目录里能看到追加 metric step、放宽 param 长度、`latest_metrics`、datasets、trace、assessments、logged model、evaluation datasets、spans 等 revision。
见 [Alembic versions](https://github.com/mlflow/mlflow/tree/v3.15.1/mlflow/store/db_migrations/versions)。

产品事实：这些 migration 改的是产品自己的表。
它们不重写用户 param / metric 的 key，也不提供用户授权的 payload converter。

产品事实：列宽变化会改变库能存下的值。
`2d6e25af4d3e` 把 param value 扩到 8k，官方标为不可逆。
见 [Backend Stores](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/)。

产品事实：`89d4b8295536_create_latest_metrics_table` 会扫描全表 metric 历史并写入 latest 表。
大库可能很慢。失败时 Alembic 不会 stamp 新版本，删掉半成品 `latest_metrics` 表即可重跑。
见 [migrations README](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/db_migrations/README.md)。

## 兼容 reader

产品事实：FileStore 读 Experiment / Run 时，若 `experiment_id` 是旧整数会转成字符串。
缺 `lifecycle_stage` 时当成 `active`。缺 status 时当成 `RUNNING`。
见 [`_read_persisted_experiment_dict`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py) 与 [`_read_persisted_run_info_dict`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py)。

产品事实：metric 行兼容 2、3、5 段旧格式。

产品事实：Trace 的 `request_metadata` 目录名保留旧名，公开字段在 V3 叫 `trace_metadata`。
SQL 主键列仍叫 `request_id`。

这些 reader 消化旧字节，普通 `search_runs` 和 Tracking UI 不静默改写 FileStore 文件。

## FileStore 迁到 SQL

```bash
mlflow migrate-filestore --source /path/to/mlruns --target sqlite:///path/to/mlflow.db
```

产品事实：要求 MLflow 3.10+。目标库必须为空。只支持 SQLite。
对已插入的迁移行是原子的：中途失败会 rollback，可以修好后再跑。
见 [Migrate from File Store](https://mlflow.org/docs/latest/self-hosting/migrate-from-file-store/)。

产品事实：迁元数据，保留 ID 与时间戳。
不搬 artifact 字节，也不把 span 从 artifact 搬进 `spans` 表。
被删 Experiment / Run 会一并迁走，并保留 `deleted` lifecycle。
Artifact URI 不变。

产品事实：`mlflow-export-import` 是另一套跨 Server 复制工具。
它会重生 ID 与时间戳，不能代替 `migrate-filestore`。

## 派生落盘对 churn 的影响

[Storage](storage.md) 区分了权威事实与 cache。
对升级来说，关键是这些派生值已经进了产品 schema：

| 派生值 | 升级时发生什么 |
| --- | --- |
| `latest_metrics` | 一次 revision 全表扫描并写入独立表；之后写入路径必须同时维护它 |
| `duration_ns` | 加 generated column 走 Alembic minor；旧进行中 span 仍为 NULL |
| `trace_metrics` / dataset digest | 计算公式若变，旧行含义会漂，但没有用户授权的重算作业 |
| UI 翻译规则 | 读时计算，不改 `content`；同一旧 span 的显示可能变 |

产品事实：作者新增 metric 名字、tag 或 artifact 路径时，不发布新的持久格式。

产品事实：本次检查的一手公开面未提供“application maintainer 针对 exact snapshot 做 plan / authorize / receipt”的用户事实 migration。
也没有把旧 Assessment JSON 迁到新 envelope 的授权流程。

## 未公开边界

- Databricks 托管 Tracking / Trace 的内部表与对象布局
- Tracking UI chart / compare 的控件级规范
- 升级后旧 OTel 翻译是否保证同一 span 仍映射到同一 `mlflow.spanType`
- 官方是否计划为用户自定义事实提供版本化 schema

研究判断：MLflow 升级的是产品自己的 Tracking schema。
用户扩展的名字和值跟着表走。
升级后 UI 和 `search_runs` 继续按原 key 读。
可信的是 key 还在。不可信的是 UI 翻译或 evaluator 定义若已变，同一旧 Run 可能画出不同图。
