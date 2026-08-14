# W&B 的 layer、component 与引用

> 观察日期：2026-08-14
>
> 只写产品自己的层、owner 与依赖。不套 NiceEval 层。
>
> Models 与 Weave 分节，不合成同一 schema。

产品定位与对象总图见 [README.md](README.md)。
发起与收尾顺序见 [execution.md](execution.md)。

## Models

### 用户可见 component

| component | 用户看见什么 | 公开入口 |
|---|---|---|
| Python SDK `wandb.Run` | `init` / `log` / `config` / `summary` / `finish` | [`wandb.init`](https://docs.wandb.ai/models/ref/python/functions/init) |
| Artifact | 具名、分 type、按 checksum 升版的文件集合 | [Artifacts](https://docs.wandb.ai/models/artifacts) |
| Registry | 模型与数据集的集中入口 | [Registry](https://docs.wandb.ai/models/registry) |
| Sweep | 超参搜索调度 | [Sweeps](https://docs.wandb.ai/models/sweeps) |
| Launch | 把作业投到队列或集群 | [Launch](https://docs.wandb.ai/models/launch) |
| Workspace | 项目内探索 Run 的面板沙盒 | [Workspaces](https://docs.wandb.ai/models/track/workspaces) |
| Report | 叙事页，内含 panel grid 与 Runset | [Create a report](https://docs.wandb.ai/models/reports/create-a-report) |
| Public API `wandb.Api` | 事后查询、导出、改 config / summary | [Public API](https://docs.wandb.ai/models/track/public-api-guide) |

组织轴是 entity → project → run。
Run 属于 project；project 属于 entity（用户或 team）。
见 [Run 概览](https://docs.wandb.ai/models/runs)。

### 进程与 sidecar

`v0.28.2` 维护者文档把 SDK 写成两半。
[architecture.md](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/docs/sdk/architecture.md) @ `dc1ef8be`：

- Python 包拥有用户 API：`wandb.init()`、`Run`、settings、config、媒体类型。
- Go 写的 `wandb-core` 拥有耐久与阻塞工作：run upsert、transaction log、filestream、文件上传、artifact、系统指标、sync。

`run.log()` 不直接发 HTTP。
它把 protobuf `Record` 交给 sidecar。

`wandb-core` 从 `0.18.0` 起成为默认。
旧 Python service 在 `0.21.0` 删除。

用户通常看不见 sidecar。
一个 `wandb-core` 可以服务多个客户端进程。
若进程变量里已有 `WANDB_SERVICE`，SDK 连已有服务，结束 Run 时不关掉它。
见 [run-lifecycle.md](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/docs/sdk/run-lifecycle.md)。

### owner

| 职责 | owner |
|---|---|
| 用户 API 校验与序列化 | 用户进程里的 Python SDK |
| 持久 `.wandb`、上传、重试 | `wandb-core` Handler / Sender |
| Run 元数据 upsert | `RunUpserter`，防抖 GraphQL `UpsertBucket` |
| history / summary / output 流 | filestream |
| `run.save()` 文件 | `runfiles.Uploader` + `FileTransferManager` |
| Artifact 长任务 | Python 对象模型 + core `ArtifactSaveManager` |
| Workspace / Report 布局 | App；代码 API 在 `wandb-workspaces`（Public Preview） |
| 服务端 Run 资源 | 闭源 App / GraphQL；本次检查未见表源码 |

### 引用与依赖

```text
entity
  └── project
        ├── Run  ──log_artifact / use_artifact──► Artifact
        ├── Sweep / Launch ──创建或 resume──► Run
        ├── Workspace ──选择──► Run 集合
        └── Report ──Runset──► 冻结或过滤后的 Run 集合
```

- Run 用项目内 `id` 引用；GraphQL `name` 即该 ID，`id` 是 `storage_id`。
  符号：`wandb.apis.public.runs.Run` @ `dc1ef8be`。
- Artifact 用 `entity/project/name:alias` 或 `vN` 引用。
- Table 不是独立资源，作为 Artifact 持久化。
  [Table 源码](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/wandb/sdk/data_types/table.py)
- Report 里的 `WeaveBlock*` / `WeavePanel*` 不指 LLM Weave 产品。
  见 [Edit a report](https://docs.wandb.ai/models/reports/edit-a-report)。
- Weave Call 可通过 `wb_run_id` 指向本层 Run。
  这不是 Models 信封的字段，见下方 Weave 节。

## Weave

### 用户可见 component

| 名词 | 官方含义 | 不是什么 |
|---|---|---|
| Op | versioned、被跟踪的函数 | 不是一次执行 |
| Call | Op 的一次执行 | 不是 Models Run |
| Trace | 共享 `trace_id` 的 Call 树 | 不是独立持久类型 |
| Thread / Turn | 多轮会话上的分组 | 可选字段 |
| Object | 可 `publish` 的 versioned 值 | 不是 Call |
| Dataset | 带 rows 的 Object | 改内容会产生新 version |
| Evaluation | dataset + scorers 的蓝图 | 一次 `.evaluate()` 才是 run |
| Feedback | 挂在 ref 上的评价 | 可添加、查询、purge |
| SavedView | 保存列、过滤、排序的 builtin Object | 不是 Call |
| ref | `weave:///{entity}/{project}/{kind}/...` | 见 [storage.md](storage.md#weave) |

见 [Ops, Calls, and Traces](https://docs.wandb.ai/weave/guides/tracking/tracing)、
[Objects](https://docs.wandb.ai/weave/guides/tracking/objects)、
[Evaluations](https://docs.wandb.ai/weave/guides/core-types/evaluations)。

### 客户端到 server

```text
用户函数 / agent SDK / OTel exporter
        │  weave.init + @weave.op  或  OTLP
        ▼
WeaveClient  ──► RemoteHTTPTraceServer
        │         POST /call/start|/call/end|/calls/complete
        ▼
ClickHouseTraceServer（开源实现）
        └── UI Traces / Evaluations / Objects
            与 get_calls / Evaluation REST
```

[trace_server/README.md](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/README.md) @ `59a9d186`

本机还可写 `~/.weave/wal/{project_id}/`。
路径与表见 [storage.md](storage.md#weave)。

### owner

| 职责 | owner |
|---|---|
| Op 装饰与 Call stack | 用户进程 `WeaveClient` |
| HTTP 批处理与重试 | `RemoteHTTPTraceServer` / Stainless client |
| ClickHouse INSERT | `ClickHouseTraceServer`，异步分批 |
| Object / Table / File | 同一 client；digest 可客户端预计算 |
| Feedback | 独立 API，不改 Call 行 |
| WAL | 本机进程私有文件，无跨进程锁 |
| Agents view | OTel ingest + 服务端 span 投影 |

符号：`weave.trace.weave_client.WeaveClient` @ `59a9d186`。

### 引用与依赖

```text
project
  ├── Op  ◄── Call.op_name（常为 Op ref）
  ├── Call ──parent_id / trace_id──► 同一 Trace 的其它 Call
  ├── Evaluation ──引用──► Dataset + Model + Scorer Object
  ├── Evaluation.evaluate Call ──input_refs──► Evaluation 蓝图
  └── Feedback.weave_ref ──► Call / Object / agent span
```

- 用户空间只接受 `weave:///` URI。
  `weave.trace.refs.Ref.parse_uri` @ `59a9d186`。
- 内部存储把 `entity/project` 换成 `project_id`，scheme 换成 `weave-trace-internal`。
  `weave.shared.refs_internal` @ `59a9d186`。
- `CallSchema.wb_run_id` / `wb_run_step` 指向 Models Run。
  见 [Call schema](https://docs.wandb.ai/weave/guides/tracking/call-schema-reference)。
- Models 的 config / history / Artifact manifest 不出现在 Weave 初表里。
  `001_init.up.sql` @ `59a9d186`。
- 旧 `wandb-artifact:///` 只留在内部 `InternalArtifactRef` 与 `dev_docs/REF_SPEC.md`。
  当前用户 API 以 `weave:///` 为准。
