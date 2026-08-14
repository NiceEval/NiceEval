# ClearML Task 的真实执行顺序

本页按 ClearML 的 Task / Queue / Agent / Event 语义描述一次运行。
对象关系见 [layers.md](layers.md)，字段和存储见 [storage.md](storage.md)。

## 发起入口

| 入口 | 产生什么 | 是否立即运行用户代码 | owner |
| --- | --- | --- | --- |
| `Task.init(...)` | 新建、reset 复用或 continue 一个 main Task | 是；当前 Python 进程继续执行用户代码 | SDK + 用户进程 |
| `Task.create(...)` | 创建 Task 资源 | 否；也不启用当前脚本的 auto-logging | SDK 调 Server API |
| `Task.clone(...)` / WebApp Clone | 从已有 Task 复制 execution 配置、script 等到新 Draft Task | 否；后续可排队或本地执行 | Server Task API |
| `clearml-task` CLI | 从脚本、仓库或现有 Task 创建远程可执行 Task | CLI 本身不执行目标训练；通常创建后排队 | CLI + Server |
| REST `tasks.create` / `tasks.enqueue` | 直接创建资源或进入 Queue | 由 Agent 领取后才运行 | API client + Server |

官方把这些入口列在 [Tasks 基础文档](https://clear.ml/docs/latest/docs/fundamentals/task/)，
SDK 语义可在 [`clearml/task.py :: Task.init, Task.create, Task.clone`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py) 核对。

## 本地 `Task.init`：从创建到终态

### 1. SDK 选择 Task 身份

`Task.init` 先判断是否远程运行，再在本地处理 `reuse_last_task_id` 与 `continue_last_task`。
默认复用依赖本机最近 Task cache；cache 时窗为 24 小时。

- 符合复用条件时，SDK 对同一 Task 执行 `reset` 并清除上一轮重输出，再沿用 Task ID。
- Task 已 Published / Closed / Archived、有 output model、非 development Task 或已有 Artifact 时，不做这种 reset，而是新建 Task。
- `continue_last_task=True` 时不清历史；SDK强制 `mark_started`，并把初始 iteration 设为 `last_iteration + 1`。
- 其它情况创建新的 Task 文档。

权威顺序在
[`clearml/task.py :: Task._create_dev_task`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)。
源码对 continue 明确打印“this run will not be reproducible”，因此它是向同一历史追加，不是新 revision。

### 2. SDK 标记开始并安装采集

选定 Task 后，SDK 将其设为进程内 main Task，调用 `task.started()`，重新加载服务端对象，然后创建 Logger、安装 stdout/stderr 与 framework hooks，并异步采集代码仓库信息。
Server `tasks.started` 把状态改为 `in_progress`，写 `started`，并清除旧 `completed` 与 `active_duration`。

源码：
[`Task._create_dev_task`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)；
[`apiserver/services/tasks.py :: started`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/tasks.py)。

### 3. 用户代码执行并持续写入

用户代码仍是实际 executor。SDK hooks 与显式 `Logger.report_*` 调用把 Event 放入 `BackgroundReportService` 队列。
默认 flush threshold 是 100 个事件，后台服务也按周期发送；Event API 用 `events.add_batch` 批量写入。

带文件的 metric event 先上传 payload，上传成功的事件才进入 batch。
普通 Artifact 则可由 `wait_on_upload=False` 走后台上传；SDK随后把 Artifact descriptor 更新到 Task。

Event 写入链路见
[`BackgroundReportService`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/metrics/reporter.py)
和 [`Metrics._do_write_events`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/metrics/interface.py)。

Artifact 写入链路见
[`Artifacts.upload_artifact`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/binding/artifacts.py)。

### 4. 退出生命周期 Hook 收尾

`Task.__shutdown` 根据 Python exception、signal、exit code 与远程 abort 判断 `completed`、`failed` 或 `stopped`。
正常退出会汇总 Artifact、等待 repo detection、flush Logger / uploads、停止资源监控，再发送终态。

异常失败路径把 `wait_for_uploads=False`，因此不会承诺排空所有后台上传。
显式 `Task.close()` 也进入这套 shutdown；它关闭当前 main Task，但不封存一个不可变 snapshot。

权威实现：
[`clearml/task.py :: Task.__shutdown, Task.close`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)。

### 5. Server 写完成标识

`tasks.completed` 用状态迁移把 `Task.status` 写为 `completed`，并写 `completed` 时间戳；可选 `publish=True` 会继续 publish。
`tasks.failed` 与 `tasks.stopped` 也写终止时间。

因此完成标识是 Mongo Task 文档上的 `status=completed` 加 `completed` timestamp。
它不是跨 Mongo、Elasticsearch 和 fileserver 的 commit marker，也不会阻止以后把 Completed Task 转回 `in_progress`、`created` 或 `published`。

源码：
[`apiserver/services/tasks.py :: completed, failed, stopped`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/services/tasks.py)；
[`apiserver/bll/task/utils.py :: state_machine`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/utils.py)。

## 远程 Queue / Agent：真实顺序

### 1. 准备 Draft Task

用户通常 clone 已有 Task、通过 `Task.create` / CLI 创建，或把当前 Task 变成可远程执行的资源。
Task 中的 `script`、`execution`、hyperparameters、configuration、container 与 requirements 成为 Agent 的执行输入。

### 2. Server 入队

`tasks.enqueue` 先用 `ChangeStatusRequest` 把 Task CAS 到 `queued`，并在 `enqueue_status` 保存之前状态；再向 Queue 的 `entries` push Task ID。
如果 push 失败，Server 尝试把状态补偿回去。成功后再写 `Task.execution.queue`，并从其它 Queue 移除该 Task。

这是多个 Mongo 文档更新组成的补偿流程，不是单一事务。
源码在
[`task_operations.py :: enqueue_task`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/task_operations.py)。

### 3. Agent 原子领取 Queue entry

Agent 轮询 `queues.get_next_task`。Server 用 Mongo `modify(pop__entries=-1)` 原子弹出队首 `Entry`；这只保证 Queue 文档上的 pop 原子。
Agent 取得 Task ID 后发送 `tasks.started(force=True)`，把 Task 标为 `in_progress`。

源码：
[`queue_bll.py :: QueueBLL.get_next_task`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/queue/queue_bll.py)、
[`worker.py :: get_next_task`](https://github.com/clearml/clearml-agent/blob/v3.0.3/clearml_agent/commands/worker.py)。

### 4. Agent 准备 repository 与运行依赖并启动

Agent 拉取 Task、clone repository、应用未提交 diff、选择 Docker 或 virtualenv、安装 requirements，再组装目标命令。
它向子进程注入 `CLEARML_TASK_ID`，也保留兼容名 `TRAINS_TASK_ID`；SDK 检测该 ID 后打开既有 Task，而不是创建另一个 Task。

Agent 在真正 launch 前再次发送强制 `StartedRequest`，再执行用户进程并转发 stdout/stderr。
官方流程见 [Agent README](https://github.com/clearml/clearml-agent/blob/v3.0.3/README.md)，实现见
[`clearml_agent/commands/worker.py`](https://github.com/clearml/clearml-agent/blob/v3.0.3/clearml_agent/commands/worker.py)。

### 5. 用户进程写 Event / Artifact / Model

远程进程使用同一 SDK 写入链路。Task ID 来自子进程变量 `CLEARML_TASK_ID`，Event、Artifact descriptor 与 Model 都归到已有远程 Task。
Agent负责进程与控制台；各 framework hook 和显式 Logger 仍由用户进程内 SDK 执行。

### 6. Agent 解释退出并写终态

只有 rank 0 改 Task 状态。目标进程 exit code 0 发送 `CompletedRequest`；用户中断发送 `StoppedRequest`；其它 exit code 发送 `FailedRequest`。
实现是
[`worker.py :: Worker.handle_task_process_termination`](https://github.com/clearml/clearml-agent/blob/v3.0.3/clearml_agent/commands/worker.py)。

## 状态词表与 owner

Server `TaskStatus` 的原始值是 `created`、`queued`、`in_progress`、`stopped`、`publishing`、`published`、`closed`、`failed`、`completed`、`unknown`。
WebApp 面向用户显示 Draft、Pending、Running、Completed、Failed、Aborted、Published 等标签。
不要把 UI 的 Aborted 误写成新的数据库枚举；服务端值是 `stopped`。

| Server status | 常见 UI 名称 | 生命周期含义 |
| --- | --- | --- |
| `created` | Draft | 已有 Task resource，尚未运行或已 reset |
| `queued` | Pending | Task 已被放入 Queue，等待 Agent |
| `in_progress` | Running | 本地 SDK或 Agent 已发送 started |
| `completed` | Completed | executor 报告正常完成；仍可继续、reset 或 publish |
| `failed` | Failed | executor 报告异常 / 非零退出 |
| `stopped` | Aborted | 用户中断、服务端停止或失联 watchdog 停止 |
| `publishing` / `published` | Publishing / Published | 发布转换与只读发布态 |
| `closed` | Closed | 服务端保留的关闭态；不是 Archived tag |
| `unknown` | fallback | 其它状态无法匹配时使用的默认值 |

| 动作 | 发起 owner | 持久 owner | 并发保护 |
| --- | --- | --- | --- |
| create / edit Task | SDK、CLI、WebApp 或 REST client | Mongo `task` | 单文档 update；具体 endpoint 校验 |
| status change | SDK、Agent、WebApp 或 watchdog | Mongo `task` | `ChangeStatusRequest` 查询 expected status 后原子 update |
| enqueue | REST client / WebApp | Mongo `task` + `queue` | Task CAS + Queue push + 失败补偿；无跨文档事务 |
| dequeue claim | Agent 请求 | Mongo `queue` | Queue 文档原子 pop；与后续 Task started 分开 |
| Event batch | SDK Logger | Elasticsearch；另更新 Mongo summary | ES bulk 逐文档成功/失败；无跨存储事务 |
| Artifact | SDK | storage payload + Mongo Task descriptor | 两步；默认可异步，无共同事务 |
| final status | 本地 SDK 或 Agent rank 0 | Mongo `task` | Task 状态 CAS；不等待 Server 跨存储核对 |

`ChangeStatusRequest` 的 expected-status CAS 见
[`apiserver/bll/task/utils.py :: ChangeStatusRequest.execute`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/utils.py)。

## 原子性、失败与 partial

### Event batch

Server 先验证和规范化事件，再用 Elasticsearch `streaming_bulk`，chunk size 500 且 `refresh=True`。
响应分开计数 `added` 与 `errors`；单 batch 可以部分成功。

随后 Server 为性能起见，按“本批尝试过的 Task”更新 Mongo `last_iteration` / `last_metrics` 等 summary，而不是只按 ES 成功事件更新。
所以 ES 明细与 Mongo summary 可能短暂或永久不一致；源码注释明确承认这项取舍。

证据：
[`event_bll.py :: EventBLL.add_events`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_bll.py)、
[`events.py :: AddBatchResponse`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_api/services/v2_23/events.py)。

### Logger shutdown race

SDK `BackgroundReportService` 注释说明：close 与 daemon 并发时，可能重复发送同一事件，也可能恰好丢一个事件；作者只承诺这种情况很少。
非 log Event 的确定性 ID 会使相同 identity overwrite，能吸收部分重复；log Event 使用随机 ID，会保留重复日志。

证据：
[`metrics/reporter.py :: BackgroundReportService._processing_events`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/metrics/reporter.py)、
[`event_bll.py :: EventBLL._get_event_id`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/event/event_bll.py)。

### 带文件 Event 与 Artifact

带文件 Event 上传失败时，SDK 从本次 API batch 排除对应 Event；若 payload 已上传而 Event API 失败，payload 可成为无引用文件。
普通 Artifact 默认异步计算目标 URI并更新 Task descriptor；因此 descriptor 写入和 payload 完成没有原子承诺。

后一句是从公开调用顺序得到的推论，不是官方声明的 recovery guarantee。
相关实现：
[`Metrics._do_write_events`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_interface/metrics/interface.py)、
[`Artifacts._upload_local_file, _add_artifact`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/binding/artifacts.py)。

### 失联 Task

Server watchdog 默认每 900 秒检查一次；`in_progress` Task 若 `last_update` 超过 7200 秒未更新，会被 CAS 为 `stopped`，reason 为 `Forced stop (non-responsive)`。
这是一条状态修复，不会补齐或回滚 Event / payload。

源码：
[`non_responsive_tasks_watchdog.py :: NonResponsiveTasksWatchdog`](https://github.com/clearml/clearml-server/blob/v2.4.0/apiserver/bll/task/non_responsive_tasks_watchdog.py)。

## retry、reset、resume 与重新执行

| 机制 | 身份与历史 | iteration | 能否恢复用户进程内状态 |
| --- | --- | --- | --- |
| HTTP retry | 同一 API request；SDK默认对 502、503、509、429 重试 | 不改变 | 否，只重发网络请求 |
| 默认 reuse/reset | 沿用 Task ID，但清旧日志与输出面 | 重新开始 | 否 |
| `continue_last_task=True` | 沿用 Task ID并保留 logs、models、artifacts | 默认从 last + 1 | 否；用户代码仍须加载 checkpoint |
| clone / reproduce | 新 Task ID，复制运行输入及 repository、container、requirements 描述，不复制旧输出 | 新运行 | Agent 重新准备 repository、container 或 virtualenv 与 requirements；不是进程快照 |
| failed Task 再 enqueue | 可沿用 Task ID再跑；状态机允许 `failed -> queued` | 取决于 SDK与用户代码 | 无内建进程 checkpoint restore |
| offline import | 可创建 Task，或追加到指定 Task；重新发送本地 logs / metrics 并上传 payload | importer 可加 iteration offset | 重新发送持久事件，不恢复原 Python 内存 |

HTTP retry code 来自
[`backend_api/session/session.py :: Session._retry_codes`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/backend_api/session/session.py)。
clone 的官方用户流程见[Reproducing Tasks](https://clear.ml/docs/latest/docs/getting_started/reproduce_tasks/)。

在固定的 Agent `v3.0.3` 与 SDK `v2.1.11` 源码中，没有发现序列化和恢复任意用户进程状态的机制。
ClearML 可以重新准备 repository、container 或 virtualenv 与 requirements，并复用或追加 Task；训练 checkpoint 的保存、选择与加载仍由框架或用户代码负责。

离线执行在关闭时生成 zip；`Task.import_offline_session` 读取 Task 元数据，创建或选定 Server Task，上传 Artifact 与 Model payload，重新发送日志和指标，最后标记 completed。
实现见
[`clearml/task.py :: Task.import_offline_session, Task.__shutdown`](https://github.com/clearml/clearml/blob/v2.1.11/clearml/task.py)。
