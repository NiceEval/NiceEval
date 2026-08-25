# Assertions —— scoped methods

本页是受管 `toolCalls`／`eventOccurrences`、原始 `events`、numeric／occurrence／sequence Match、工具与 event 领域包装的唯一公开契约。
其它页面只链接本页，不重复签名、字段、计数或顺序规则。

root `t`、Session 与 Turn 都暴露同形态的 `toolCalls`、`eventOccurrences`、`events` 与 `check`。
工具／event 包装与显式 collection Match 都通过 `check(subject, match)` 登记。
领域包装只取 ctx-owned 公开 collection、选择公开 Match，再调用同一 `check`。
包装没有私有 evaluator、私有 criterion 或私有 Report 协议。

`succeeded` 与 Usage 包装保持各自入口；Judge 使用显式 `JudgeMaterial × ScoreMatch`，不属于 scoped collection。

## 受管 `toolCalls`

```ts
interface ToolOccurrenceView {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status?: "pending" | "completed" | "failed" | "rejected";
}

interface CollectionMatch<in T> {
  readonly kind: "collection-match";
}

type ManagedToolCalls<S extends "turn" | "session" | "attempt" = "turn" | "session" | "attempt"> =
  readonly ToolOccurrenceView[] & {
    readonly [managedToolCallsBrand]: S;
  };
```

`ctx.toolCalls` 是不可变 managed collection。公开元素是 logical tool occurrence 的只读投影，不是 o11y `ToolCall[]`。
公开字段只保留作者 Matcher 需要的 `name`、`input`、`output` 与 `status`。
occurrence identity、locator、cut、coverage、command projection 与 envelope 不进入公开元素。
scope identity 由 collection 对象携带，不是作者可写字段。

实现用 WeakMap sidecar 把 locator、scope identity、cut 与 coverage 绑在整个 collection 对象上。
作者不必填写 locator。公开数组与私有 matcher rows 严格同序、同基数。
不存在第二份公开 matcher collection，也不存在第二 getter。

Turn 封口后，重复读取 `turn.toolCalls` 得到相同内容。
Session 与 root 的每次 getter 访问冻结当下 cut；后一次 getter 可以看到更新，旧引用永不变化。
getter 返回的不是 live 引用。`check` 不会在登记时重新裁切或再次冻结 subject。

`check` 使用 subject 自身携带的 scope identity 与 cut。
因此 `t.check(turn.toolCalls, m)` 与 `turn.check(turn.toolCalls, m)` 等价。
调用 `check` 的 ctx 不改写 subject 已携带的 cut。

Turn 的元素是该 Turn 发起的 occurrence。
Session 的元素是该 Session 在 cut 内发起的 occurrence。
root 的元素是所有已启动 Session 按稳定 `sessionId` 排列的前缀拼接；它不是一条全局时间线。

公开 API 不提供 `toolCallCount()`、事实 selector、未包装的 number，或公开 `Fact<number>`。
Match 不自行从 ctx 取值。

## 原始 `events` 与受管 `eventOccurrences`

`ctx.events` 保持原始 `readonly StreamEvent[]`，是普通 Value subject。新 occurrence API 不删除、改写或缩窄它的元素，
也不在这个数组上附加 occurrence sidecar；既有 `check(ctx.events, satisfies(...))` 语义不变。

`ctx.eventOccurrences` 是另一份受管 subject，只投影 occurrence matcher 支持的三类中立事件。公开元素不包含
`eventId`、`toolOccurrenceId`、scope identity、cut、sequence 或 locator：

```ts
interface EventToolView {
  readonly name: string;
}

type EventOccurrenceView =
  | {
      readonly type: "message";
      readonly role: "assistant" | "user";
      readonly text: string;
    }
  | {
      readonly type: "operation.started";
      readonly tool: EventToolView;
    }
  | {
      readonly type: "operation.finished";
      readonly tool: EventToolView;
      readonly status: "completed" | "failed" | "rejected";
    };

type ManagedEventOccurrences<S extends "turn" | "session" | "attempt" = "turn" | "session" | "attempt"> =
  readonly EventOccurrenceView[] & {
    readonly [managedEventOccurrencesBrand]: S;
  };
```

实现用独立 WeakMap sidecar 保存每个投影的 identity／locator relation，并在整个 collection 对象上保存 scope、cut 与 coverage。
公开数组与私有 matcher rows 同序、同基数。复制或展开会丢失 sidecar。Turn、Session、root 的冻结规则与
`toolCalls` 相同；`check` 使用 subject 携带的 cut，不按调用 receiver 重裁。

`eventOccurrences` 不接受 numeric Match；本批 API 不提供 event cardinality、`maxEvents` 或 `usedNoEvents`。
作者若要把原始 `events` 当普通 array 检查，继续使用 Value Match。

## collection subject 与 Match

```ts
interface ToolOccurrenceMatch extends CollectionMatch<ManagedToolCalls> {
  readonly [occurrenceMatchBrand]: "tool-positive";
}

interface ToolUpperBoundOccurrenceMatch extends CollectionMatch<ManagedToolCalls> {
  readonly [occurrenceMatchBrand]: "tool-upper-bound";
}

interface ToolSequenceMatch extends CollectionMatch<ManagedToolCalls<"turn" | "session">> {
  readonly [occurrenceMatchBrand]: "tool-sequence";
}

interface EventOccurrenceMatch extends CollectionMatch<ManagedEventOccurrences> {
  readonly [occurrenceMatchBrand]: "event-positive";
}

interface EventUpperBoundOccurrenceMatch extends CollectionMatch<ManagedEventOccurrences> {
  readonly [occurrenceMatchBrand]: "event-upper-bound";
}

interface EventSequenceMatch extends CollectionMatch<ManagedEventOccurrences<"turn" | "session">> {
  readonly [occurrenceMatchBrand]: "event-sequence";
}

interface ToolMatch<R extends ToolOccurrenceView = ToolOccurrenceView>
  extends BooleanMatch<ToolOccurrenceView, R, "tool"> {
  atLeast(n: number): ToolOccurrenceMatch;
  lessThan(n: number): ToolUpperBoundOccurrenceMatch;
  atMost(n: number): ToolUpperBoundOccurrenceMatch;
  greaterThan(n: number): ToolOccurrenceMatch;
  exactly(n: number): ToolOccurrenceMatch;
}

interface EventMatch<R extends EventOccurrenceView = EventOccurrenceView>
  extends BooleanMatch<EventOccurrenceView, R, "event"> {
  atLeast(n: number): EventOccurrenceMatch;
  lessThan(n: number): EventUpperBoundOccurrenceMatch;
  atMost(n: number): EventUpperBoundOccurrenceMatch;
  greaterThan(n: number): EventOccurrenceMatch;
  exactly(n: number): EventOccurrenceMatch;
}

interface ToolMatchOptions {
  readonly input?: BooleanMatch<JsonValue>;
  readonly output?: BooleanMatch<JsonValue>;
  readonly status?: ToolStatus;
}

interface CommandMatchOptions {
  readonly argsStart?: readonly string[];
  readonly excludes?: readonly string[];
  readonly status?: ToolStatus;
}

toolMatch(name: string, options?: ToolMatchOptions): ToolMatch;
toolMatch(options: ToolMatchOptions): ToolMatch;
commandMatch(executable: string, options?: CommandMatchOptions): ToolMatch;
eventMatch(type: "message", options?: {
  readonly role?: "assistant" | "user";
  readonly text?: BooleanMatch<string>;
}): EventMatch;
eventMatch(type: "operation.started" | "operation.finished", options?: {
  readonly tool?: ToolMatch;
}): EventMatch;

// tool-domain overloads；value-domain overloads 继续保留自己的 BooleanMatch result。
and(first: ToolMatch, ...rest: readonly ToolMatch[]): ToolMatch;
or(first: ToolMatch, ...rest: readonly ToolMatch[]): ToolMatch;
and(first: EventMatch, ...rest: readonly EventMatch[]): EventMatch;
or(first: EventMatch, ...rest: readonly EventMatch[]): EventMatch;

inOrder(
  matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]],
): ToolSequenceMatch;
inOrder(
  matches: readonly [EventMatch, EventMatch, ...EventMatch[]],
): EventSequenceMatch;
```

这些都是受管 Match。求值结果是 `matched`、`mismatched` 或 `unavailable`，并按需带 typed artifact。
它们不返回不带状态的 boolean。Match 只比较 `check` 传入的 subject，不读取 ctx。

numeric Match 直接用于 collection subject 时比较 collection cardinality。
`atMost`、`lessThan`、`greaterThan` 与 `atLeast` 仍是普通 numeric Match，定义见 [Value assertions](value-assertions.md#数值比较)。
cardinality 的展示是 count、threshold、result 与 completeness。它不产生 tool matcher debugger 或 ledger。

未调用量词的 `ToolMatch` 用于受管 `toolCalls` 时默认要求至少一次命中。

`ToolMatch` 与 `EventMatch` 的五个量词方法对每笔 occurrence 独立求值，再按命中数聚合。
`.atLeast`、`.exactly`、`.greaterThan` 返回可供正向领域包装选择的 `ToolOccurrenceMatch`／`EventOccurrenceMatch`；
`.atMost`、`.lessThan` 返回可区分的 upper-bound 类型。`inOrder` 返回独立 sequence 类型。
正向、上界与 sequence 都可以显式交给对应 managed subject 的 `check`，但量化或 sequence 结果不能再交给 `and`、`or` 或 `inOrder`。

`commandMatch` 与 tool-domain `and`／`or` 产生的未调用量词结果同样提供量词方法。`not` 仍只接受 value-domain Match。
`inOrder(seq)` 对 Turn 或 Session 的 canonical source order 做 subsequence 查询；tuple 必须全部是同一 domain 的未量化 Match。
occurrence 与 order 可产生各自的 typed artifact、witness 或 `failure frontier`。

occurrence 量词的 `n` 必须是非负安全整数，且允许 `0`。
`inOrder` 至少两个 `ToolMatch`，最多 64 步。root／attempt 的 `toolCalls` 不能使用 `inOrder`。

```ts
ctx.check(ctx.toolCalls, atMost(2));
ctx.check(ctx.toolCalls, toolMatch("x").atLeast(2));
ctx.check(ctx.toolCalls, toolMatch("read").exactly(2));
ctx.check(ctx.toolCalls, toolMatch("write").exactly(0));
ctx.check(ctx.toolCalls, toolMatch("search"));
turn.check(turn.toolCalls, commandMatch("pnpm", { argsStart: ["test"] }).atMost(1));
turn.check(
  turn.toolCalls,
  and(commandMatch("pnpm"), toolMatch({ status: "completed" })).atLeast(1),
);
turn.check(turn.toolCalls, inOrder([toolMatch("read"), toolMatch("write")]));
turn.check(turn.eventOccurrences, eventMatch("message").atLeast(2));
turn.check(turn.eventOccurrences, eventMatch("operation.finished").atMost(3));
turn.check(
  turn.eventOccurrences,
  inOrder([eventMatch("operation.started"), eventMatch("operation.finished")]),
);
```

普通作者 array 可直接使用 numeric Match。长度按作者给出的完整 collection 精确计算，材料视为 complete。
`[...ctx.toolCalls]` 会退化成普通 array：numeric cardinality 仍可用，但丢失 managed locator／cut／coverage。
对该副本使用未调用量词或已经量化的 `ToolMatch`、或使用 tool `inOrder` 时，`check` 在登记时以作者错误拒绝，不写入 entry，也不伪造结果。

`[...ctx.eventOccurrences]` 同样只剩普通 array，不能再使用 `EventMatch`、event occurrence 或 event sequence。

根 `toolCalls` 或根 `eventOccurrences` 交给对应 `inOrder` 时同样在登记时拒绝。非法整数在对应工厂或包装调用时拒绝。

## 领域包装

工具与 event 包装都是同一 `check` 的语法糖。显式 `check` 与对应包装产生相同 criterion 与 decision。

| 包装 | 等价登记 |
|---|---|
| `maxToolCalls(n)` | `check(toolCalls, atMost(n))` |
| `calledTool(name)` | `check(toolCalls, toolMatch(name))` |
| `calledTool(m)`，`m` 是未量化 `ToolMatch` 或正向 `ToolOccurrenceMatch` | `check(toolCalls, m)` |
| `notCalledTool(m)` | `check(toolCalls, m.exactly(0))` |
| `usedNoTools()` | `check(toolCalls, toolMatch({}).exactly(0))` |
| `toolOrder(seq)` | `check(toolCalls, inOrder(seq))` |
| `event(m)`，`m` 是未量化 `EventMatch` 或正向 `EventOccurrenceMatch` | `check(eventOccurrences, m)` |
| `notEvent(m)` | `check(eventOccurrences, m.exactly(0))` |
| `eventOrder(seq)` | `check(eventOccurrences, inOrder(seq))` |

无名称、无 `input`／`output`／`status` 约束的 `toolMatch({})` 匹配每一笔 occurrence。
`usedNoTools` 复用 occurrence Match，不增加私有求值入口。
它保留 occurrence criterion 与 collection-filter artifact，不是 cardinality `atMost(0)`。

`name` 是 `toolMatch(name)` 的薄糖，只按原始工具名选择 occurrence。`calledTool` 没有第二参数；计数先由
`ToolMatch` 的量词形成公开 occurrence Match。`calledTool(toolMatch("x").atLeast(2))` 与规范显式写法
`check(toolCalls, toolMatch("x").atLeast(2))` 完全等价。

`maxToolCalls(n)` 的 `n` 必须是非负安全整数，允许 `0`。occurrence 量词参数也必须是非负安全整数。
`calledTool` 在调用 `check` 前拒绝 `.exactly(0)` 与 `.atLeast(0)`；`.greaterThan(0)` 合法。
零次语义使用 `notCalledTool`、`usedNoTools`，或显式 `check(toolCalls, toolMatch(...).exactly(0))`。
上界 `ToolUpperBoundOccurrenceMatch` 与 `ToolSequenceMatch` 在类型层不能传给 `calledTool`。

`maxToolCalls` 显示 numeric／cardinality criterion，没有 matcher debugger。
`usedNoTools`、`calledTool`、`notCalledTool` 显示 occurrence criterion 与 collection-filter artifact。
`toolOrder` 显示 occurrence order criterion 与 ordered-sequence artifact。

```ts
calledTool(match: ToolMatch | ToolOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
calledTool(name: string): BooleanAssertionHandle<Kind, void>;
notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
usedNoTools(): BooleanAssertionHandle<Kind, void>;
maxToolCalls(maximum: number): BooleanAssertionHandle<Kind, void>;
event(match: EventMatch | EventOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;

toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;

maxTokens(maximum: number): UsageAssertionHandle<Kind, void>;
maxCost(maximumUSD: number): UsageAssertionHandle<Kind, void>;
```

`event` 没有 options。未量化 `EventMatch` 表示至少一次；显式计数先调用同样的五个量词。
`event` 在登记前拒绝 `.exactly(0)`／`.atLeast(0)`，`notEvent` 只接未量化 `EventMatch` 并选择 `.exactly(0)`；
event upper-bound 与 sequence 在类型层不能传给 `event`。
`toolOrder` 与 `eventOrder` 只在 Turn 与 Session receiver 上提供。根 `t` 不伪造全局顺序。

Boolean handle 仍可 `await .orStop()`。它只等待并控制同一条已登记 Assertion。

## Usage 上限包装

`maxTokens(limit)` 与 `maxCost(limitUSD)` 在 root `t`、Session 和 Turn receiver 上可用。两者的上限都必须是有限且不小于零的 number，并在调用处冻结 receiver 的 usage scope。

它们是领域包装，不是另一套比较系统：`maxTokens(limit)` 等价于把 scope token fact 交给 `atMost(limit)`，`maxCost(limitUSD)` 等价于把 scope pricing estimate fact 交给同一个 matcher。包装与 `t.check(value, atMost(limit))` 共用 numeric evaluator、`numeric-comparison/v1` criterion 和一次登记路径。公开 API 不暴露 `t.tokens`、`t.cost` 或 `metric(selector)`。

`maxTokens` 的 fact 只等于 scope 内互斥桶的 `inputTokens + outputTokens`。cache read、cache write、reasoning、other 与 request 数都不计入这个上限，也不能回填缺失的 input 或 output。

`maxCost` 只消费 Runner 在 Assertion 登记时以 model、usage token 桶和选中的 price source 形成的 USD pricing estimate。它绝不读取或回退到 provider／Adapter observed `usage.costUSD`。费用材料保存完整的 pricing receipt，Report 只格式化该 receipt，不按当前价格重新计算。

Usage fact 有 `exact`、`lower-bound` 与 `unavailable` 三态。完整 usage 与完整 pricing 输入形成 exact；可证明安全前缀但缺少后续 usage 时形成 lower-bound；无法取得可信数值时形成 unavailable，不能补零。

对 `maxTokens` 或 `maxCost` 的 `atMost` 比较，lower-bound 只有在已知下界严格大于上限时才能确定 mismatched。下界等于或小于上限都为 unavailable，因为未观察部分仍可能使总量超限。`.ifCovered()` 只把已声明 unavailable 改为 not-applicable；它不能把 lower-bound 当成完整值，也不能改变已确定的超限失败。

```ts
import {
  commandMatch,
  jsonMatch,
  referencesAnyPath,
  toolMatch,
} from "niceeval/expect";

const turn = await t.send("查询台北天气，检查项目状态，然后汇报结果。");

turn.calledTool(toolMatch("get_weather", {
    input: jsonMatch({ city: "Taipei" }),
    output: jsonMatch({ forecast: "sunny" }),
    status: "completed",
  }).exactly(1)).label("完成天气查询");

turn.check(
  turn.toolCalls,
  toolMatch("read_file", {
    input: referencesAnyPath([".env", "secrets/**"]),
  }).atLeast(1),
).label("读取敏感路径");

turn.calledTool(commandMatch("pnpm", { argsStart: ["test"] }));
turn.notCalledTool(commandMatch("rm", { argsStart: ["-rf"] }));
turn.maxToolCalls(4).label("工具次数上限");
turn.usedNoTools().label("本轮不使用工具");
```

普通 JSON 结构交给受管的 `jsonMatch`。路径搜索交给 `referencesAnyPath`，二者用在 `toolMatch` 的 JSON 条件中。命令 token 交给可直接作为 selector 的 `commandMatch`；不在局部 JSON 中写命令正则或自定义函数。

## 一个 occurrence 的合取

`ToolMatch` 每次只比较一个 logical tool occurrence。名称、`input`、`output` 与 `status` 是同一 occurrence 上的 AND 条件。计数只数完整满足这一组条件的 occurrence，不会把一笔调用的输入和另一笔调用的输出拼成命中。

`toolMatch` 适用于官方工具和第三方工具。两者都按 Adapter 归一后的 occurrence、原始名称与材料状态求值，没有官方工具的特权分支。

## 集合过滤与有序序列查询

未调用量词或已经量化的 `ToolMatch`／`EventMatch`，以及选择它们的包装，对 scope 中每条候选 source row 独立求值，再按 quantifier 聚合。
tool 候选是一笔 logical tool occurrence；event 候选是一条独立事件。
`operation.started` 与 `operation.finished` 因而是两个 event 候选，即使它们共享同一个 `toolOccurrenceId`。

`inOrder`、`toolOrder` 与 `eventOrder` 是 query steps 对一个 Turn 或 Session 的 per-Session observed ingestion order 做 subsequence 查询。这个顺序只表示 source owner 让 event 对 runtime 可见的顺序，不冒充 provider wall-clock。每一步必须选择严格晚于前一步的 source row；无关 row 可以穿插，同一 row 不能满足两个 step。成功结果保留字典序最早的 definite witness path，因此相同 Record、scope 与 query 总是选择同一路径。query 最多 64 步。

order 使用自己的 receipt，不把 step × row comparison 强行折成 collection 的 matched count。producer 流式维护 definite 与 matched-or-unavailable possible frontier，不保存 matrix。

失败结果保留 `failure frontier`：字典序最早的 longest definite prefix、longest possible prefix，以及 possible prefix 后的 first blocking step。它还保存从该处开始的 suffix checked counts，以及最多 8 个 representative differences。它不是 `minimal counterexample`。

只有 complete source、exhaustive receipt 且 possible frontier 无法形成完整 witness 时才失败。possible frontier 能完成而 definite frontier 不能完成时，结果为 unavailable。

query artifact 必须保存 query steps、witness path 或 `failure frontier`、suffix aggregate、有界 representative diagnostics，以及所用 source locator 与 relation status。只保存 final tri-state 加 raw matches array 不能离线解释 order，也不是合法的 current artifact。

## 输入、输出与 HITL

输入和输出材料各有 `complete`、`partial`、`unavailable` 三种状态。`complete` 有完整 JSON；`partial` 明示可见片段与缺失边界；`unavailable` 带具名原因，不能用空对象、`null` 或普通 mismatch 代替。

受管 Match 在 `partial` 材料中只有取得决定性正向见证时才可 matched。其余需要不可见部分的比较是 unavailable。`unavailable` 材料不会产生假阴性。

HITL 等待中的工具已有 `operation.started`，却还没有相配的 finished。它的 occurrence 状态是 `pending`，输出为 unavailable。匹配 `status: "pending"` 可以成立；要求输出的 Match 必须是 unavailable。缺少输出从不等同于输出不匹配。

## receiver、Session 与 vector cut

Turn receiver 只读取该不可变 Turn 封口时的 source cut。Session receiver 读取该 Session 在 getter 处之前的全部 Turn，所以可以断言跨 Turn 的工具行为；两者都保存 inclusive per-Session sequence cut。后续完成或新增事件不能改写已经交给 `check` 的 collection。

根 `t` 在 getter 处冻结所有已启动 Session 的 vector cut。每个成员由稳定 `sessionId` 与 inclusive through-sequence 标识，并按 `sessionId` 规范化；根 scope 不把多个 Session 伪造成一条全局时间线，也不提供 `toolOrder`／`eventOrder`／`inOrder`。之后新增的 Turn、Session 或工具调用不进入已冻结的 collection。

tool lifecycle 可以跨 Turn：started 与 finished 分别保留各自的 Turn relation，并通过 `toolOccurrenceId` 属于同一 occurrence。occurrence 的 Turn membership 只取 started 所在的 home Turn。finish event 不让它成为 finish Turn 的第二个 tool candidate。

旧 Turn handle 永远观察封口时的 lifecycle，状态可能是 pending。Session handle 则观察 getter cut 内已经出现的 finish。scope snapshot 保存准确的 scope relation、`scopeId` 与 cut。Report 不能用 producer-minted `callId`、时间相邻或数组位置决定某个 ledger row 是否属于这次 Assertion。

## 三值计数与 coverage

每个候选 occurrence 先得到 `matched`、`mismatched` 或 `unavailable`。occurrence Match 的计数在这三种结果上求值，不能把未知当作零。

- `.exactly(n)`：已知匹配数超过 `n` 时确定 mismatched。只有已知匹配数等于 `n` 且其余候选都可判定时才 matched；否则为 unavailable。
- `.atLeast(n)` 与 `.greaterThan(n)`：已知匹配下界满足条件时立即 matched。下界不足且其余候选都可判定时才 mismatched；否则为 unavailable。
- `.atMost(n)` 与 `.lessThan(n)`：已知匹配下界违反条件时立即 mismatched。下界仍在范围内且其余候选都可判定时才 matched；否则为 unavailable。
- 未调用量词的 `ToolMatch`／`EventMatch`，以及收到未量化 Match 的 `calledTool`／`event`：按 `.atLeast(1)` 求值。
- `notCalledTool`、`notEvent` 与 `.exactly(0)`：按精确零匹配求值。一个已知匹配即可 mismatched；只有所有候选都可判定且没有匹配时才 matched。

这套规则也要求 collection 的 actions 材料足以判定。材料不完整时，正断言、负断言和未达到的下限都保留 unavailable，而不是据空白认定结果。
source `complete`、`partial`、orphan 或 invalid 时，结果仍走上述三值规则，不另造统一 Fact envelope。

collection subject 直接交给 numeric Match 时，`check` 把已知长度形成 numeric 材料。完整 collection 形成 exact；partial／orphan source 仍有可证明前缀时形成 lower-bound。

invalid source 或其它无法取得可信长度的情况形成 unavailable，不能补成 `lower-bound(0)`。
`atMost` 在下界严格大于 threshold 时 mismatched；下界小于或等于 threshold 且集合不完整时 unavailable。
其余 numeric comparator 沿用 [Architecture](../architecture.md#数值材料与-usage-pricing-receipt) 的 lower-bound 规则。
普通作者 array 没有 sidecar coverage，长度按传入值精确计算。

## 版本边界

`ToolMatch`、scoped Assertion、Analysis 与 Report 作者 API 都不用 `V1` 或 `V2` 后缀。中高层 breaking
change 通过包与 API 升级交付，不要求用户改写已封口的 Record。

只有 `RecordAttachment` 的持久 schema 与跨进程 wire codec 使用版本号。Assertions current envelope 是
schemaVersion `3`；本方向不升级到 v4。持久 payload 规则见 [Architecture](../architecture.md)。
历史 `value-match/v1` 的 `maxToolCalls` 条目按原 criterion 读取，不推断、不迁移成 numeric 或 occurrence criterion。

Sandbox 专属结果断言见 [断言 Sandbox 结果](../../sandbox/library/asserting-results.md)。
