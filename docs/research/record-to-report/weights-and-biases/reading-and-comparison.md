# W&B 怎样重开、查询、比较和展示

> 观察日期：2026-08-14
>
> 只写读取链。落盘形状见 [storage.md](storage.md)。完成态见 [execution.md](execution.md)。

普通用户不需要打开本机 `wandb/run-.../` 或 `~/.weave/wal`。
那些目录是 sidecar / 客户端队列，不是阅读界面。

Models 由 `wandb.Api`、Workspace 与 Report 读取 Run；Weave 由 `get_calls`、Evaluation REST 与自己的 UI 读取 Call。
`wb_run_id` 只能筛选相关 Call，不构成联合查询或共同 reader。

## Models

### 用户入口

| 入口 | 做什么 | 稳定性 |
|---|---|---|
| App 项目页 / Workspace | 看 Runs 表、自动或手动面板 | 产品默认 |
| Saved view | 团队可编辑的 workspace 快照 | 协作面 |
| Report | 叙事页 + panel grid + Runset | UI 稳定；代码 API 为 Public Preview |
| `wandb.Api().run(path)` / `api.runs(...)` | 按路径取单个 Run，或 Mongo 风格过滤集合 | SDK 稳定面 |
| `run.history()` / `scan_history()` | 读时间序列 | 前者默认采样 |
| `wandb leet` | 终端 UI，`wandb-core` 的 `leet` 子命令 | 维护者文档提到，不是主文档入口 |
| `wandb sync` / `wandb beta sync` | 把本机目录补传到服务端 | CLI 正在迁移 |

见 [Workspaces](https://docs.wandb.ai/models/track/workspaces)、
[Public API](https://docs.wandb.ai/models/track/public-api-guide)、
[Create a report](https://docs.wandb.ai/models/reports/create-a-report)。

### query 与 filter

```python
import wandb

api = wandb.Api()
run = api.run("<entity>/<project>/<run_id>")
runs = api.runs(
    "username/project",
    {"$or": [{"config.experiment_name": "foo"}, {"config.experiment_name": "bar"}]},
)
```

`api.runs` 默认按 `-created_at` 排序，可按 `summary.val_acc` 或 `config.experiment_name` 排序。
每次加载 50 条，可用 `per_page` 调整。
列表默认可懒加载，不含 `config` / `summaryMetrics` 等重字段。
`wandb/apis/public/runs.py` @ `dc1ef8be`

Report / Workspace 代码 API 用字符串或 `FilterExpr`：
[Edit a report](https://docs.wandb.ai/models/reports/edit-a-report)

```python
runset = wr.Runset(
    entity="[ENTITY]",
    project="[PROJECT]",
    filters="Config('learning_rate') > 0.01 and Config('batch_size') == 32",
)
```

也可按 `SummaryMetric('accuracy') > 0.9`、`Metric('state') in ['finished']`、`Tags('training')` 过滤。

### group、align、compare、render

分组键可以是 `config.group`、`Name` / `State` / `JobType`，或 `summary.acc`。

冻结 Runset 会固定报告看到的 Run 集合，后续新 Run 不再进入。

比较两个 Run 的官方 Public API 示例是把两边的 `config` 做成 DataFrame，再打印不等的键。
这是作者自己做差，不是产品级的固定分母 API。

Workspace 可用 pinned run 与 baseline run 做对照。
最多 pin 20 个 Run。
summary 可显示相对 baseline 的 delta。
[Pin and compare runs](https://docs.wandb.ai/models/runs/compare-runs)

两个作为 artifact version 的 Table 可以按 join key 合并，或并排查看。
[Visualize tables](https://docs.wandb.ai/models/tables/visualize-tables)

自动 Workspace 为项目里所有 logged key 生成面板。
默认 x 轴是每次 `log()` 递增的 step。
手动 workspace 从空白开始。

Report 对象不自动保存，必须 `save()`。
[Report 类](https://github.com/wandb/wandb-workspaces/blob/v0.4.5/wandb_workspaces/reports/v2/interface.py)
内建面板包括 LinePlot、BarPlot、ScalarChart、ScatterPlot。

报告里的 `WeaveBlock*` / `WeavePanel*` 不指 LLM Weave 产品。

### 缺测怎样出现

`run.history()` 默认采样 500 点。
指定 `keys` 时，不含该 metric 的 step 在 dataframe 里是 `NaN`。
`stream="default"` 读 metric history；`stream="system"` 读机器指标。
`Run.history` @ `dc1ef8be`

要完整、未采样的 history，用 `scan_history()`。
`keys` 只返回同时包含这些键的行。
不同 step 写入的键应分开扫描。

Table stepper 在缺失 step 时使用该 slider key 的上一个已写入值。

分母是「当前查询选中的 Run 集合」或「报告里冻结的 Runset」。
Public API 不提供 `unsupported` 或 per-row coverage 枚举。
缺测表现为 `NaN`、空单元格或沿用上一个值。

## Weave

### 用户入口

| 入口 | 做什么 |
|---|---|
| Weave UI **Traces** | Call 表、trace 树、Call 详情、Feedback |
| Weave UI **Agents** | session / turn / span |
| Weave UI **Evaluations** | evaluation run、逐行预测与分数 |
| UI Export | 导出选中或全部 Call；同时给出 Python / cURL |
| `client.get_calls(...)` | SDK 过滤、排序、投影、`to_pandas()` |
| `client.get_call(id)` | 单条 Call |
| `Evaluation.get_evaluate_calls()` / `get_score_calls()` | 从蓝图找回历史 evaluate / scorer Call |
| v2 Evaluation REST | `evaluation_runs`、`eval_results/query`、单个 prediction |
| Service API / OpenAPI | `sdks/node/weave.openapi.json` 与 `trace.wandb.ai/docs` |
| `SavedView` | 保存列、过滤、排序 |

见 [Query and export Calls](https://docs.wandb.ai/weave/guides/tracking/querying-calls)、
[Export evaluation data](https://docs.wandb.ai/weave/guides/evaluation/export_eval)。

### query 与 filter

`CallsFilter` 高阶字段：`op_names`、`input_refs`、`output_refs`、`parent_ids`、`trace_ids`、`call_ids`、`thread_ids`、`turn_ids`、`trace_roots_only`、`wb_user_ids`、`wb_run_ids`。
`CallsFilter` @ `59a9d186`

`query` 是 Mongo aggregation 子集：`$literal`、`$getField`、`$convert`、`$and`、`$or`、`$eq`、`$gt`、以及官方自加的 `$contains`。
`$getField` 可用点号进入 `attributes` / `inputs` / `output` / `summary`。
`weave/trace_server/interface/query.py` @ `59a9d186`

`get_calls` 还支持 `sort_by`、`columns`、`expand_columns`、`include_costs`、`include_feedback`、`scored_by`。
`scored_by` 多个 scorer 是 AND。
默认页大小 1000。
`WeaveClient.get_calls` @ `59a9d186`

`wb_run_ids` 可以按 Models Run 过滤 Call。
这不是 Models `api.runs` 的联合查询。

### group、align、compare、render

Evaluation 对齐用 `row_digest`，不是行号。
`eval_results/query` 按 evaluation 分组返回 trials、model output、scores，以及可选的 dataset 行输入。

比较两次评测时，官方走 Compare Evaluations UI 与这套 REST，而不是 Models Runset。
[Compare evals](https://docs.wandb.ai/weave/guides/evaluation/compare_evals)

Traces 表列包括 id、display_name、op_name、inputs、output、attributes、summary、时间、exception。
`SavedView.KNOWN_COLUMNS` 还列出 `func_name`、`ui_url`。
`Status` 是 `summary.weave.status` 的别名。
`weave/flow/saved_view.py` @ `59a9d186`

成本与 Feedback 默认不随 Call 返回。
`include_costs` / `include_feedback` 才写入 `summary.weave`。
文档把 `include_costs` 标为 beta。

Leaderboard 是另一类 builtin Object，不是 Call 查询的默认投影。

### 缺测怎样出现

只有 start、没有 end 的 Call，status 为 `running`。

Compare Evaluations 按 `row_digest` 对齐。
某次评测没有对应行或某个 scorer 没有 score 时，UI / REST 给出空缺，而不是 Models 那种 `NaN` history 单元格。

分母通常是当前 filter 命中的 Call 集合，或某次 evaluation run 的 dataset 行。
公开面没有比「该 scorer 没有 score」更明确的 `unsupported` 枚举。
