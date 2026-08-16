# Phoenix 实验的发起、调度、执行与收尾

> 观察日期：2026-08-14
>
> 文档性质：外部产品研究，不是 NiceEval 目标契约

Phoenix 有两条真实执行路径。
一条由 Client 在用户进程里跑 Task。
一条由 Playground 把作业交给服务端 `ExperimentRunner`。

两条路径共享 `Experiment`、`ExperimentRun`、`ExperimentRunAnnotation`。
只有第二条路径创建 `ExperimentJob`，并使用 `RUNNING` / `COMPLETED` / `STOPPED` / `ERROR`。
[Background experiments](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/run-experiments-in-background)
[`models.py`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/db/models.py)

层与 owner 总表见 [layers.md](layers.md)。
表形状见 [storage.md](storage.md)。
evaluator Trace 细节见 [evaluator-observability.md](evaluator-observability.md)。

## 路径 A：SDK `run_experiment`

官方步骤是：上传 Dataset，定义 Task，配置 Evaluator，再调用 `run_experiment`。
[Run Experiments](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/run-experiments)

真实顺序如下。符号落在 `Experiments.run_experiment`。
[experiments/__init__.py](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/packages/phoenix-client/src/phoenix/client/resources/experiments/__init__.py)

| 步 | 动作 | owner |
|---|---|---|
| 1 | 校验 Task 签名，要求 Dataset 至少有一条 example | Client |
| 2 | 非 `dry_run` 时 `POST /v1/datasets/{dataset_id}/experiments` | Client 发起，Server 写库 |
| 3 | 写入 `dataset_version_id`、example 快照、`Experiment-{24 hex}` Project | Server，同一 session |
| 4 | 打印 `datasets/{id}/experiments` 与 `datasets/{id}/compare?experimentId={id}` | Client |
| 5 | 对 `examples × repetitions` 做笛卡尔积，用 executor 调度 | Client；默认 `retries=3`，`timeout=60`，`exit_on_error=False` |
| 6 | 每个 Task 开独立 OTel Trace，根 Span 名 `Task: {func}`，kind `CHAIN`；再 `POST .../runs` | Client 执行并投递 |
| 7 | `GET` 全部 runs，用服务端状态替换本地缓存 | Client 读，Server 为权威 |
| 8 | 若传入 evaluators，调用 `evaluate_experiment`，再 `POST /v1/experiment_evaluations` | Client |
| 9 | 可选打印摘要，返回 `RanExperiment` | Client |

步骤 3 的符号是 `insert_experiment_with_examples_snapshot` 与 `generate_experiment_project_name`。
payload 带当前 `dataset.version_id`、可选 splits、`repetitions`。

产品事实：`dry_run=True` 时不创建 Experiment，结果不写入 Phoenix。

产品事实：这条路径没有服务端 `ExperimentJob.status`。
完成标识是列表接口上的三个派生计数：`successful_run_count`、`failed_run_count`、`missing_run_count`。
`error is None` 算成功，`error` 非空算失败。
`missing = example_count * repetitions - successful - failed`。
符号在 `get_experiment`。
[experiments.py](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/api/routers/v1/experiments.py)

产品事实：`actual_runs < expected_runs` 时只打印警告，不回滚已写入的 Experiment。

## 路径 B：Playground 后台作业

产品事实：从 Playground 点 Run，服务端创建 Experiment Job。
关闭浏览器或重启服务后，作业可以继续，也可以 Stop / Resume。
[Background experiments](https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/run-experiments-in-background)

| 状态 | 含义 |
|---|---|
| `RUNNING` | 正在执行 Task 或 Evaluation |
| `COMPLETED` | 全部 Task 与 Evaluation 成功结束 |
| `ERROR` | 提供方反复失败后被服务端停住，可以 Resume |
| `STOPPED` | 用户暂停，或 ephemeral 运行在连接断开后暂停；可以 Resume |

源码把这些状态存在 `experiment_jobs.status`。
类型只能是 `PROMPT` 或 `EVAL_ONLY`。
`claimed_at` 非空表示有 runner 持有该作业。

`ExperimentRunner` 的调度顺序是源码注释写明的：

1. 从数据库认领一条 Experiment，建立 `RunningExperiment`。
2. 先做 evaluation 对账。扫描已成功但缺 annotation 的 runs，补 eval。
3. 对账耗尽后，再扫描未完成的 Task。
4. 选活优先级是 eval 队列、到期重试、新 Task。
5. 可重试错误走指数退避。`stop()` 只清内存队列。Resume 时从数据库重建未完成工作。

[`experiment_runner.py`](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/daemons/experiment_runner.py)

产品事实：Resume 只补 outstanding work。已成功的 run 不重跑。

产品事实：Playground 的 Record 开关关掉时，实验是 ephemeral。
它不出现在实验列表，数据库行会在一段时间后删除。
`experiments.is_ephemeral` 是对应列。

## 写入信封

创建 Experiment：`POST /v1/datasets/{dataset_id}/experiments`。
字段包括 `version_id`、`splits`、`repetitions`、`name`、`description`、`metadata`。

创建 run：`POST /v1/experiments/{experiment_id}/runs`。
成功 run 再提交会 `409`。带 `error` 的旧 run 允许 upsert。
[experiment_runs.py](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/api/routers/v1/experiment_runs.py)

创建 evaluation：`POST /v1/experiment_evaluations`。
按 `(experiment_run_id, name)` upsert。必须带 `result` 或 `error` 之一。
[experiment_evaluations.py](https://github.com/Arize-ai/phoenix/blob/arize-phoenix-v20.2.0/src/phoenix/server/api/routers/v1/experiment_evaluations.py)

## 失败、partial、retry、resume

产品事实：SDK Task 失败会把 `error` 写进 ExperimentRun，并重新抛出给 executor。
executor 在剩余 retries 内重跑。服务端允许用新结果替换失败行。

产品事实：SDK 在 POST 前把 run 放进进程内 `task_result_cache`。
若本地 Task 已完成、只是 POST 被取消，重试会先投递缓存，不重跑用户函数。

产品事实：SDK evaluator 写入失败只打 warning，实验继续。
evaluation 不是封口条件。

产品事实：SDK 路径没有 Resume API。
调用方可以再跑 `evaluate_experiment` 补评，或对失败 example 再提交 run。

产品事实：服务端作业把 missing 与 failed 都视为 incomplete。
`get_experiment_incomplete_runs_query` 明确包含「还没跑」和「跑过但有 error」。
该查询在 `src/phoenix/db/helpers.py`。

产品事实：`stop()` 允许 in-flight LLM 调用结束，不再派发新工作。
Resume 重新查询 incomplete runs 与 missing evaluations。

产品事实：服务重启后，过期 claim 会被重新认领。
官方写「几分钟内自动接回」。
源码常量是 `EXPERIMENT_STALE_CLAIM_TIMEOUT`。

本次检查的一手公开面未提供：跨多个 Experiment 的两阶段提交，或用户可见的 WAL / receipt。
