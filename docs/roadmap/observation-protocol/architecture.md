# 运行观测协议 —— 架构

## 信息模型先于文件模型

Writer、Live 和 Report 在接收一个值前都要先判断它属于哪类信息。

| 信息 | 判据 | 例子 |
|---|---|---|
| Provenance | 解释运行与求值所需，不能用读取时的环境替代 | 输入清单、Agent 与 model、配置、源码摘要、算法版本 |
| Observation | 运行后无法重新取得，只陈述发生了什么 | Agent 事件、命令输出、workspace 变化、耗时、实际账单、错误 |
| Claim | 当时由 evaluator 根据依据作出的结论 | Assertion、judge、Verdict、估算成本、证据覆盖结论 |
| Projection | Projector 从同一份 Record 确定性计算出的中性读模型 | 执行树、时间树、usage、diff、Assertion 与 Verdict 读面 |

Projector 取名自 Event Sourcing/CQRS 中从事件产生读模型的组件，直接先例与 NiceEval 的纯函数特化见 [Reference](reference/README.md#projector-与-projection)。
Projector 是函数，Projection 是这次函数调用产生的普通值；两者都不是 Record 实体。
本契约只把 Projector 输出称为 Projection；Reducer 输出称为 snapshot，Reports 输出称为计算结果或 artifact。

只有前三类进入 Record 的权威业务内容；root 与 catalog 另行保存稳定身份、关系、封口状态与 typed object 引用。
Projection 默认只存在于读取进程的内存中，Record writer 不写 Projection object，Record catalog 也不提供 Projection 引用或缓存槽位。

面向读取的可重建结果只有以下两种落盘例外，且都位于 Record 之外：

| 可重建输出 | 落盘目的 | 必须携带 | 失效处理 |
|---|---|---|---|
| 运行期 snapshot 或索引 | 支持活动 Invocation 附着、进程恢复和有界读取 | reducer 版本与 stream basis | 删除并从 durable 事件重建 |
| 用户导出的 Report artifact | 保存一次明确请求的交付结果 | generator 版本与输入 Record 摘要 | 重新导出，不回写 Record |

写入磁盘的副本不能作为 Observation、Claim 的 `basedOn` 或其它 Projector 的事实输入。
一个 Projector 可以在内存中调用另一个 Projector，但必须继续从 Record 求值并合并底层依据。
Report artifact 可以独立定义面向消费者的格式，但改变该格式只升级 Reports，不升级 Record。

## Observation envelope

所有 durable 事件共用一个稳定 envelope。
事件业务字段只存在于自己的 `body` schema；新增事件种类不会扩大其它事件、Record root 或 Layout schema。

```ts
type ObservationScope =
  | {
      kind: "run";
      runId: string;
      experimentId: string;
    }
  | {
      kind: "attempt";
      runId: string;
      experimentId: string;
      attemptId: string;
      evalId: string;
      agentSessionId?: string;
      turnId?: string;
    };

interface ObservationEvent<T extends JsonValue = JsonValue> {
  format: "niceeval.observation";
  id: string;
  name: string;
  schema: string;
  stream: {
    id: string;
    sequence: number;
  };
  scope: ObservationScope;
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

durable scope 只有 Run 与 Attempt 两种穷尽形状。
Invocation 是 live channel 的聚合身份，不写入 Record；Agent Session 与 Turn 只能细分 Attempt，`turnId` 存在时必须同时存在 `agentSessionId`。

`stream.id` 标识一个可独立封口和重放的流。
Attempt 事件使用 Attempt stream；Run 级调度、setup、teardown 与共享 activity 使用 Run stream。
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
| Runner | Run、Attempt、phase 与 activity 边界 | 生命周期阶段只使用 `LifecyclePhase` |
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

序列化后的单个 Observation envelope 最大为 1 MiB。
事件 schema 必须把更大的完整 payload 写成 Descriptor 引用的大型对象，或按该 schema 的固定规则截断并标记；不能让一条事件独占无界文件。
这个预算只约束一条事件的编码，不限制一个 stream 能保存多少事件。

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

Invocation 索引、TTY 面板、`watch` snapshot 与 `exp --json` 共享同一个运行状态 reducer。
Invocation writer 只序列化 reducer 的有界 snapshot，不再实现 queued、running、waiting 或终态计数迁移。
Live renderer 可以在这份权威状态上叠加 ephemeral progress 的最新值，但 overlay 不能修改 phase、计数或终态。

snapshot 必须声明它折叠到哪个 stream sequence。
附着者先取得 snapshot 与 cursor，再只接收 cursor 之后的事件，避免 snapshot 与 tail 之间丢事件或重复计算。

## Provenance 与 Claim

Provenance 保存复核运行所需、但不能用读取时环境替代的输入：

- Run、Attempt、Experiment、Eval、Agent Session 与 Turn 身份。
- 实际使用的 Agent、Adapter、model、reasoning effort 与 provider。
- 运行配置、Eval 源码、判据、Sandbox 输入与安装清单。
- strict、judge、价格表和 Claim evaluator 等求值算法身份。
- Adapter 声明及每 Turn 实际形成的证据覆盖。

哈希值是输入在指定算法下的派生标识，不是 Projector 读模型。
Record 可以用哈希寻址或校验文档，但同时保存完整输入与算法身份；configHash、fingerprint 或索引值不能代替输入本身。

```ts
type Digest = `${string}:${string}`;

type EvidenceRef =
  | {
      kind: "event";
      recordId: string;
      streamId: string;
      eventId: string;
    }
  | {
      kind: "object";
      recordId: string;
      digest: Digest;
      selector?: string;
    }
  | {
      kind: "claim";
      recordId: string;
      claimId: string;
    };

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
  basedOn: EvidenceRef[];
  producedAt: string;
}
```

`recordId` 限定 EvidenceRef 的权威范围。
Report 可以同时消费多个 Run；只写 `streamId`、`claimId` 或文档 key 会在不同 Record 之间发生碰撞，不能作为发布闭包的身份。

确定性 Assertion 也保存为 Claim。
Reader 可以使用相同 evaluator 复核，但不能用读取时规则静默覆盖历史结论。
Judge Claim 保存模型返回与 judge 身份；Verdict Claim 引用 Assertion、Judge、致命错误和 strict 输入，不复制它们。

Claim 可以依据内存中的完整事件求值，而 Record 中的同一事件可能带 `truncated` 或脱敏标记。
这种 Claim 仍保存当时结论，但读取面必须把复核能力标为 truncated 或 redacted，不能宣称持久化证据完整。

provider 返回的实际账单是 Observation。
NiceEval 根据 usage 和价格表计算的金额是 Claim，必须引用 usage 事件、价格表与计价算法。

## Record 容器

### v2 是 typed-object 容器

v2 不把 Run、Attempt、trace、Claim 或 Report 页面做成根 manifest 的字段。
它只定义一个固定入口和一种内容描述符；所有领域内容都是描述符指向的独立 typed object。
这个形状借用 OCI Content Descriptor 的 `mediaType + digest + size`，但不采用 OCI 的 image、config 或 layer 语义。

```ts
type CapabilityId = `${string}/${number}`;

interface Descriptor {
  mediaType: string;
  artifactType?: string;
  digest: Digest;
  size: number; // 精确落盘字节数，且 <= RECORD_FILE_MAX_BYTES
  requires?: readonly CapabilityId[];
  annotations?: Readonly<Record<string, string>>;
}

interface LayoutV2 {
  format: "niceeval";
  schema: "niceeval.layout/2";
  kind: "record" | "report";
  root: Descriptor;
  requiredCapabilities?: readonly CapabilityId[];
  annotations?: Readonly<Record<string, string>>;
}
```

`digest` 自带算法名，例如 `sha256:<hex>`；算法不能靠 reader 的当前默认值猜。
`size` 和 `digest` 总是描述取得的原始落盘字节，验证发生在解压、解密或业务解析之前。
`mediaType` 描述落盘表示；使用压缩或其它 wrapper 时，`artifactType` 标明解码后的逻辑类型。
对象按 digest 放进内容寻址仓库，目录布局由 digest 确定，不进入领域引用身份。

`annotations` 只允许展示和检索 metadata，key 必须带命名空间。
annotation 不能改变解码、完整性、权限、Verdict 或其它已知字段的含义，旧 reader 可以安全忽略它。

`LayoutV2.requiredCapabilities` 只声明无法安全解析 root、验证完整性或判断封口时所需的能力。
压缩、加密和具体 typed object decoder 属于 `Descriptor.requires`；不支持时只让该对象及依赖它的 Projector unavailable。
`kind: "record"` 的 root media type 固定为 `application/vnd.niceeval.record-root.v1+json`。
`kind: "report"` 则固定为 `application/vnd.niceeval.report-root.v1+json`；两者的 catalog 必须指向已知 Catalog page media type。

### Catalog 与领域关系

root 只保存对象身份、封口状态和一个有界 catalog 入口。
Catalog page 同时表达实体挂载的对象与跨实体的有类型关系，不把世界限制成一棵 parent-child 树。

```ts
interface EntityRef {
  kind: string;
  id: string;
}

type CatalogTarget =
  | { kind: "object"; object: Descriptor }
  | { kind: "entity"; entity: EntityRef };

interface CatalogEntryV1 {
  subject: EntityRef;
  relation: string;
  target: CatalogTarget;
}

interface CatalogPageV1 {
  entries: readonly CatalogEntryV1[];
  children?: readonly Descriptor[];
}

interface RecordRootV1 {
  recordId: string;
  state: "open" | "sealed";
  catalog: Descriptor;
}

interface ReportRootV1 {
  reportId: string;
  state: "sealed";
  catalog: Descriptor;
}
```

`layout.json` 是唯一按原子替换更新的入口；它始终指向一份不可变 root object。
活动 Record 每次 checkpoint 写新 catalog page 与 `state: "open"` root，再原子替换入口中的 root Descriptor。
封口时 writer 先验证 root 可达的全部对象与引用，再写 `state: "sealed"` root 并原子替换入口。
open root 可以提供已经完整落盘的事实，但不能产生完整 Verdict、携带资格或 terminal snapshot。
Report artifact 只有 sealed root；失败的导出不发布新的入口。

`kind` 与 `relation` 都是开放、带命名空间的机器名。
Run 包含 Attempt、重试来源、携带、人工接受、跨 Run 对比与 Claim 依据都通过关系表达。
一个结论可以有多个 `derivedFrom` link，不需要伪造唯一 parent。

Catalog page 与它的 child page 都是普通 Descriptor，因此无界集合能递归分页。
根文件、catalog page、index、segment、chunk 和 Report asset 都受固定的 `RECORD_FILE_MAX_BYTES = 16 * 1024 * 1024` 约束。
16 MiB 为常见 Git 托管限制保留余量，也避免证据增长到发布阶段才第一次失败。

未知领域 object 必须是叶对象。
它依赖的其它 object 必须通过 catalog relation 或容器已知的 chunk-index 声明，不能把 Descriptor 藏进只有业务 decoder 才看得懂的 payload。
因此 generic copier 不解码未知业务对象，也能遍历和复制完整依赖闭包。

typed object 使用独立 media type，例如：

- `application/vnd.niceeval.run.v1+json`
- `application/vnd.niceeval.attempt.v1+json`
- `application/vnd.niceeval.observation-stream-index.v1+json`
- `application/vnd.niceeval.claim.v1+json`
- `application/vnd.niceeval.report-export-plan.v1+json`
- `application/vnd.niceeval.report-entrypoints.v1+json`
- `application/vnd.niceeval.evidence-closure.v1+json`
- `application/vnd.niceeval.chunk-index.v1+json`

新增事实、证据、页面或 Report metadata 只能增加 typed object、namespaced relation、annotation 或语义独立的可选字段。
可选字段只有在移除后不改变任何旧字段的含义和正确性时才能沿用同一 media type。
它们不能给 `LayoutV2`、Descriptor 或 root 增加业务字段。

### Observation stream 与大型对象

Observation stream index 指向按 sequence 排列的 NDJSON segment Descriptor。
Writer 在下一条完整 envelope 会使 segment 超过 16 MiB 时封口当前 segment，再创建一个新对象。
一条事件不能跨 segment，Reader 同时验证 event sequence、segment digest 与 index 连续性。

stream index 另存针对规范化事件序列计算的 logical digest。
这个摘要不包含 segment 边界；重新分段可以改变物理 Descriptor，但不能改变事件身份、logical digest 或 Projector 结果。

trace 使用同一种 Observation stream。
收到的每个 OTLP span 都进入 durable Observation；span 多只产生更多 segment，不能触发整类 trace 丢弃。
单个巨大 attribute 仍服从事件 schema 的值预算，并通过 `truncated` 或大型对象引用交代边界。

源码、workspace change、模型原始响应与 telemetry payload 使用 chunk-index object。
每个叶 chunk 都有独立 Descriptor，index 本身也能递归分页；对象数量再多也不会生成无界 manifest。
Projector 按 index 顺序得到连续原始字节，分块不改变逻辑 media type 或内容摘要。

### 未知对象与 v2 演进

这次切换不读取旧 Record 或旧 Report，也不提供迁移、双写或兼容 decoder。
v2 落地后的演进则遵守以下兼容矩阵：

| 输入变化 | 旧 v2 reader | 新 v2 reader 读取旧数据 |
|---|---|---|
| 新增 namespaced annotation | 忽略，已知结果不变 | 字段缺失等价于未声明 |
| 已有 typed object 增加语义独立的可选字段 | 忽略且原字节保留 | 缺失按 schema 声明解释为 absent 或 unavailable |
| 新增未知 typed object | 校验、列举并原字节复制，不解码 | 新功能缺对象时返回 `not-recorded` |
| 新增对象级 capability | 只把该对象标为 `unsupported-capability` | 旧对象按原能力读取 |
| 新增 Projector 或 Report 页面 | 不提供该功能，但保留全部对象 | 根据旧事实计算，缺事实则 unavailable |
| 改变已有 media type 的字段或语义 | 协议违规 | 协议违规 |

sealed object 永不原地修改，已发布 media type 永不复用为另一种含义。
同一 media type 可以增加具有明确缺失语义的可选字段；不能删除、改名、改类型或重定义既有字段。
Generic copier 只按 Descriptor 复制原始字节；它不能把未知 JSON parse 后重新序列化，否则会丢字段或改变 digest。
小型 JSON index 使用 RFC 8785 JCS 规范化；超过 JSON 安全整数范围的计数和 offset 使用十进制字符串。

普通功能不得提出 v3。
只有 root 入口、Descriptor 寻址、对象图遍历、可信 object ID 或封口完整性无法继续按 v2 解释时，才允许讨论新的容器版本。
每个提案必须先通过 [schema 演进防火墙](reference/schema-evolution.md#版本升级防火墙)；不能证明必须改变容器公理，就留在 v2。

### Record 发布与 Report 导出

Record 发布与 Report 导出是两种不同操作。

- `publish()` 复制选中 Record root 可达的完整 Provenance、Observation 与 Claim 对象图。
  它不接受按 evidence 种类排除对象的选项，也不能把已存在的 trace、diff 或源码改成缺失。
- Report 导出先生成确定的 Export Plan，再执行其中声明的全部页面实例与 Projector 请求。
  宿主收集可用 Projection 的 `basedOn`，复制这些引用的传递闭包，并写成 Report catalog。

Report 根本没有消费某类事实时，导出物可以不带该事实。
一旦 Projector 引用了 stream、Claim、Provenance 或大型对象，导出就必须复制完整闭包；大小不能成为删除依据。
引用复制失败时整次导出失败，不能把发布故障伪装成运行时未采集。

HTML 只内嵌有界 Projection。
大型 trace、diff 与源码保持为 content-addressed segment 或 chunk，由页面按需加载，不能重新拼成超大单文件。
导出可以报告总字节数，但不设置会静默删证据的总量预算。

## OTel 边界

OTel 是补充遥测协议，不是 NiceEval 的状态机或 Record writer。

OTLP 接收器保存实际收到的原始 span 名、attributes、时间与父子关系。
Adapter mapper 可以产生 canonical GenAI kind 供瀑布图和跨 Agent 对比，但 mapper 结果必须带版本，并且属于可重算 Projection。

trace Projector 引用构成结果的全部 telemetry Observation 与外部 payload。
Report 使用这份 Projection 时，导出闭包必须携带这些依据的全部 segment 和 blob；不能只保存瀑布图节点摘要。

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
- Record 没有采集该事实时返回 unavailable，不使其它能力或整份 Run 失效。

Report 行、图表点、通过率、p90、汇总成本和执行树都不进入 Record 权威 schema。
用户导出的 HTML、JSON 或其它 Report artifact 写入 Reports 负责的目标位置，不登记进本地 Record catalog。
artifact 的 generator 版本和输入摘要只解释这份交付物，不把它提升成历史事实。

## 重放不变量

1. 同一组已封口 durable 事件与同一 reducer 版本必须产生相同 snapshot。
2. Live 在终态 cursor 上的 snapshot 必须等于从 Record 重放得到的同版本 snapshot。
3. 丢失或合并 ephemeral progress 不得改变终态 snapshot、Claim 或 Verdict。
4. OTel 缺失不得改变 Agent 行为节点、执行错误和 Verdict，只允许 timing 能力降级。
5. Reader 必须保留未知事件与未知 typed object 的原始字节；不知道一种 schema 不能让已知内容不可读。
6. Projector 升级不得改写历史 Claim，也不得要求重写原始 Observation。
7. 每条 Claim 的全部 `basedOn` 必须能解析到同一份已封口 Record；解析失败时该 Claim 不可用。
8. Record sink 未确认的 Attempt 不能作为完整结果进入 Sample。
9. Record 可读性不得依赖曾经计算出的 Projection；删除 snapshot、索引与 Report artifact 后，sealed Record 仍能重新产生同版本 Projection。
10. Observation stream 的分段边界不得改变事件 sequence、logical digest 或任何 Projector 结果。
11. Report artifact 必须包含所有已用 Projection 的完整 `basedOn` 传递闭包；复制失败不能降级为证据未采集。
12. trace 已被采集且被报告引用时，全部 trace segment 与 blob 都属于强制发布依据。
13. Generic copier 必须按 Descriptor 原字节复制未知对象，不能通过 JSON parse 与重新序列化搬运 sealed 内容。
14. 新事实、新关系、新页面、新 Projector 与新 evidence 类型不得改变 `LayoutV2`、Descriptor 或 root schema。
