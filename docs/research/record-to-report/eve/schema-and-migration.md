# Eve：eval dump 的 schema 与其它面的版本

> 观察日期：2026-08-14
>
> 核对源码：`vercel/eve` `a29cc8e0864348fb7b02c2e8be718b7edd056e65`，`packages/eve` 0.31.3
>
> 返回 [目录](README.md)

本页写 schema、version、compatibility 与 migration 由谁拥有。
落盘字段见 [`.eve/evals` 信封](storage.md)。
公开作者面见 [channel、harness 与作者面](layers.md)。

官方入口：

- [TypeScript API](https://eve.dev/docs/reference/typescript-api)
- [Sessions, Runs & Streaming](https://eve.dev/docs/concepts/sessions-runs-and-streaming)
- [Execution Model and Durability](https://eve.dev/docs/concepts/execution-model-and-durability)

## Eval dump：没有版本字段，也没有 migrate

`summary.json`、`results.jsonl` 与 per-eval JSON 都没有 `schemaVersion`。
`packages/eve/src/evals/` 里没有 migrate 符号，也没有兼容 reader。

仓库 `AGENTS.md` 写明 pre-1.0 偏好 breaking change，不要 legacy fallback。
`defineEval` 对旧键 `input`、`run`、`checks`、`scores`、`expected`、`thresholds`、`parseOutput`、`model`、`cases`、`requires` 直接拒绝。

因此作者 API 的不兼容是编译期 / 导入期失败。
磁盘上的旧 dump 没有升级命令，也不会被新代码改写。
没有 reader，旧字节只是普通文件。

## 其它 Eve 面确实有版本

这些版本不属于 eval dump，但说明 Eve 知道对象版本这件事：

| 面 | 机制 | 是否改用户已保存的 eval 数据 |
|---|---|---|
| `/eve/v1/info` | `version` 字面量 `1`；不匹配则拒绝 target | 否 |
| 消息流 | `EVE_MESSAGE_STREAM_VERSION = "21"` | 否；旧 session 事件可缺 `meta.id`，runtime 放行 |
| 本地 traces | 目录名 `.eve/traces/v1/` | 否 |
| dev server 状态 | 文件名 `dev-server-state.v1.json` | 否 |
| compile metadata | `COMPILE_METADATA_VERSION = 5` | 否 |
| discovery diagnostics | `DISCOVERY_DIAGNOSTICS_ARTIFACT_VERSION = 1` | 否 |
| Workflow world | 自定义 world 必须匹配 vendored `@workflow/*` 协议 | 否 |

流版本 21 的文档写明：`meta.id` 从 stream version 20 起存在。
更早写成的事件没有 id，回看协议历史时不能去重。
这是 session 流的兼容 reader，不是 eval dump 的 migration。

本次检查的一手公开面未提供「升级 `.eve/evals`」命令。
也未提供改写用户已保存 eval 文件的官方步骤。
Vercel Workflow dashboard 的内部表与 migration 也未公开；上表只描述 Eve 公开的 runtime 边界。

## 哪些本可计算却仍持久化

写入前就算好、再写进磁盘的值：

| 值 | 算法 | 为何仍落盘 |
|---|---|---|
| `EveEvalDerivedFacts` | `deriveRunFacts` 扫 `MessageStreamEvent` | reporter 与 per-eval JSON 直接读它 |
| `AssertionResult.passed` | `computePassed(severity, threshold, score, failed)` | 控制台、JUnit、Braintrust 都读布尔结果 |
| `EveEvalVerdict` | `computeEvalVerdict` | 退出码与所有展示面的主标签 |
| `passed` / `failed` / `scored` / `skipped` / `errored` | 对结果计数 | `summary.json` 的头条 |
| `output` | 最后 turn 的 `data`，否则 `finalMessage` | 给只要一个输出值的 reporter |

`derived` 可以从 `.events.ndjson` 重算。
Eve 仍把它写入 `evals/<id>.json`，并在 `sessions[]` 里再存一份 events。
这是为了让 artifact 自己能被人打开，而不要求存在 reader。

读取时才算、不进 eval dump 的值：

| 值 | 何时算 |
|---|---|
| 控制台的 gate `passed/total` | `Console.onRunComplete` |
| 按 assertion 名平均的 soft score | 同上 |
| 控制台与 JUnit 的 duration | 用 `startedAt` / `completedAt` 相减 |
| `--json` 的完整 summary | 内存对象，不重读文件 |
| Braintrust 的 experiment diff | Braintrust `summarize`，Eve 只打印 URL |
| `eve logs --events` 的交错事件 | 查询 `.eve/.workflow-data` |

`deriveRunFacts` 在 [`derive-run-facts.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/derive-run-facts.ts)。
`computeEvalVerdict` 在 [`verdict.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/evals/runner/verdict.ts)。

对 schema churn 的影响：

1. 没有 dump 版本号，也没有 reader。
   改 `derived` 或 `AssertionResult` 形状不会触发 migrate。
   旧目录只是不再与当前类型字面相同的 JSON。
2. 派生值与事件并排持久化。
   抽取算法一变，新旧 dump 会在同一字段里表示不同含义。
   没有兼容层指出哪份用哪套算法。
3. 展示聚合故意不落盘。
   控制台改平均算法或改图标，不会改 `.eve/evals`。
4. 比较面在 Braintrust。
   Eve 增加 Table 或 Chart 不需要新的 eval 文件格式。
   它也还没有这些产品面。
