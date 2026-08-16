# Harbor 的执行、失败与恢复

本页回答一个 Job 怎样展开并执行 Trial，谁写每份结果，以及失败后 retry、resume 与 regrade 怎样处理已有事实。
对象层次见 [原生层与对象关系](layers.md)，落盘形状见 [存储与权威事实](storage.md)。

## 发起 Job

主命令是 `harbor run`，它是 `harbor job start` 的别名。
见 [`cli/main.py`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/cli/main.py)。

```bash
harbor run -d "org/dataset" -a "<agent>" -m "<model>"
harbor run -p "<path/to/dataset>" -a "<agent>" -m "<model>"
harbor run -c job.yaml
harbor run -d "org/dataset" -a "<agent>" -m "<model>" --env daytona -n 32
```

程序入口是 `await Job.create(config)` 再 `await job.run()`。
直接构造 `Job(...)` 已被源码拒绝。

Job plugin 不再写入 `JobConfig`。
`--plugin` 只作用于当次进程。

## 一次本地 Job 的真实顺序

下面是本地 `harbor run` 的顺序。
云端只替换 `Environment` provider，不改 Job / Trial 信封。

1. CLI 把 flag 或 `job.yaml` 收成 `JobConfig`。
   `Job.create` 把 Agent skills 落到本地路径，下载或定位 Task，校验资源策略，再装入 Metric。
2. `Job.__init__` 先展开 `TrialConfig`，再创建 `jobs/<job_name>/`。
   展开失败时不留下空目录。
3. 若该目录已有 `result.json`，这次调用按 resume 处理。
   Job UUID 从已有 `result.json` 取回。
4. `Job.run` 写入 `config.json`、`lock.json`，并写入不含 `trial_results` 的 `result.json`。
   `started_at` 在首次运行时生成，resume 时沿用。
5. `TrialQueue` 按 `n_concurrent_trials` 提交尚未完成的 Trial。
   每个 Agent 还可另有 `n_concurrent` 上限。
6. `Trial.create` 建立 `jobs/<job>/<trial>/`，立刻写 `lock.json`，并准备 agent / verifier / artifacts 子目录。
7. `Trial.run` 发 `START`，再执行 `_prepare()`：启动 `Environment`、healthcheck、上传 skills、安装 Agent。
8. 单步 Trial 跑 Agent，上传 Agent 日志，收集 artifact，再跑 verifier。
   `separate` 模式先停主容器，再拉 sidecar 证据，再开独立 verifier `Environment`。
   `shared` 模式在 Agent 还活着的同一 `Environment` 里跑 test 脚本。
9. Verifier 执行 `tests/test.sh`。
   它读取 `/logs/verifier/reward.txt` 或 `reward.json`，得到 `VerifierResult.rewards`。
10. `_finalize()` 停掉 `Environment`，写 `finished_at`，把完整 `TrialResult` 写入 `result.json`，再发 `END`。
11. Job 在 `END` 上更新 `JobStats`、live rewards 和 Metric，再回写 Job 级 `result.json`。
    若带 `--upload`，每个 Trial 结束时上传该 Trial 的 archive。
12. 全部 Trial 结束后，Job 重算 Metric 与 `pass_at_k`，写入 `finished_at`，再次回写 `result.json`。
    磁盘文件仍排除 `trial_results`。
    内存里的 `JobResult` 带齐 Trial 列表，供终端表打印。

运行入口见 [`Job`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/job.py)、
[`Trial`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/trial/trial.py) 与
[Run Evals](https://harborframework.com/docs/run-jobs/run-evals)。
artifact 的公开行为见 [Artifact Collection](https://harborframework.com/docs/run-jobs/results-and-artifacts)。

## 完成条件

| 对象 | 磁盘或远端完成条件 | 未完成时的形状 |
|---|---|---|
| Trial | 存在可读且通过校验的 `result.json`，并且含 `finished_at` | 没有 `result.json` 的目录会被 resume 删掉 |
| Job | `result.json` 里的 `finished_at` 有值 | `finished_at` 为空；`n_running_trials` / `n_pending_trials` 描述进度 |
| Hub Job | 行上的 `archive_path` 与 `finished_at` 都被 `finalize_job` 填上 | `archive_path` 为 `NULL`，表示上传未收尾 |

源码把「`finished_at` 已设置」当作已完成 Job。
异常路径只在内存里给 telemetry 填 `finished_at`，不把它写回磁盘。
见 `Job.run` 的 `except` 注释。

## 写入 owner

| 写入 | Owner |
|---|---|
| Job `config.json` / `lock.json` / `result.json` / `job.log` | `Job` |
| Trial 目录与 `lock.json` | `Trial` 构造 |
| Trial `config.json` 与内存中的初始 `TrialResult` | `Trial._init_result` |
| Trial `result.json` | `Trial._finalize`，整文件重写 |
| reward 文件 | 容器内 test 脚本，经 verifier 下载 |
| artifact 与 `manifest.json` | `ArtifactHandler`；收集失败不让 Trial 失败 |
| Hub `job` / `trial` 行与 archive | `Uploader`；需要 `harbor auth login` |
| `analysis.json` | `harbor analyze` |

普通用户通过 CLI 触发这些 owner。
Harbor 没有公开的「用户直接写 `result.json`」API。

## 本地原子性

本地写入使用单文件 `Path.write_text`。
没有跨文件事务，也没有 WAL。

顺序约束来自代码，不是数据库：

- 先展开 Trial，再创建 Job 目录。
- 先写 Trial `lock.json`，再跑 Agent。
- 只有 `_finalize()` 才写 Trial `result.json`。
- Job `result.json` 在每个 Trial 起止时整文件重写。

`lock.json` 已存在且内容不相等时，`Job._write_job_lock` 拒绝改写已有文件。
它会保留原 `created_at` 与 `harbor` 信息后再比较。

## Hub 上传与完成

Hub 上传分三步，源码把这段过程描述为可中断的 in-progress：

1. `start_job` 插入 `job` 行，`archive_path` 与 `finished_at` 为 `NULL`。
2. 每个 Trial 结束时调用 `upload_single_trial`。
3. `finalize_job` 上传 Job archive，并填写 `archive_path` 与 `finished_at`。

崩溃停在第一步与第三步之间时，行保持 in-progress。
`harbor upload <job-dir>` 与 `harbor job resume --upload` 做幂等补齐。

## 失败与输出回收

Agent 超时或非零退出码会写入 `exception_info`，然后 Trial 仍尝试收集 artifact 并运行 verifier。
其它异常走 `_recover_outputs`，尽量拉回日志和 artifact。
`CancelledError` 单独计数为 cancelled。

Trial 因此可以同时「已经完成写盘」和「执行出错」。
完成条件描述信封是否收尾，`exception_info` 描述执行结果；两者不是同一个状态轴。

## Retry

`RetryConfig.max_retries` 默认是 0。
默认错误可重试，但超时、缺 reward、鉴权和安全拒绝等类型被排除。

重试前，Harbor 用 `shutil.rmtree` 删除整个 Trial 目录，再用同一 `trial_name` 重跑。
Job 从 stats 中撤掉旧贡献，并增加 `n_retries`。

## Resume

```bash
harbor job resume -p jobs/<job>
harbor job resume -p jobs/<job> --upload
```

`resume` 先按 `--filter-error-type` 删除匹配的 Trial 目录，默认删除 `CancelledError`。
然后它用原 `config.json` 再跑 `Job.create` 与 `Job.run`。

`Job._maybe_init_existing_job` 执行以下规则：

- `config.json` 必须与新的 `JobConfig` 相等，否则抛出 `FileExistsError`。
- 没有 `result.json` 的 Trial 目录直接删除。
- 空或无法通过校验的 `result.json` 跳过并打印警告。
- 已完成 Trial 按 `TrialConfig` 相等匹配；对不上时报错。
- `lock.json` 必须与重建的 lock 相等。

resume 的 CLI 入口见 [`cli/jobs.py`](https://github.com/harbor-framework/harbor/blob/ac398bbda7c4c1073461797d3b95c2455cc671b5/src/harbor/cli/jobs.py)。
锁版本怎样参与相等判断见 [Schema、兼容与 Migration](schema-and-migration.md#lock-与-resume)。

## Regrade

Regrade 永不修改源 Job / Trial。
新目录是 fork：复制 `agent/` 与 artifact，用新 verifier 重跑，写出新的 `verifier/` 与 `result.json`。

源 Agent 身份与 token / cost 会抄到新结果，便于继续按原 Agent 分组；费用不会再扣一次。
源 Trial 身份怎样参与 lock 相等比较见 [Lock 与 resume](schema-and-migration.md#lock-与-resume)。

完整用户入口见 [Regrade](https://harborframework.com/docs/run-jobs/regrade)。
