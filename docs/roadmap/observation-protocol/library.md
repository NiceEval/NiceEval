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

type MessageEvent =
  | {
      type: "message";
      role: "assistant";
      text: string;
    }
  | {
      type: "message";
      role: "user";
      origin: "eval";
      text: string;
      sourceOrder: number;
      loc?: SourceLoc;
    }
  | {
      type: "message";
      role: "user";
      origin: "agent";
      text: string;
    };

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
7. Adapter 观察到的内部 user message 必须使用 `origin: "agent"`，且不能携带 `loc` 或 `sourceOrder`。

Runner 为每条 Agent frame 补齐 Turn scope、Observation identity、sequence、单调时间和 source。
`StreamEvent.operationId` 只配对一项 Agent 操作；Observation `id` 则是跨 Record 引用的稳定事件身份，两者不能互换。

core 为每次 `send` 或 `respond` 创建 `origin: "eval"` 的 user message，并放在该 logical Turn 的 event ordinal 0。
Adapter frame 依原顺序接在它之后。
Adapter 不能产出 `origin: "eval"`，assistant message 也不能带 origin；非法组合是协议错误。

### Session event position

```ts
interface EventPosition {
  readonly turnOrdinal: number;
  readonly eventOrdinal: number;
}
```

SessionManager 在 `send` / `respond` 开始时分配零起点、单调递增且不复用的 turnOrdinal。
core user message 的 eventOrdinal 是 0；Adapter event frame 按 yield 顺序从 1 递增；Outcome 不占 ordinal。

两个位置按 `(turnOrdinal, eventOrdinal)` 做 lexicographic comparison。
因此前一 Turn 已 closed 的 operation 与后一 Turn 的 event 可以形成严格顺序；Attempt stream sequence 不能替代这组坐标。

Runner 把 turnOrdinal 写进每条 turn-scoped durable Observation，并把 eventOrdinal 写进每条 Agent behavior Observation。
缺失、重复、负数或非 safe integer 是协议 defect；partial stream 中已经写出的合法位置仍保持可比较。

## Command projection

每笔 tool `operation.started` 都携带穷尽的 command classification：

```ts
type CommandLanguage = "posix-shell" | "powershell" | "cmd" | "unknown";

type CommandProjection =
  | { readonly kind: "not-command" }
  | {
      readonly kind: "command";
      readonly source:
        | {
            readonly state: "available";
            readonly value: string;
            readonly language: CommandLanguage;
          }
        | {
            readonly state: "opaque";
            readonly reason:
              | "redacted"
              | "truncated"
              | "structured-only"
              | "unsupported";
          };
    };

type ToolOperationStarted = {
  readonly type: "operation.started";
  readonly operationId: string;
  readonly operation: {
    readonly kind: "tool";
    readonly name: string;
    readonly input: JsonValue;
    readonly tool?: ToolName;
    readonly command: CommandProjection;
  };
};
```

CommandProjection 的 owner 是具体 Adapter。
它只能根据原生协议的显式、版本化映射分类，不能由 core 根据 canonical tool name 或 input 字段猜测。

`source.state: "available"` 要求原生协议明确提供提交给执行边界的 command source string。
仅有 argv、`program + args`、SDK display summary 或若干片段时使用 `structured-only` 或 `unsupported`。

Adapter 与 core 都不能把 argv join 成字符串、重新 quote、拆分一笔 occurrence 或合并多笔 occurrence。
`language` 只解释原始 source，不授权任何 normalization。

`not-command` 表示 Adapter 能确定这笔 tool operation 不是命令。
Adapter 无法确定 command / not-command 时必须降低 actions coverage，不能用 `not-command` 掩盖未知。

actions 为 complete 时，必须保证全部 action occurrences 已产生，且每笔 tool operation 都有上述分类。
command source 可以结构化 opaque；这不遗漏 occurrence，但依赖 source 的 Projector 或 Assertion 必须得到 unavailable。

工具 input 若有未交代的截断、redaction 或可能隐藏字符串的 opaque subtree，actions 不能继续宣称 complete。
这条要求让工具输入的 exact-zero Assertion 不会把未知内容当作空内容。

## Batch Adapter

不能增量取得原生事件的 Adapter 可以使用 batch 工具。
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

`Turn.events` 包含 core 创建的 eval user message 与后续 Adapter events。
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

`fact` 的同 key 更新不覆写历史事件。
需要当前值的消费面使用 latest-fact projector；需要变化轨迹的消费面读取全部事件。

## Record 读取

`openRecord()` 仍返回事实层句柄，不提供选择器、聚合或报告字段。

```ts
interface AttemptHandle {
  readonly identity: AttemptIdentity;
  readonly record: RecordGraphRef;
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

`openRecord()` 只读取一次 `layout.json.head`，随后所有 handle 都固定到同一个 `RecordGraphRef`。
活动 writer 更新 head 或迟到事实产生新 Graph root 时，已打开 handle 不得静默切换；调用方重新打开才读取新版本。

第三方需要审计原始事实时可以直接读取 ObservationSet。
Report、show 与 view 不直接按事件名或 schema 分支，而是使用 projector。

## Projector

Projector 是带稳定身份的普通函数值。
它把一个 AttemptHandle 转成带 availability 和依据的中性读模型，不创建新的持久化实体。
这个名称借自 Event Sourcing/CQRS 的 Projector，但 NiceEval 采用的是只读纯函数特化；出处与差异见 [Reference](reference/README.md#projector-与-projection)。

```ts
type UnavailableReason =
  | "not-recorded"
  | "unsupported-schema"
  | "unsupported-capability"
  | "unsupported-digest"
  | "missing-object"
  | "resource-limit"
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
它只能依赖 sealed Record、显式参数和其它 Projector，不能读取当前运行条件或未登记配置。
同一 Projector 版本对相同输入必须返回相同结果。

Projector 版本用于区分派生语义，并写入明确导出的 Report artifact 元数据。
Reader 可以在当前 AttemptHandle 内 memoize 结果，但不能写磁盘缓存、增加 Record graph 引用或把 Projection 交给 Record writer。
`Availability<T>` 中的 `T` 是 Library API 类型，不是 Record schema；不兼容变化只产生新的 Projector 版本，不改写 Record。

Claim evaluator 使用 Projection 时，必须确认全部 EvidenceRef 来自当前 Record graph，再把 `target` 写成 Claim 的底层 EvidenceTarget。
Projection 自身不是 EvidenceRef，也不能成为 Claim、另一个 Record 或后续 Report 的权威输入。
evaluator 版本必须涵盖所调用 Projector 的语义版本，不能让依赖变化静默改写同一 evaluator 身份。

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
它可以登记 generator 版本与输入 Record Graph root，但不进入本地 Record graph，也不被 `openRecord()` 读取。

## Report artifact 的证据闭包

Report 导出不能靠渲染时碰巧观察到的函数调用猜依赖。
报告定义必须先枚举全部静态页面、参数化页面实例与 Projector 请求，形成确定的 Export Plan。

```ts
interface ReportExportPlan {
  report: {
    name: string;
    version: string;
    parameters: JsonValue;
  };
  inputs: readonly {
    id: string;
    recordId: string;
    graph: GraphRootRefV1;
  }[];
  projections: readonly {
    id: string;
    attempt: { inputId: string; attemptId: string };
    projector: { name: string; version: string };
    parameters?: JsonValue;
  }[];
  pages: readonly {
    route: string;
    projectionIds: readonly string[];
  }[];
}
```

页面渲染只消费 plan 中已经求值的 Projection。
组件不能在条件分支、客户端懒加载或网络回调里打开新的 Record 查询。
宿主对全部 available 结果的 `basedOn` 求传递闭包，再分别写出 Export Plan、entrypoints、页面资源与 evidence closure typed object。
这些对象各自成为 Graph node，并通过 strong edge 进入新的 sealed Report Graph root，不扩张 bootstrap。

每个 EvidenceRef 还必须携带 source Graph root 到 target 的 membership proof。
导出器保存 proof 路径上的原始 GraphRootV1、GraphNodeV1 与 EdgePageV1 bytes，再用 wrapper node 把它们纳入 Report 强闭包。
Report reader 校验这些 bytes 的 DescriptorV1 与相邻引用；无关 sibling payload 不需要随报告复制。

增加页面、Projector、报告参数、资源类型或 evidence 种类只增加 node、strong edge 与 typed payload。
旧 v2 reader 可以校验并复制未知 node 的完整强闭包；新 reader 读取缺少这些对象的旧 artifact 时，只缺对应功能。
已有 payload media type 可以增加语义独立、缺失含义明确的可选字段。
字段不能改名、删除、改类型或改变语义；需要不兼容的业务形状时使用新的 media type，不升级容器。

闭包不是 artifact 文件名白名单。
一个 trace Projection 引用了 telemetry stream，就必须复制该 stream 的全部 segment，以及事件引用的全部 blob。
一个报告没有执行 trace Projector，则它的 Report artifact 不需要携带 trace；这不改变本地 Record，也不把 trace 定义成可牺牲证据。

Record 已采集某项依据，但导出时打不开、校验失败或复制失败，整次导出必须失败。
只有原 Record 本来就没有采集该项事实时，Projector 才能返回 `not-recorded`，报告再按自己的缺失口径呈现。
导出宿主不能把发布故障伪装成 `not-recorded`。

Report artifact 中的 evidence 文件沿用 Record 的 16 MiB segment 与 blob chunk 上限。
宿主可以在完成消息里报告文件数和总字节数，但不能为了满足总量目标自动删掉闭包中的依据。
HTML 只保存有界 Projection 与 evidence 引用；trace 等大型证据从分段文件按需加载，不在构建时重新合并进单个页面。
