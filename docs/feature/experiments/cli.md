# Experiments —— CLI 反馈模型

`niceeval exp` 选择已签入的 Experiment 配置，建立一个 `invocationId`，并把每个选中的 Experiment 写成同一 RecordStore 中的 Run graph entity。
命令的终态是 `InvocationReceipt`，而不是目录清单、宽结果对象或另一套结果格式。

`watch`、`session` 查询、`exp --json` 与 receipt 共享这个 `invocationId` 和同一个 Reducer。
它们只能投影 Live 或外部 Invocation 索引，不能各自维护第二套计数或状态机。

## `niceeval exp`

```sh
niceeval exp [<experiment-prefix>] [<eval-prefix>] [flags]
niceeval exp list [<experiment-prefix>] [--json]
niceeval exp <experiment-prefix> --dry [--json]
```

位置参数先选择 Experiment ID 或路径前缀，第二个及以后的参数再收窄 Eval ID 前缀。
它们只能缩小 Experiment 自己的 `evals` 选择，不能把未选中的 Eval 加回计划。

### `niceeval exp list`：先看有哪些运行配置

`exp list` 进行发现和配置求值，但不建立 Invocation、不取调度锁、不启动 Sandbox，也不写 Record。
每行显示 `experimentId`、description、Agent、model、attempts、已选 Eval 数和 labels；不打印凭据、完整 flags 或运行时坐标。

`--json` 输出一个静态文档，供调用者取得已选 Eval ID。
它不是运行期 NDJSON 流，也不表示某个 Experiment 正在执行。

### 实验选择器怎样求值

精确 Experiment ID 优先。
否则目录段要求精确匹配，最后一个路径段允许前缀匹配；零命中时命令显示可浏览目录和下一步 `--dry`。

Experiment 命中而 Eval 前缀零命中是独立错误。
命令不会把它降级成空 Invocation，因为空计划常常是拼写错误。

### `--dry`：计划矩阵与作废原因

`--dry` 固定本次用于规划的 source `RecordGraphRef`，展示 Experiment、Eval、ordinal 与每个成员的执行或采用原因。
它不启动 Invocation、不写 Claim、不写 Run，也不创建 JUnit。

```text
PLAN
compare/codex  memory/commit0  ordinal 0  carried
compare/codex  memory/commit0  ordinal 1  execute: fingerprint-changed
```

carry 行显示历史 Attempt 的完整 locator，例如 `@01J8ZK3M6P4T7V9X2C5N8QW0RY`，以及它为何仍可采用。
没有 source Graph、读取不兼容或证据不可验证时，计划显示具名原因，不把它伪装成从未执行过。

### `niceeval accept`

```sh
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY @123456789ABCDEFGHJKMNPQRST
```

accept 先对全部 locator 做原子预检。
通过后，它为每个关联的 Experiment 建 Run、accept Claim 与 `accepted` Contribution；完整写入契约在 [缓存与携带](cache.md#niceeval-accept-locator接受明确列出的-attempt)。

成功行只回显原 locator、Experiment、`accepted` mode、Run 和 GraphRef。
同一 Attempt 的 locator 不变；命令不能输出另一个 locator 或复制执行事实。

| 错误 | 反馈 |
|---|---|
| `malformed-locator` | 要求完整的 `@` + 26 个大写 Crockford 字符 |
| `locator-not-found` | 说明当前 Record 没有该 Attempt，并提示检查 Record 或输入 |
| `accept-ineligible` | 列出 Verdict、timeout、配置或计划的具体阻断条件 |
| `duplicate-accept-member` | 指出重复选中的 Experiment membership |
| Record 写入失败 | 输出该 Run receipt 的 `partial` 或 `not-recorded`，不伪装成功 |

`exp --accept`、动态批量 accept 与按差异类别 accept 都不存在。

## Session 查询

`niceeval session` 是外部 Invocation 索引的查询命令名，不是独立的 Session 实体。
索引的唯一键是 `invocationId`，并由同一个 Live Reducer 提供状态、计数、关联 Run 和 receipt 指针。

```sh
niceeval session list
niceeval session list compare/codex
niceeval session list --all --json
niceeval session show inv_01ac42f0
```

Human 输出按 Invocation 分组：

```text
ACTIVE INVOCATIONS (1)
inv_01ac42f0  2m 14s  1 running · 2 queued
  compare/codex   run_01  1 running · 1 queued
  compare/claude  run_02  1 queued
```

索引项可显示 `active`、`complete`、`incomplete`、`interrupted` 或 `expired`。
`expired` 仅表示外部索引心跳失效，不证明进程仍在运行，也不阻止新的 Invocation。

查询不发现 Experiment 源码、不加载配置、不启动 Sandbox，并且不打开或修改 Record。
它不分配第二个 Session identity，不公开内部索引的物理路径，也不保存 Attempt 证据。
要阅读事实，使用 receipt 的 GraphRef、`niceeval show` 或固定 Sample。

| 错误 | 条件 | 下一步 |
|---|---|---|
| `invocation-not-found` | `session show` 的 invocationId 不在索引中 | 复制 `session list` 中的完整 ID，或用 receipt 查 Record |
| `ambiguous-invocation` | 给出的 ID 前缀命中多个 Invocation | 使用完整 invocationId |
| `invocation-index-unavailable` | 外部索引暂时不能读取 | 用已知 receipt 的 GraphRef 运行 `show` |

## 什么动态更新，什么逐条追加

Live 是 Reducer 从同一 Observation stream 计算的有界读取面。
`progress()` 可以替换，Attempt phase 和 counters 可以更新；durable Observation、Claim 与 receipt 只能追加到各自的 Record revision。

| 信息 | Live 行为 | Record 行为 |
|---|---|---|
| counters、active Attempt、短 detail | Reducer 更新 | 不成为独立事实 |
| `progress()` | 可合并或丢弃 | 不进入 durable sequence |
| Diagnostic、fact、phase Observation | 推送给连接者 | 追加到 Run 或 Attempt stream |
| Claim | 推送给连接者 | 追加并带 evidence refs |
| Invocation 结束 | terminal Live 状态 | 唯一 `InvocationReceipt` |

### Attempt 阶段

Runner 只投影实际的 `LifecyclePhase`。
Adapter、Sandbox provider 和用户 Hook 不能直接写 phase 字段。

| phase | Human 短文案 |
|---|---|
| `sandbox.queue` | waiting for sandbox |
| `sandbox.create` | creating sandbox |
| `sandbox.prepare.*` | preparing sandbox |
| `agent.ensure` | preparing agent |
| `agent.setup` | agent setup |
| `eval.run` / `agent.run` | running eval |
| `workspace.diff` | capturing diff |
| `assertions.evaluate` | evaluating assertions |
| `sandbox.cleanup` / `sandbox.stop` | releasing sandbox |

阶段转换只改变 active 行的 phase 和 detail。
完整 timing、trace、Assertion 与 Verdict 由 `show` 的 Projector 在固定 GraphRef 上读取。

### 实验级 Hook 的显示

Experiment `setup` 与 `teardown` 不属于任何 Attempt。
TTY 在它们运行时显示 Run 范围活动行；非 TTY 与 `--json` 只发送对应 Observation 或 Claim，不用不断刷新的 Hook 日志代替事实。

等待 Hook 的 Attempt 仍是 `queued`，不占 Attempt 并发位。
Hook 抛错会进入受影响 Run 的 durable Diagnostic 和 receipt；不会变成一个没有归属的终端文案。

### 判分预检的显示

Judge precheck 在任何 Attempt 派发前进行。
TTY 显示 `prechecking judge config`；机器面通过同一 Live / Observation 流表达进度与失败。

预检失败后，受影响成员的执行失败事实标明 `judge.precheck`。
它不能只依赖临时 stderr，也不能让 InvocationReceipt 声称 `complete`。

### 等待并发 run 的显示

等待另一个 Invocation 的用例锁或共享状态租约时，Live counters 把成员计为 `elsewhere`。
它不占本 Invocation 的并发位，也不会被误记为 active Attempt。

锁释放后，Runner 打开一个明确 GraphRef 并重新规划。
被采用的成员从 `elsewhere` 进入 `reused`，需要执行的成员进入 `queued`；两种迁移都由同一个 Reducer 计算。

### 输出流和落盘节奏

Observation Hub 先保证 durable sink 的顺序与 backpressure，再把同一事件交给 Reducer、Live 和可选 OTel。
进程中断后，已经成功提交的 GraphRef 仍可打开；尚未完成的 scope 由 receipt 如实标为 `partial` 或 `not-recorded`。

`--junit <path>` 是最终聚合输出。
它使用临时文件与原子替换，不把每个 Attempt 的状态写成可被误认为完整的中间汇总。

## 人在终端里怎么用

TTY 以计划、Live、失败摘要、receipt 状态与下一步命令组织输出。
细节不在终端无限展开：复制完整 locator 后使用 `niceeval show @01J8ZK3M6P4T7V9X2C5N8QW0RY`，由 Projector 按 GraphRef 读取所需证据。

### 框线体裁

框线只组织当前终端的可见信息。
它不能成为事实 owner，不能把 Live counter 当成 receipt，也不能以滚屏替代 Record 中的 Observation 与 Claim。

### 运行中的 live 面板

面板首行显示 Reducer 计数：

```text
12 total · 3 reused · 2 running · 1 elsewhere · 4 queued · 1 passed · 1 failed
```

每一帧都满足 Record CLI 定义的计数恒等式。
`reused` 指当前 Run 已写出历史 Attempt 的 Contribution，不表示复制结果；`elsewhere` 指等待外部 Invocation 的协调状态。

失败行只显示完整 locator、Eval、Experiment 和有界摘要。
完整消息、stream、diff、usage、Assertion 与 Verdict 必须通过 `show` 或 Report 读取。

### 键盘输入与画面自愈

交互式 TTY 可以重绘 Live 面板，但重绘只读取 Reducer 状态。
终端尺寸变化、控制字符或连接重建不会修改 Run、Attempt、Contribution、Claim 或 receipt。

### 人看的结束反馈

结束反馈显示 terminal counters、Invocation completion、RecordCommit state、可用 GraphRef 与下一步。
`partial` 还显示 `durableThrough` 和写入失败；`not-recorded` 明确没有 GraphRef。

```text
INCOMPLETE · invocation inv_01ac42f0
record: partial · graph: rec_01…
next: niceeval show @01J8ZK3M6P4T7V9X2C5N8QW0RY
```

终端不把某个 Run 描述成最终结果整体。
需要可比较总体时，显式以 receipt 的 GraphRef 调用 Sample，再交给 Report。

## 机器怎么读：`--json`

`exp --json` 使用 [Record CLI](../record/cli.md#机器输出) 定义的 `InvocationMachineRecord`。
前半段是 `LiveRecord` NDJSON，末尾恰好一条 `{ "type": "receipt" }`，其 `receipt` 是完整 `InvocationReceipt`。

| record `type` | 完整 owner shape |
|---|---|
| `snapshot`、`observation`、`claim`、`heartbeat` | `LiveRecord` |
| `receipt` | `InvocationReceipt` |

字段的穷尽形状、sequence、cursor 与 receipt 语义以 Record CLI 和 Record Library 为准。
消费者不能从 cursor 推断路径、Attempt identity 或 Store 布局。

### AI 常见循环

coding agent 先运行 `--dry --json` 检查计划，再运行 `exp --json`。
收到 failure 或 receipt 后，只用完整 locator 下钻必要证据，修改代码，再按需求使用默认 carry、`--rerun` 或 `--rerun all`。

agent 必须以退出状态与 InvocationReceipt 判断完成，不能从一条 Live counter 或文字摘要猜成功。

### CI 门禁

CI 用退出状态判断红绿，使用 `--junit` 上传测试注解。
需要结构化审计时归档 `InvocationReceipt` 的 GraphRef，或在固定 GraphRef 上执行 `show --json`；不解读人读日志，也不拼运行期计数。

`complete` 仍要交给既有 Verdict 退出策略处理。
`partial`、`not-recorded`、`incomplete` 和 `interrupted` 必须非零退出，即使当前没有 failed Verdict。

## 哪些参数改变什么

| 类别 | 参数 | 作用 |
|---|---|---|
| 选择 | 位置参数 | 收窄 Experiment 与 Eval |
| 调度 | `--attempts`、`--max-concurrency`、`--budget` | 只影响本次派发 |
| timeout | `--timeout` | 改变历史 Attempt 的采用资格 |
| 采用口径 | `--rerun` | 决定哪些 Verdict 可自动采用 |
| Sandbox | `--keep-sandbox` | 要求对应成员本次真实执行 |
| 输出 | `--json`、`--junit` | 改变读取或交付形态，不改事实 |

### attempts 与首过即停怎样展示

首过即停后，没有派发的 ordinal 在 Live reducer 中以明确的未启动原因计数。
它们不伪造 Attempt、locator、Verdict 或 Contribution；receipt 的 completion 依照 Runner 的完成规则表达。

### timeout、budget 与基础设施错误

timeout、预算耗尽、Provider 失败与 Record 写入失败都必须留下区分明确的 Observation、Claim 或 receipt cause。
CLI 不能把它们收敛成空结果、零成本或绿色 Verdict。

## 用法错误

argv、配置发现或 selector 无法形成 Invocation 时，命令以非零状态输出 `error:` 与 `fix:`。
这类 preflight 错误没有 InvocationReceipt，因为尚未建立 `invocationId`。

常见例子包括未知 Experiment、零 Eval、无效 `--rerun`、把 `--model` 当成临时 Experiment 改写，以及不完整 locator。

## 相关阅读

- [Architecture](architecture.md) —— Invocation、Run、Contribution 与外部索引。
- [缓存与携带](cache.md) —— `accepted` / `carried` 的预检与写入。
- [Record CLI](../record/cli.md) —— `watch`、Live、locator、show、receipt 的权威形状。
- [Record Library](../record/library.md) —— `InvocationReceipt` 与 `RecordCommit`。
