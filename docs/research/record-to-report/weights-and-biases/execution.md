# W&B 的发起、执行、完成与 resume

> 观察日期：2026-08-14
>
> 只写真实顺序与 owner。层与引用见 [layers.md](layers.md)。落盘形状见 [storage.md](storage.md)。

## Models

### 发起

最小在线路径见 [Initialize runs](https://docs.wandb.ai/models/runs/initialize-run)：

```python
import wandb

with wandb.init(entity="nico", project="awesome-project") as run:
    run.log({"accuracy": 0.9, "loss": 0.1})
```

官方示例把 Run 写成 `exalted-darkness-6`，ID 写成 `pgbn9y21`。
本机日志目录写成 `wandb/run-20241106_090747-pgbn9y21/logs`。

CLI 先 `wandb login`，或设置 `WANDB_API_KEY`。
离线设 `WANDB_MODE=offline` 或 `mode="offline"`。
见 [Environment variables](https://docs.wandb.ai/models/track/environment-variables)。

`wandb.init()` 在 `v0.28.2` 的顺序：
[run-lifecycle.md](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/docs/sdk/run-lifecycle.md) @ `dc1ef8be`

1. Python 检查活动 Run 与 `reinit`。
2. 启动或复用 `wandb-core`。
3. 发送 `ServerInformInitRequest`，按 run ID 建一条 core `Stream`。
4. 构造 `wandb.Run`，挂上 `InterfaceSock`。
5. 发布 `HeaderRecord`。
6. 投递 `RunRecord`，等待 `RunUpdateResult`。
7. 投递 `RunStartRequest`。
8. 开始采集控制台、状态检查与 telemetry，把 `Run` 交回用户。

core 收到第一条 `RunRecord` 后做 `InitRun` / GraphQL `UpsertBucket`。
`RunStartRequest` 之后才启动 filestream、系统指标和 code/patch 采集。

`reinit` 控制同一进程再次 `init`：`create_new`、`finish_previous`、`return_previous`。
多活动 Run 需要 SDK ≥ `v0.19.10`。

### 调度

Sweep 与 Launch 可以先创建尚未开始的 Run。
公开状态标成 `Pending`。
见 [Run states](https://docs.wandb.ai/models/runs/run-states)。

`wandb.apis.public.Run.create(..., state="pending")` 给可能无法立刻调度的作业。
官方写明这不是普通路径，功能比 `wandb.init()` 少。
符号：`Run.create` @ `dc1ef8be`。

Sweep 状态控制是否再派新 Run。
暂停 Sweep 不会改已经在跑的 Run。
只有取消 Sweep 才会把运行中的 Run 打成 `Killed`。

### 执行与写入

| 用户动作 | Python 发出 | core owner | 效果 |
|---|---|---|---|
| `run.log()` | `PartialHistoryRequest` | Handler 再 Sender | 累积/刷新 history，更新 summary |
| `run.summary[...] = ...` | `SummaryRecord` | Sender | 更新 summary，流式写 `wandb-summary.json` |
| `run.save()` | `FilesRecord` | `runfiles.Uploader` | 按 `now` / `live` / `end` 上传 |
| `run.log_artifact()` | `ArtifactRecord` 或 request | `ArtifactSaveManager` | 上传 manifest 与文件 |
| `run.use_artifact()` | `UseArtifactRecord` | Sender | 声明输入 lineage |

`run.log()` 签名是 `log(data: dict[str, Any], step=None, commit=None)`。
Python 校验 key 为字符串，把值序列化成 history item。
没有显式 `step` 时维护本机 `_local_step`。
`commit=False` 只累积当前 step；默认路径 flush 并前进。

`PartialHistoryRequest` 先在 Handler 里累积。
flush 后才变成 `HistoryRecord`。
没有跨 metric、跨 step 的用户可见事务。
多进程若手工设 `step`，官方警告可能丢数据。

`mode="shared"` 允许多进程写同一 Run，官方标 experimental。
见 [`wandb.init`](https://docs.wandb.ai/models/ref/python/functions/init)。

### 完成

`with` 块结束时调用 `run.finish()`。
不调用时，脚本退出也会结束 Run。

`RunExitRecord` 既写入 transaction log，也要求响应。
客户端发完它之后保证不再发送改 Run 的 record。
收到响应表示数据已上传，或 finish 超时。
`wandb_internal.proto` `RunExitRecord` @ `dc1ef8be`

core 的 `finishRunSync` 顺序：

1. 停控制台生产者。
2. 上传最终 summary。
3. 完成 run upserter 元数据，再上传最终 config。
4. 等待 artifact 操作。
5. 必要时保存 job artifact。
6. 停止文件监视。
7. 上传剩余 run files。
8. 关闭 file transfer manager。
9. 结束 filestream，可选地把 Run 标为完成。
10. 标记传输统计结束。

| 状态 | 官方含义 |
|---|---|
| `Finished` | 退出码 0 且数据已同步，或调用了 `finish()` |
| `Failed` | 非零退出 |
| `Crashed` | 内部进程停止发送 heartbeat |
| `Killed` | 被强制停止 |
| `Running` | 仍在发送 heartbeat |
| `Pending` | 已调度未开始 |

`RunExitResult.timed_out` 为真时，数据可能没传完。
客户端应报错，让用户决定是否忽略。

完成标识是服务端 Run `state`，不是本地 seal 文件。
本机 `run-{id}.wandb` 只是可回放的 transaction log。

### 失败、partial、retry、resume

- 非零退出 → `Failed`。
- heartbeat 停 → `Crashed`。
- finish 超时 → `RunExitResult.timed_out`。
- 离线未 sync → 本机有 `.wandb`，服务端可能没有完整 history。
- 已结束 Run 仍可 `upload_file`，也可改 config / summary。
  见 [Public API](https://docs.wandb.ai/models/track/public-api-guide)。

filestream 会在较长时间内反复发送 history / events / output。
见 [wandb-core.md](https://github.com/wandb/wandb/blob/dc1ef8bec7642bea1cb89c3f6f8fc64f536def4c/docs/sdk/wandb-core.md)。

Handler 把 work 交给 Sender 时，磁盘写入是副作用，不是往返。
`FlowControl` 先在内存里缓冲；缓冲满了才从 `.wandb` 重读。

进程崩溃后，`.wandb` 是回放源。
`wandb beta sync` 让 core 按这份 log 重新发送数据。
普通 `wandb sync` 仍是旧 Python 实现。
见 [`wandb sync`](https://docs.wandb.ai/models/ref/cli/wandb-sync)。

| `resume` | Run ID 已存在 | Run ID 不存在 |
|---|---|---|
| `"must"` | 从最后一步继续 | 报错 |
| `"allow"` | 从最后一步继续 | 用该 ID 新建 |
| `"never"` | 报错 | 用该 ID 新建 |
| `"auto"` | 尝试自动恢复本机崩溃 Run | 新建 |

见 [Resume a run](https://docs.wandb.ai/models/runs/resuming)。
官方更推荐 `resume="allow"` 并显式给出 run ID。
`resume="auto"` 依赖同一目录与 `wandb-resume.json`。

`resume_from` 与 `fork_from` 使用 `{run_id}?_step={step}`。
二者都是 beta，且不能与 `resume` 同时使用。

UI 显示 `crashed` 但本机仍在跑时，官方建议 `wandb sync PATH`。
[Support](https://docs.wandb.ai/support/models/tags/experiments)

分布式 Artifact 用 `upsert_artifact(..., distributed_id=...)` 与 `finish_artifact`。
`ArtifactState.PENDING` 到 `COMMITTED` 是对象级状态，不是 Run 级事务。
见 [Create an artifact version](https://docs.wandb.ai/models/artifacts/create-a-new-artifact-version)。

partial 是常态：history 逐步追加，summary 持续被后写值替换，resume 在同一 ID 上继续写。

## Weave

### 发起一条 Op

最小路径见 [仓库 README](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/README.md)：

```python
import weave
weave.init("weave-example")

@weave.op
def main():
    return 42

main()
```

`v0.53.2` 顺序：`WeaveClient` @ `59a9d186`，[trace_server README](https://github.com/wandb/weave/blob/59a9d186afaf9e3c020cd8a0fedd0ee439a7f101/weave/trace_server/README.md)

1. `weave.init(project_name)` 创建全局 `WeaveClient`，识别 entity/project。
2. 调用 `@weave.op` 时，`create_call` 保存 Op 定义，生成 Call `id` 与 `trace_id`。
3. 客户端把 start 发给 `POST /call/start`，或稍后走 complete 批路径。
4. 函数返回或抛错后，`finish_call` 合并用户 `summary` 与计算出的 usage / status。
5. 客户端把 end 发给 `POST /call/end`，或把完整 Call 发给 `/calls/complete`。
6. 开源 server 把行插入 ClickHouse；插入是异步分批的。

`settings.use_calls_complete` 默认为 `True`。
短生命周期 Op 可以把 start 与 end 合成一次请求。
符号：`weave.trace.api.init` @ `59a9d186`。

嵌套 Op 通过运行时 call stack 设置 `parent_id`，并共享 `trace_id`。
顶层 Call 没有 parent。

### 调度

Weave 没有 Models Sweep / Launch 那种先建 `Pending` Run 再派 worker 的公开调度面。
评测在调用 `.evaluate()` 的客户端进程里执行。
见 [Evaluations](https://docs.wandb.ai/weave/guides/core-types/evaluations)。

Agent 路径可以不装 Python `weave` 包，只把 OTLP 打到 Weave。
见 [OTel](https://docs.wandb.ai/weave/guides/tracking/otel)。
官方接受任意 OTel span。
符合 GenAI agent conventions 的 span 会进入 Agents view。

### 执行 Evaluation

`Evaluation` 是蓝图，不是一次运行。
`.evaluate(model)` 才触发一次 evaluation run。

`Evaluation.evaluate` @ `59a9d186`：

1. 在 call attributes 里写入 `_weave_eval_meta.declarative = True`。
2. `get_eval_results(model)`：按 dataset 行调用 `predict_and_score`。
3. 每个 example：跑 model，再并行 `apply_scorer`。
4. `summarize(eval_results)` 得到 summary dict。
5. 返回 summary。该返回值也是这次 `Evaluation.evaluate` Call 的 output。

一次 Evaluation 对象可以 `evaluate` 多次。
`get_evaluate_calls()` 按 `input_refs` 与 `op_names=[".../op/Evaluation.evaluate:*"]` 找回这些 Call。

imperative 路径 `EvaluationLogger` 构造合成 Op，用 ContextVar 记住当前 `predict_and_score`。
两条路径都落成 Call 树，不是另一套表。

### 完成

Call 完成看 `ended_at` 是否存在。
`CallSchema.summary.weave.status` 可以是 `success`、`error`、`running`、`descendant_error`。
`TraceStatus` 在 `trace_server_interface.py` @ `59a9d186`。

`running` 表示还没有 end。
`descendant_error` 表示自己成功但子 Call 失败。

Evaluation run 的完成标识是那次 `Evaluation.evaluate` Call 的 `ended_at` 与 output summary。
v2 REST 另给 evaluation run 的 `status`、timestamps 与 summary。
见 [Export evaluation data](https://docs.wandb.ai/weave/guides/evaluation/export_eval)。

没有 Models 那种 `Finished` / `Crashed` / `Pending` 枚举。
也没有「整份 project 封口」的对象。

### 失败、partial、retry、resume

- 函数抛错：`exception` 有值，`ended_at` 仍写入，status 为 `error`。
- 进程在 `finish_call` 前崩溃：可能只剩 start，status 为 `running`。
- HTTP 默认 `retry_max_attempts = 3`。
- `enable_disk_fallback` 默认 `True`，队列丢弃的项可写盘。
- WAL drain 失败会进 `.deadletter`；发送采用 at-least-once delivery。
  `weave.durability.wal` @ `59a9d186`
- Call 可 `deleted_at`；Object version 也可删。
- Feedback 可 purge，不删除对应 Call。
  见 [Feedback](https://docs.wandb.ai/weave/guides/tracking/feedback)。

`attributes` 一旦创建就冻结。
要补元数据，必须在 `create_call(..., attributes=...)` 或 `weave.attributes` 里事先放入。
`summary` 运行中可改，结束时与计算值合并后落盘。

没有 Models 那种 `resume="must"` 复用同一 Call ID 继续写 history 的 API。
要重跑评测，再调用一次 `.evaluate()`，得到新的 evaluate Call。

没有「整棵 Trace 一次提交」。
子 Call 失败不会回滚父 Call 的 inputs。
parent 的 `descendant_error` 不是事务回滚。
