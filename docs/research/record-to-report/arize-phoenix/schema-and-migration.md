# Phoenix 的 schema、版本与 migration

> 观察日期：2026-08-14
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页只写版本轨道与升级。
表形状见 [storage.md](storage.md)。
实验状态机见 [execution.md](execution.md)。

观察钉在 `arize-phoenix-v20.2.0`，提交 `4367f3fc2a2dd1f7da125c6f38a77bf91325710d`。
Alembic head 是 `4aad9107d196`，父 revision `e767d3c57f32`。
[versions/](https://github.com/Arize-ai/phoenix/tree/arize-phoenix-v20.2.0/src/phoenix/db/migrations/versions)

## 对象版本轨道

| 对象 | 有没有用户可见版本 | 含义 |
|---|---|---|
| Dataset | 有 `DatasetVersion` | 固定 example 集合与每条 revision |
| DatasetExample | 稳定 ID，内容走 revision | 改内容不改 example 身份 |
| Prompt | 有 `PromptVersion` 与 tag | Playground / LLM evaluator 可钉版本 |
| Experiment | 创建时钉 `dataset_version_id`，并快照 revision | 之后 Dataset 再改，旧 Experiment 仍看快照 |
| Trace / Span | 没有用户 schema 版本 | 属性袋按写入时的键保存 |
| Annotation | 按 `(对象, name, identifier)` upsert | 不是不可变历史 |
| OpenInference 键 | 规范声称约定稳定，破坏性变更会版本化 | [Semantic conventions](https://arize.com/docs/phoenix/tracing/concepts-tracing/otel-openinference/semantic-conventions) |

产品事实：用户新增 metric 名字、annotation 名字、example 字段或任意属性时，不必发新的持久格式。
稳定写入对象很少：Span、Annotation 信封、Dataset revision、ExperimentRun。

产品事实：Client 改名不要求重写历史 traces。
旧入口迁到 `phoenix.client.experiments`。旧 evaluations 在新 Client 里改叫 annotations。
[MIGRATION.md @ 20.2.0](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/MIGRATION.md)

## 兼容 reader

产品事实：普通 `show` 式用户命令不存在。
读旧数据的是当前服务端与当前 Client。它们按现表读取旧行。

产品事实：没有按 family 出具的用户事实 migration receipt。
也没有「旧 Span payload 升到新字段图」的兼容转换器。

本次检查的一手公开面未提供：把历史自定义属性迁到新键。

## 数据库 migration

产品事实：启动时自动跑 Alembic，升到 `head`。
[`src/phoenix/db/README.md`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/README.md)
[Self-hosting: Migrations](https://arize.com/docs/phoenix/self-hosting/upgrade/migrations)

符号是 `phoenix.db.migrate.migrate`，内部调用 `alembic upgrade head`。

产品事实：官方政策是「只在 major 升版做 migration」。
观察日的 20.2.0 Alembic 树里仍有 major 之间追加的 revision。
v20 增加 `e767d3c57f32`（`agent_sessions`）与 `4aad9107d196`（补 FK 索引并删除无用 `ix_latency`）。

产品事实：`4aad9107d196` 删除 `spans.ix_latency`。
注释写明应用用 `EXTRACT` / `unixepoch` 算延迟，没有查询发出 `(end_time - start_time)` 这个表达式。
这是索引从 schema 拿走、计算留在读取侧，不是重写用户行。

## 升级命令

产品事实：用户升级命令是升级 Phoenix 进程，或显式 `phoenix db migrate`。
自托管部署可以在 initContainer 里先升库，再 `phoenix serve`。
命令注册在 `src/phoenix/server/cli/commands/db.py`。
[Self-hosting: Migrations](https://arize.com/docs/phoenix/self-hosting/upgrade/migrations)

产品事实：PostgreSQL 大表建索引可设 `PHOENIX_MIGRATE_INDEX_CONCURRENTLY=true`。
它避免写锁阻塞 ingest，但会更慢。SQLite 忽略该开关。

产品事实：`alembic downgrade` 可能丢数据。官方要求先备份。
Phoenix 回滚到旧二进制时，不会自动 down-migrate。
旧版本代码里没有新 revision 的 downgrade 逻辑。

## 是否重写已保存的用户数据

| 升级 | 改了什么 | 是否改写用户已保存的 Trace / Dataset / Experiment 语义 |
|---|---|---|
| v19.x → v20.0.0 | 官方写「无需操作」；自动建 `agent_sessions` 等新表 | 否。PXI 会话是新表，不是改旧 Trace 行 |
| 20.2.0 的 `4aad9107d196` | 补 FK 索引，删除无用延迟索引 | 否。不改 Span / Experiment 行内容 |
| Client 3.x 改名 | SDK 入口从 `phoenix.experiments` 迁到 `phoenix.client.experiments` | 否。历史 traces 仍按 span 与 annotation 读取 |
| Dataset 再 insert / update / delete | 新建 `DatasetVersion` 与 revision | 否。旧 Experiment 继续看创建时快照 |
| 同名 Annotation / Experiment Evaluation 再写 | upsert 替换旧值 | 是。这是产品写语义，不是 schema migration |
| 价目表变化 | 影响后续 `SpanCost` 计算 | 本次未找到公开的历史重计价命令 |

[MIGRATION.md](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/MIGRATION.md)

研究判断：服务端 Alembic 演进自己的表。
用户属性袋和 annotation 名字不进入这条链。
展示、过滤和价目表可以改，而不强迫重写历史 Span bytes。
代价是自定义字段没有 schema 主人，也没有用户可见的字段代际。

## 未公开边界

- 任意属性是否在所有导出路径上无损保留。
- 改价目表后，历史 `span_costs` 会不会重写。
- Experiment Compare 过滤语言的完整官方语法页。
- TypeScript Client 是否提供与 Python 同等的 `version_id` 固定 API。
- Phoenix OSS 是否计划提供用户声明的 Dashboard 或 Report。
- Arize AX 自定义 Dashboard 的存储格式。
- OpenInference 约定变更时，服务端会不会改写历史 Span JSON。公开面只说按写入时的键保存。
