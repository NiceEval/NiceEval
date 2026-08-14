# MLflow Execution：发起、写入、完成与 resume

> 观察日期：2026-08-14
>
> 核对：`v3.15.1` / `9a1c0d9a9827acd23c7a215f0999e4b0f97e9870`
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

本页写一次 Run 或 Trace 在时间上的真实顺序。
对象归属见 [Layers](layers.md)。
落盘形状见 [Storage](storage.md)。

## 没有中心调度器

普通 Tracking 不是排队系统。
用户进程自己执行训练或评估代码。
`mlflow run` 只是可选的 Project 启动器，不是每次实验的必经路径。
见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) 与 [`mlflow/cli/__init__.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/cli/__init__.py)。

`SqlRun.status` 允许 `SCHEDULED`。
`SqlAlchemyStore.create_run` 与 `FileStore.create_run` 实际写入的是 `RUNNING`。
本次检查的一手公开面未把 `SCHEDULED` 做成普通 Tracking 的独立排队阶段。
见 [`models.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/dbmodels/models.py) 与 [`sqlalchemy_store.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py)。

## Run 顺序

1. 选定 Tracking URI。未配置时走 `_get_default_tracking_uri()`。见 [Layers](layers.md)。
2. 选定或创建 Experiment。入口是 `mlflow.set_experiment`、`mlflow.create_experiment`、`mlflow experiments create`，或进程变量 `MLFLOW_EXPERIMENT_NAME` / `MLFLOW_EXPERIMENT_ID`。
3. 发起 Run。`mlflow.start_run()`、`MlflowClient.create_run` 或 `mlflow runs create` 在 store 里插入一条 `RUNNING` 行。
4. 执行发生在用户进程。autolog 或手工 `log_*` 在 Run 仍为 `active` 时追加写入。
5. 可选嵌套。同一线程已有活动 Run 时必须先 `end_run()`，或传 `nested=True`。子 Run 用 tag `mlflow.parentRunId` 挂到父 Run。
6. 收尾。离开 `with` 块、显式 `end_run(status=...)`，或进程退出时的 `atexit` `_safe_end_run()`，都会调用 `set_terminated`。
7. 完成标识是 `RunInfo.status` 加上可选 `end_time`。终态是 `FINISHED`、`FAILED` 或 `KILLED`。`lifecycle_stage` 仍是 `active`，除非用户再删除。

符号在 [`mlflow/tracking/fluent.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracking/fluent.py)、[`run_status.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/entities/run_status.py) 与 [`lifecycle_stage.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/entities/lifecycle_stage.py)。

```python
import mlflow

with mlflow.start_run():
    mlflow.log_param("lr", 0.001)
    mlflow.log_metric("val_loss", val_loss)
```

这是 Tracking 首页的官方最小路径。
离开 `with` 块时 Run 自动结束。
见 [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)。

产品事实：没有活动 Run 时，`log_param` / `log_metric` 会自动开一个新 Run。
fluent API 不是线程安全的。跨线程必须自行互斥，或给每个线程开独立 Run。
见 [Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)。

## 可选启动器

| 入口 | Owner | 做什么 | 完成标识 |
| --- | --- | --- | --- |
| `mlflow.start_run()` | 用户进程 | 开当前线程的活动 Run | `end_run` 或离开 context |
| `mlflow.autolog()` | 用户进程 + 支持库 | 在 fit 前后自动写 param / metric / 模型 | 训练调用返回，外层 Run 结束 |
| `mlflow runs create` | CLI | 立刻创建并按指定 status 结束 | 命令打印 `run_id` 与 status JSON |
| `mlflow run` | Project 启动器 | backend 可以是 `local`、`databricks` 或 experimental `kubernetes` | 被启动进程结束，对应 Run 收尾 |
| `mlflow.models.evaluate` | 用户进程 | 经典模型评估，结果写成 evaluation Run | 函数返回，可在 UI 打开 |
| `mlflow.genai.evaluate` / `mlflow traces evaluate` | 用户进程 | 对 Dataset 或已有 Trace 跑 Scorer | Feedback 写入同一 Tracking 面 |

## 写入约束

产品事实：写 metric / param / tag 前，两套 store 都检查 Run 仍是 `active`。
见 [`SqlAlchemyStore._check_run_is_active`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py) 与 [`check_run_is_active`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/entities/run_info.py)。

产品事实：Param 不可变。同一 key 再写相同值会被吞掉，不同值抛 `Changing param values is not allowed`。
Metric 可按 step / timestamp 追加。Tag 可改可删。
见 [`SqlAlchemyStore.log_param`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py) 与 [`FileStore._validate_new_param_value`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py)。

产品事实：SQL 一次 `create_run`、一次 `log_param`、一次 `_log_metrics` 各是一个 `ManagedSessionMaker` 会话。
`_log_metrics` 先插 `metrics` 行，再更新 `latest_metrics`，然后 commit。
同一主键再写会 rollback，去掉已存在的行后只提交新行。
见 [`SqlAlchemyStore._log_metrics`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py)。

产品事实：FileStore 按文件追加或整文件改写，没有跨文件事务。
metric 是 `append_to`。param 是 `write_to`。Run 状态是重写 `meta.yaml`。

产品事实：SQL 不能存 IEEE Infinity。
`sanitize_metric_value` 把 `+Inf` / `-Inf` 换成最大或最小 64 位 float，把 NaN 存成 `value=0` 且 `is_nan=true`。
FileStore 不替换 Infinity。
见 [Backend Stores](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/)。

## 失败、partial、软删除

产品事实：进程崩溃时，`atexit` 的 `_safe_end_run()` 可能来不及跑。
store 里会留下 `RUNNING` 且 `end_time is None` 的 Run。
公开面没有自动把它标成 `FAILED`。
见 [`fluent.py`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracking/fluent.py)。

产品事实：partial 在 Tracking 里就是“还在 `RUNNING`，或某些 key 从未写入”。
产品没有 missing / partial / unsupported 的穷尽枚举。
缺列怎样出现见 [Reading and comparison](reading-and-comparison.md)。

产品事实：软删除只改 `lifecycle_stage=deleted` 和 `deleted_time`。
SQL 原地更新行。FileStore 重写该 Run 的 `meta.yaml`，不把 Run 目录搬进 `.trash`。
`.trash` 只停放被删 Experiment。
永久清除走 `mlflow gc`。
见 [Backend Stores](https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/)。

## Resume 与 retry

产品事实：`start_run(run_id=...)` 或进程变量 `MLFLOW_RUN_ID` 会恢复已有 Run，并把 status 设回 `RUNNING`。
其它创建参数被忽略。`run_id` 优先于 `MLFLOW_RUN_ID`。
`lifecycle_stage == deleted` 的 Run 不能 resume。
见 [`start_run`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/tracking/fluent.py)。

产品事实：resume 时 `end_time` 先留着旧值，因为 `update_run_info` 需要一个 end_time 参数。
同一 `run_id` 可以再次变成 `RUNNING` 并继续追加。
完成标识是可变 status，不是封口 revision。

产品事实：公开 Tracking 没有自动重试一次失败训练。
重试就是再开一次 Run，或 resume 同一 `run_id` 继续写。
SQL `log_spans` 对 deadlock 会重试，那是 store 内部重试，不是实验级 retry。
见 [`SqlAlchemyStore.log_spans`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py)。

## Trace 与 Assessment 顺序

GenAI 产品面见 [Tracing 与 Assessment](tracing-and-assessments.md)。
时间顺序如下。

1. 应用、`@mlflow.trace` 或 OTel exporter 开始根 span。
2. `start_trace` 在 Backend Store 写入 `TraceInfo`。
3. Span 按 `mlflow.trace.spansLocation` 分流：表、artifact `traces.json` 或归档根。
4. 可选 `log_feedback` / `log_expectation` 在 Trace 仍存在时追加 Assessment。
5. Trace 结束时写入 `execution_duration` 与 `state`。未正常结束时 duration 可以为空。
6. SQL `get_trace(allow_partial=False)` 若发现 span 尚未全部导出，会重试三次再报 “not fully exported yet”。

产品事实：Assessment 允许后补、原地 update、delete 和 override。
`overrides` 会把旧条标成 `valid=False`。删除 override 后，旧条恢复 `valid=True`。
`source` 与 `span_id` 不可变。
见 [`FileStore.create_assessment`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/file_store.py) 与 [`SqlAlchemyStore.update_assessment`](https://github.com/mlflow/mlflow/blob/v3.15.1/mlflow/store/tracking/sqlalchemy_store.py)。

研究判断：MLflow 的执行 owner 始终是用户进程。
Server 只代写。没有独立的实验调度层来声明分母或封口 revision。
