# 运行观测协议 —— Library

本页定义 Adapter 怎样增量产生 Agent 事件，以及读取面怎样把 Observation 投影成 Report 可消费的值。
磁盘 envelope 与 Record 容器单源在 [Architecture](architecture.md)。

## Agent Turn stream

Adapter 的 `send` 返回一条异步 Turn stream。
stream 由零到多条事件和恰好一个末尾 Outcome 构成。

```ts
type AgentTurnFrame =
  | { type: "event"; event: StreamEvent }
  | { type: "outcome"; outcome: TurnOutcome };

type AgentTurnStream = AsyncIterable<AgentTurnFrame>;

interface TurnOutcome {
  status: "completed" | "failed" | "waiting";
  data?: JsonValue;
  usage?: Usage;
  evidenceCoverage?: TurnEvidenceCoverage;
}

interface SandboxAgent {
  readonly name: string;
  readonly kind: "sandbox";
  readonly evidenceCoverage: EvidenceCoverage;
  send(input: TurnInput, ctx: SandboxAgentContext): AgentTurnStream;
}

interface DirectAgent {
  readonly name: string;
  readonly kind: "direct";
  readonly evidenceCoverage: EvidenceCoverage;
  send(input: TurnInput, ctx: AgentContext): AgentTurnStream;
}
```

stream 必须满足以下规则：

1. `event` 保持原始发生顺序，Adapter 不按类型或时间重排。
2. 最后一帧必须是唯一的 `outcome`，其后不能再 yield。
3. 协议无法形成可信 Outcome 时，迭代器 reject `SendFailure`，不能 yield 一个伪造的 `failed`。
4. reject 前已经 yield 的事件继续作为 partial Observation 保存，不复制进 `SendFailure`。
5. `waiting` 必须伴随至少一条未解决的 `input.requested`，回答轮沿用同一 `AgentSession`。
6. Adapter 不截断事件；Record sink 在持久化边界统一截断并写入结构化标记。

Runner 为每条 Agent frame 补齐 Turn scope、Observation identity、sequence、单调时间和 source。
`StreamEvent.operationId` 只配对一项 Agent 操作；Observation `id` 则是跨 Record 引用的稳定事件身份，两者不能互换。

## Batch Adapter

不能增量取得原生事件的 Adapter 可以使用 batch helper。
它仍产生同一条 Turn stream，只是所有 frame 在原生调用结束后才可见。

```ts
function batchTurn(
  run: () => Promise<{
    events: readonly StreamEvent[];
    outcome: TurnOutcome;
  }>,
): AgentTurnStream;
```

`batchTurn` 不降低证据语义。
Adapter 仍按实际能力声明 `evidenceCoverage`；无法取得完整 transcript 时必须把对应通道降为 partial 或 unavailable。

## Eval 作者看到的 Turn

`t.send()` 消费完整 Agent Turn stream 后，把事件和 Outcome 组装成 Turn 交给 Eval 作者。
作者面保持按事件断言的心智，不暴露 Hub、cursor 或 Record envelope。

```ts
interface Turn {
  readonly events: readonly StreamEvent[];
  readonly data?: JsonValue;
  readonly status: "completed" | "failed" | "waiting";
  readonly usage?: Usage;
  readonly evidenceCoverage?: TurnEvidenceCoverage;
}
```

断言在完整的内存事件上运行。
Record 截断、Live 过滤和 OTel 缺失都不能改变 `Turn.events` 或断言结果。

## AgentContext 的三类反馈

```ts
interface AgentContext {
  readonly session: AgentSession;
  readonly telemetry?: Telemetry;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  fact(key: string, value: string | number | boolean): void;
}
```

| API | 信息类别 | 持久化 | 折叠规则 |
|---|---|---|---|
| `progress` | ephemeral feedback | 否 | live 只保留同一作用域最新值 |
| `diagnostic` | Observation | 是 | 每次发生都保留，读面可以按 key 去重投影 |
| `fact` | Observation | 是 | 每次上报都追加；latest-fact projector 按 sequence 取最后值 |

`fact` 的同 key 更新不覆盖历史事件。
需要当前值的消费面使用 latest-fact projector；需要变化轨迹的消费面读取全部事件。

## Record 读取

`openRecord()` 仍返回事实层句柄，不提供选择器、聚合或报告字段。

```ts
interface AttemptHandle {
  readonly identity: AttemptIdentity;
  readonly run: RunHandle;
  provenance(): Promise<ProvenanceSet>;
  observations(): Promise<ObservationSet>;
  claims(): Promise<ClaimSet>;
}

interface ObservationSet {
  readonly streams: readonly ObservationStream[];
  events(options?: {
    names?: readonly string[];
  }): AsyncIterable<ObservationEvent>;
}

interface ObservationStream {
  readonly id: string;
  readonly schema: string;
  readonly state: "sealed" | "incomplete" | "corrupt";
  readonly throughSequence?: number;
}
```

Reader 验证 envelope、sequence、摘要和 Claim 引用。
它不从事件计算通过数，不用新 evaluator 改写历史 Claim，也不因未知事件丢弃整个 stream。

第三方需要审计原始事实时可以直接读取 ObservationSet。
Report、show 与 view 不直接按事件名或 schema 分支，而是使用 projector。

## Projector

Projector 是带稳定身份的普通函数值。
它把一个 AttemptHandle 转成带 availability 和依据的中性读模型。

```ts
type UnavailableReason =
  | "not-recorded"
  | "unsupported-schema"
  | "incomplete"
  | "corrupt"
  | "redacted";

type Availability<T> =
  | {
      state: "available";
      value: T;
      basedOn: readonly EvidenceRef[];
    }
  | {
      state: "unavailable";
      reason: UnavailableReason;
      detail?: string;
      basedOn?: readonly EvidenceRef[];
    };

interface AttemptProjector<T> {
  (attempt: AttemptHandle): Promise<Availability<T>>;
  readonly name: string;
  readonly version: string;
}
```

内建 projector 包含：

```ts
execution(attempt);   // Availability<ExecutionTree>
timing(attempt);      // Availability<TimingTree>
usage(attempt);       // Availability<Usage>
diff(attempt);        // Availability<WorkspaceDiff>
assertions(attempt);  // Availability<readonly AssertionClaim[]>
verdict(attempt);     // Availability<VerdictClaim>
```

Projector 可以组合其它 projector，但必须合并 `basedOn`，不能把 unavailable 变成猜测值。
Projector 版本改变只使自己的可选缓存失效，不改变 Record 容器或历史 Claim。

## Reports 的依赖方向

Reports 的 Calculation 和实体转换函数消费 projector 结果，不消费 `EvalResult` 持久化形状。

```ts
const changedLines = rollup(async (attempt) => {
  const value = await diff(attempt);
  return value.state === "available"
    ? value.value.changedLines
    : null;
});
```

需要在报告里解释缺失时，转换函数把 `Availability` 变成带 Attempt locator 的 Notice 或空值口径。
组件只显示已经计算完成的普通值，不读取 Record、Observation 或 Claim。

新报告若只组合已有 projector，不会产生新的持久化字段。
只有新的 projector 证明缺少不可重建事实时，才需要增加独立 Observation schema。
