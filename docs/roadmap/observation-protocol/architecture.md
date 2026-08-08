# 运行观测协议 —— 架构

## 信息模型先于文件模型

Writer、Live 和 Report 在接收一个值前都要先判断它属于哪类信息。

| 信息 | 判据 | 例子 |
|---|---|---|
| Provenance | 解释运行与求值所需，不能用读取时的运行条件替代 | 输入清单、Agent 与 model、配置、源码摘要、算法版本 |
| Observation | 运行后无法重新取得，只陈述发生了什么 | Agent 事件、命令输出、workspace 变化、耗时、实际账单、错误 |
| Claim | 当时由 evaluator 根据依据作出的判断 | Assertion、judge、Verdict、估算成本、证据涵盖判断 |
| Projection | Projector 从同一份 Record 确定性计算出的中性读模型 | 执行树、时间树、usage、diff、Assertion 与 Verdict 读面 |

Projector 取名自 Event Sourcing/CQRS 中从事件产生读模型的组件，直接先例与 NiceEval 的纯函数特化见 [Reference](reference/README.md#projector-与-projection)。
Projector 是函数，Projection 是这次函数调用产生的普通值；两者都不是 Record 实体。
本契约只把 Projector 输出称为 Projection；Reducer 输出称为 snapshot，Reports 输出称为计算结果或 artifact。

只有前三类进入 Record 的权威业务内容；冻结的对象图核心另行保存 typed object 引用、强依赖与封口状态。
领域 catalog 只是 Record payload 中的查询索引，不参与通用复制规则。
Projection 默认只存在于读取进程的内存中，Record writer 不写 Projection object，对象图也不提供 Projection 引用或缓存槽位。

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
事件业务字段只存在于自己的 `body` schema；新增事件种类不会扩大其它事件或 frozen core schema。

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

`stream.id` 标识一个可独立封口和重新执行的流。
Attempt 事件使用 Attempt stream；Run 级调度、setup、teardown 与共享 activity 使用 Run stream。
每个 stream 的 `sequence` 从零连续递增，顺序由 Observation Hub 收到事件的次序决定，不用墙钟推断并发事件的先后。

`observedAt` 是 Hub 接收事件时的墙钟，`monotonicOffsetNs` 是相对 stream 起点的本地单调时钟。
`occurredAt` 只在外部协议可信地给出原始时间时存在，不参与 NiceEval 事件排序。

`source` 交代谁产生或映射了事件。
Adapter 从原生 transcript 或 SDK 事件归一时写入 Adapter 身份和 mapper 版本；没有保留原始输入时，归一化事件本身就是捕获到的 Observation，不能在读取时假装可重新映射。

## 事件身份与版本

同一 `id` 只能对应同一份规范化字节。
Hub 重复收到字节相同的事件时按幂等重入处理；相同 ID 对应不同内容是协议错误，必须产生结构化 Diagnostic。

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
| Sandbox | command、退出状态、workspace change、cleanup 与 physical release | 大值由 Record sink 统一截断并显式标记 |
| Telemetry | 实际收到的 OTLP log、span 与采集 Diagnostic | 原始 name/attributes 保留，canonical kind 是投影 |
| Usage | provider 或 Agent 实际返回的 token 与账单 | 估算成本不属于 Observation |

短期 `progress`、spinner tick、heartbeat 与 renderer redraw 属于 ephemeral 反馈。
它们使用独立的 live stream，不占用 durable stream 的 sequence。
这些反馈可以进入 live snapshot 的 transient overlay，也可以被合并或丢弃，但不进入 Record，不能改变权威 reducer 的结果。

Assertion、judge、Verdict、估算成本与证据涵盖聚合不伪装成 Observation。
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
下一次回答沿用同一 `AgentSession`，产生新的 Turn stream；历史事件不可覆写。

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
事件 schema 必须把更大的完整 payload 写成 NodeRef 引用的大型对象，并让承载事件 segment 的 node 对它写 strong edge。
另一种允许形态是按事件 schema 的固定规则截断并标记；不能让一条事件独占无界文件。
这个预算只约束一条事件的编码，不限制一个 stream 能保存多少事件。

Attempt 只有在 Attempt-scoped finalizer 完成、事件流封口、Claim 写入且 Record sink 确认后才成为完整数据。
进程中断留下的未封口 stream 保留为 incomplete evidence；Reader 不补造 Outcome、Verdict 或缺失事件。

Attempt-scoped finalizer 包含 Agent teardown、已登记 cleanup 与 Sandbox lifecycle teardown。
物理 Sandbox 的 suspend / destroy 随后进入 Invocation resource completion。
release failure 不改写 Verdict Claim 或已封口 Attempt Record，但会让 Invocation completion 为 incomplete。

Run stream 用 `niceeval.sandbox.release.finished` 写入每台物理资源的终态。
body 穷尽为 `suspended`、`destroyed` 或 `managed-error`，并携带 `retentionId` 与 checkpoint kind。
Reducer 只从该事件折叠 retained 数和 resource errors，不能从 Diagnostic 文案推断资源状态。

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

Provenance 保存复核运行所需、但不能用读取时运行条件替代的输入：

- Run、Attempt、Experiment、Eval、Agent Session 与 Turn 身份。
- 实际使用的 Agent、Adapter、model、reasoning effort 与 provider。
- 运行配置、Eval 源码、判据、Sandbox 输入与安装清单。
- strict、judge、价格表和 Claim evaluator 等求值算法身份。
- Adapter 声明及每 Turn 实际形成的证据涵盖。

哈希值是输入在指定算法下的派生标识，不是 Projector 读模型。
Record 可以用哈希寻址或校验文档，但同时保存完整输入与算法身份；configHash、fingerprint 或索引值不能代替输入本身。

```ts
interface RecordGraphRef {
  recordId: string;
  graph: GraphRootRefV1;
}

type EvidenceTarget =
  | {
      kind: "event";
      stream: NodeRefV1;
      eventId: string;
    }
  | {
      kind: "object";
      node: NodeRefV1;
      selector?: {
        schema: string;
        value: JsonValue;
      };
    }
  | {
      kind: "claim";
      node: NodeRefV1;
      claimId: string;
    };

interface EvidenceRef {
  source: RecordGraphRef;
  target: EvidenceTarget;
}

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
  basedOn: EvidenceTarget[];
  producedAt: string;
}
```

持久化 Claim 的 `basedOn` 保存 `EvidenceTarget`，所属 Claim node 必须对每个 target node 写 strong edge。
Claim 不能嵌入最终 GraphRootRef；否则 Graph root 包含 Claim、Claim 又包含 Graph root digest，会形成无法构造的内容哈希自引用。

Reader 从一个明确 Graph root 读取 Claim 后，把每个 target 与当前 `RecordGraphRef` 组合成对外 `EvidenceRef`。
`recordId` 是领域身份，`graph` 是该次读取内容的权威身份；Reader 必须验证 target 确实位于该 root 的强闭包。

同一 `recordId` 可以在迟到事实进入后产生新的 Graph root；已经返回的 EvidenceRef 仍绑定原 root，不能跟随 mutable `layout.json` 漂移。
`node` 和 `stream` 保存完整 typed reference，不能只用 digest 猜 media type。
object selector 省略时引用整个 payload；存在时由开放、带版本的 `selector.schema` 解释，不能靠 reader 默认 JSON Pointer 或 byte range。
Report 可以同时消费多个 Run；只写 `recordId`、`streamId`、`claimId` 或 digest 都不能作为发布闭包的身份。

确定性 Assertion 也保存为 Claim。
Reader 可以使用相同 evaluator 复核，但不能用读取时规则静默覆写历史判断。
Judge Claim 保存模型返回与 judge 身份；Verdict Claim 引用 Assertion、Judge、致命错误和 strict 输入，不复制它们。

Claim 可以依据内存中的完整事件求值，而 Record 中的同一事件可能带 `truncated` 或脱敏标记。
这种 Claim 仍保存当时判断，但读取面必须把复核能力标为 truncated 或 redacted，不能宣称持久化证据完整。

provider 返回的实际账单是 Observation。
NiceEval 根据 usage 和价格表计算的金额是 Claim，必须引用 usage 事件、价格表与计价算法。

## Record 容器

### v2 是冻结核心上的 typed-object graph

v2 不把 Record、Report、Run、Attempt、trace、Claim 或页面种类写进 bootstrap。
它只冻结发现 Graph root、验证原始字节和遍历强依赖所需的五种结构；所有领域内容都是 Graph node 的 typed payload。
这个形状借用 OCI Content Descriptor 的 `mediaType + digest + size`，但不采用 OCI 的 image、config 或 layer 语义。

```ts
type DigestV1 = `${string}:${string}`;

interface DescriptorV1 {
  mediaType: string;
  digest: DigestV1;
  size: number; // 精确落盘字节数，且 0..RECORD_FILE_MAX_BYTES
}

type NodeRefV1 = DescriptorV1 & {
  mediaType: "application/vnd.niceeval.graph-node.v1+jcs";
};

type EdgePageRefV1 = DescriptorV1 & {
  mediaType: "application/vnd.niceeval.edge-page.v1+jcs";
};

type GraphRootRefV1 = DescriptorV1 & {
  mediaType: "application/vnd.niceeval.graph-root.v1+jcs";
};

interface StrongEdgeV1 {
  relation: string;
  target: NodeRefV1;
}

interface EdgePageV1 {
  schema: "niceeval.edge-page/1";
  edges: readonly StrongEdgeV1[];
  pages: readonly EdgePageRefV1[];
}

interface GraphNodeV1 {
  schema: "niceeval.graph-node/1";
  payload: DescriptorV1;
  dependencies: EdgePageRefV1 | null;
}

interface GraphRootV1 {
  schema: "niceeval.graph-root/1";
  state: "open" | "sealed";
  subject: NodeRefV1;
}

interface LayoutV2 {
  format: "niceeval";
  schema: "niceeval.layout/2";
  head: GraphRootRefV1;
}
```

这五种结构的字段集合、缺失语义和 JCS 字节规范永久冻结。
core decoder 遇到未知字段、重复 JSON key、非法 UTF-8、非安全整数或非规范 JCS 时必须拒绝，不能把它们当作未来 extension。
extension 只能进入新的 typed payload，不能增加 `LayoutV2`、`DescriptorV1`、`GraphNodeV1`、`EdgePageV1` 或 `GraphRootV1` 字段。

`digest` 使用 `<registered-algorithm>:<canonical-value>`，算法和值都必须通过注册表校验。
路径读取器根据校验后的算法和值生成存储路径，不能把输入字符串直接拼进文件路径。
未知算法返回 `unsupported-digest`；增加一种算法不改变 Digest 语法，也不自动要求新的容器版本。
`size` 必须是 JSON safe integer，并与取得的原始落盘字节完全相等。

`mediaType` 是小写、无参数的规范 media type；`DescriptorV1` 的三个字段共同组成 typed reference。
digest 只定位原始字节，不能单独决定这些字节的业务解释。
验证发生在解压、解密或业务读取之前；内容寻址目录布局不是 EvidenceRef 或领域身份。

压缩、加密、签名、annotation、权限与 codec 要求都不进入 DescriptorV1。
它们使用独立 wrapper、attestation 或 metadata payload，并通过 Graph node 强依赖引用所需对象。
旧 reader 不理解这类 payload 时仍能验证、遍历和原字节复制；对应 Projector 返回 `unsupported-schema` 或 `unsupported-capability`。

### 强依赖与通用遍历

`GraphNodeV1.payload` 是不参与容器遍历的 opaque bytes。
payload 依赖的 blob、chunk、index 或其它 typed object 必须成为 `dependencies` 中的 strong edge；未知 payload 内禁止藏容器 DescriptorV1。
`relation` 是开放、带命名空间的机器名，但 generic walker 不解释它并无条件跟随每一条 strong edge。

通用遍历从 `layout.json.head` 开始，依次读取 Graph root、subject node、payload、dependency page、child page 与全部 target node。
copier、verifier、GC 和 Report exporter 必须使用同一套遍历规则，不能让领域 catalog 或 decoder 另行决定哪些对象属于闭包。
walker 使用 typed reference visited set，并实施对象数、深度和累计字节预算；预算耗尽返回资源限制，不能伪装成损坏或事实未采集。

所有 core object、payload、segment、chunk 和 Report asset 都受固定的 `RECORD_FILE_MAX_BYTES = 16 * 1024 * 1024` 约束。
Edge page 可以递归分页，因此对象数量增长不会产生无界 root 或单文件。
16 MiB 为常见 Git 托管限制保留余量，也避免证据增长到发布阶段才第一次失败。

### Graph root、mutable head 与封口

`layout.json` 是唯一可变入口；`head` 始终指向不可变的 Graph root object。
活动 Record 每次 checkpoint 写新的 payload、node、edge page 和 `state: "open"` Graph root，再更新 head。
更新者必须持有 single-writer lease，或以旧 head 为条件执行原子 compare-and-swap；无条件 last-write-wins 属于协议错误。

封口时 writer 遍历并验证完整强闭包，再写 `state: "sealed"` Graph root 并更新 head。
sealed 只承诺封口时强闭包完整、原始字节通过 DescriptorV1 校验，并且该 Graph root 永不修改。
它不承诺作者真实性、内容保密、本地副本永远持有全部对象或外部存储永远在线。
签名与 timestamp 是引用 sealed Graph root 的 attestation payload；本地缺对象返回 `missing-object`，不能改写成 `open`、`not-recorded` 或 `corrupt`。

open Graph root 可以提供已经完整落盘的事实，但不能产生完整 Verdict、携带资格或 terminal snapshot。
Report artifact 只发布 sealed Graph root；失败的导出不更新 head。
迟到事实只能形成新的 Graph root，并用领域 lineage 关系连接旧版本；旧 Claim 与旧 Report 继续绑定原 Graph root。

Record、Report 和多份输入组成的 bundle 都是 subject node 的 payload media type，不是 Layout kind。
bundle subject 通过 strong edge 引用多个 Record 或 Report node；增加新的交付物种类不扩大 bootstrap。
如果 attestation 必须和被签对象一起交付，外层 bundle 同时引用原 sealed Graph root bytes 与 attestation node，签名本身不进入被签闭包。

### 领域 catalog 与 typed payload

领域 catalog 是 Record 或 Report payload 使用的查询索引，不是容器闭包算法。
它可以表达实体挂载与跨实体的有类型关系，不把 Run、Attempt、重试、携带、人工接受或跨 Run 对比限制成一棵 parent-child 树。
一个判断可以有多个 `derivedFrom` link，不需要伪造唯一 parent。

Catalog payload 若保存 NodeRef，所属 Graph node 必须同时对每个引用写 strong edge。
已知 catalog decoder 校验两边一致；generic walker 只使用 strong edge。
第三方未知 payload 可以保存领域 ID 或外部 URL，但不能把 DescriptorV1 或 NodeRef 藏在 body 中。

typed payload 使用独立 media type，例如：

- `application/vnd.niceeval.record.v1+json`
- `application/vnd.niceeval.report.v1+json`
- `application/vnd.niceeval.run.v1+json`
- `application/vnd.niceeval.attempt.v1+json`
- `application/vnd.niceeval.observation-stream-index.v1+json`
- `application/vnd.niceeval.claim.v1+json`
- `application/vnd.niceeval.report-export-plan.v1+json`
- `application/vnd.niceeval.report-entrypoints.v1+json`
- `application/vnd.niceeval.evidence-closure.v1+json`
- `application/vnd.niceeval.evidence-membership-proof.v1+json`
- `application/vnd.niceeval.chunk-index.v1+json`

新增事实、证据、页面、Report metadata 或领域关系只能增加 typed payload 或发布新的 payload media type。
同一 payload media type 只能增加语义独立、缺失时含义明确的可选字段；旧 reader 必须整对象保留原始字节。
字段参与身份、依赖、权限、Verdict 或旧字段正确性时，必须发布新的 payload media type，不能改名、删除、改类型或重定义既有字段。

### Observation stream 与大型对象

Observation stream index 通过 strong edge 指向按 sequence 排列的 NDJSON segment node。
Writer 在下一条完整 envelope 会使 segment 超过 16 MiB 时封口当前 segment，再创建一个新对象。
一条事件不能跨 segment，Reader 同时验证 event sequence、segment digest 与 index 连续性。

stream index 另存针对规范化事件序列计算的 logical digest。
这个摘要不包含 segment 边界；重新分段可以改变物理 NodeRef，但不能改变事件身份、logical digest 或 Projector 结果。

trace 使用同一种 Observation stream。
收到的每个 OTLP span 都进入 durable Observation；span 多只产生更多 segment，不能触发整类 trace 丢弃。
单个巨大 attribute 仍服从事件 schema 的值预算，并通过 `truncated` 或大型对象引用交代边界。

源码、workspace change、模型原始响应与 telemetry payload 使用 chunk-index payload。
每个叶 chunk 都有独立 node，index node 通过 strong edge 引用 chunk 与 child index；对象数量再多也不会生成无界 manifest。
Projector 按 index 顺序得到连续原始字节，分块不改变逻辑 media type 或内容摘要。

### 未知对象与 v2 演进

这次切换不读取旧 Record 或旧 Report，也不提供迁移、双写或兼容 decoder。
v2 落地后的演进则遵守以下兼容矩阵：

| 输入变化 | 旧 v2 reader | 新 v2 reader 读取旧数据 |
|---|---|---|
| 新增 metadata payload | 未知 payload 原字节保留，已知结果不变 | 缺少该 node 等价于未声明 |
| 已有 payload 增加语义独立的可选字段 | 忽略且整 node 原字节保留 | 缺失按 payload schema 解释为 absent 或 unavailable |
| 新增未知 payload media type | 验证 node 与强闭包并原字节复制，不解码 | 新功能缺 node 时返回 `not-recorded` |
| 新增 wrapper 或对象级 capability | 保留 wrapper 强闭包，只把依赖功能标为 unavailable | 旧对象按原 media type 读取 |
| 新增 Projector 或 Report 页面 | 不提供该功能，但保留全部对象 | 根据旧事实计算，缺事实则 unavailable |
| 给五种 frozen core 增加字段 | 协议违规 | 协议违规 |
| 改变已有 payload media type 的字段或语义 | 协议违规 | 协议违规 |

内容对象永不原地修改，已发布 media type 永不复用为另一种含义。
Generic copier 只按 DescriptorV1 和 strong edge 复制原始字节；它不能把未知 JSON parse 后重新序列化，否则会丢字段或改变 digest。
领域小型 JSON payload 可以使用 RFC 8785 JCS；超过 JSON 安全整数范围的计数和 offset 使用十进制字符串。

普通功能不得提出 v3。
只有 frozen bootstrap 无法读取、typed reference 无法继续解释、显式强闭包不足、Graph root 封口语义失效，或 core parser 与 object-ID 信任缺陷无法隔离时，才允许讨论新的容器版本。
每个提案必须先通过 [schema 演进防火墙](reference/schema-evolution.md#版本升级防火墙)；不能证明必须改变容器公理，就留在 v2。

### Record 发布与 Report 导出

Record 发布与 Report 导出是两种不同操作。

- `publish()` 只接受 sealed Record Graph root，并复制其可达的完整 Provenance、Observation 与 Claim 强闭包。
  它不接受按 evidence 种类排除对象的选项，也不能把已存在的 trace、diff 或源码改成缺失。
- Report 导出先生成确定的 Export Plan，再执行其中声明的全部页面实例与 Projector 请求。
  宿主收集可用 Projection 的 `basedOn`，复制这些 node 的强闭包，并写成新的 Report Graph root。

Report 还必须证明 EvidenceRef 的 target 属于它声明的 source Graph root。
导出器为每个 source 保存原 GraphRootV1 原始字节，以及从 subject 到 target 的 GraphNodeV1 与 EdgePageV1 原始路径。
这些 core bytes 分别作为 proof wrapper node 的 payload 进入 Report 强闭包；membership-proof payload 描述校验顺序。
Reader 验证每段原始字节的 DescriptorV1 和相邻引用，就能确认成员关系，不需要复制 source Record 的无关 sibling payload。

membership proof 只证明 target 位于 source graph，不宣称 Report 含有整个 source Record。
target node 自身的全部 strong closure 仍必须复制；缺少 proof、target 或 target 依赖都让导出失败。

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
Sample 只选择 Attempt、建立比较口径和呈现涵盖。

Projector 是从 AttemptHandle 到带依据读模型的纯函数。
这里的纯函数允许读取句柄指向的 sealed Record，但不允许读取当前时间、网络、进程条件、随机数或未登记配置。
同一份 Record、同一 Projector 版本与相同参数必须得到相同结果。

Projection 没有 Record identity、Graph root 生命周期或文档引用。
读取面按需计算，并且可以在一个 AttemptHandle 的生命周期内按 Projector 版本与参数 memoize；关闭句柄后结果即可丢弃。
执行树、时间树、usage、diff、Assertion、Verdict 与报告指标各有独立 projector；Report 不读取 manifest 字段、原始事件名或 OTel attributes。

Projection 类型属于 Library API，不是磁盘 document schema。
不兼容的读模型变化使用新的 Projector 版本；它可以继续读取同一份 sealed Record，不触发 Record decoder、转换或重写。

Claim evaluator 可以调用 Projector，但保存 Claim 时必须确认全部 EvidenceRef 来自当前 Record graph，并把它们展开为底层 EvidenceTarget。
Claim 不能引用一个 Projection 值、Report artifact 或运行期 snapshot。
evaluator 版本必须涵盖它依赖的 Projector 语义，使依赖变化产生新的 Claim evaluator 身份。

新增 Report 时：

- 已有 Observation 或 Claim 足够时，只增加或组合 projector。
- 只改变聚合、命名、分组或图表时，只改变 Reports。
- 确实缺少无法重建的事实时，增加独立 Observation 事件 schema。
- Record 没有采集该事实时返回 unavailable，不使其它能力或整份 Run 失效。

Report 行、图表点、通过率、p90、汇总成本和执行树都不进入 Record 权威 schema。
用户导出的 HTML、JSON 或其它 Report artifact 写入 Reports 负责的目标位置，不挂进本地 Record graph。
artifact 的 generator 版本和输入摘要只解释这份交付物，不把它提升成历史事实。

## 重新执行不变量

1. 同一组已封口 durable 事件与同一 reducer 版本必须产生相同 snapshot。
2. Live 在终态 cursor 上的 snapshot 必须等于从 Record 重新执行得到的同版本 snapshot。
3. 丢失或合并 ephemeral progress 不得改变终态 snapshot、Claim 或 Verdict。
4. OTel 缺失不得改变 Agent 行为节点、执行错误和 Verdict，只允许 timing 能力降级。
5. Reader 必须保留未知事件与未知 typed object 的原始字节；不知道一种 schema 不能让已知内容不可读。
6. Projector 升级不得改写历史 Claim，也不得要求重写原始 Observation。
7. 每条 Claim 的全部 `basedOn` 必须是完整 NodeRef，Claim node 必须写对应 strong edge；Reader 对外返回时再限定到当前 sealed Graph root。
8. Record sink 未确认的 Attempt 不能作为完整结果进入 Sample。
9. Record 可读性不得依赖曾经计算出的 Projection；删除 snapshot、索引与 Report artifact 后，sealed Record 仍能重新产生同版本 Projection。
10. Observation stream 的分段边界不得改变事件 sequence、logical digest 或任何 Projector 结果。
11. Report artifact 必须包含所有已用 Projection 的完整 `basedOn` 传递闭包；复制失败不能降级为证据未采集。
12. trace 已被采集且被报告引用时，全部 trace segment 与 blob 都属于强制发布依据。
13. Generic copier 必须按 DescriptorV1 和 strong edge 原字节复制未知对象，不能通过 JSON parse 与重新序列化搬运内容。
14. copier、verifier、GC 与 Report exporter 必须从同一 Graph root 使用同一强边遍历算法。
15. 相同 digest、不同 media type 的 typed reference 不得被 EvidenceRef、缓存或 visited set 混同。
16. `sealed` 只表示封口时强闭包完整、字节验证通过且 Graph root 不可变；真实性、本地缺对象与外部存储故障必须分别反馈。
17. 新事实、新关系、新页面、新 Projector 与新 evidence 类型不得改变五种 frozen core schema。
