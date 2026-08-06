# 运行观测协议 —— Library

本页定义 Adapter 怎样增量产生 Agent 事件，以及读取面怎样按需把 Observation 投影成 Report 可消费的值。
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
物理 segment 对这个 API 完全透明；`events()` 跨段连续迭代，一条逻辑 stream 不因文件滚动变成多个 stream。

第三方需要审计原始事实时可以直接读取 ObservationSet。
Report、show 与 view 不直接按事件名或 schema 分支，而是使用 projector。

## Projector

Projector 是带稳定身份的普通函数值。
它把一个 AttemptHandle 转成带 availability 和依据的中性读模型，不创建新的持久化实体。

```ts
type EvidenceRef = Claim["basedOn"][number];

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
trace(attempt);       // Availability<TraceTree>
usage(attempt);       // Availability<Usage>
diff(attempt);        // Availability<WorkspaceDiff>
assertions(attempt);  // Availability<readonly AssertionClaim[]>
verdict(attempt);     // Availability<VerdictClaim>
```

Projector 可以组合其它 projector，但必须合并 `basedOn`，不能把 unavailable 变成猜测值。
它只能依赖 sealed Record、显式参数和其它 Projector，不能读取当前环境或未记录配置。
同一 Projector 版本对相同输入必须返回相同结果。

Projector 版本用于区分派生语义，并写入明确导出的 Report artifact 元数据。
Reader 可以在当前 AttemptHandle 内 memoize 结果，但不能写磁盘缓存、增加 manifest 引用或把 Projection 交给 Record writer。
`Availability<T>` 中的 `T` 是 Library API 类型，不是 Record schema；不兼容变化只产生新的 Projector 版本，不改写 Record。

Claim evaluator 使用 Projection 时，必须把它的 `basedOn` 展开成底层 EvidenceRef。
Projection 自身不是 EvidenceRef，也不能成为 Claim、另一个 Record 或后续 Report 的权威输入。
evaluator 版本必须覆盖所调用 Projector 的语义版本，不能让依赖变化静默改写同一 evaluator 身份。

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

用户明确保存的 HTML、JSON 或其它 Report artifact 属于 Reports 输出。
它可以记录 generator 版本与输入 Record 摘要，但不进入 Run 或 Attempt manifest，也不被 `openRecord()` 读取。

## Report artifact 的证据闭包

Report 导出宿主必须执行全部静态页面，并枚举每个参数化页面实例。
宿主收集渲染过程中取得的 `Availability.state === "available"` 结果，再对其中的 `basedOn` 求传递闭包。

```ts
interface ReportArtifactManifest {
  format: "niceeval.report";
  schema: "niceeval.report/2";
  generator: { name: "niceeval"; version?: string; commit?: string };
  inputs: Array<{ runId: string; manifestSha256: string }>;
  projectors: Array<{ name: string; version: string }>;
  evidence: readonly EvidenceRef[];
}
```

Report v2 reader 只接受上面的精确 manifest schema。
它不忽略未知字段，不接受未来 `schema` 值，也不把未知 evidence 引用保存成 opaque 数据；这些输入都返回 unsupported。
需要改变 manifest 结构或 evidence 引用类型时定义新 Report 版本，由对应 reader 明确实现，不在 v2 中预埋兼容分支。

闭包不是 artifact 文件名白名单。
一个 trace Projection 引用了 telemetry stream，就必须复制该 stream 的全部 segment，以及事件引用的全部 blob。
一个报告没有执行 trace Projector，则它的 Report artifact 不需要携带 trace；这不改变本地 Record，也不把 trace 定义成可牺牲证据。

Record 已采集某项依据，但导出时打不开、校验失败或复制失败，整次导出必须失败。
只有原 Record 本来就没有采集该项事实时，Projector 才能返回 `not-recorded`，报告再按自己的缺失口径呈现。
导出宿主不能把发布故障伪装成 `not-recorded`。

Report artifact 中的 evidence 文件沿用 Record 的 16 MiB segment 与 blob chunk 上限。
宿主可以在完成消息里报告文件数和总字节数，但不能为了满足总量目标自动删掉闭包中的依据。
HTML 只保存有界 Projection 与 evidence 引用；trace 等大型证据从分段文件按需加载，不在构建时重新合并进单个页面。
