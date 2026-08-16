# ClearML 持久数据结构

本页把“事实”分成四类：

- **权威资源**：公开 API 读写的资源元数据或完整事件 / payload；其它层不能从自身完整重建它。
- **持久派生值**：可以从更细事实计算，但 Server 为查询性能写回数据库。
- **summary / index**：面向筛选、聚合或文本检索的投影，不应当作完整明细。
- **cache**：丢失后可重建的短期服务状态。

写入时序与原子性见 [execution.md](execution.md)。

## 物理存储总表

| 存储 | 精确资源 / 名称 | 保存内容 | 事实分类 |
| --- | --- | --- | --- |
| MongoDB `backend` | `task` collection · `Task` | Task identity、状态、script、execution、参数、配置、Artifact descriptor、Model refs、Report 正文 | 权威资源 + 同文档内持久 summary |
| MongoDB `backend` | `model` · `Model` | 模型 metadata、framework、design、labels、ready、weights URI、Task / Project refs | 权威资源 + metric summary |
| MongoDB `backend` | `project` · `Project` | 项目树、名称、描述、tags、统计设置 | 权威资源；`basename` 是派生字段 |
| MongoDB `backend` | `queue` · `Queue` / embedded `Entry` | queue metadata 与待执行 Task ID 列表 | 权威调度资源 |
| MongoDB `backend` | `versions` · `Version` | 已执行 Mongo migration 的版本 ledger | migration 控制事实 |
| Elasticsearch | `events-<type>-<company_id>` | scalar、vector、debug image、plot、log 的详细事件文档 | 详细 Event 的权威公开存储；物理上也是 ES index |
| fileserver / 对象存储 | URI 指向的 key | Artifact bytes、model weights、debug image/media、Report 上传资源 | payload 权威事实 |
| Redis | Event retrieval state，默认 TTL 3600 秒 | 查询迭代器等短期状态 | cache；不是 Task / Event 持久事实 |
| 离线目录 / zip | `task.json`、`metrics.jsonl`、`log.jsonl`、`data/` | 尚未导入 Server 的 Task session envelope | 可迁移的本地 session envelope；无显式 package schema version |

Mongo class 来自
[`apiserver/database/model`](https://github.com/clearml/clearml-server/tree/v2.4.0/apiserver/database/model)；
collection 名也由正式 migration 对 `db.task`、`db.model`、`db.project`、`db.queue` 的操作证实。
Event index 命名来自
[`event_common.py :: get_index_name`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_common.py)。

Elasticsearch 不是仅从 Mongo 重建的二级 cache：Mongo Task 只保存摘要，不保存完整 Event 明细。
fileserver 也不是 Mongo 的附件字段：Mongo / ES 只持有其 URI、hash 或 key。

Server `v2.4.0` 默认 Docker volume 路径为：

| host | container |
| --- | --- |
| `/opt/clearml/data/fileserver` | `/mnt/fileserver` |
| `/opt/clearml/data/elastic_7` | `/usr/share/elasticsearch/data` |
| `/opt/clearml/data/mongo_4/db` | `/data/db` |
| `/opt/clearml/data/mongo_4/configdb` | `/data/configdb` |

这些是 compose 中的实际目录名；`elastic_7` / `mongo_4` 是保留下来的 path label，不代表当前 engine major。
当前 engine 与升级冲突见 [schema-and-migration.md](schema-and-migration.md)。
定义见 [`docker/compose.yaml`](https://github.com/clearml/clearml-server/blob/v2.4.0/docker/compose.yaml)。

## Task：API type 与 Mongo model

### 公开 API type

SDK `v2.1.11` 生成的最高版本目录是 `v2_23`。
Task 服务公开
[`TaskStatusEnum`, `TaskTypeEnum`, `TaskModelItem`, `Output`, `ArtifactTypeData`, `Artifact`, `TaskModels`, `Execution`, `ParamsItem`, `ConfigurationItem`, `Task`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_api/services/v2_23/tasks.py)。

这些是 REST envelope 的 Python data model，不是另一个本地数据库 schema。
`Task` SDK facade 最终读写同一 Server Task resource。

### Mongo `Task`

Server 权威 model 是
[`apiserver/database/model/task/task.py :: Task`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/task/task.py)。

| 字段组 | 精确字段 | 分类与含义 |
| --- | --- | --- |
| identity / placement | `id`, `name`, `type`, `project`, `parent`, `company`, `user` | 权威资源；ID 稳定，名称和 placement 可改 |
| lifecycle | `status`, `status_reason`, `status_message`, `status_changed`, `created`, `started`, `completed`, `published` | 权威状态事实；不是跨存储 seal |
| prose | `comment`, `report`, `report_assets`, `tags`, `system_tags` | 用户/服务写入事实；Report 复用这些 Task 字段 |
| execution input | `script`, `hyperparams`, `configuration`, `container`, `runtime` | 可复现输入与运行 metadata |
| execution refs | `execution.queue`, `execution.artifacts`, `models.input`, `models.output`, `output` | 到 Queue、payload、Model 或输出资源的引用 |
| worker bookkeeping | `last_worker`, `last_worker_report`, `last_update`, `last_change`, `last_changed_by`, `enqueue_status` | Server / Agent 维护的当前状态与调度 bookkeeping |
| metric projection | `last_iteration`, `last_metrics`, `unique_metrics`, `metric_stats` | 持久 summary；不等于详细 Event |
| duration | `active_duration` | 可从 `started` 与终止时刻计算却持久化；旧 `duration` 已标 obsolete |

`TaskType` 的公开值包括 `training`、`testing`、`inference`、`data_processing`、`application`、`monitor`、`controller`、`report`、`optimizer`、`service`、`qc`、`custom`。
Task 的“实验”身份不是单独 collection，而是 `type=training` 等 Task type。

### 嵌入类型

| Server type | 精确字段 | 存放位置 |
| --- | --- | --- |
| `ParamsItem` | `section`, `name`, `value`, `type`, `description` | `Task.hyperparams.<section>.<name>` |
| `ConfigurationItem` | `name`, `value`, `type`, `description` | `Task.configuration.<name>` |
| `Execution` | `test_split`, `parameters`, `model_desc`, `model_labels`, `framework`, `artifacts`, `queue` | `Task.execution` |
| `Artifact` | `key`, `type`, `mode`, `uri`, `hash`, `content_size`, `timestamp`, `type_data`, `display_data` | `Task.execution.artifacts` map |
| `ArtifactTypeData` | `preview`, `content_type`, `data_hash` | `Artifact.type_data` |
| `Models` | `input[]`, `output[]` | `Task.models` |
| `ModelItem` | `name`, `model`, `updated` | `Task.models.input/output[]` |

`execution.parameters`、`execution.model_desc` 是 migration 保留的 legacy 面；当前结构化参数和配置分别在 `hyperparams` 与 `configuration`。
兼容轨道见 [schema-and-migration.md](schema-and-migration.md)。

`execution.artifacts` 的物理 map key 不是用户的原始 `key`。
Server `get_artifact_id` 计算 `<hash_field_name(key)>_<mode>`，API response 再把 map values 按 Artifact `key` 排序为 list。
实现见
[`apiserver/bll/task/artifacts.py :: get_artifact_id, artifacts_prepare_for_save, artifacts_unprepare_from_saved`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/artifacts.py)。

## Event：序列化 envelope 与 Elasticsearch

### API envelope

SDK 类型与字段由
[`backend_api/services/v2_23/events.py`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_api/services/v2_23/events.py) 固定。

| API class / `type` | 必要身份与坐标 | payload |
| --- | --- | --- |
| `MetricsScalarEvent` / `training_stats_scalar` | `task`, `timestamp?`, `iter?`, `metric?`, `variant?` | `value: number?` |
| `MetricsVectorEvent` / `training_stats_vector` | 同上 | API 输入名 `values: number[]?`；Server 规范为 `value` |
| `MetricsImageEvent` / `training_debug_image` | 同上 | `key?`, `url?` |
| `MetricsPlotEvent` / `plot` | 同上 | `plot_str?`, `skip_validation?` |
| `TaskLogEvent` / `log` | `task`, `timestamp?`, `worker?` | `level?`, `msg?` |

`AddRequest` 包一条 event；`AddBatchRequest` 是 stream-friendly 的 JSON-lines batch request；`AddBatchResponse` 返回 `added`、`errors` 与 `errors_info`。
官方 REST 入口见 [Events API](https://clear.ml/docs/latest/docs/references/api/events/)。

Server ingestion 写入 `@timestamp`，在 `timestamp` 和 `worker` 省略时补值，规范 `type`、`metric`、`variant`，并添加 `model_event`。
`@timestamp` 表示写入 ES 的时间，不是事件发生时间。

### index 与文档 identity

每个 company 和 event type 使用独立 index：

- `events-training_stats_scalar-<company_id>`
- `events-training_stats_vector-<company_id>`
- `events-training_debug_image-<company_id>`
- `events-plot-<company_id>`
- `events-log-<company_id>`

官方 mappings 在
[`apiserver/elastic/index_templates/events`](https://github.com/clearml/clearml-server/tree/v2.4.0/apiserver/elastic/index_templates/events)。
common mapping 索引 `@timestamp`、`task`、`worker`、`timestamp`、`iter`、`metric`、`variant`、`value`、`company_id` 与 `model_event`。
`plot_str` 和 log `msg` 不做全文索引；debug image 的 `url` 是 keyword。

除 log 外，Server 对存在的 `task`、`iter`、`metric`、`variant`、`key` 依次拼接后取 MD5，作为 ES `_id`；相同 identity 用 `index` 替换原文档。
log 使用随机数据库 ID，因此是 append 语义。
权威实现是
[`event_bll.py :: EventBLL.event_id_fields, _get_event_id, add_events`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_bll.py)。

### Plot 的持久派生字段

Server 可验证 `plot_str` JSON，并持久化 `valid_plot`、`plot_len` 与抽取出的 `source_urls`。
超过默认 100,000 字符时，Server 用 zlib level 1 + base64 写 `plot_data`，并移除 `plot_str`；读取时再解压。

这些是同一 Plot payload 的持久校验、摘要和压缩表示，不是新用户事件。
实现见
[`event_bll.py :: validate_and_compress_plots`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_bll.py)
与 [`event_common.py :: uncompress_plot`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_common.py)。

## Mongo 中的 Event summary

[`MetricEvent`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/task/metrics.py)
保存 `metric`、`variant`、last `value`、`min_value` / iteration、`max_value` / iteration、`first_value` / iteration、`count`、`mean_value` 与 `x_axis_label`。
`mean_value` 在 Mongo update pipeline 中舍入到两位小数。

这些值进入 Task / Model 的 `last_metrics`；`unique_metrics` 是已见 metric/variant 名单，默认最多维护 2000 项；`metric_stats` 保存每种 event type 的最后 timestamp。
`last_iteration` 取本批最大 iteration。

它们都能从详细 Event 重新计算，却被持久化以支持 Task list 排序、Project Overview 与比较页的 last/min/max/mean。
计算 owner 是
[`task/utils.py :: get_last_metric_updates`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/utils.py)
和 [`task_bll.py :: TaskBLL.update_statistics`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/task_bll.py)。

这些 summary 有两个重要限制：数量上限可截断新 metric；Event partial failure 时它们仍可能按尝试事件更新。
因此精确历史应读 Event，不应把 `last_metrics` 当完整事实集。

## Artifact 与 fileserver

SDK `Artifacts.upload_artifact` 可序列化 NumPy、Pandas DataFrame、PIL image、dict / YAML、pickle、单文件或目录 archive。
它计算 SHA-256 与 byte size，并生成 preview / content type，随后把描述符写到 Task。
[官方 Artifacts 文档](https://clear.ml/docs/latest/docs/fundamentals/artifacts/)给出用户语义；实现见
[`binding/artifacts.py :: Artifacts.upload_artifact`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/binding/artifacts.py)。

同名 Artifact 会替换 Task map 中的 descriptor。
`hash`、`content_size` 与 preview 是根据 payload 计算后仍被持久化的派生 metadata；`uri` 是定位 bytes 的权威引用。

SDK 默认 Task key prefix 是：

```text
<project-name>/<task-name>.<task-id>/<extra-path>
```

各资源继续追加：

```text
metric media: <prefix>/metrics/<metric>/<variant>/<generated-or-overridden-filename>
artifact:     <prefix>/artifacts/<artifact-name>/<generated-or-overridden-filename>
model:        <prefix>/models/...
```

路径规则定义在
[`backend_interface/task/task.py :: _get_output_destination_suffix`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/task/task.py)
和 [`metrics/events.py :: get_target_full_upload_uri`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/metrics/events.py)。

内建 fileserver 的容器根目录是 `/mnt/fileserver`。
POST `/` 把 multipart field name 当相对路径，经过 `safe_join` 后创建父目录并 `file.save`；相同目标会被新文件替换。
Server `v2.4.0` 的 compose 默认把 host `/opt/clearml/data/fileserver` 挂载到该目录。

证据：
[`fileserver/fileserver.py :: DEFAULT_UPLOAD_FOLDER, upload`](https://github.com/clearml/clearml-server/blob/v2.4.0/fileserver/fileserver.py)、
[`docker/compose.yaml`](https://github.com/clearml/clearml-server/blob/v2.4.0/docker/compose.yaml)。

## Model

Mongo model 是
[`apiserver/database/model/model.py :: Model`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/database/model/model.py)。

权威字段包括 `id`、`name`、`parent`、`project`、`created`、`task`、`comment`、`tags`、`system_tags`、`uri`、`framework`、`design`、`labels`、`ready` 与 `metadata`。
`uri` 指向 weights payload；权重 bytes 不在 Mongo 文档中。

Model 也持久化 `last_iteration`、`last_metrics` 与 `unique_metrics`，性质与 Task summary 相同。
`ui_cache` 明确命名为 UI cache，并默认不随普通查询返回。

## Report 与 Dashboard

Report 没有单独的 Mongo model。
REST `reports.create` 产生 `TaskType.report`；Markdown 正文放 `Task.report`，上传资源 URL 放 `Task.report_assets`，description 使用 `Task.comment`。
Report 仍获得 Task ID、Project、status、tags、user、created / updated 时间等字段。

API request types 是
[`CreateReportRequest`, `UpdateReportRequest`, `PublishReportRequest`, `GetTasksDataRequest`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/apimodels/reports.py)。
Server resource handler 在
[`apiserver/services/reports.py`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/reports.py)。

Report iframe 保存 Task / Model ID或动态 query；widget 在读取时获取当前对象。
所以正文是持久事实，嵌入图的像素与选中对象集合通常是读取时结果，不是 Report 内封存数据。

Project Dashboard Pro App 可导入、导出 JSON configuration，但公开文档没有给出服务端 envelope、collection、文件目录或 schema version。
在固定的开源 Server / SDK / Agent 中也未找到该 App 的持久 model；此部分记为未公开，不作推测。

## 离线 session envelope

离线 Task 根目录在 close 后压成同名 `.zip`；archive 内相对结构为：

```text
task.json
metrics.jsonl
log.jsonl
data/
```

| 路径 | 精确序列化内容 |
| --- | --- |
| `task.json` | SDK Task API model 的 `to_dict()`，另加 `project_name`、`offline_folder`、`offline_output_models` |
| `metrics.jsonl` | 每行一个 JSON array；元素是 `events.AddRequest.to_dict()`，Model event 可另含 `model_event=true` |
| `log.jsonl` | 每行一个 JSON array；元素是 `TaskLogEvent` request dict |
| `data/` | 离线 Artifact、metric media 与 output model payload |

写入 owner 见
[`_save_data_to_offline_dir`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/task/task.py)、
[`Metrics`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/metrics/interface.py)
与 [`TaskHandler`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/task/log.py)。

导入 owner 见
[`Task.import_offline_session`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)。

## 哪些坚持读取时计算

ClearML 没把所有便利视图写回存储。以下值在读取或渲染时形成：

- scalar histogram / downsample，以及 time-from-start、wall time 等 x-axis 变换；
- EMA、Gaussian、running average smoothing；
- Task comparison 的 hide-identical、差异高亮、overlay 与 group-by；
- Report dynamic query 选出的 Task / Model 集合及 live widget；
- PDF、Web 图表与比较布局等 render 结果。

读取契约见 [reading-and-comparison.md](reading-and-comparison.md)。

这种分界直接影响 schema churn：Mongo `last_metrics`、`active_duration`、Artifact metadata、Project `basename` 等持久派生值一旦改形状，就需要 migration 或重建索引。
读取时的 smoothing、对齐、分组与差异高亮可独立演进，不必改写用户保存的 Task / Event。
