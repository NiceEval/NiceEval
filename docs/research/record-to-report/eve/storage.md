# Eve：`.eve/evals` 落盘信封与写入 owner

> 观察日期：2026-08-14
>
> 核对源码：`vercel/eve` `a29cc8e0864348fb7b02c2e8be718b7edd056e65`，`packages/eve` 0.31.3
>
> 返回 [目录](README.md)

本页写 eval dump 的文件、字段、谁写、原子性与 resume。
一次 run 何时写盘见 [一次 `eve eval`](execution.md) 第 12 步。
派生值对升版的影响见 [schema 与版本](schema-and-migration.md)。

官方入口：

- [Running Evals](https://eve.dev/docs/evals/running)
- [Reporters](https://eve.dev/docs/evals/reporters)
- [Project Layout](https://eve.dev/docs/reference/project-layout)

## 持久数据结构

Eval 没有数据库 table。
权威落盘信封是 `writeArtifacts` 写出的三个 JSON 形状，外加每个 eval 一份事件 NDJSON。

目录：

```text
<appRoot>/.eve/evals/<timestamp>/
├── summary.json
├── results.jsonl
└── evals/
    ├── <sanitized-id>.json
    └── <sanitized-id>.events.ndjson
```

`<timestamp>` 来自 `new Date().toISOString()`，把 `:` 与 `.` 换成 `-`，再 `slice(0, 19)`。
精度只到秒，例如 `2026-08-10T21-47-11`。
同一秒内两次 `eve eval` 会写进同一目录并把已有文件换成新内容。

id 里的 `/` 保留为子目录。
其它不安全字符按段换成 `_`。
`weather/brooklyn-forecast` 变成 `evals/weather/brooklyn-forecast.json`。

符号在 [`artifacts.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/artifacts.ts)。

## 公开类型与落盘字段

内存权威类型是 `EveEvalResult` 与 `EveEvalRunSummary`（[`types.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/types.ts)）。
磁盘信封是它们的投影，不是同一对象的完整序列化。

`summary.json`（`buildSummaryArtifact`）：

| 字段 | 取值 | 角色 |
|---|---|---|
| `target` | `EveEvalTarget`：`kind`、`url`、`capabilities` | 权威：这次打的是谁 |
| `startedAt` / `completedAt` | ISO 字符串 | 权威：整次 run 墙钟 |
| `passed` / `failed` / `scored` / `skipped` / `errored` | 对 `verdict` 计数 | 派生后落盘 |
| `totalEvals` | `results.length` | 派生后落盘 |
| `evals[]` | 每条的 id、verdict、status、assertions、error、skipReason | 索引 |

`results.jsonl` 一行一个 `buildResultLine`：

| 字段 | 角色 |
|---|---|
| `id` / `verdict` / `status` / `output` | 权威摘要 |
| `assertions` | 完整 `AssertionResult[]` |
| `error` / `skipReason` | 可选 |

每条 eval 的 `evals/<id>.json`（`buildEvalArtifact`）：

| 字段 | 角色 |
|---|---|
| `id` | 路径派生身份 |
| `result.output` / `finalMessage` / `sessionId` / `status` / `logs` | 任务结果 |
| `result.derived` | `EveEvalDerivedFacts`，从事件抽出后再写入 |
| `result.sessions` | 每个 session 的 events、derived、state |
| `verdict` / `assertions` / `error` / `skipReason` | 评分结果 |

`evals/<id>.events.ndjson` 把 `result.result.events` 逐条 `JSON.stringify`。
这些事件是 session 流上的 `MessageStreamEvent`。
`sessions[].events` 里会再存一份。

## 内存有、磁盘没有

`EveEvalResult` 还有 `startedAt`、`completedAt`。
三个落盘投影都不写这两项。
单条 eval 的耗时只活在内存 summary 和 reporter 里。

`EveEvalTaskResult.runtimeIdentity` 也不进 artifact。
`AssertionResult.passed` 会进磁盘。
它是 `computePassed` 的结果，不是独立采集事实。

## 其它相关信封，但不是 eval dump

| 对象 | 形状 | 说明 |
|---|---|---|
| 作者 eval | `EveEvalDefinition` + 发现层盖上的 `id` | 源码，不是运行结果 |
| 目标探测 | `/eve/v1/info` 的 `kind: "eve-agent-info"`、`version: 1` | 活 target 契约 |
| 会话事件 | `MessageStreamEvent`，流版本 `EVE_MESSAGE_STREAM_VERSION = "21"` | 被测 agent 的权威事件 |
| JUnit | `<testsuite>` / `<testcase>` | reporter 另写的 CI 文件 |
| Braintrust log | `id`、`input`、`output`、`scores`、`metadata`、`metrics`、`tags` | 外部 experiment 行 |

Braintrust 的读取与比较边界见 [历史 dump 怎样重新打开](reading-and-comparison.md)。

## 谁写

| 写入 | owner | 何时 |
|---|---|---|
| `.eve/evals/<timestamp>/` | `runEvals` → `writeArtifacts` | 全部 eval 结束后，reporter `onRunComplete` 之前 |
| 控制台行 | `Console` reporter | `onEvalComplete` / `onRunComplete` |
| `--junit` 文件 | `JUnit` reporter | `onRunComplete` |
| Braintrust experiment | `Braintrust` reporter | `onRunStart` 建 experiment，`onEvalComplete` 逐条 `log` |
| 被测 session | agent runtime / Workflow world | `t.send` 等 client 调用期间 |
| 本地 traces / logs | `eve dev` 与 tracing processor | 与 eval dump 无关 |

`writeArtifacts` 是 eval dump 的唯一 writer。
对应的读取边界见 [历史 dump 怎样重新打开](reading-and-comparison.md)。

## 事务与原子性

没有数据库事务。
`writeArtifacts` 先 `mkdir` `evals/`，再分别 `writeFile` summary、jsonl 与每个 eval 文件。
没有临时目录，也没有 rename commit。
写到一半失败时，目录里会留下不完整文件。

`runEvals` 等待 `writeArtifacts` 成功后才调 `onRunComplete`。
artifact 失败会让整个命令以未捕获异常结束。
此时 JUnit 与 Braintrust 的收尾可能还没跑。

Braintrust 的 `log` 发生在 artifact 写入之前。
进程在 [一次 `eve eval`](execution.md) 第 12 步之前被杀时，远端可能已有部分行，本地没有 dump。

## 单条 eval 的失败

`executeEval` 接住 `executeTask` 的抛错。
它仍返回一条 `EveEvalResult`，`verdict` 为 `failed`，`derived` 为空。
`test` 体抛错时，已捕获的 session 与已写入 collector 的 assertion 会留下来。

其它 eval 继续跑。
`errored` 是 `failed` 里带 `error` 的子集。

Reporter 回调走串行队列。
一个 reporter 抛错会打断后续 `onEvalComplete`，也会打断后面的调度。

## 没有 eval run 的 resume

没有「接着上次 `eve eval` 跑」的命令或字段。
每次调用都是新的发现、新的 target、新的 timestamp 目录。

可 resume 的是被测 agent 的 session，不是 eval run：

- `t.target.attachSession(sessionId, { startIndex? })` 接到已有 session
- `t.target.watchTurn(sessionId)` 观察进行中的 turn
- agent 自己的 crash resume 从 last completed step 继续

这些恢复的是 `/eve/v1/session/<id>` 上的 durable conversation。
它们不会把那些 session 再写成 `.eve/evals/<timestamp>/`，也不会续写该目录。
