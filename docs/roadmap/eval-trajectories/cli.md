# Eval Trajectory —— CLI

Trajectory 只有下面两条执行语法。没有 `niceeval trajectory run`、通用 `niceeval resume`、`--checkpoint` 或按目录
推断恢复位置的别名。receipt 可由既有显式查看入口 `niceeval show --run <RunId>` 读取；它不是第三条 trajectory
执行语法，也不选择或恢复 state。

```sh
niceeval trajectory start <trajectory-id> [--breakpoint <node-id>] [--debug] [--dry] [--json]
niceeval trajectory resume <resume-locator> [--breakpoint <node-id>] [--debug] [--dry] [--json]
```

`start` 只接受路径派生的 exact `<trajectory-id>`，不接受 prefix selector。`resume` 只接受完整 locator；它不接受
单独的 Run ID、execution ID、Cohort、Region 或 checkpoint。`--breakpoint` 在指定 exact node ID 开始前暂停，且
该 node 必须位于本段可达图中。

普通 start / resume 遇到 debug root、debug locator 或 State acquisition 的 debug downgrade 时 fail closed。
`--debug` 是唯一授权：它允许从 locator 绑定的 exact debug checkpoint 继续，且每份 handoff 必须带非空、封闭的
debug reasons。flag 不能绕过 identity、DAG、fence、cleanup 或 isolation 校验。

## Dry

dry 读取 declaration、DAG 与 locator，显示 segment 边界、ready node、每条 `checkpointFrom`、并发分组及
comparability decision。它不建立 Run、不 restore state、不 mint commit ID、不执行 Eval，也不生成新 locator。

```text
TRAJECTORY PLAN memory/recall
segment start  comparability comparable
ready memory/recall/seed  checkpoint root
breakpoint memory/recall/inspect
```

debug root 或 locator 在没有 `--debug` 时由 dry 明确标为 `blocked: debug-flag-required`；带 `--debug` 时只显示
exact ref 的安全摘要和封闭 reasons，仍不探测 provider 或创建 handoff。

## 人读 handoff

每段结束都显示 Run、execution、完整 frontier、expected slot 摘要和状态交接。下列四种可交接输出穷尽 planned
breakpoint / controlled interruption 与 comparable / debug 的组合：

| 终结原因 | comparability | human 输出的必有字段 | exit |
|---|---|---|---|
| planned breakpoint | comparable | `segment paused`、`run`、`execution`、`frontier`、`resume locator` | `0` 或 `1` |
| planned breakpoint | debug | 上述字段、`debug`、非空 `reasons`、`resume locator` | `0` 或 `1` |
| controlled interruption | comparable | `segment interrupted`、`run`、`execution`、`frontier`、`resume locator` | `130` |
| controlled interruption | debug | 上述字段、`debug`、非空 `reasons`、`resume locator` | `130` |

例如：

```text
trajectory memory/recall  node recall  failed  state committed
segment paused at memory/recall/inspect  run 01J…  execution te_4…
frontier completed=2 ready=1 pending=0
debug reasons: content-digest-unavailable
resume locator: trr1.<opaque>
```

没有 locator 时，输出必须点名阻断原因，例如 `errored`、`dirty`、`cleanup-failed`、`isolation-failed`、
`commit-indeterminate` 或 `debug-flag-required`。不得以较早 checkpoint 替换它。

## JSON 与退出码

`--json` 输出 NDJSON，并以一条 segment receipt 结束；该 receipt 总是含完整 `expectedNodeIds` 与
`expectedSlots`。handoff event 的 locator 是下一段唯一授权输入。以下联合穷尽 planned breakpoint、controlled
interruption 与 debug handoff：

```ts
type TrajectoryHandoffEvent =
  | {
      readonly type: "trajectory-handoff";
      readonly cause: "planned-breakpoint";
      readonly comparability: "comparable";
      readonly debugReasons: readonly [];
      readonly runId: RunId;
      readonly trajectoryId: TrajectoryId;
      readonly trajectoryExecutionId: TrajectoryExecutionId;
      readonly frontier: TrajectoryFrontier;
      readonly resumeLocator: string;
    }
  | {
      readonly type: "trajectory-handoff";
      readonly cause: "controlled-interruption";
      readonly comparability: "comparable";
      readonly debugReasons: readonly [];
      readonly runId: RunId;
      readonly trajectoryId: TrajectoryId;
      readonly trajectoryExecutionId: TrajectoryExecutionId;
      readonly frontier: TrajectoryFrontier;
      readonly resumeLocator: string;
    }
  | {
      readonly type: "trajectory-handoff";
      readonly cause: "planned-breakpoint";
      readonly comparability: "debug";
      readonly debugReasons: readonly [TrajectoryDebugReason, ...TrajectoryDebugReason[]];
      readonly runId: RunId;
      readonly trajectoryId: TrajectoryId;
      readonly trajectoryExecutionId: TrajectoryExecutionId;
      readonly frontier: TrajectoryFrontier;
      readonly resumeLocator: string;
    }
  | {
      readonly type: "trajectory-handoff";
      readonly cause: "controlled-interruption";
      readonly comparability: "debug";
      readonly debugReasons: readonly [TrajectoryDebugReason, ...TrajectoryDebugReason[]];
      readonly runId: RunId;
      readonly trajectoryId: TrajectoryId;
      readonly trajectoryExecutionId: TrajectoryExecutionId;
      readonly frontier: TrajectoryFrontier;
      readonly resumeLocator: string;
    };
```

```json
{"type":"trajectory-node","runId":"01J...","trajectoryId":"memory/recall","executionId":"te_4...","nodeId":"memory/recall/recall","verdict":"failed","advance":"allowed"}
{"type":"trajectory-handoff","cause":"planned-breakpoint","comparability":"debug","debugReasons":["content-digest-unavailable"],"runId":"01J...","trajectoryId":"memory/recall","trajectoryExecutionId":"te_4...","frontier":{"completedNodeIds":["memory/recall/seed","memory/recall/recall"],"readyNodeIds":["memory/recall/inspect"],"pendingNodeIds":[]},"resumeLocator":"trr1.<opaque>"}
```

| 退出码 | 含义 |
|---|---|
| `0` | segment 完成且没有 `failed` Verdict，或在 planned breakpoint 干净暂停 |
| `1` | segment 有 `failed` Verdict；可前进时仍会给出 handoff |
| `1` | argv、exact trajectory ID、breakpoint 或 locator 无效，零 Run 写入 |
| `1` | `errored`、dirty、cleanup / isolation failure、commit indeterminate、state receipt 不可用，或未带 `--debug` 的 debug 路径 |
| `130` | 受控 interruption 已封口本段；只有干净交接时才带 handoff |

未捕获崩溃使用 `2`。本方向继承 [CLI 的统一 `niceeval exp` 退出码](../../cli.md#退出码)，不新增 Trajectory 专用状态码。

第一次 SIGINT 请求 controlled interruption：停止尚未开始的 node，等待已开始 node 到其 Scope 边界，并完成已签发
commit ID 的 reconciliation。第二次 SIGINT 交给宿主终止进程；没有已封口 Run 或 handoff 的承诺。

## 并发与审计边界

同一 trajectory execution 的 commit node 按 DAG predecessor 串行执行。read node 可以与无依赖的 node 并发，
但仍受 Experiment 与全局并发限制。另一个 execution 只有在 State lifecycle 允许时才可取得同一 Cohort。

CLI、JSON、Report 与 `niceeval show --run <RunId>` 只读取 segment Run 的 receipt 和 resumed-prefix provenance。显示
层不向 provider 询问可变位置，也不根据显示顺序补造 frontier。built-in comparison 在 receipt 层拒绝 debug Run，
不能由 CLI 展示行为绕过。
