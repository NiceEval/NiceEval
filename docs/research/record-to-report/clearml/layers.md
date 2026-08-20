# ClearML 原生组件、资源与 owner

本页只描述 ClearML 自己公开的组件边界、资源归属和依赖。
调用顺序见 [execution.md](execution.md)，物理结构见 [storage.md](storage.md)。

## 产品组件

ClearML 官方仓库把产品拆成 SDK、Server、Agent 和 WebApp；Server 部署再依赖 MongoDB、Elasticsearch、Redis 与 fileserver。

| ClearML 组件 | 原生职责 | 主要 owner | 官方证据 |
| --- | --- | --- | --- |
| Python SDK | `Task` / `Logger` API、framework auto-connect、stdout/stderr、资源监控、Event 与 Artifact 客户端 | 用户 Python 进程 | [`clearml/task.py :: Task`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py) · [`clearml/logger.py :: Logger`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/logger.py) |
| REST API Server | 鉴权后验证资源、执行 Task 状态机、Queue 操作、Event ingestion/query、Report API | `clearml-apiserver` | [Server README](https://github.com/clearml/clearml-server/blob/v2.4.0/README.md) · [`apiserver/services`](https://github.com/clearml/clearml-server/tree/v2.4.0/apiserver/services) |
| MongoDB backend/auth | Task、Model、Project、Queue 与 migration ledger 等文档；用户、凭证等 auth 数据 | API Server 的 MongoEngine model / migration | [`apiserver/database/model`](https://github.com/clearml/clearml-server/tree/v2.4.0/apiserver/database/model) |
| Event BLL + Elasticsearch | 详细 scalar、vector、debug image、plot、log 事件及聚合查询 | API Server EventBLL | [`apiserver/bll/event/event_bll.py :: EventBLL`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_bll.py) |
| fileserver / 外部对象存储 | Artifact、debug image、model weights 等 payload bytes | 上传客户端与选定 storage driver；内建 fileserver 提供 HTTP 文件面 | [`fileserver/fileserver.py`](https://github.com/clearml/clearml-server/blob/v2.4.0/fileserver/fileserver.py) · [Storage 文档](https://clear.ml/docs/latest/docs/integrations/storage/) |
| Queue | 保存待执行 Task ID 的服务端资源 | API Server `QueueBLL` | [`apiserver/database/model/queue.py :: Queue, Entry`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/queue.py) |
| clearml-agent | 轮询 Queue，准备 repository、container 或 virtualenv 与 requirements，运行用户命令并报告状态和控制台输出 | Agent worker 进程 | [Agent README](https://github.com/clearml/clearml-agent/blob/v3.0.3/README.md) · [`commands/worker.py`](https://github.com/clearml/clearml-agent/blob/v3.0.3/clearml_agent/commands/worker.py) |
| WebApp | Project / Task 表格、单 Task 页、比较页、Reports 页面及 Apps UI | 浏览器 + Web/API Server | [Tracking Tasks](https://clear.ml/docs/latest/docs/webapp/webapp_exp_track_visual/) · [Comparing Tasks](https://clear.ml/docs/latest/docs/webapp/webapp_exp_comparing/) |
| Redis | Event 查询迭代器等短期服务状态；不是运行事实的长期存储 | API Server | [`apiserver/bll/event/event_common.py :: EventSettings`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_common.py) |

`clearml-web` 有官方开源仓库，但本研究不把浏览器内部 Redux state 当持久契约。
产品可核查的持久边界来自 Server model、API schema 和正式 migration。

## 原生资源及其引用

### Project 与 Task

`Project` 是组织与导航容器；`Task.project` 保存 Project ID。
`Task.parent` 可以引用另一个 Task，供 clone、pipeline 或父子任务关系使用。
Task ID 是稳定系统身份，名称、Project、tags 与状态均可变。

服务端权威类是
[`apiserver/database/model/project.py :: Project`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/project.py)
和 [`apiserver/database/model/task/task.py :: Task`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/task/task.py)。
用户侧入口是[官方 `Task` SDK](https://clear.ml/docs/latest/docs/references/sdk/task/)。

### Event

Event 不是嵌入 Task 的明细数组。事件文档用 `task` 字段归属 Task，或在 API 2.23 以后用 `model_event` 区分 Model event。
公开 Event 类型为 scalar、vector、debug image、plot 与 task log。

SDK envelope 见
[`backend_api/services/v2_23/events.py :: MetricsScalarEvent, MetricsVectorEvent, MetricsImageEvent, MetricsPlotEvent, TaskLogEvent`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_api/services/v2_23/events.py)。
Server 的 index owner 见
[`event_common.py :: get_index_name`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_common.py)。

### Artifact

Artifact 的描述符嵌在 `Task.execution.artifacts`；描述符包含 `key`、`type`、`mode`、`uri`、`hash`、`content_size` 等字段。
payload 不嵌入 Task，而由 `uri` 指向 fileserver、S3、GCS、Azure 或其它 storage。

服务端类型是
[`task.py :: Artifact, ArtifactTypeData, Execution`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/task/task.py)；
SDK owner 是
[`binding/artifacts.py :: Artifacts`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/binding/artifacts.py)。

### Model

Model 是独立资源，不是 Task 内嵌 Artifact。
Mongo `model` 文档保存 framework、design、labels、metadata、权重 `uri` 等；Task 的 `models.input` / `models.output` 只保存 `ModelItem(name, model)` 引用。
Model 也可用 `task` 字段反向关联创建它的 Task。

公开 owner 是
[`apiserver/database/model/model.py :: Model`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/model.py)
与 [`task.py :: Models, ModelItem`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/task/task.py)。
用户概念见[官方 Models 文档](https://clear.ml/docs/latest/docs/fundamentals/models/)。

### Queue 与 Agent

`Queue.entries` 是 `Entry(task, added)` 的有序嵌入列表；Task 还可在 `execution.queue` 引用队列。
Queue 归 Server 所有，Agent 只是消费者；Agent 不拥有 Task schema，也不直接写数据库。

这条边界由
[`queue.py :: Queue, Entry`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/queue.py)、
[`queue_bll.py :: QueueBLL`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/queue/queue_bll.py)
与 [`worker.py :: get_next_task`](https://github.com/clearml/clearml-agent/blob/v3.0.3/clearml_agent/commands/worker.py) 共同证明。

### Report

Report 有公开 `reports.*` REST API，但没有独立 Mongo `report` collection。
`reports.create` 创建 `TaskType.report` Task，并把它放到用户 Project 下的隐藏 `.reports` 子 Project。
正文与资源引用分别进入 Task 的 `report` 和 `report_assets` 字段。

权威实现是
[`apiserver/services/reports.py :: create_report, update_report, publish`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/reports.py)
和 [`apiserver/apimodels/reports.py`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/apimodels/reports.py)。
公开 REST 面见[Reports API](https://clear.ml/docs/latest/docs/references/api/reports/)，作者 UI 见[Reports 文档](https://clear.ml/docs/latest/docs/webapp/webapp_reports/)。

SDK `v2.1.11` 的
[`backend_api/services`](https://github.com/clearml/clearml/tree/v2.1.11/clearml/backend_api/services)
只有 `v2_9`、`v2_13`、`v2_20`、`v2_23` 生成目录，未生成 `reports` service，也没有公开 `Report` Python class。
这表示 Report 的 REST 资源公开，但 Python SDK 没提供同级作者对象；不能把两者混写成“Report 未公开”。

### Dashboard

ClearML 文档有同名面：WebApp home 的标题也是 Project Dashboard，只汇总最近的 Projects、Reports 与 Tasks；它是导航首页。
本研究把它称为 **Home Dashboard**，见[官方 WebApp Home](https://clear.ml/docs/latest/docs/webapp/webapp_home/)。

Project Overview 是 Project 页面的一部分，可显示 Task 的 LAST / MIN / MAX 指标快照。
Project Dashboard 则是 Pro App，可聚合 Task 状态、指标、GPU、worker 与告警，并可导入、导出 JSON 配置或 clone App instance。
本研究把后者称为 **Project Dashboard App**。

公开文档见
[Project Overview](https://clear.ml/docs/latest/docs/webapp/webapp_project_overview/)
和 [Project Dashboard](https://clear.ml/docs/latest/docs/webapp/applications/apps_dashboard/)。
Dashboard App 的服务端实现、数据库 model、事务边界与 schema migration 未在本次固定的官方开源 Server / SDK / Agent 源码中公开；本文不推测。

## 引用与依赖边界

| 引用方 | 被引用方 | 引用形态 | 依赖含义 |
| --- | --- | --- | --- |
| Task | Project / parent Task / Queue | Mongo ID 字段 | 逻辑引用，由 Server API 校验；Mongo 不提供关系型外键 |
| Event | Task 或 Model | Elasticsearch 文档的 `task` ID + `model_event` | Event 明细与 Mongo resource 通过 ID 关联 |
| Task | Artifact payload | embedded descriptor 的 `uri` | descriptor 与 bytes 分属 Mongo 和 storage |
| Task | Model | `models.input/output[].model` | Model 是独立资源；Task 保存具名 input/output reference |
| Model | weights | Model `uri` | metadata 与 weights bytes 分属 Mongo 和 storage |
| Report Task | 嵌入对象 | Markdown iframe/query + `report_assets` URL | Report 依赖 Task / Model / App widget query |
| Dashboard App | Project / workspace / metric | Pro App 配置 | 持久 model 与引用完整性规则未公开 |

因此 ClearML 的 owner 是分布式的：Server 拥有资源与状态，SDK/Agent 拥有运行时采集，storage 拥有 bytes，WebApp 拥有读取时组合。
