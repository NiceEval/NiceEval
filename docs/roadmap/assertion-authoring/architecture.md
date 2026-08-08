# Assertion 作者面 —— Architecture

Assertion collector 仍把值 matcher、scope assertion、Sandbox evidence 与 Judge 折叠成 `AssertionResult[]`。
本主题收紧输入快照、scope provenance、logical occurrence 与求值边界，不增加第五种 Verdict。

## 数据建模

```text
Attempt
├─ Assertion collector
│  ├─ registered assertion × N
│  └─ frozen AssertionResult × N
└─ Agent session × N
   └─ logical Turn × N
      ├─ Turn outcome
      ├─ resolved EvidenceCoverage
      └─ StreamEvent × N
         └─ logical operation occurrence × N
```

registered assertion 保存 selector、matcher snapshot、handle 配置与求值状态。
logical occurrence 只在单个 session 的标准事件中派生。
Record 保存每个 Turn 的原始 outcome、证据完整度与事件，使 scope assertion 的依据不退化成 attempt 级最差摘要。

## `AssertionResult`

```ts
type AssertionScope =
  | { readonly kind: "attempt" }
  | {
      readonly kind: "session";
      readonly session: string;
      readonly through?: string;
    }
  | {
      readonly kind: "turn";
      readonly turn: string;
    };

type AssertionEvaluatorRef =
  | { readonly kind: "llm"; readonly executionId: string }
  | { readonly kind: "agent"; readonly executionId: string };

interface AssertionBase {
  /** 最终人读标题。 */
  readonly name: string;
  /** 标题由框架摘要还是作者输入产生。 */
  readonly nameKind: "default" | "author";
  /** matcher / Judge evaluator 摘要。 */
  readonly detail?: string;
  readonly scope: AssertionScope;
  readonly groupPath?: readonly string[];
  readonly severity: "gate" | "soft";
  readonly stopOnFailure?: true;
  readonly optional?: true;
  readonly loc?: SourceLoc;
  readonly sourceOrder: number;
  readonly pointsAvailable?: number;
  readonly evaluator?: AssertionEvaluatorRef;
}

type AssertionResult =
  | (AssertionBase & {
      readonly outcome: "passed" | "failed";
      readonly score: number;
      readonly threshold?: number;
      readonly expected?: string;
      readonly received?: string;
      readonly evidence?: string;
      readonly points?: number;
    })
  | (AssertionBase & {
      readonly outcome: "unavailable";
      readonly reason: string;
      readonly evidence?: string;
    });
```

`scope` 是 machine-readable provenance。
`name` 不再内嵌 `turn2 ·` 或 `session2 through session2/turn1 ·`。
turn 与 session token 都按 opaque equality 使用，读取面不能拆字符串推导层级。

session receiver 登记 Assertion 时，把当时最后一个 returned logical Turn 写入 `through`；零 turn session 省略它。
selector 与 `through` 一同冻结，因此同一 session 在不同时间取得的 snapshot 可以区分。

内建 matcher 没有 `.label()` 时写 `nameKind: "default"`。
`.label()`、`defineAssertion.name` 与 Judge `name` 写 `nameKind: "author"`。
`nameKind` 让读取面分清作者恰好把 label 写成 matcher 文本的情形，不需要重复保存 label 字符串。
label 允许重复；它不能参与跨运行 join 或唯一性校验。

内建 matcher 的 `detail` 是默认 matcher 摘要。
`defineAssertion` 被 `.label()` 改标题时，原始 custom name 进入 `detail`，仍可解释 evaluator 的职责。

`sourceOrder`、`loc` 与 source code 位置只用于排序和导航，不承担 Assertion 身份。
跨 eval 的语义维度仍是 `groupPath`。

### 统一展示投影

所有 text、Web、source view 与 JSON failure feedback 共用一个 pure projector：

1. attempt 无 scope prefix；turn 使用 `<turn> · `；session 使用 `<session> through <turn> · `，没有 turn 时只显示 session。
2. 无 group 时，主体标题是 `name`。
3. 有 group 且 `nameKind: "author"` 时，主体是 `groupPath > name`。
4. 有 group 且 `nameKind: "default"` 时，主体只显示 `groupPath`，matcher 摘要紧邻显示。
5. `detail` 与主体最后一项相同时不重复，否则紧邻标题显示。

机器 JSON 继续分字段携带 `scope`、`name`、`nameKind`、`groupPath` 与 `detail`。
人读投影不能改写这些结构字段。

label 不改变 main failure 选择、group 比较、source order 或源码位置。

## Recorded Turn evidence

`events.json` 的顶层形状是按 session 分组的 array：

```ts
type EventsArtifact = readonly RecordedSession[];

interface RecordedSession {
  readonly session: string;
  readonly evidenceCoverage: EvidenceCoverage;
  readonly turns: readonly RecordedTurn[];
}

interface RecordedTurn {
  readonly turn: string;
  readonly status: "completed" | "failed" | "waiting";
  readonly data?: JsonValue;
  readonly usage?: Usage;
  readonly evidenceCoverage: EvidenceCoverage;
  readonly events: readonly StreamEvent[];
  readonly truncated?: readonly Truncation[];
}
```

session 按 core 创建序稳定排列；turn 按该 session 的 send 调用序排列；event 只在所属 turn 内有顺序。
这个 artifact 不声明跨 session 的全局 event index。
每个已创建 session 都进入 array，包括没有 turn 的 unused session。

持久 event ref 使用 `{ session, turn, eventOrdinal }`。
occurrence ref 保存同形 start ref 与可选 end ref，不从 array 下标构造跨 session 坐标。

每个 returned logical Turn 都保存 status、data、usage、六通道 evidence coverage 与事件。
input、reply、toolCalls、subagentCalls 与 input requests 继续从事件派生，不重复保存。

Turn coverage 是 Agent 默认值与该轮降级合成后的六通道完整形状。
非空 session 逐通道取 turns 的最差状态；相同最差等级时稳定选择最早 turn 的 reason。

从未发起 send 的 session 使用全通道 complete 作为空集合 identity。
core 知道该 session 没有 action、message、event、usage、status 或 data；创建 unused handle 不能制造采集缺口。
`result.json.evidenceCoverage` 是全部 session coverage 的最差摘要，writer 与 reader 校验它和 grouped facts 一致。

status、usage 与 coverage 不受 event 大值转写影响。
Turn data 需要缩减时，`RecordedTurn.truncated` 用结构化 path 与原始大小说明；runtime Assertion 始终读取完整 data。
离线 evaluator 依赖被缩减部分时返回 unavailable，不能把 Record 保留能力误写成 Adapter coverage。
coverage reason 使用自身的有界文本规则；event 或 data 缩减不能删除 channel 状态与 reason。

物理 retry 或最终 `SendFailure` 不伪装成 logical Turn。
它们的 partial events、usage 与 coverage 留在 retry/error evidence，并携带 `{ session, turn, sendAttempt }` refs。
同一 refs 使用 opaque token，不靠数字字符串反推 session 或 turn。

### Message event provenance

`RecordedTurn.events` 复用[运行观测协议的 `MessageEvent`](../observation-protocol/library.md#agent-turn-stream)。
下列 union 说明 Assertion 与持久结构依赖的字段：

```ts
type MessageEvent =
  | {
      readonly type: "message";
      readonly role: "assistant";
      readonly text: string;
    }
  | {
      readonly type: "message";
      readonly role: "user";
      readonly origin: "eval";
      readonly text: string;
      readonly sourceOrder: number;
      readonly loc?: SourceLoc;
    }
  | {
      readonly type: "message";
      readonly role: "user";
      readonly origin: "agent";
      readonly text: string;
    };
```

core 为 `send` 与 `respond` 创建 `origin: "eval"` 的 user event。
每次调用产生新 logical Turn，该 core event 固定是本轮 event ordinal 0。
返回给作者的 `Turn.events` 与 `RecordedTurn.events` 都包含它。

Adapter 内部观察到的 user message 必须写 `origin: "agent"`，不能伪造 `loc` 或 `sourceOrder`。
assistant message 不带 origin。
`loc` 可能因调用栈不可得而省略，因此不能用它猜 message producer。

## Logical occurrence

tool 与 subagent operation 使用 session-local state machine：

```text
closed / absent --started(id, kind)--> open
open --finished(same id, same kind)--> closed occurrence
closed --started(reused id, kind)----> new occurrence
```

operation id 只在单个 session 的当前 open lifecycle 内唯一。
两个 session 的同名 id 绝不配对。

每个 event 的坐标是 `(turnOrdinal, eventOrdinal)`。
closed occurrence 使用 `[startedCoordinate, finishedCoordinate]`；open occurrence 没有有限 end。
open 可以跨同一 session 的 turns，resume turn 的 finish 关闭历史 start。

logical occurrence 归属 start 所在 turn。
已经返回的 Turn 是不可变 snapshot：后续 finish 不回写旧 Turn，也不让 resume turn 凭空多一笔新发起调用。
session 与 attempt 的后续 snapshot 可以看到 closed occurrence。

同 id 在 open 时再次 started，或 finish kind 与 open kind 不一致，都是 Adapter 协议缺陷。
send 边界把它归为 non-retryable `SendFailure`，Attempt 使用既有 `agent-send-failed` error code。
coverage 只描述缺失事实，不用来掩盖矛盾流。

同 session 历史从未出现 open start 的 finish 是 orphan。
它作为 `[i, i]` point occurrence 保存自己真实拥有的 status 与 output，同时把 actions channel 降为 partial。
orphan 没有 name 或 input，不能凭空匹配 `calledTool(name)`。

非 order 的 attempt receiver 先在每个 session 内派生 occurrence，再把各 session 的集合相加做存在性、count 与上限判断。
生命周期配对仍不跨 session；负断言必须证明每个相关 session 都没有命中。

## Order

### `toolOrder`

`toolOrder(["A", "B"])` 只读取拥有真实 start/name 的 logical tool occurrences，并按 start 坐标寻找名字子序。
open occurrence 可以贡献 start 正事实，orphan finish 不能。

找到完整 start 子序即可在 partial actions 上 passed。
没找到且 actions 非 complete 时 unavailable；complete 时 failed。

### `eventOrder`

`eventOrder` 断言存在一组互不重叠的 occurrences：

```text
next.start > previous.end
```

tool 与 subagent 是 interval；message、skill、thinking 等普通事件是 `[i, i]` point。
非最终 matcher 只能选择 closed occurrence；最终 matcher 可以选择 open occurrence。
显式 `{ status: "pending" }` 出现在非最终位置是登记期 author error。

status 省略时，非最终 matcher 跳过 open candidate；最终 matcher 可以用它的 start/name/input 正事实。
显式 pending 声称“没有 finish”，因此即使找到 derived open occurrence，也要求 actions complete。

算法按存在性求链，不选择“最早开始”后就停止。
每一层从可接续的 closed candidates 中选择 end 最小者；相同 end 再按 start 与 occurrence ordinal 排序。
等价 DP 可以替代，但必须产出相同 canonical chain。

```text
A1=[1,100]  A2=[2,3]  B=[4,5]
```

`eventOrder([A, B])` 选择 A2 后 passed，不能因 A1 更早开始而失败。

下面的交错调用刻意展示两种 order 不同：

```text
A started(1), B started(2), B finished(3), A finished(4)
```

- `toolOrder(["A", "B"])` passed；
- `eventOrder([{ type: "tool", name: "A" }, { type: "tool", name: "B" }])` failed。

evidence 保存 canonical occurrence refs。
失败诊断指出无法接续的 matcher index 与当时最小可达 end，不声称事件流里完全没有该 type。

turn order 只看该 turn；session order 可以跨自己的 turns。
attempt order 对每个 session 独立求链，任一 session passed 则整体 passed。
没有 session 成链时，只要任一 session 的 required channel 非 complete 就 unavailable；全部 complete 才 failed。

## Evidence routing

`EventMatch.type` 固定 required channel，作者不能改写：

| EventMatch type | Channel |
|---|---|
| `tool`、`subagent` | actions |
| `message` | messages |
| `skill`、`input-request`、`thinking`、`context`、`compaction`、`error` | events |

`eventOrder` 的 required channels 是序列各 matcher 的并集。
它不额外要求 events complete；不相关 type 的缺口不能阻止 tool-to-message 链成立。

证据折叠规则：

- complete：匹配正常得到 passed 或 failed；
- partial / unavailable：找到完整正事实可以 passed；没找到时 unavailable；
- 负断言与需要最终上界的检查在非 complete channel 上 unavailable；
- 显式 pending 是负事实，必须要求 actions complete。

unavailable evidence 列出每个 required channel 的实际状态与 reason。

### Count

count 先数满足 matcher 的 logical occurrences，再应用 `CountMatch`：

| Evidence state | 可确定 outcome |
|---|---|
| observed > max | failed |
| 只有 min，且 observed >= min | passed |
| 其它依赖最终总数的情形，channel 非 complete | unavailable |
| channel complete | 正常判断 exact/range |

公开 API 不接受 count predicate。
框架无法判断 `n => n === 2` 或 `n => n >= 2` 是否能在 partial 流上安全提前成立。

`eventsSatisfy` 也不推断 predicate 单调性。
对应 scope 的 events channel 不全为 complete 时，它直接 unavailable，且不执行用户函数。

## Scope current state

### `succeeded`

turn 读取该 turn；session snapshot 读取最后一个 logical Turn；attempt 按每个非空 session 的最后一轮折叠。

- status 是 failed 或 waiting：确凿 failed；
- status 是 completed，但 status coverage 非 complete：unavailable；
- status 是 completed 且 status coverage complete：passed；
- session 没有 turn：idle，failed；
- attempt 没有非空 session：failed；unused session 不参与 attempt 折叠。

attempt 中任一 session 的最新状态为 failed/waiting 时 failed。
全部最新状态 completed，但任一 status coverage 非 complete 时 unavailable；全部 complete 才 passed。
并发 send 谁先 settle 不影响结果。

一个总写 completed、但把 status 声明为 partial 的 Adapter 不能让 `succeeded()` passed。

### `parked`

turn 与 session 按当前最后一轮检查；attempt 表示至少一个 session 当前 parked，unused session 忽略。

找到当前未回答 `input.requested` 是正事实，可以 passed。
没找到时，required status/events 任一非 complete 就 unavailable；两者 complete 才 failed。

waiting 却没有对应 `input.requested` 违反 Adapter Turn 契约。
send 边界产生协议 `SendFailure`，不把该 Turn 交给 Assertion。

## Evaluator 边界

所有 Assertion 求值都位于 runner 已有的 Effect fiber 与 Attempt AbortSignal 中。
collector 不为单条 Assertion 启动 nested Effect runtime。

custom evaluator 的合法返回只有 score result 或显式 unavailable。
signal 未 abort 时的 throw/rejection、非法 union、非文本诊断、NaN 或越界 score 都成为结构化 `assertion-evaluator-defect` Attempt error。
`.optional()` 不能遮蔽 defect。

collector 对 Promise 使用下面的 cancellation protocol：

1. 调用 evaluator 前检查 signal；已经 abort 时不调用。
2. 为 Promise 的 fulfill/reject 两支都安装 handler，并和 signal abort 竞争。
3. abort 获胜时，把 evaluation cell 原子标为 cancelled，停止等待并传播原始 `signal.reason`。
4. evaluator 先 settle 时，在接受结果前再次检查 signal；同 tick abort 时 signal 优先。
5. cancelled cell 的 late fulfillment/rejection 只被消费，不能写 `AssertionResult`、改变 Attempt error 或再次 finalize。

never-settling evaluator 不会阻止 Attempt deadline。
deadline 到达后沿既有 timeout 分类成为 errored，不生成 custom unavailable、failed 或 score。

abort 后的 late rejection 不成为 unhandled rejection，也不改写 timeout/interruption 终态。
evaluator 仍有义务响应 signal，终止外部 I/O 并释放自己拥有的资源。

只有 signal 未 abort，且 `{ unavailable: true }` 先合法 settle 时，custom unavailable 才成立。
expected、received 与 evidence 统一去控制字节并应用 Assertion preview 上限；matcher 不各自定义保存大小。

同一 registered assertion 至多 evaluate 一次。
`t.require` 与 awaited stop 的冻结结果由 finalize 复用。

## Handle 生命周期

```text
registered --modifier--> registered
registered --require / stop / finalize--> evaluating --> frozen
frozen --modifier--> author error
```

ValueAssertion modifier 返回不可变 clone；recorded handle modifier 更新同一 pending spec。
调用 stop 的瞬间就冻结，不等 Promise settle。

浮空 stop 没有语言层面的控制力。
框架不维护“下个 API 再补抛”的 pending queue，也不通过截掉后续 `AssertionResult` 伪装同步副作用没有发生。

failed/unavailable stop 使用内部 non-error control signal，只中止依赖代码。
evaluator defect 使用 Attempt error；两者不能共用普通 Error 文案猜测。

## Sandbox evidence

turn changes 与 aggregate Sandbox Assertion 共用一次最终 diff export。
turn selector 使用该 turn token；aggregate selector使用全部 send 区间。

分类能力只来自每个 send 区间的 before/after：

- 同一 send 区间内改动后复原，边界相同，框架无法观察该历史；
- 跨两个 send 区间的改动与复原形成两条 delta，仍可见；
- `fileChanged` 与 `fileDeleted` 只声明边界 delta，不声称观察 syscall 或 touch 历史。

目标 turn 的 diff group 即使没有变化也必须存在。
export 失败或 group 缺失时 `noChanges` unavailable，不能把缺事实当空事实。
`notInDiff` 遇 elided 内容时沿现有规则 unavailable。

Delayed file 在 matcher 前使用 tagged resolution：

```ts
type FileResolution =
  | { readonly state: "available"; readonly text: string }
  | { readonly state: "missing"; readonly path: string }
  | {
      readonly state: "unavailable";
      readonly reason: string;
      readonly detail?: string;
    };
```

只有 available 分支调用 matcher。
missing 直接形成 score 0 的 failed；unavailable 写 `sandbox-file-unavailable`。
Provider 必须用结构化 NotFound 区分 missing；core 不正则匹配异常文本。

## Record compatibility

grouped `events.json`、required `AssertionResult.scope`、`nameKind` 与 message origin 是同一次 breaking Record change。
目标 Run 格式把当前 `schemaVersion` 从 15 提升到 16；没有 per-artifact version 或局部兼容分支。

旧 Run 整份 incompatible，不对 `events.json` 猜形，也不做多版本 normalize loader。
writer、reader、artifact registry、truncation、o11y 派生、Reports、fixtures 与 carry eligibility 在同一 schema 切换。
跨 `schemaVersion` 继续不携带结果。

[运行观测协议](../observation-protocol/README.md) 使用 typed Observation 时，projector 必须产生同构的 recorded session/turn view。
协议可以换物理容器，不能丢 session boundary、Turn outcome、coverage 或 message origin，也不能制造跨 session 顺序。

## 不变量

- label 是人读标题，不是 join key。
- operation id 不跨 session 配对，attempt order 不跨 session 拼链。
- `toolOrder` 使用 start 子序；`eventOrder` 使用非重叠 interval sequence。
- pending 需要完整 actions 事实；open start 本身仍是正事实。
- arbitrary count predicate 不进入公开 API。
- predicate 返回值不做 truthiness coercion。
- unavailable 与 evaluator defect 不互相转换。
- finalized Assertion 不会再次求值或被 handle modifier 改写。
- missing file 不进入 string matcher，unknown read failure 不伪装成 missing。
- Record 与 author predicate view 分型；`eventsSatisfy` 不能读取 status、data、usage 或 coverage。
