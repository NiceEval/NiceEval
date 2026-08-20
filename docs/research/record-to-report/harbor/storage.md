# Harbor 的存储与权威事实

本页回答 Harbor 把 Job / Trial 写在哪里、每份信封保存什么，以及本地目录、Hub 行、派生值与 cache 哪一个拥有事实。
写入时序见 [执行、失败与恢复](execution.md)。

## 本地 Job 目录

默认根是工作目录下的 `jobs/`。
Job 名默认使用时间戳 `%Y-%m-%d__%H-%M-%S`，路径是 `jobs_dir / job_name`。

官方文档给出的树是：

```text
jobs/job-name/
├── config.json
├── result.json
├── job.log
├── lock.json
└── trial-name/
    ├── config.json
    ├── lock.json
    ├── result.json
    ├── trial.log
    ├── exception.txt          # 仅失败时
    ├── analysis.json          # 仅 harbor analyze 后
    ├── agent/                 # 含 trajectory.json、recording.cast 等
    ├── verifier/              # reward.txt 或 reward.json、test-std*.txt
    └── artifacts/
        └── manifest.json
```

多步 Task 把每步的 `agent/`、`verifier/`、`artifacts/` 放到 `steps/{step_name}/`。
路径定义见 [`TrialPaths`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/trial/paths.py)。

Trial 目录名由 Task 短名加 7 位 ShortUUID 组成，例如 `hello-world__bZZeEkw`。
目录名不是全局 UUID；全局身份是 `TrialResult.id`。

Harbor 把 `jobs/` 当作用户可见目录。
官方 [Run Evals](https://harborframework.com/docs/run-jobs/run-evals#analyzing-results) 直接说明 `config.json`、`result.json`、
`agent/` 与 `verifier/`，而不是要求用户通过隐藏的数据库读取它们。

## Job 与 Trial 信封

| 文件 | 类型 | 角色 |
|---|---|---|
| `jobs/<job>/config.json` | `JobConfig` | 用户请求；写入时使用 `exclude_defaults=True` |
| `jobs/<job>/lock.json` | `JobLock`，`schema_version = 3` | 已锁定输入：Harbor 版本、并发、retry 和每个 Trial 的 `TrialLock` |
| `jobs/<job>/result.json` | `JobResult`，不含 `trial_results` | Job UUID、时间戳、`n_total_trials` 与 `JobStats` |
| `jobs/<job>/job.log` | 文本 | Job 级日志 |
| `<trial>/config.json` | `TrialConfig` | 该次尝试的请求 |
| `<trial>/lock.json` | `TrialLock`，`schema_version = 2` | Task digest、Agent、skills、environment、verifier 模式和可选 `source_trial` |
| `<trial>/result.json` | `TrialResult` | 权威运行事实 |
| `<trial>/verifier/reward.txt` 或 `reward.json` | verifier 原文 | reward 的原始写出 |
| `<trial>/artifacts/manifest.json` | `ArtifactManifestEntry[]` | 收集了什么、来自哪个 service、是否成功 |
| `<trial>/agent/trajectory.json` | ATIF `Trajectory` | Agent 轨迹；不是所有 Agent 都写 |

公开模型见：

- [`JobResult` / `JobStats`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/job/result.py)
- [`JobLock` / `TrialLock`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/job/lock.py)
- [`TrialResult`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/models/trial/result.py)
- [Artifact Collection](https://harborframework.com/docs/run-jobs/results-and-artifacts)

## `TrialResult`

| 字段 | 含义 |
|---|---|
| `id` | Trial UUID，在构造时生成 |
| `task_name` / `task_id` / `source` | Task 身份与所属 Dataset 名 |
| `task_checksum` | Task 目录的 dirhash；源码标明将弃用，改看 `TrialLock.task.digest` |
| `trial_name` / `trial_uri` | 目录名与 `file://` URI |
| `config` | 再保存一份 `TrialConfig` |
| `agent_info` | `name`、`version` 与可选 `model_info` |
| `agent_result` | `AgentContext`：token、cost 与可选 rollout |
| `verifier_result` | `VerifierResult.rewards: dict[str, float \| int] \| None` |
| `verifier_environment_mode` | `shared` 或 `separate`；多步 Trial 为 `None` |
| `exception_info` | 类型、消息、traceback 与时间 |
| `started_at` / `finished_at` | Trial 起止 |
| `environment_setup` / `agent_setup` / `agent_execution` / `verifier` | 分阶段 `TimingInfo` |
| `step_results` | 多步时每步一份 |

`Task.checksum` 仍写入 `TrialResult.task_checksum`。
源码注释要求新消费者改用 `TrialLock.task.digest`。

## `JobResult` 与 `JobStats`

`JobResult` 的关键字段是：

| 字段 | 含义 |
|---|---|
| `id` | Job UUID |
| `started_at` / `updated_at` / `finished_at` | 进度与完成时间 |
| `n_total_trials` | 计划总数 |
| `stats` | `JobStats` |
| `trial_results` | 内存聚合；落盘时排除 |

`JobStats` 保存：

- 进度：`n_completed_trials`、`n_errored_trials`、`n_running_trials`、`n_pending_trials`、
  `n_cancelled_trials`、`n_retries`
- 按 `agent__model__dataset` 分组的 `evals`
- 每组的 `metrics`、`pass_at_k`、`reward_stats`、`exception_stats`
- Job 合计 token 与 `cost_usd`

`evals` 的键由 `JobStats.format_agent_evals_key` 拼出。
没有 model 时是 `agent__dataset`，adhoc Task 的 dataset 名是 `"adhoc"`。

默认 Metric 是 `Mean`。
缺 reward 按 0 计入。
见 [Metrics](https://harborframework.com/docs/datasets/metrics) 与 `harbor.metrics.base.aggregate_reward_dicts`。

## 权威事实、派生值与 cache

| 类别 | 内容 | 位置 |
|---|---|---|
| 权威输入 | 用户 Job / Trial 配置 | `config.json` |
| 权威锁定输入 | Task `sha256:` digest、skill digest、Harbor 版本与 git hash | `lock.json` |
| 权威运行事实 | 时间、exception、Agent 日志、verifier 原文、artifact bytes | Trial 目录 |
| 权威判定 | `VerifierResult.rewards` | `result.json` 与 reward 文件 |
| 派生并落盘 | `JobStats.metrics`、`pass_at_k`、token / cost 合计 | Job `result.json` |
| 读取时计算 | viewer 的 `JobSummary`、`TaskSummary`、比较网格 | `viewer/server.py`；不另存 |
| cache | 远程 Task 下载、Hub 源 Trial 的 `.sources/` | 本机 cache 与 Job 内临时目录 |
| 后补派生 | `analysis.json` | `harbor analyze` 写入源 Job / Trial |

## Hub 表与 archive

Harbor Hub 服务端没有开源。
公开可见的是生成类型 [`src/harbor/db/types.py`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/db/types.py)，
以及上传与下载客户端 [`src/harbor/hub/client.py`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/hub/client.py)。

表名按生成类型还原：

| 类型 | 表 | 公开列 |
|---|---|---|
| `PublicJob` | `job` | `id`、`job_name`、`config`、`created_by`、`visibility`、`started_at`、`finished_at`、`n_planned_trials`、`archive_path`、`log_path` |
| `PublicTrial` | `trial` | `id`、`job_id`、`trial_name`、`task_name`、`task_content_hash`、`config`、`lock`、`rewards`、时间戳、`exception_type`、`archive_path`、`trajectory_path`、`agent_id` |
| `PublicTrialModel` | `trial_model` | `trial_id`、`model_id`、token 与 `cost_usd` |

公开类型中还有 `user`、`organization`、package / task version 等 registry 表。
SQL DDL 与 migration 文件不在公开仓库。

上传 archive 使用 allowlist，不会打包整个目录：

- Trial archive 只收 `config.json`、`lock.json`、`result.json`、`analysis.md`、`agent/`、`verifier/`、
  `artifacts/`、`trial.log` 与 `exception.txt`。
- Job archive 只收 `config.json`、`lock.json`、`result.json`、`analysis.md`、`job.log`，
  外加过滤后的 Trial 子目录。

allowlist 定义见 `Uploader._TRIAL_ARCHIVE_INCLUDES`。

下载约定是：

- `harbor job download <job-id>` → `./jobs/<job-name>`
- `harbor trial download <trial-id>` → `./trials/<trial-name>`

## 本地与远端的差别

| 面 | 本地 | Hub |
|---|---|---|
| 身份 | 目录名；UUID 在 `result.json` | 行 UUID；目录名只用于展示 |
| 查询 | viewer 扫文件系统 | Postgres RPC：`get_jobs`、`get_job_overview`、`get_job_tasks`、`get_job_trials`、`get_comparison_data` |
| 比较 | `GET /api/compare?job=` | `harbor hub job compare` → `get_comparison_data` |
| 完成 | 本地 `finished_at` | 行上的 `finished_at` 与 `archive_path` |
| 删除 | 删除目录 | `DELETE` `job` 行；trials / shares cascade；存储桶中的 archive 不删除 |
| schema | Pydantic 兼容读取 | 服务端 schema 未公开 |

Hub CLI 把 `finished_at` 有值视为 `finished`，否则按已开始或 pending。
见 `hub.models.JobSummary.status`。

## 哪些计算仍然持久化

Harbor 把不少可重算值写入 `result.json`：

| 值 | 为什么能重算 | 为什么仍写盘 |
|---|---|---|
| `JobStats.evals.*.metrics` | 对 Trial rewards 再跑 `Mean` 或 `metric.py` | 终端、viewer、Hub overview 直接读 |
| `pass_at_k` | 由同一 Task 的多次 Trial 重算 | 写在 `JobStats` 中 |
| Job 级 token / `cost_usd` | 对 `AgentContext` 求和 | 避免每次打开都扫描全部 Trial |
| `reward_stats` / `exception_stats` | 按 Trial 再聚合 | 用于进度展示 |
| `TrialResult.task_checksum` | 对 Task 目录重新 hash | 历史字段；lock digest 才是后续权威 |
| Regrade 抄来的 token / cost | 源 Trial 已保存 | 让表格继续按原 Agent 分组 |
| Hub 行上的 `rewards` 与 `trial_model` | 来自 Trial `result.json` | 供 RPC 过滤与聚合 |

以下值坚持在读取时计算：

| 值 | 计算点 |
|---|---|
| viewer `JobSummary` / `TaskSummary` / `TrialSummary` | 打开页面时扫描目录 |
| 比较网格的平均 reward 与排序 | `GET /api/compare` |
| 未缓存输入 token | viewer 使用 `n_input_tokens - n_cache_tokens` |
| Hub `JobSummary.status` | 查看 `finished_at` |
| `leaderboard` 名次展示 | 读取 API 返回的 `n_trials` 等；association 变更不重算行指标 |

这些持久化选择怎样影响兼容成本，见
[Schema、兼容与 Migration](schema-and-migration.md#持久化选择怎样影响-schema)。
