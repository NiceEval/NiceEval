# ClearML 历史读取与比较

ClearML 重新打开历史工作的单位仍是 Task。
它没有先把 Task 转成另一类公开的持久比较资源；用户通过 SDK、REST 或 WebApp 选择 Task，再读取明细、summary 或比较视图。

## SDK：重新打开 Task

### 单个 Task

`Task.get_task(task_id=...)` 按稳定 Task ID 打开资源。
也可以传 `project_name` + `task_name`；若名称不唯一，SDK 查询路径选择匹配结果而不是建立新的复合主键。
返回对象与运行时 `Task` 是同一个 facade，既能读，也可能在权限和状态允许时继续写。

源码：
[`clearml/task.py :: Task.get_task`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)；
用户入口：[Task SDK reference](https://clear.ml/docs/latest/docs/references/sdk/task/)。

### 多个 Task

`Task.get_tasks(...)` 返回匹配的 `Task` 对象，但公开契约只取最近 500 个。
需要扫描更老历史时使用 `Task.query_tasks(...)`；它分页取完整匹配集合，默认返回 Task ID，也可用 `additional_return_fields` 返回投影 dict。

两者都支持：

- `task_ids`，或 project name / task name；名称支持 partial match 与 regex；
- tags；默认 OR，可用 `__$all` / `__$and`、`__$or`、`__$not` 组合；
- `parent`、`status`、`type`、`user`、`search_text`；
- `order_by`，以及 `_all_` / `_any_` 对指定字段做 regex；
- `allow_archived` 或 system tag 过滤。

权威签名与过滤语法在
[`Task.get_tasks, Task.query_tasks`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)
和[官方 Tag Filters](https://clear.ml/docs/latest/docs/clearml_sdk/task_sdk/#tag-filters)。

REST 的原生选择面是 `tasks.get_all` / `tasks.get_all_ex`，定义见
[Tasks API](https://clear.ml/docs/latest/docs/references/api/tasks/)。

## SDK：读取 Task 的不同事实面

| 方法 | 读取对象与变换 | 返回 / 缺失行为 |
| --- | --- | --- |
| `get_reported_scalars(max_samples=0, x_axis='iter')` | Server scalar histogram；按采样区间平均，最多 5000 点 | nested dict；request 失败或无数据返回 `{}` |
| `get_all_reported_scalars(x_axis='iter')` | 以 1000 条为 batch scroll 完整 scalar Event | nested dict；同一 series 连续相同 x 时以较后 y 替换；中途失败返回已收集部分 |
| `get_last_scalar_metrics()` | 重新加载 Mongo Task `last_metrics` | nested `last/min/max`；是 summary，不扫描 Event |
| `get_reported_plots(max_iterations=None)` | `events.get_task_plots`；默认只取最后 1 个 iteration | list；失败或无数据返回 `[]` |
| `get_reported_console_output(n)` | `events.get_task_log` | message list；无事件返回 `[]` |
| `get_reported_single_values()` | API 2.20+ single-value endpoint | dict；无 Task values 返回 `{}`；旧 API 抛 `ValueError` |
| `get_reported_single_value(name)` | 上一方法后按 key 取值 | 不存在返回 `None` |
| `get_configuration_objects()` | Mongo Task `configuration` | name→text；API <2.9 抛 `ValueError` |
| `get_user_properties()` | `hyperparams.properties` | API <2.9 写 info 日志后返回 `{}` |

Scalar、plot 与 single-value 的读取实现见
[`backend_interface/task/task.py`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/task/task.py)。

Metric summary 与 user properties 的读取实现见
[`clearml/task.py`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)。

这组 API 没有统一的 `missing | partial | unsupported` discriminated union。
空 dict / list 可能表示没有上报，也可能表示被 method 吸收的 request failure；某些版本不支持则抛异常，另一些返回空值。

## WebApp：查找并重新打开

用户从 Projects 进入 Task table，按列排序和过滤，或按名称搜索，再点击 Task 进入详情页。
单 Task 页面把信息分到以下原生视图：

- Execution / Details：repository、commit、diff、entry point、packages、container 等；
- Hyperparameters 与 Configuration；
- Artifacts 与 Models；
- Console；
- Scalars；
- Plots；
- Debug Samples；
- Info / runtime / progress。

官方入口见
[Tracking Tasks](https://clear.ml/docs/latest/docs/webapp/webapp_exp_track_visual/)
和 [Task table](https://clear.ml/docs/latest/docs/webapp/webapp_exp_table/)。
Task metadata 可以从 WebApp 导出 JSON；Event 与 payload 不因此内嵌进该 JSON。

Project Overview 允许选择 metric / variant 的 LAST、MIN、MAX，在 Project 首页画跨 Task snapshot。
这些点来自持久 metric summary，而不是一份另存的比较报告。
[官方 Project Overview](https://clear.ml/docs/latest/docs/webapp/webapp_project_overview/)描述了该入口。

## scalar 的对齐、分组与渲染

单 Task Scalar graph 默认按 metric 画图，同一 metric 的 variants overlay。
用户可把 `Group by` 设为 `Metric`，或设为 `None` 让每个 metric/variant 独立成图。

x-axis 可选：

- Iterations；
- Time from start；
- Wall time。

WebApp 对 series 做显示用 subsampling；full-screen 提供更高分辨率，但 full-screen 不自动 refresh。
曲线 smoothing 在读取/渲染时选择 Exponential moving average、Gaussian 或 Running Average，并可同时显示 original。

Metric Values view 按 metric/variant 显示 First、Last、Min、Max、Mean；这些数值读 Task summary。
官方契约在
[Tracking Tasks / Scalars](https://clear.ml/docs/latest/docs/webapp/webapp_exp_track_visual/#scalars)。

公开文档没有声明跨 Task scalar 会做插值、补点或按 index inner/outer join。
可核查的契约只是每条 series 保留自己的 x 坐标后 overlay，并允许切换共同 x-axis 表示；因此不能把 UI 叠图推断成统计对齐算法。

## Task Comparison

### 选择集合

用户在 Task table 先用过滤、排序或搜索缩小候选，再勾选多个 Task，点击 Compare。
比较页可继续增删 Task；完整 URL 可分享并恢复同一选择和 tab 状态。

在固定的公开 Server models / services 中没有 `Comparison` Mongo model 或 comparison migration。
比较选择是 Web UI / URL state，不是新的持久运行资源。

官方流程：[Comparing Tasks](https://clear.ml/docs/latest/docs/webapp/webapp_exp_comparing/)。

### Details 与 Hyperparameters Values

Task 以竖列 side-by-side；最左 Task 是 base。
UI 对齐相同字段路径，突出 nominal value 差异，可换 base、跳到上/下一个差异、搜索字段，并隐藏 identical fields。

对齐键是对象字段 / 参数名，而不是运行 iteration。
缺少某字段时，公开文档没有定义专名或 typed missing reason。

### Scalar Values

表格以 metric/variant 为 row、Task 为 column，可选择 Last、Min 或 Max，并导出 CSV。
`Show row extremes` 在每行突出最大与最小值。

这是一组已选 Task 的 summary 比较。
比较集合由当下选择的 Task 决定；产品没有公开要求预先保存的 comparison set definition 或 revision。

### Parallel Coordinates 与 Scatter

Parallel Coordinates 让用户选择一个或多个 performance metric 的 LAST / MIN / MAX，再选择 hyperparameters。
Scatter 用一个 hyperparameter 作 x-axis、一个 metric summary 作 y-axis；hover 显示 Task 与数值。

两者在读取时组合 Task hyperparameters 与 metric summary，不生成新 Event。

### Scalar / Plot overlay

Scalar Graph view overlay 各 Task 的 time series。
Plot tab默认比较每个 Task 的 metric/variant 最后一个 iteration；line、scatter、box、bar 可 overlay，其它 plot type 并排显示。

比较页的 `Group by` 为：

- `Metric`：同一 metric 的 variants 合并到一张图；
- `Metric+Variant`：每个 variant 单独一张图，且是默认值。

single-value scalars 聚成 `Summary` clustered bar chart。
这些行为来自[官方 Plot Comparison](https://clear.ml/docs/latest/docs/webapp/webapp_exp_comparing/#plot-comparison)。

### Debug Samples

Debug Sample comparison 按 Task 并排，用户选择 metric 并在 reported iterations 间前后移动。
“Sync selection”同步各 Task 的 metric 与 iteration 选择；它不声明会合成缺失 sample。

公开文档没有说明某 Task 缺该 metric、iteration 或 blob 时显示的精确占位文字。
所以本研究只能确认 sparse input 与同步选择，不能声称产品有具名 missing / partial 状态。

## Report：查询、重开与 render

Reports Page 有 Project view 与 List view。
用户可按 My Work、tags、user、Draft / Published 过滤，也可用普通或 regex free-text 搜索 name、ID、tags、project、description 和 report content。

Report 本体是 Markdown；可嵌入 Task、Model 和 App 的 scalar、plot、single-value、parallel coordinates 或 debug sample widget。
标准 embed 传 `objectType`、`objects`、`type`、`xaxis`、`metrics`、`variants` 等 query parameters。

`objects` 也可替换为 `tasks.get_all` / `models.get_all` 条件：project、tags、status、order、page size 等。
因此动态 Report 可在每次打开时选择“当前最新一个”或“当前 top 5”对象；它不是固定 Task ID snapshot。

官方语义与 query 示例在
[Reports / Dynamic Queries](https://clear.ml/docs/latest/docs/webapp/webapp_reports/#dynamic-queries)。

Server `reports.get_task_data` 为 widget render 组合 Task / Model docs、debug images、plots、scalar histogram 与 single values。
实现见 [`reports.get_task_data`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/reports.py)。

发布 Report 会锁定后续正文编辑；Server 把 Task status 改为 `published`。
发布后 `report` 与 `report_assets` 不能再由 `reports.update` 修改，但 `tags`、`name`、`comment` 仍可改；见
[`reports.py :: update_report, publish`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/reports.py)。
但官方同时明确 embedded visualization 会随源对象 live update。
所以“Published”锁的是 Report body，不是嵌入数据 snapshot。

用户可分享 URL、下载 PDF 或复制 Markdown。
PDF 是 render/export 结果；公开 Server model 没有把它定义为 Report 的持久权威 payload。

## Dashboard

Home Dashboard 是进入最近 Projects、Reports 与 Tasks 的导航页，不执行跨运行统计分析。
Project Dashboard 是 Pro App 的聚合读取面。
它显示 Task status / type summary、Task 数量随时间、选定 metric 趋势、GPU / memory、active worker、worker table 与 failed/completed alerts。
用户可以 clone instance，或导入/导出 JSON configuration 后重新启动。

官方入口：[Project Dashboard](https://clear.ml/docs/latest/docs/webapp/applications/apps_dashboard/)。
该 App 的服务端 query、查询时间范围、缺测策略、聚合集合规则与持久 schema 未在官方开源源码中公开。
文档只足以确认用户可见能力，不能验证其内部 comparison 或 missing 语义。

## 缺测与 partial 的公开表现

| 情况 | SDK 可核查表现 | Web / Report 可核查边界 |
| --- | --- | --- |
| Task 没有某 scalar series | nested dict 不含该 metric/variant | 不会凭空形成 curve；精确空态文字未公开 |
| scalar query 失败 | downsample 方法可返回 `{}`；full reader 可返回已收集部分 | UI 是否标网络失败与“无数据”为不同状态，公开文档未说明 |
| plot 不存在或 query 失败 | `get_reported_plots` 返回 `[]` | Plot tab 没有可比较 sample；精确占位未公开 |
| single value 不存在 | dict 无 key；`get_reported_single_value` 返回 `None` | 比较表是 sparse；未公开 typed missing reason |
| 旧 Server 不支持字段 | 有的方法抛 `ValueError`，有的方法日志后 `{}` | UI compatibility fallback 未公开 |
| Artifact descriptor 有 URI但 payload 不可读 | metadata 仍可读取；payload GET 失败 | Web viewer 失败文案与 recovery 未在固定材料中公开 |
| Report dynamic query 暂无匹配对象 | Server 返回空 Task / event集合 | widget 的精确空态未公开 |

ClearML 公开读取面因此能表示“没有值”，但没有一套跨 SDK、UI、comparison、Report 一致的 missing taxonomy。
Event batch partial 的形成原因见 [execution.md](execution.md)。
