# Braintrust 的 schema、version、compatibility 与 migration

本文只讨论“同一份 Braintrust 数据如何随版本被继续读写，以及自托管部署怎样升级”。对象的完整字段与物理介质见 [storage.md](storage.md)，运行失败与重试见 [execution.md](execution.md)。研究截点为 2026-08-14；源码证据均固定到文末列出的 commit，而不是把 `main` 当作永恒契约。

## 先把独立版本轨道分开

Braintrust 没有一个公开的全局 `schemaVersion` 同时控制 API、event、Prompt、Dataset、trace propagation、数据库和部署镜像。公开材料能确认至少下列独立轨道：

| 版本轨道 | 公开表示 | 它版本化什么 | 不能据此推断什么 |
| --- | --- | --- | --- |
| OpenAPI document | `openapi: 3.0.3`; `info.version: 1.0.0` | API 描述文件及其 schema | 不是每条 event 的 schema version，也不是服务端 release |
| SDK ingest envelope | `{"rows": ..., "api_version": 2}` | `/logs3` 的 batch wire envelope | 不等于 OpenAPI `1.0.0`，也不等于 `_xact_id` |
| Event history | 每个版本有 `_xact_id`；fetch 可带 `version` | 同一 `id` 的 event snapshot/history | 没有公开的 per-row schema revision number |
| Dataset selection | concrete `_xact_id`、`DatasetSnapshot.xact_id`、Environment mapping | 一组 dataset rows 的读取点 | Snapshot/Environment 名都不能替代对应的 concrete version |
| Prompt | Prompt row 的 `_xact_id` | 每次保存的 Prompt revision | 不等于 SDK/package version |
| Distributed span slug | `SpanComponentsV3` / `SpanComponentsV4` | SDK 跨进程传递 parent/object identity 的序列化 | 不是持久 Event resource version |
| Client release | npm/PyPI package SemVer | client types、writer/reader behavior | 不保证等于 data-plane image |
| Self-hosted release | Terraform module、Helm chart、data-plane image，各自有版本 | infrastructure 与服务部署 | chart/module/image version 不能互换 |
| Brainstore physical format | `brainstore_wal_footer_version` 可取 `""`、`"v1"`、`"v2"`、`"v3"` | WAL footer/read compatibility | 未公开 segment binary schema 或全兼容矩阵 |
| PostgreSQL migration | versioned `MigrateDatabaseFunction` artifact + migration endpoints | 闭源服务端 schema/data migration | migration 名称、SQL、table、transaction 与 backfill 内容均未公开 |

OpenAPI 文件本身可直接核验 [`openapi/spec.yaml`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1-L18)；JS SDK 的 [`constructLogs3Data`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L2770-L2787) 则把 `api_version: 2` 写进 ingest body。这两个数字处在不同 protocol boundary。

## Event version：append history 与 snapshot reader

### `_xact_id` 是 insertion version，不是 schema revision

服务端为每次 network insertion 分配单调递增 `_xact_id`。同一个 event `id` 可以有多个 `_xact_id`；普通 fetch 把历史投影为当前 row，`version=<past max_xact_id>` 则把“最新版本”上限截到过去的 transaction point。分页遍历的是整个 version history，所以后续页可能再次出现同一 `id` 的更旧版本；consumer 必须按 `id` 排除 duplicate/outdated rows。OpenAPI 对 `limit`、`cursor`、`version` 的这组语义有明文说明。[OpenAPI fetch parameters, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L220-L314)

写入仍是 append version。默认同 id 新 row replacement；`_is_merge`、`_merge_paths`、`_array_delete` 调整当前投影的 merge 行为，`_object_delete` 追加 tombstone。它们使旧版 reader 面对新增 nullable fields 时通常仍可读，也保留精确历史。

但 OpenAPI 没有声明一套 general unknown-field preservation rule，也没有承诺所有未来 additive change 都能由任意旧 SDK 写回而不丢字段。因此需要 round-trip mutation 的 client 应固定并升级 SDK，而不是把“JSON 可忽略未知字段”当正式兼容协议。[OpenAPI insert controls, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1870-L2222)

deprecated `_parent_id` 是可见的兼容尾巴：OpenAPI 仍接受并解释它，但明确要求新 producer 改写 `span_id`、`root_span_id`、`span_parents`，并称未来会移除支持。这是 field-level deprecation，不是服务器替历史 row 补齐新字段。[OpenAPI `_parent_id`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1023-L1064)

### Dataset：concrete version、稳定 Snapshot 与可移动 Environment

Dataset version 就是 event history 的 concrete transaction point。官方 instrumentation spec 定义三种 selector：

- exact version：直接锁定 `_xact_id`；
- `DatasetSnapshot`：通常作为稳定 checkpoint 的命名 pointer，保存 `dataset_id + xact_id`；正式 spec 也允许 caller 显式移动已有 snapshot，因此它不是存储模型强制 immutable；
- Environment：可重新指向另一个 concrete version 的命名 alias。

SDK 按 Snapshot/Environment 所指的 concrete version 读取，Experiment 保存对应的 `dataset_version`，因此 alias 后来移动不应改变既有 Experiment 的数据 provenance。恢复旧 Dataset version 不是倒写 head 或删除后续历史：restore 计算 old/current snapshot 的差异，再追加 compensating insert/update/delete rows，生成一个新的 head；旧 history 仍可按原 `_xact_id` 读取。[Dataset versions contract, commit `f50b53f`](https://github.com/braintrustdata/braintrust-spec/blob/f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928/skills/instrumentation-spec/references/features/dataset-versions/README.md)

这条 migration 会改变用户当前保存的数据，但方式是**追加新版本**，不是原地重写过去：恢复后 latest dataset 内容改变，历史 snapshot 不变。

### Dataset legacy reader：`output` → `expected`

当前 durable Dataset shape 使用 `expected`。JS `initDataset({useOutput:true})` 仍提供 deprecated reader adapter，把 fetched row 的 `expected` 重命名为旧字段 `output`。Python `ensure_dataset_record()` 同时能把 `expected` 映射为 legacy `output`，或把旧 `output` 规范化为新 `expected`。

默认常量已是 non-legacy。转换发生在返回给调用者的 copy 上，不会迁移或重写服务端 Dataset row。[JS `initDataset`/`useOutput`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L4384-L4465)；[Python `ensure_dataset_record`, commit `f893ebd`](https://github.com/braintrustdata/braintrust-sdk-python/blob/f893ebdd49c89298497e80a8e812a43f29f62b9f/py/src/braintrust/object.py#L1-L31)

这类 compatible reader 把 schema churn 留在 client boundary：历史 payload 不必 backfill，但 legacy 入口终有移除风险，consumer 应迁到 `expected`。

### Prompt reader 与 cache compatibility

Prompt 每次保存产生新 `_xact_id`，SDK 把它暴露为 concrete `version`。`loadPrompt()` 的选择与失败语义是：

1. 同时传 `version` 与 `environment` 时，explicit `version` 优先；
2. explicit version 或 environment 的 network lookup 失败时抛错，不用本地旧 cache 假装命中指定 revision；
3. 未 pin 的 latest lookup 才可按 cache policy 在 network failure 时 fallback 到本地 Prompt cache；
4. cache key 是 prompt id，或 project + slug + concrete version/字面 `latest`；environment 不是独立 cache-key 维度，但 explicit environment lookup 失败不会读取该 cache。

这保护了“指定版本”与“尽可能可用的 latest”两种契约，不会把 cache freshness 混成 Prompt version。[JS `loadPrompt`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L4813-L4978)

## Span propagation：V3/V4 compatible reader

这是 object reference/parent context 的 wire compatibility，不是 Experiment/Event schema migration。当前 native TypeScript/Python SDK 默认产生 W3C/OTel-compatible hex ids：16-byte trace id、独立 8-byte span id，并用 V4 span-component serialization。

`BRAINTRUST_LEGACY_IDS=true` opt back into UUID ids 与 V3 serialization。若同时启用 OTel compatibility，hex 要求优先，SDK 忽略 legacy 设置并 warning。[Distributed tracing spec, commit `f50b53f`](https://github.com/braintrustdata/braintrust-spec/blob/f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928/skills/instrumentation-spec/references/features/distributed-tracing.md#native-sdk-id-format-and-back-compat)

兼容读的关键点：`SpanComponentsV4.fromStr()` 先识别版本，遇到旧 V3 slug 时用 `SpanComponentsV3.fromStr()` 解码并转换；deprecated parent-slug path 接受 V3/V4 乃至 parent/child 混合 id format。W3C `traceparent` 路径按规范只能传 hex，所以不产生这种混合 link。[Python `SpanComponentsV4.from_str`, commit `f893ebd`](https://github.com/braintrustdata/braintrust-sdk-python/blob/f893ebdd49c89298497e80a8e812a43f29f62b9f/py/src/braintrust/span_identifier_v4.py#L160-L205)；[JS framework backward-compatible parent decode, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/framework.ts#L1225-L1242)

V3→V4 因而是 writer-default + compatible-reader rollout；公开 SDK 没有批量重写历史 Event ids 或已保存 span slug 的 upgrade command。Terraform 的 migration Lambda 当前还显式设置 `BRAINTRUST_LEGACY_IDS="true"` 并标注待 V4 migration 完成后移除，说明部署内服务的切换也可能晚于 SDK 默认值；不能仅从一个 client 的默认值判断整个 deployment 已完成迁移。[`lambda-migrate-database.tf`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/modules/services/lambda-migrate-database.tf#L24-L43)

## 自托管 routine upgrade：版本与命令

### AWS Terraform

官方 routine 路径是把 module source pin 更新为 `?ref=vX.Y.Z`，随后先 `terraform plan`、审查，再 `terraform apply`。module 通过自己仓库内的 `VERSIONS.json` 固定 data-plane services，而不是要求 operator 手工让每个 image 与 module 同号。[Routine upgrades](https://www.braintrust.dev/docs/admin/self-hosting/upgrade/routine)

在本研究的源码截点，AWS module 各 component pin 是独立文件：API、Gateway、Brainstore、Lambda services 为 `v2.11.0`，Loop Runtime 为 `latest-2.x`。这是 commit `cf5ed69` 的仓库状态，不是对所有安装的推荐版本承诺。[`modules/services/VERSIONS.json`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/modules/services/VERSIONS.json)；[`modules/brainstore-ec2/VERSIONS.json`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/modules/brainstore-ec2/VERSIONS.json)

### GCP/Azure Terraform + Helm

官方说明 GCP/Azure 的 Terraform module 和 Helm chart 是独立 release track；chart version 也不等于 data-plane image version。两者都升级时先 Terraform，再 Helm，并分别审查 plan/diff。因而不能以 `Chart.yaml` 的版本判断 PostgreSQL migration 或 API schema 已处在哪一版。[Routine upgrades](https://www.braintrust.dev/docs/admin/self-hosting/upgrade/routine)

### Data Plane v2 / no-PG 是分阶段兼容迁移

官方 v2 guide 要求严格分 apply，以避免 rolling deployment 中新旧 Brainstore reader/writer 不兼容：

1. 先到 guide 指定的 v1 module/data-plane prerequisite；
2. 单独 apply `brainstore_wal_footer_version = "v1"`，等所有节点已在能读该格式的目标版本；
3. 再升级 v2 module/image，同时切到 WAL `v3`，且保持 `skip_pg_for_brainstore_objects = ""`；
4. 验证后再单独 apply `skip_pg_for_brainstore_objects = "all"`，把 Brainstore objects 的写路径移出 PostgreSQL。

Terraform variable 只允许 WAL footer `""`, `v1`, `v2`, `v3`；repo 的 operator instructions 还明确说明旧节点不能读 rollout 中的新 WAL format。`skip_pg_for_brainstore_objects` 是 one-way operation：回滚需要停机、drain 并重新 ingest，而不是简单把 variable 改回空值。[Data Plane v2 upgrade](https://www.braintrust.dev/docs/admin/self-hosting/upgrade/v2)；[`variables.tf`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/variables.tf#L1163-L1181)；[repo `AGENTS.md` rollout constraints, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/AGENTS.md#L74-L91)

这些步骤明确改变 physical writer/read compatibility 与 write ownership。公开 guide **没有说明**升级时是否批量重写既有 WAL/segment 中的用户 payload，也没有公开格式转换算法；可确认的 destructive boundary 只到“no-PG rollback 需要 drain/re-ingest”。不能据此断定逻辑 Event rows 一定被或一定没被重写。

### Terraform major v6：服务拓扑切换

AWS module v6 把 APIHandler/AIProxy 从 Lambda 迁到 ECS。正式 migration guide 要先以 `enable_ecs_api=false` apply，让 ECS 与 Lambda 并存并验活；再设 `true` 二次 apply 切流。早期可把它改回 `false` 快速回滚到仍保留的 Lambda。这是 topology migration；guide 没有声明它迁移或重写 Experiment/Dataset/Prompt data。[`MIGRATION_V6.md`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/MIGRATION_V6.md)

Terraform 的 `moved` blocks 只把 state address（例如 S3 bucket resource 从一个 module address 移到另一个）映射到已有 infrastructure resource，避免 destroy/create。它不是 Braintrust Event/Object 的 data migration，不能据此推断 object storage 内容被复制。[`moved_state.tf`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/moved_state.tf)

## 服务端数据库 migration：公开了触发器，没有公开内容

AWS Terraform 能确认的 server migration 边界如下：

- `aws_lambda_function.migrate_database` 从 Braintrust versioned S3 artifact 部署 `MigrateDatabaseFunction`。handler 是 `lambda_function.lambda_handler`、runtime 是 Python 3.13，并取得 `PG_URL`；binary/source 不在 repository；
- `BRAINTRUST_RUN_DRAFT_MIGRATIONS` 来自 `run_draft_migrations`，该 variable 默认 `false`；
- `aws_lambda_invocation.invoke_database_migration` 的 trigger 是 Lambda published `function_version`，因此 artifact version 变化会 invoke 一次；
- APIHandler、AIProxy 与 cron infrastructure 依赖该 invocation，部署图要求 migration 先完成；
- API gateway 暴露 `/migration-status`、`/migration-version` 以及 `/logs-migration/status|run-batch|update-state|update-cursor-sequence-id` routes。

证据分别是 [`lambda-migrate-database.tf`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/modules/services/lambda-migrate-database.tf)、[`run_draft_migrations` variable](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/modules/services/variables.tf#L250-L265) 与 [`api-gateway-openapi-spec.tf`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/modules/ingress/api-gateway-openapi-spec.tf#L265-L327)。

正式公开仓库没有这个 Lambda 的 Python source、migration manifest、SQL/DDL、PostgreSQL table/model 名或 revision graph。它也没有公开 status response schema、每一步 transaction boundary、lock、idempotency/backfill/rollback strategy，以及 `draft` migration 清单。因此本研究不能验证：

- 某个 release 新建/改写了哪些 table、column、index 或用户 rows；
- migrations 是逐条、逐 migration 还是整批 transaction；
- Lambda timeout/失败后的 partial state 与下一次 invoke 如何恢复；
- hosted Braintrust 的 rollout cadence 是否与公开 self-host module 相同；
- `/migration-*` 或 `/logs-migration/*` 的内部状态机和兼容期。

“存在 migration Lambda”只证明有 owner/ordering hook，不证明 migration 的内容或原子性。闭源部分必须停在这里。

## `braintrust-migrate` 是组织复制，不是 schema upgrade

Braintrust 官方另有 `braintrust-migrate` CLI。它在两个 Braintrust environment/org 之间读取 REST/BTQL resources、重新创建 destination objects，并维护 source→destination id mapping。它还用 SDK-backed `/logs3` 写高容量 logs/experiment/dataset events。高容量 stream 按 `_pagination_key` 分页，本地 JSON checkpoint 与 SQLite seen-id store 允许 resume/deduplicate。[`braintrust-migrate` README, commit `d6ae02f`](https://github.com/braintrustdata/braintrust-migrate/blob/d6ae02fdf82802c8babfedce8c492c6f05ed19ff/README.md)

它会在 destination 产生用户可见的新 resource/event 与新/映射后的 id，source 不被原地升级；它的 checkpoint 也不是 Experiment execution resume protocol。API 只暴露 bundle reference/preview、不给编译后的 artifact，所以 bundle-backed functions 会以 `code_bundle_not_migratable` 跳过并要求用户重新 `braintrust push`。[Bundled-code boundary, commit `d6ae02f`](https://github.com/braintrustdata/braintrust-migrate/blob/d6ae02fdf82802c8babfedce8c492c6f05ed19ff/README.md#L520-L550)

## 哪些动作会改写用户已保存数据

| 动作 | 对用户保存数据的公开影响 | 是否保留旧历史 / 是否可回退 |
| --- | --- | --- |
| SDK Dataset legacy reader | 不改服务端，只转换返回字段 | 原 row 不变；关掉 legacy adapter 即可 |
| Dataset restore | 追加 compensating rows，改变 latest dataset head | 旧 `_xact_id` history 保留；可再做另一次 restore |
| Prompt environment move | 改 alias→version mapping，不改 Prompt revision | 既有 version 与 Experiment provenance 不变 |
| routine DB migration Lambda | **未公开**；可能含 schema/data migration，无法逐版判断 | transaction、rollback、row rewrite 均未公开 |
| WAL footer v1→v3 | 改 physical write/read format compatibility | 既有 object 是否重写未公开；必须按分阶段 rollout |
| no-PG enable | 改 Brainstore object write path/owner | one-way；rollback 要 downtime + drain/re-ingest |
| Terraform v6 Lambda→ECS | 没有公开的用户 data rewrite | traffic 可在 Lambda 尚存时切回 |
| Terraform `moved` blocks | 只改 Terraform state address | 指向同一 infra resource，不是业务 data rewrite |
| `braintrust-migrate` | 在 destination 创建副本并 remap references | source 保留；destination 可 partial/resume；不是 in-place |

## 未公开且不能推断的兼容边界

截至研究截点，官方源码/文档不足以验证以下内容：

- PostgreSQL DDL、table/ORM model、index、foreign key，以及 Event/Object 的确切 table mapping；
- Brainstore WAL/segment 的 binary schema、reader compatibility matrix、compaction schema evolution 与旧 segment retirement；
- web application 的 query/result schema negotiation 与前后端最低兼容版本；
- Experiment comparison/grade 算法的持久 schema 或 algorithm version；
- hosted control-plane 与 data-plane 的 database migration 细节；
- 服务端是否保存/回填任一 UI aggregate 的历史版本；
- deprecated `_parent_id`、Dataset `useOutput` 等接口的准确移除 release；
- routine database migration 是否逐版重写任何历史 user payload。

研究证据显示，Braintrust 对**对象历史**主要采用 versioned event + compatible reader。对**部署/物理格式**，它采用有顺序的 rollout 和 migration hook。公开材料不足以证明它有某种未公开的统一 schema registry、自动兼容所有旧 client，或数据库迁移永不改变用户数据。

## 源码核对点

| 官方仓库 | commit / 日期 | 本页核对范围 |
| --- | --- | --- |
| [`braintrustdata/braintrust-openapi`](https://github.com/braintrustdata/braintrust-openapi) | `4481f2e10e5859c930abc844483354101d10a57b` / 2026-08-13 | OpenAPI dialect/document version、event history/fetch/deprecation |
| [`braintrustdata/braintrust-sdk-javascript`](https://github.com/braintrustdata/braintrust-sdk-javascript) | `ae768820b1f5044c825918aa7226ea300bf3670d` / 2026-08-13 | logs3 envelope、Dataset legacy adapter、Prompt reader/cache、V3/V4 decode |
| [`braintrustdata/braintrust-sdk-python`](https://github.com/braintrustdata/braintrust-sdk-python) | `f893ebdd49c89298497e80a8e812a43f29f62b9f` / 2026-08-13 | Dataset normalization、`SpanComponentsV4.from_str` |
| [`braintrustdata/braintrust-spec`](https://github.com/braintrustdata/braintrust-spec) | `f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928` / 2026-08-13 | Dataset versions/restore、distributed tracing compatibility |
| [`braintrustdata/terraform-aws-braintrust-data-plane`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane) | `cf5ed695727363877296a1d37c7876e3a9a4d969` / 2026-08-13 | version pins、migration trigger、WAL/no-PG、v6、Terraform moved state |
| [`braintrustdata/braintrust-migrate`](https://github.com/braintrustdata/braintrust-migrate) | `d6ae02fdf82802c8babfedce8c492c6f05ed19ff` / 2026-07-07 | organization copy、checkpoint/resume、bundle boundary |
