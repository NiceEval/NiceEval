# Braintrust 的 layer、component 与 resource

本文只回答 Braintrust 自己怎样分面、谁拥有哪段状态，以及对象怎样引用；执行时序见 [execution.md](execution.md)，字段与物理表示见 [storage.md](storage.md)。

## 产品面与 owner

Braintrust 明确把部署分为 control plane 与 data plane；SDK、CLI、browser UI 则是进入这两个 plane 的客户面。自托管并不是把整个产品搬进客户云：control plane 仍由 Braintrust 管理，敏感 AI data 所在的 data plane 才可以放在客户账户或区域。[Self-hosted architecture](https://www.braintrust.dev/docs/admin/self-hosting/architecture)

| 原生 layer/component | owner | 它拥有或负责什么 | 不应误认为 |
| --- | --- | --- | --- |
| `bt` CLI | 用户进程 | eval 文件发现、language/runner 选择、参数与 sampling、子进程、SSE progress、终端退出码 | Experiment 的持久 scheduler 或 completion service |
| TypeScript/Python SDK eval framework | 用户进程 | data iteration、trial/concurrency、task/scorer 调用、span tree、后台日志队列 | 服务端 job queue |
| Web app / browser | Braintrust control plane 提供；浏览器直连 data plane | 项目导航、Experiment/Dataset/Prompt 管理、trace viewer、review、comparison、saved view | AI payload 的中转存储；自托管时浏览器经 CORS 直接访问客户 data plane |
| Control plane | Braintrust | UI、authentication/user management、organization/project settings，以及 project/experiment/dataset 名称与 experiment git metadata | 敏感 trace/dataset payload 的权威存储 |
| Data-plane API service | Braintrust binary；部署方运维 | SDK/browser 的入口，resource registration、ingest、query、background eval/function/proxy work | 已公开源码的 server；公开 Terraform 只部署编译 artifact |
| Brainstore writer | data plane | ingest span/trace，向 object-storage WAL 追加 | PostgreSQL table writer 的同义词 |
| Brainstore reader / fast reader | data plane | ad-hoc BTQL/SQL 与隔离的 UI 常用查询 | 权威原始事实；它们可替换且依赖 object storage |
| Object storage | 部署方账户或 Braintrust hosted plane | AI data 的 durable source of truth；WAL 与 compacted/indexed segments | 仅附件 bucket |
| PostgreSQL | data plane | 运行平台所需 metadata、object-storage pointer 与 aggregate statistics | trace/span/log 的主要存储 |
| Redis | data plane | cache、session/rate-limit coordination、Brainstore transaction-id assignment | durable event history |

官方架构给出了更细的 Brainstore read/write pipeline。writer 先 append WAL。processor 把写入项放进 time-ordered segment，并保证同一 trace 的 span 位于同一 segment。compactor 产生 inverted index、row store、column store 与 bloom filter。reader 在查询时合并 WAL、已处理但未压实的写入项与已索引 segment，因此索引尚未完成也能实时读。[Architecture：write/read path](https://www.braintrust.dev/docs/admin/self-hosting/architecture#brainstore)

在 2026-08-14 核对的 AWS module 中，API 已按 workload 拆成 `braintrust-api`、`braintrust-api-ingest`、`braintrust-api-background`；Brainstore 则有 writer、reader、fast reader。这是 Braintrust 的部署组件边界，不是 Experiment 内部的产品分层。[`MIGRATION_V6.md`, commit `cf5ed69`](https://github.com/braintrustdata/terraform-aws-braintrust-data-plane/blob/cf5ed695727363877296a1d37c7876e3a9a4d969/MIGRATION_V6.md)

## Resource graph

### Project、Project logs 与 Experiment

`Project` 是 logs、Experiments、Datasets、Prompts、Views 的共同管理边界。production instrumentation 写入 `project_logs` 容器；offline eval 写入 `experiment` 容器。两者的 row 都采用同一 span shape，主要差异是容器外键：project log row 有 `project_id/log_id`，experiment row 有 `project_id/experiment_id`。[OpenAPI `ProjectLogsEvent` 与 `ExperimentEvent`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1175-L1480)

`Experiment` resource 保存比较和复现所需的容器 metadata：`project_id`、`name`、`base_exp_id`、`dataset_id`、`dataset_version`、`parameters_id/version`、repo/git metadata、tags 等。它拥有一组 `ExperimentEvent`，但没有公开的 `status` 或 `completed_at`。[OpenAPI `Experiment`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L1609-L1750)

### Event、Span 与 Trace

这三个词处在不同抽象面：

- **Event** 是 API row：`InsertExperimentEvent` 是写 shape，`ExperimentEvent` 是服务端补齐 `_xact_id`、container ids、span ids 后的读 shape。
- **Span** 是用户与 SDK 的 execution unit，也是 UI 的一行。公开 `Span` interface 拥有 `log()`、`startSpan()`、`traced()`、`end()`、`flush()`、`permalink()` 等生命周期方法；持久化后仍是上述 event row。[`Span` interface, `js/src/logger.ts`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L319-L495)
- **Trace** 是共享 `root_span_id` 的 span DAG；`span_parents` 构边。官方说明 DAG 可有多 parent，但 UI 只支持显示一个 root。[Advanced tracing](https://www.braintrust.dev/docs/instrument/advanced-tracing#trace-data-structures)

一个 offline test case 通常产生 root `eval` span、child `task` span、若干 `llm/tool/function` span，以及 sibling/child `score`、`classifier` span。Experiment 不是“一个 trace”；它是许多 case traces 的容器。[Trace anatomy](https://www.braintrust.dev/docs/observe/examine-traces#anatomy-of-a-trace)

### Dataset、Snapshot 与 Environment

`Dataset` 是 versioned test-case collection，拥有 `DatasetEvent` rows。每次 insert/update/delete 推进 head version；version 是 concrete `_xact_id`。两个额外 resource 只是指针：

- `DatasetSnapshot` 把 human-readable `name` 指向一个 concrete `xact_id`；正常用法是稳定 checkpoint，但 spec 也允许调用者显式移动已有命名 snapshot，所以复现必须保存对应的 concrete version；
- `EnvironmentObject` 把 environment slug 映射到一个可移动 `object_version`，由 dataset 与 prompt 共用。

SDK 的 selector precedence 是 explicit version → snapshot name → environment；Experiment 注册前必须求出间接 selector 对应的 concrete `dataset_version`。restore 不是移动 head pointer，而是追加 compensating rows，产生新的 head。[官方 `dataset-versions` contract, commit `f50b53f`](https://github.com/braintrustdata/braintrust-spec/blob/f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928/skills/instrumentation-spec/references/features/dataset-versions/README.md)

### Prompt 与运行 provenance

`Prompt` 是 project-scoped、versioned resource；其 public row 有 stable `id/slug`、version `_xact_id` 与 `prompt_data`。每次 prompt change 自动产生新 version，environment 可以指向某个 version。[Create prompts](https://www.braintrust.dev/docs/evaluate/write-prompts#version-prompts)

Prompt 与 Experiment 没有强 containment。真正的运行关联由 span provenance 完成。`Prompt.build()` 返回的 `span_info.metadata.prompt` 包含 `id`、`project_id`、`version` 与 render variables。playground/session 还可带 `prompt_session_id`。instrumentation 随后把它写进实际 LLM span。[`Prompt.runBuild`, commit `ae76882`](https://github.com/braintrustdata/braintrust-sdk-javascript/blob/ae768820b1f5044c825918aa7226ea300bf3670d/js/src/logger.ts#L9099-L9170)；[Prompt metadata spec, commit `f50b53f`](https://github.com/braintrustdata/braintrust-spec/blob/f50b53f5400b6ddf1e91e0c6b7a0880ec71ae928/skills/instrumentation-spec/references/instrumentation-guide.md#prompt-metadata)

### Feedback、Review span 与 Activity

`FeedbackExperimentItem` 不是一个可独立 list/get 的顶层 object resource；它是对目标 event `id` 的 write command，可带 scores、expected、comment、audit metadata、source、tags。feedback metadata 明确属于 attached audit log，不是 target event 的 ordinary metadata。[OpenAPI `FeedbackExperimentItem`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L2490-L2555)

多人判断不能靠在 target row 上反复写入同一个 score。官方产品面用每位 reviewer 的 `review` span 保存独立判断；production user feedback 指南同样要求每次 submission 建 child span，parent 的展示 score 再做平均。[Human review](https://www.braintrust.dev/docs/annotate/human-review)；[Capture user feedback](https://www.braintrust.dev/docs/instrument/user-feedback#collect-multiple-scores)

Activity history 是 row-scoped change/merge/comment history，和 organization-level audit logging 不是一件事。[Examine traces：Activity](https://www.braintrust.dev/docs/observe/examine-traces#view-activity-history)

### ObjectReference 与 View

`ObjectReferenceNullish` 是跨容器 provenance pointer。它必填 `object_type/object_id/id`，可带 source `_xact_id/created`。object type 包括 `project_logs`、`experiment`、`dataset`、`prompt`、`function`、`prompt_session`。它说明“本 event 从哪一 row 复制/派生”，不内嵌或保证 source 内容继续存在。[OpenAPI `ObjectReferenceNullish`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L760-L794)

典型引用链是 Dataset row `origin` → production span，Experiment root span `origin` → concrete Dataset row/version，LLM span metadata → Prompt/version。完整 trace reference 也能直接作为 Dataset row input；这种 row 依赖 source trace 的 retention，source 消失时 UI 显示 `Referenced trace not found`，证明 reference 不是 copy。[Promote traces from logs](https://www.braintrust.dev/docs/annotate/datasets/create#promote-traces-from-logs)

`View` 是独立持久 resource，关联 `object_type/object_id/view_type`；`view_data.search` 保存 filter/tag/match/sort，`options` 保存 column、layout、group 等呈现选择。它引用数据，不拥有 query result snapshot。[OpenAPI `ViewData` / `View`, commit `4481f2e`](https://github.com/braintrustdata/braintrust-openapi/blob/4481f2e10e5859c930abc844483354101d10a57b/openapi/spec.yaml#L8355-L8655)

## 公开边界

Braintrust 公开了 client SDK、CLI、OpenAPI、instrumentation/dataset-version spec 与 self-host Terraform。它没有公开 data-plane API service、Brainstore engine、web app backend 的实现仓库，也没有公开 PostgreSQL ORM model/table 或 migration SQL。

因而本研究可以确认 plane、resource、wire shape 与部署组件，不能从 public material 推断内部表名、foreign key、transaction isolation 或 comparison engine 的私有 schema。闭源边界的逐项清单见 [schema-and-migration.md](schema-and-migration.md#未公开且不能推断的边界)。
