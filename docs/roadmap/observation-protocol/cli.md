# 运行观测协议 —— CLI

`watch` 是旁路观察面，`exp --json` 是发起者的机器事件面，`show` 与 `view` 是终态审计面。
三者读取同一份 Observation 与 Claim，不复制生命周期状态机。

## 命令

```bash
niceeval watch
niceeval watch inv_01ac42f0
niceeval watch --exp compare/codex
niceeval watch --json
niceeval watch --json --once
```

| 形态 | 行为 |
|---|---|
| `watch` 的 TTY 输出 | 显示 active Attempt、phase、短 detail、elapsed、计数与最近 Diagnostic |
| `watch` 的非 TTY 输出 | 先打印 snapshot，再追加 phase、终态与 Diagnostic 摘要 |
| `watch --json` | 先输出 snapshot，再 tail Observation 与 Claim NDJSON |
| `watch --json --once` | 只输出一致 snapshot 后退出 |
| `exp --json` | 在既有机器输出中追加同形 Observation、Claim 与 snapshot record |

`watch` 只读已经存在的 Invocation，不启动调度，不占用被观察进程的 stdin，也不抢 TTY。

## 附着选择

selector 可以是 Invocation ID 或 Experiment ID。
Invocation 已结束时，命令输出终态 snapshot，并指向 `show --exp <id> --history`，退出码为零。

没有 selector 且只有一个 active Invocation 时自动附着。
存在多个 active Invocation 时列出候选并非零退出；命令不能静默选择最新或最早的一项。

未知 Invocation、没有 live 通道的生产者和权限不足使用不同的结构化错误码。
错误必须给出可执行的下一步，例如改用 `invocation list` 或终态 `show`。

## 机器输出

机器输出是 NDJSON，每行属于以下穷尽联合：

```ts
type LiveRecord =
  | {
      type: "snapshot";
      reason: "attach" | "resync" | "terminal";
      cursor: string;
      snapshot: LiveSnapshot;
    }
  | {
      type: "observation";
      cursor: string;
      observation: ObservationEvent;
    }
  | {
      type: "claim";
      cursor: string;
      claim: Claim;
    }
  | {
      type: "heartbeat";
      cursor: string;
      observedAt: string;
    };
```

`observation` 与 `claim` 逐字使用 Record 协议形状，不另定义 `attempt_start`、`phase_event` 或 `result_summary` schema。
`snapshot` 与 `heartbeat` 是 live transport record，不进入 Record 权威事实。

cursor 是 Invocation live channel 发出的不透明续读位置。
客户端只能原样回传，不能读取 cursor 来猜 stream 或 sequence。

## Live snapshot

```ts
interface LiveSnapshot {
  invocationId: string;
  status: "active" | "complete" | "incomplete" | "interrupted";
  observedAt: string;
  elapsedMs: number;
  basis: Array<{
    streamId: string;
    throughSequence: number;
  }>;
  counters: {
    total: number;
    reused: number;
    running: number;
    elsewhere: number;
    queued: number;
    passed: number;
    failed: number;
    errored: number;
    skipped: number;
  };
  active: Array<{
    runId: string;
    experimentId: string;
    attemptId: string;
    evalId: string;
    attempt: number;
    phase: LifecyclePhase;
    detail?: string;
    elapsedMs: number;
    locator?: AttemptLocator;
  }>;
}
```

计数满足：

```text
total = reused + running + elsewhere + queued
      + passed + failed + errored + skipped
```

snapshot 由共享 reducer 产生。
Invocation 索引、TTY 面板与 JSON 输出都不能自行维护另一套 counters 或 active Attempt 状态。
snapshot 是 live transport 的有界状态副本，不是 Record 文档或 Projector 磁盘缓存。
实现可以为了活动 Invocation 恢复而在 Record 外保存 snapshot，但必须连同 reducer 版本和 `basis` 保存；不匹配时从 durable 事件重建。
执行 `watch --json --once` 只读取或计算 snapshot，不更新 `layout.json.head`，也不向 Record graph 写入任何 node。

## 一致附着与重连

附着通道必须原子地返回 snapshot 和对应 cursor。
随后只发送 cursor 之后的 record，确保 attach 边界没有漏项。

live channel 可以只保留有界历史。
客户端给出的 cursor 已落出保留时段时，服务端发送 `reason: "resync"` 的新 snapshot 和 cursor，再从新位置继续；不得用现有状态伪造缺失的历史事件。

断线重连以最后确认的 cursor 继续。
重复收到相同 Observation ID 或 Claim ID 时按幂等登记处理；相同 ID 内容不同是协议错误。

## 公开的 live 事件

默认 live 流只暴露以下 durable 事件和必要 Claim：

| record | 时点 | live body 的作用 |
|---|---|---|
| `niceeval.attempt.started` | Attempt 租到并发位 | 建立 active Attempt |
| `niceeval.attempt.phase.changed` | `LifecyclePhase` 改变 | 更新 phase 与短 detail |
| `niceeval.attempt.finished` | Attempt-scoped finalizer 与 Attempt Record 封口完成 | 移除 active Attempt，并引用终态 Claim |
| `niceeval.sandbox.release.finished` | 物理 Sandbox release 收敛或持久化 resource error | 更新 retained 数与 Invocation resource completion |
| `niceeval.diagnostic.observed` | 形成 durable Diagnostic | 显示近期问题 |
| `Claim(kind: "verdict")` | Verdict Claim 形成 | 更新 passed、failed、errored 或 skipped |

`niceeval.attempt.finished` 不复制 Verdict 值，只引用对应 Claim ID。
消费者先应用 Claim，再应用 finished，或按引用等待 Claim 到达；Hub 必须保证同一连接上的依赖先于引用发送。

作者 `progress` 使用 `niceeval.attempt.progress` envelope，但属于 ephemeral 事件，并进入独立 live stream。
它只携带硬截断的 message、current 与 total；可以合并到同一作用域最新值，也不要求重连补发历史。
它不能占用 Attempt durable stream 的 sequence。

全文 message、thinking、工具 input/output、stdout、stderr 与 workspace diff 默认不进入 live 通道。
这些内容继续进入 Record，并通过 `show @<locator> --execution`、`--timing`、`--diff` 或其它终态切片读取。

## `invocation show`

活动 Invocation 的 `invocation show` 和 `--json` 显示共享 snapshot 的有界副本：

- 每个 running Experiment 的 `runningEvalIds`。
- active Attempt 的 `LifecyclePhase`、短 detail 与 elapsed。
- passed、failed、errored、skipped、queued、running 与 elsewhere 计数。
- suspended Sandbox 数、未收敛 resource errors 与 `sandbox list` 入口。
- snapshot basis 与 observedAt。

`invocation list` 仍只做 Invocation 索引，不提供事件 tail，也不扩张成监控总线。

## 人读反馈

TTY 的 ACTIVE 行固定显示 `evalId`、Attempt 序号、phase、短 detail 与 elapsed。
非 TTY 在 Attempt start、phase 变化和终态时立即追加一行，不只依赖 heartbeat。

plan 摘要同时显示全局并发和 Experiment 并发限制，并给出实际有效宽度。
失败行使用终态 Claim 的 Verdict，不从 Diagnostic 文案或 phase 推断 failed 与 errored。

`watch` 结束时只打印终态计数和 Record 入口，不展开完整证据。
需要回答为什么失败时进入 `show @<locator>`，live 输出不成为第二份 execution log。
