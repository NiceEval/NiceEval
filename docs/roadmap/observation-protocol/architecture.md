# 运行观测协议 —— 架构

## 信息模型先于文件模型

Writer、Live 和 Report 在接收一个值前都要先判断它属于哪类信息。

| 信息 | 判据 | 例子 |
|---|---|---|
| Provenance | 解释运行与求值所需，不能用读取时的环境替代 | 输入清单、Agent 与 model、配置、源码摘要、算法版本 |
| Observation | 运行后无法重新取得，只陈述发生了什么 | Agent 事件、命令输出、workspace 变化、耗时、实际账单、错误 |
| Claim | 当时由 evaluator 根据依据作出的结论 | Assertion、judge、Verdict、估算成本、证据覆盖结论 |
| Projection | Projector 从同一份 Record 确定性计算出的中性读模型 | 执行树、时间树、usage、diff、Assertion 与 Verdict 读面 |

Projector 取名自 event sourcing 中的 projection：它把完整事实投射成一个消费面需要的有限视图。
Projector 是函数，Projection 是这次函数调用产生的普通值；两者都不是 Record 实体。
本契约只把 Projector 输出称为 Projection；Reducer 输出称为 snapshot，Reports 输出称为计算结果或 artifact。

只有前三类进入 Record 的权威业务内容；manifest 另行保存稳定身份、父子关系、封口状态与文档引用。
Projection 默认只存在于读取进程的内存中，Record writer 不写 Projection 文档，manifest 也不提供 Projection 引用或缓存槽位。

面向读取的可重建结果只有以下两种落盘例外，且都位于 Record 之外：

| 可重建输出 | 落盘目的 | 必须携带 | 失效处理 |
|---|---|---|---|
| 运行期 snapshot 或索引 | 支持活动 Session 附着、进程恢复和有界读取 | reducer 版本与 stream basis | 删除并从 durable 事件重建 |
| 用户导出的 Report artifact | 保存一次明确请求的交付结果 | generator 版本与输入 Record 摘要 | 重新导出，不回写 Record |

写入磁盘的副本不能作为 Observation、Claim 的 `basedOn` 或其它 Projector 的事实输入。
一个 Projector 可以在内存中调用另一个 Projector，但必须继续从 Record 求值并合并底层依据。
Report artifact 可以独立定义面向消费者的格式，但改变该格式只升级 Reports，不升级 Record。

## Observation envelope

所有 durable 事件共用一个稳定 envelope。
事件业务字段只存在于自己的 `body` schema；新增事件种类不会扩大其它事件或 Run manifest 的 schema。

```ts
interface ObservationEvent<T extends JsonValue = JsonValue> {
  format: "niceeval.observation";
  id: string;
  name: string;
  schema: string;
  stream: {
    id: string;
    sequence: number;
  };
  scope: {
    sessionId: string;
    invocationId?: string;
    runId?: string;
    experimentId?: string;
    attemptId?: string;
    evalId?: string;
    turnId?: string;
  };
  time: {
    observedAt: string;
    monotonicOffsetNs: string;
    occurredAt?: string;
  };
  source: {
    component: string;
    version?: string;
    adapter?: string;
    mapperVersion?: string;
  };
  correlation?: {
    parentEventId?: string;
    traceId?: string;
    spanId?: string;
  };
  body: T;
  truncated?: Array<{ path: string; originalBytes: number }>;
}
```

`name` 是开放、带命名空间的语义名，例如 `niceeval.attempt.started`、`niceeval.agent.operation.started`。
`schema` 标识该事件 body 的独立版本，例如 `niceeval.agent.operation.started/1`。

`stream.id` 标识一个可独立封口和重放的流。
Attempt 事件使用 Attempt stream；Run 级 setup、teardown 与共享 activity 使用 Run stream；Session 调度使用 Session stream。
每个 stream 的 `sequence` 从零连续递增，顺序由 Observation Hub 收到事件的次序决定，不用墙钟推断并发事件的先后。

`observedAt` 是 Hub 接收事件时的墙钟，`monotonicOffsetNs` 是相对 stream 起点的本地单调时钟。
`occurredAt` 只在外部协议可信地给出原始时间时存在，不参与 NiceEval 事件排序。

`source` 交代谁产生或映射了事件。
Adapter 从原生 transcript 或 SDK 事件归一时写入 Adapter 身份和 mapper 版本；没有保留原始输入时，归一化事件本身就是捕获到的 Observation，不能在读取时假装可重新映射。

## 事件身份与版本

同一 `id` 只能对应同一份规范化字节。
Hub 重复收到字节相同的事件时按幂等重放处理；相同 ID 对应不同内容是协议错误，必须产生结构化 Diagnostic。

持久化事件不是封闭 TypeScript union。
Reader 用 `(name, schema)` 查找 decoder；不知道的事件仍以 opaque event 返回，并保留完整 envelope 与 body。
一个 projector 不认识某事件时只降低自己的 availability，不得让无关 projector 或整份 Run 失效。

事件 schema 在以下情况升级自身版本：

- 字段语义改变。
- 新增省略时没有明确语义的必填字段。
- 状态词表或单位改变。
- 既有字段的身份、排序或关联含义改变。

新增事件种类、增加省略时语义明确的可选字段、增加 projector 或改变 UI 不升级 Record 容器版本。

## 事件域

| 域 | durable 事件 | 说明 |
|---|---|---|
| Runner | Session、Run、Attempt、phase 与 activity 边界 | 生命周期阶段只使用 `LifecyclePhase` |
| Agent | Turn、message、operation、Skill、HITL、compaction 与 Agent error | 由 Adapter 归一，按 Turn 声明证据完整性 |
| Sandbox | command、退出状态、stdout/stderr、workspace change 与 cleanup | 大值由 Record sink 统一截断并显式标记 |
| Telemetry | 实际收到的 OTLP log、span 与采集 Diagnostic | 原始 name/attributes 保留，canonical kind 是投影 |
| Usage | provider 或 Agent 实际返回的 token 与账单 | 估算成本不属于 Observation |

短期 `progress`、spinner tick、heartbeat 与 renderer redraw 属于 ephemeral 反馈。
它们使用独立的 live stream，不占用 durable stream 的 sequence。
这些反馈可以进入 live snapshot 的 transient overlay，也可以被合并或丢弃，但不进入 Record，不能改变权威 reducer 的结果。

Assertion、judge、Verdict、估算成本与证据覆盖聚合不伪装成 Observation。
它们进入 Claim，并通过明确依据引用 Observation 或 Provenance。

## Agent 是增量事件生产者

Agent 的一轮执行是一个只向前推进的事件生产过程。
Adapter 可以逐条产出行为事件，最后产出且只产出一个 Outcome；Outcome 后不能再产出事件。

```text
idle ── send ──> emitting ── outcome.completed ──> completed
                       ├──── outcome.failed ─────> failed
                       └──── outcome.waiting ────> waiting

waiting ── send(responses, same AgentSession) ──> emitting
```

`waiting` 是一轮的正常 Outcome，不是半写入的状态快照。
下一次回答沿用同一 `AgentSession`，产生新的 Turn stream；历史事件不可覆盖。

Batch Adapter 可以在原生调用结束后一次产出全部事件。
Streaming Adapter 在事件发生时立即产出；两者进入 Hub 后具有相同的 Record、断言和 live 语义。

Runner 自己的生命周期不是 Agent 状态机的一部分。
Agent 不能伪造 Attempt phase，Runner 也不从 Agent 文案猜工具、消息或 HITL 事件。

## Observation Hub 与 sink

Observation Hub 是一次 Invocation 内唯一的事件入口。
它依次完成 scope 校验、身份与 sequence 分配、事件注册校验，再把事件交给各 sink。

| sink | 输入 | 交付保证 | 失败影响 |
|---|---|---|---|
| Reducer | durable 生命周期事件 | 同步按 sequence 折叠 | 违反 reducer 不变量是运行错误 |
| Record | Provenance、全部 durable Observation 与 Claim | Attempt 封口前写完并校验 | Record 不完整，Invocation completion 不得报告 complete |
| Live | 公开允许的 durable 子集与有界 ephemeral progress | 可断线、可重连、可从 snapshot 恢复 | 不改变 Attempt 或 Verdict |
| OTel exporter | 可安全导出的 Observation | supplemental，允许批处理 | 产生 Diagnostic，不改变 Attempt 或 Verdict |

durable 事件不能因消费者慢而丢弃或合并。
Hub 对 durable sink 施加 backpressure；ephemeral 反馈使用独立的有界缓冲，满时保留最新值。

Producer 与断言在内存中读取未截断事件。
字节进入 Record 或离开 NiceEval 进程前，Record serialization policy 对 Runner 已知凭据做精确替换，再按事件 schema 的预算截断大值并写入 `truncated`。
Record、Live 和 OTel exporter 共享这份转写后的 durable envelope，不能各自实现脱敏或截断规则。

Attempt 只有在 finalizer 完成、事件流封口、Claim 写入且 Record sink 确认后才成为完整记录。
进程中断留下的未封口 stream 保留为 incomplete evidence；Reader 不补造 Outcome、Verdict 或缺失事件。

## Reducer 与 snapshot

Reducer 是纯函数，输入为上一状态和下一条事件，输出为新状态。
它不读取墙钟、不访问文件系统，也不知道 human、JSON 或 Web renderer。

```ts
type Reducer<State> = (
  state: State,
  event: ObservationEvent,
) => State;
```

Session 索引、TTY 面板、`watch` snapshot 与 `exp --json` 共享同一个运行状态 reducer。
Session writer 只序列化 reducer 的有界 snapshot，不再实现 queued、running、waiting 或终态计数迁移。
Live renderer 可以在这份权威状态上叠加 ephemeral progress 的最新值，但 overlay 不能修改 phase、计数或终态。

snapshot 必须声明它折叠到哪个 stream sequence。
附着者先取得 snapshot 与 cursor，再只接收 cursor 之后的事件，避免 snapshot 与 tail 之间丢事件或重复计算。

## Provenance 与 Claim

Provenance 保存复核运行所需、但不能用读取时环境替代的输入：

- Run、Attempt、Experiment、Eval、Session 与 Turn 身份。
- 实际使用的 Agent、Adapter、model、reasoning effort 与 provider。
- 运行配置、Eval 源码、判据、Sandbox 输入与安装清单。
- strict、judge、价格表和 Claim evaluator 等求值算法身份。
- Adapter 声明及每 Turn 实际形成的证据覆盖。

哈希值是输入在指定算法下的派生标识，不是 Projector 读模型。
Record 可以用哈希寻址或校验文档，但同时保存完整输入与算法身份；configHash、fingerprint 或索引值不能代替输入本身。

```ts
interface Claim<T extends JsonValue = JsonValue> {
  id: string;
  kind: string;
  schema: string;
  value: T;
  evaluator: {
    name: string;
    version: string;
    model?: string;
  };
  basedOn: Array<
    | { kind: "event"; streamId: string; eventId: string }
    | { kind: "document"; key: string; sha256: string; selector?: string }
    | { kind: "claim"; claimId: string }
  >;
  producedAt: string;
}
```

确定性 Assertion 也保存为 Claim。
Reader 可以使用相同 evaluator 复核，但不能用读取时规则静默覆盖历史结论。
Judge Claim 保存模型返回与 judge 身份；Verdict Claim 引用 Assertion、Judge、致命错误和 strict 输入，不复制它们。

Claim 可以依据内存中的完整事件求值，而 Record 中的同一事件可能带 `truncated` 或脱敏标记。
这种 Claim 仍保存当时结论，但读取面必须把复核能力标为 truncated 或 redacted，不能宣称持久化证据完整。

provider 返回的实际账单是 Observation。
NiceEval 根据 usage 和价格表计算的金额是 Claim，必须引用 usage 事件、价格表与计价算法。

## Record 容器

`run.json` 与 `attempt.json` 只保存稳定身份、父子关系、封口状态和文档引用。
它们不承载报告摘要、总用量、通过数或宽配置对象。

```ts
type DocumentRef =
  | {
      state: "open";
      key: string;
      schema: string;
      path: string;
      mediaType: "application/json" | "application/x-ndjson";
    }
  | {
      state: "sealed";
      key: string;
      schema: string;
      path: string;
      mediaType: "application/json" | "application/x-ndjson";
      sha256: string;
      bytes: number;
    };

interface RunManifest {
  format: "niceeval.record";
  schema: "niceeval.record/2";
  state: "open" | "sealed";
  producer: { name: string; version?: string; commit?: string };
  runId: string;
  experimentId: string;
  attempts: Array<{
    attemptId: string;
    evalId: string;
    attempt: number;
    path: string;
  }>;
  provenance: Record<string, DocumentRef>;
  observationStreams: Record<string, DocumentRef>;
  claims: Record<string, DocumentRef>;
}
```

Attempt manifest 使用相同的 `format`、`schema`、`state` 与文档引用字段，并额外保存 `runId`、`attemptId`、`evalId` 和 Attempt 序号。
Run manifest 的 attempts 只负责指向 Attempt manifest，不把 Attempt 文档复制到 Run 层。

Observation stream 使用 NDJSON，每行一个完整 envelope。
Writer 开始写 stream 时登记 open ref，封口后计算摘要并替换成 sealed ref。
Reader 发现缺行、sequence gap、摘要错误或 open ref 时，把对应能力标为不可用。

sealed manifest 只能引用 sealed document。
open manifest 允许读取已经完整落盘的事件，但不能产生完整 Verdict、携带资格或 terminal snapshot。

容器版本只在身份、父子关系、封口规则或文档引用无法继续解析时改变。
Provenance、Observation 与 Claim 文档按自己的 schema 演进，不共享一个 Run 级业务版本。

Run 与 Attempt manifest 不允许增加 Projection、Report 摘要、统计宽表或它们的引用。
`publish()`、结果携带与 Record 转换因此只处理 Provenance、Observation、Claim 和容器关系，不需要理解任何 Report 字段。

## 既有格式读取

Reader 为每一种既有 Record schema 使用隔离 decoder，再把可证明的信息归入 Provenance、Observation 与 Claim。
decoder 不能根据读取时配置补造历史输入，也不能为无法指出依据的结论伪造 `basedOn`。

既有字段能确认结论、但不能恢复依据时，decoder 产生明确的 opaque Claim。
缺少新事件只让依赖它的 projector 返回 unavailable，不让其它 artifact 或整份 Run 失效。

离线转换若存在，只能写入新目录并保留原 Record。
转换生成的文档必须声明来源 schema 和 decoder 版本；转换不会把推测升级成 Observation。

## OTel 边界

OTel 是补充遥测协议，不是 NiceEval 的状态机或 Record writer。

OTLP 接收器保存实际收到的原始 span 名、attributes、时间与父子关系。
Adapter mapper 可以产生 canonical GenAI kind 供瀑布图和跨 Agent 对比，但 mapper 结果必须带版本，并且属于可重算 Projection。

行为树始终以 Agent 标准事件为骨架。
span 只能通过显式 correlation ID 叠加时间和父子关系；无法唯一关联的 span 作为 telemetry-only 节点保留，不按名称、文本或时间接近度猜测。

没有 OTel 时，行为事件、Runner phase、执行错误和 Verdict 保持不变，只把细粒度 timing 标为 unavailable。
OTel 配置、导出或采集失败产生 Diagnostic，不把 Attempt 改成 errored。

NiceEval Observation 可以映射成 OTel LogRecord 或 span event 向外导出。
导出映射不得反向决定内部事件 body，也不能要求 Record 跟随外部 semantic convention 升级容器版本。

## Report 与 projector 边界

Record reader 只验证文档、返回已知中性类型，并把未知、损坏、截断与缺失切面显式交代。
Sample 只选择 Attempt、建立比较口径和呈现覆盖。

Projector 是从 AttemptHandle 到带依据读模型的纯函数。
这里的纯函数允许读取句柄指向的 sealed Record，但不允许读取当前时间、网络、进程环境、随机数或未记录配置。
同一份 Record、同一 Projector 版本与相同参数必须得到相同结果。

Projection 没有 Record identity、封口生命周期或文档引用。
读取面按需计算，并且可以在一个 AttemptHandle 的生命周期内按 Projector 版本与参数 memoize；关闭句柄后结果即可丢弃。
执行树、时间树、usage、diff、Assertion、Verdict 与报告指标各有独立 projector；Report 不读取 manifest 字段、原始事件名或 OTel attributes。

Projection 类型属于 Library API，不是磁盘 document schema。
不兼容的读模型变化使用新的 Projector 版本；它可以继续读取同一份 sealed Record，不触发 Record decoder、转换或重写。

Claim evaluator 可以调用 Projector，但保存 Claim 时必须把 Projection 的 `basedOn` 展开为底层 Observation、Provenance 与 Claim 引用。
Claim 不能引用一个 Projection 值、Report artifact 或运行期 snapshot。
evaluator 版本必须覆盖它依赖的 Projector 语义，使依赖变化产生新的 Claim evaluator 身份。

新增 Report 时：

- 已有 Observation 或 Claim 足够时，只增加或组合 projector。
- 只改变聚合、命名、分组或图表时，只改变 Reports。
- 确实缺少无法重建的事实时，增加独立 Observation 事件 schema。
- 旧 Record 没有该事实时返回 unavailable，不使其它能力或整份 Run 失效。

Report 行、图表点、通过率、p90、汇总成本和执行树都不进入 Record 权威 schema。
用户导出的 HTML、JSON 或其它 Report artifact 写入 Reports 负责的目标位置，不登记进 Run 或 Attempt manifest。
artifact 的 generator 版本和输入摘要只解释这份交付物，不把它提升成历史事实。

## 重放不变量

1. 同一组已封口 durable 事件与同一 reducer 版本必须产生相同 snapshot。
2. Live 在终态 cursor 上的 snapshot 必须等于从 Record 重放得到的同版本 snapshot。
3. 丢失或合并 ephemeral progress 不得改变终态 snapshot、Claim 或 Verdict。
4. OTel 缺失不得改变 Agent 行为节点、执行错误和 Verdict，只允许 timing 能力降级。
5. Reader 必须保留未知事件；不知道一种事件不能让已知事件不可读。
6. Projector 升级不得改写历史 Claim，也不得要求重写原始 Observation。
7. 每条 Claim 的全部 `basedOn` 必须能解析到同一份已封口 Record；解析失败时该 Claim 不可用。
8. Record sink 未确认的 Attempt 不能作为完整结果进入 Sample。
9. Record 可读性不得依赖曾经计算出的 Projection；删除 snapshot、索引与 Report artifact 后，sealed Record 仍能重新产生同版本 Projection。
