# ClearML：以 Task 为中心的实验管理与执行系统

> 观察日期：2026-08-14
> 文档性质：外部产品研究

## 产品是什么

ClearML 是一套 ML/DL 开发与生产套件。它把实验跟踪、远程执行、Model 与 Artifact 管理、Web 查看和报告放在同一产品中。
用户代码实际执行；ClearML SDK 捕获代码版本、依赖包、参数、日志、指标、图表、Model 与 Artifact；Server 保存并向 SDK、REST API 和 WebApp 提供这些对象。
[官方 Tasks 概念](https://clear.ml/docs/latest/docs/fundamentals/task/)把 `Task` 定义为一次代码执行会话。

本研究固定在下列公开版本。滚动文档与带 tag 的源码冲突时，以带 tag 源码为准。

| 对象 | 固定版本与 commit | commit 日期 | 官方入口 |
| --- | --- | --- | --- |
| Python SDK | `v2.1.11` · `0061afeeab3cb3fab27b1cd907aa67cf438d4e8b` | 2026-08-07 | [源码](https://github.com/clearml/clearml/tree/v2.1.11) · [release](https://github.com/clearml/clearml/releases/tag/v2.1.11) |
| ClearML Server | `v2.4.0` · `0a90a2745885fd7173cdb1d5466855fc57b1187b` | 2026-03-08 | [源码](https://github.com/clearml/clearml-server/tree/v2.4.0) · [release](https://github.com/clearml/clearml-server/releases/tag/v2.4.0) |
| ClearML Agent | `v3.0.3` · `328662fd981f417d83201c52a34a476d9ec32fbb` | 2026-06-02 | [源码](https://github.com/clearml/clearml-agent/tree/v3.0.3) · [release](https://github.com/clearml/clearml-agent/releases/tag/v3.0.3) |
| 官方文档仓库 | `53782832efce804072879f107ab148218ba07536` | 2026-08-11 | [固定源码](https://github.com/clearml/clearml-docs/tree/53782832efce804072879f107ab148218ba07536) · [滚动站](https://clear.ml/docs/latest/docs/) |

## 用户的核心心智模型

用户先创建或重新打开一个 `Task`。本地进程可以直接执行它，也可以把它放进 `Queue`，由 `clearml-agent` 领取并执行。
运行中的 Logger 把 Event 归到该 Task；模型与 Artifact 通过引用挂回 Task；状态字段说明它当前处于 Draft、Queued、Running 或终态。

历史工作不是另建一套分析对象。用户在 Project / Task 表格里筛选 Task，再打开单 Task、比较若干 Task，或把 Task / Model / App 的可视化嵌入 Report。
因此 ClearML 的中心对象是可继续更新的执行资源 `Task`，不是一次封存后不可变的结果快照。

## 原生对象总图

```text
Project ──contains──> Task <──queued in── Queue <──polls── Agent
                        │                         │
                        │                         └──executes user process
                        ├──owns event identity──> Event stream
                        ├──embeds descriptors───> Artifact ──URI──> file/object store
                        ├──references───────────> Model ──URI──> weights
                        ├──parent/child─────────> Task
                        └──special type─────────> Report Task

WebApp / SDK / REST read these resources
Report embeds live Task / Model / App widgets
Project Dashboard App aggregates Task, metric, worker and GPU views
```

| 名词 | ClearML 原生含义 | 必须与什么区分 |
| --- | --- | --- |
| `Task` | 一次代码执行会话，也可表示 pipeline step、controller、service、optimizer 或 report | 它同时是执行控制面和持久元数据资源，不等于 Event |
| `Event` | 绑定 Task 或 Model 的 scalar、vector、debug image、plot 或 log 事件 | 详细事件流不在 Mongo `task` 文档中 |
| `Model` | 独立的模型元数据资源，权重由 URI 指向文件或对象存储 | 不是 Artifact 的别名；Task 只保存 input/output model 引用 |
| `Artifact` | 嵌在 Task execution 中的描述符；payload 由 URI 指向文件或对象存储 | 描述符写入与 payload 上传不是一个原子对象 |
| `Report` | Server 的 `reports.*` API 资源；实现上是 `TaskType.report` 的特殊 Task | Python SDK 没有公开 `Report` 作者类；它也不是 Dashboard |
| `Dashboard` | Pro 的 Project Dashboard App，聚合状态、指标、GPU 与 worker，并可发 Slack 告警 | 公开 Server 源码没有披露该 Pro App 的持久 schema |

`Report` 的服务端身份可由
[`apiserver/services/reports.py :: create_report`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/reports.py)
和 [`TaskType.report`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/task/task.py) 核对。
Dashboard 的公开边界见[官方 Project Dashboard 文档](https://clear.ml/docs/latest/docs/webapp/applications/apps_dashboard/)。

## 研究页导航

- [layers.md](layers.md)：ClearML 自己的组件、资源、owner、引用与依赖边界。
- [execution.md](execution.md)：从发起、排队、Agent 执行、写入到完成、失败、partial 与续跑的真实顺序。
- [storage.md](storage.md)：公开 class/type、Mongo collection、Elasticsearch index、fileserver 路径、离线 envelope 与事实分类。
- [reading-and-comparison.md](reading-and-comparison.md)：历史 Task 的重开、查询、筛选、对齐、分组、比较、渲染与缺测表现。
- [schema-and-migration.md](schema-and-migration.md)：API、对象、Mongo、Elasticsearch、离线包的版本与 migration 轨道。

## 与 NiceEval 的相似、差异与可吸收约束

相似点是两者都要求真实用户代码产生结果，并让同一产品重新读取历史运行；都需要稳定运行身份、结构化指标、Artifact 引用和可分享展示。

差异是 ClearML 把 Task 同时用于调度、执行状态、元数据与展示入口，并允许 reset、continue、publish 等后续变更。
它的比较直接面向一组 Task；Report 保存 Markdown 与活查询 widget，而不是固化的 typed analysis / report snapshot。

NiceEval 可吸收的约束是：

- 写入 owner、原始事实、查询摘要与 blob 引用必须明确分开。
- “Completed” 只是一条状态写入时，不能被误称为跨存储原子封存。
- 缺测、部分上传与兼容降级应成为显式数据状态，不应只表现为空字典、空曲线或日志警告。
- 可重算摘要若选择持久化，必须承担 schema migration 与重建责任；纯展示对齐和 smoothing 更适合读取时计算。
- 报告若嵌入活查询，必须把“可编辑正文锁定”和“所见数据冻结”作为两条不同契约。
