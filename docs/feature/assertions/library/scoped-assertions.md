# Assertions —— scoped methods

本页是 tool／event collection filter、`toolOrder`／`eventOrder`、`ToolMatch` 与计数的唯一公开契约。其它页面只链接本页，不重复签名、字段、计数或顺序规则。

每一次调用都直接登记 Boolean Assertion。receiver 在调用处取得 snapshot；随后发生的 Session 或 Turn 不能改写这条 entry。Boolean handle 仍可 `await .orStop()`，它只等待并控制同一条已登记 Assertion。

## 调用形状

```ts
interface CalledToolAtLeast {
  readonly atLeast: number;
}

type CalledToolCount = number | CalledToolAtLeast;

interface CalledToolOptions {
  readonly count?: CalledToolCount;
}

interface EventOptions {
  readonly count?: number;
}

calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
event(match: EventMatch, options?: EventOptions): BooleanAssertionHandle<Kind, void>;
notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;

// Turn 与 Session receiver 提供有序序列查询；根 t 不伪造全局顺序。
toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;

maxTokens(maximum: number): UsageAssertionHandle<Kind, void>;
maxCost(maximumUSD: number): UsageAssertionHandle<Kind, void>;
```

`name` 是 `toolMatch(name)` 的薄糖，只按原始工具名选择 occurrence。`calledTool` 的第二参数只含 `count`；`input`、`output` 与 `status` 都属于 `ToolMatch`。

`count` 的数字是恰好次数，且必须为正整数。`{ atLeast: n }` 的 `n` 同样必须为正整数。省略 `count` 等于 `{ atLeast: 1 }`。数值 `0` 无效；需要证明没有匹配调用时使用 `notCalledTool`。

`event` 的数值 `count` 同样表示恰好次数；省略时表示至少一次。零次使用 `notEvent`。`toolOrder` 与 `eventOrder` 至少各接收两个 Match，并检查允许无关 source row 穿插的 subsequence；`toolOrder` 只证明 logical tool occurrence 的开始顺序，不把“前一笔 finished 后下一笔才 started”藏进方法名。

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

turn.calledTool(
  toolMatch("get_weather", {
    input: jsonMatch({ city: "Taipei" }),
    output: jsonMatch({ forecast: "sunny" }),
    status: "completed",
  }),
  { count: 1 },
).label("完成天气查询");

turn.calledTool(
  toolMatch("read_file", {
    input: referencesAnyPath([".env", "secrets/**"]),
  }),
).label("读取敏感路径");

turn.calledTool(commandMatch("pnpm", { argsStart: ["test"] }));
turn.notCalledTool(commandMatch("rm", { argsStart: ["-rf"] }));
```

普通 JSON 结构交给受管的 `jsonMatch`。路径搜索交给 `referencesAnyPath`，二者用在 `toolMatch` 的 JSON 条件中。命令 token 交给可直接作为 selector 的 `commandMatch`；不在局部 JSON 中写命令正则或自定义函数。

## 一个 occurrence 的合取

`ToolMatch` 每次只比较一个 `LogicalToolOccurrence`。名称、`input`、`output` 与 `status` 是同一 occurrence 上的 AND 条件。计数只数完整满足这一组条件的 occurrence，不会把一笔调用的输入和另一笔调用的输出拼成命中。

`toolMatch` 适用于官方工具和第三方工具。两者都按 Adapter 归一后的 occurrence、原始名称与材料状态求值，没有官方工具的特权分支。

## 集合过滤与有序序列查询

`calledTool`、`notCalledTool`、`event` 与 `notEvent` 对 scope 中每条候选 source row 独立求值，再按 quantifier 聚合。tool 候选是一笔 logical tool occurrence；event 候选是一条独立事件。`operation.started` 与 `operation.finished` 因而是两个 event 候选，即使它们共享同一个 `toolOccurrenceId`。

`toolOrder` 与 `eventOrder` 是 query steps 对一个 Turn 或 Session 的 per-Session observed ingestion order 做 subsequence 查询。这个顺序只表示 source owner 让 event 对 runtime 可见的顺序，不冒充 provider wall-clock。每一步必须选择严格晚于前一步的 source row；无关 row 可以穿插，同一 row 不能满足两个 step。成功结果保留字典序最早的 definite witness path，因此相同 Record、scope 与 query 总是选择同一路径。query 最多 64 步。

order 使用自己的 receipt，不把 step × row comparison 强行折成 collection 的 matched count。producer 流式维护 definite 与 matched-or-unavailable possible frontier，不保存 matrix。

失败结果保留 `failure frontier`：字典序最早的 longest definite prefix、longest possible prefix，以及 possible prefix 后的 first blocking step。它还保存从该处开始的 suffix checked counts，以及最多 8 个 representative differences。它不是 `minimal counterexample`。

只有 complete source、exhaustive receipt 且 possible frontier 无法形成完整 witness 时才失败。possible frontier 能完成而 definite frontier 不能完成时，结果为 unavailable。

query artifact 必须保存 query steps、witness path 或 `failure frontier`、suffix aggregate、有界 representative diagnostics，以及所用 source locator 与 relation status。只保存 final tri-state 加 raw matches array 不能离线解释 order，也不是合法的 current artifact。

## 输入、输出与 HITL

输入和输出材料各有 `complete`、`partial`、`unavailable` 三种状态。`complete` 有完整 JSON；`partial` 明示可见片段与缺失边界；`unavailable` 带具名原因，不能用空对象、`null` 或普通 mismatch 代替。

受管 Match 在 `partial` 材料中只有取得决定性正向见证时才可 matched。其余需要不可见部分的比较是 unavailable。`unavailable` 材料不会产生假阴性。

HITL 等待中的工具已有 `operation.started`，却还没有相配的 finished。它的 occurrence 状态是 `pending`，输出为 unavailable。匹配 `status: "pending"` 可以成立；要求输出的 Match 必须是 unavailable。缺少输出从不等同于输出不匹配。

## receiver、Session 与 vector cut

Turn receiver 只读取该不可变 Turn 封口时的 source cut。Session receiver 读取该 Session 在调用处之前的全部 Turn，所以可以断言跨 Turn 的工具行为；两者都保存 inclusive per-Session sequence cut。后续完成或新增事件不能改写这个 evaluation cut。

根 `t` 在调用处冻结所有已启动 Session 的 vector cut。每个成员由稳定 `sessionId` 与 inclusive through-sequence 标识，并按 `sessionId` 规范化；根 scope 不把多个 Session 伪造成一条全局时间线，也不提供 `toolOrder`／`eventOrder`。之后新增的 Turn、Session 或工具调用不进入已登记 Assertion。

tool lifecycle 可以跨 Turn：started 与 finished 分别保留各自的 Turn relation，并通过 `toolOccurrenceId` 属于同一 occurrence。occurrence 的 Turn membership 只取 started 所在的 home Turn。finish event 不让它成为 finish Turn 的第二个 tool candidate。

旧 Turn handle 永远观察封口时的 lifecycle，状态可能是 pending。Session handle 则观察登记时 cut 内已经出现的 finish。scope snapshot 保存准确的 scope relation、`scopeId` 与 cut。Report 不能用 producer-minted `callId`、时间相邻或数组位置决定某个 ledger row 是否属于这次 Assertion。

## 三值计数

每个候选 occurrence 先得到 `matched`、`mismatched` 或 `unavailable`。计数在这三种结果上求值，不能把未知当作零。

- 精确 `n`：已知匹配数超过 `n` 时确定 mismatched。只有已知匹配数等于 `n` 且其余候选都可判定时才 matched；否则为 unavailable。
- `{ atLeast: n }`：已知匹配数达到 `n` 时立即 matched。已知匹配数不足且其余候选都可判定时才 mismatched；否则为 unavailable。
- 省略计数：按 `{ atLeast: 1 }` 求值。
- `notCalledTool`：按精确零匹配求值。一个已知匹配即可 mismatched；只有所有候选都可判定且没有匹配时才 matched。

这套规则也要求 receiver 的 actions 材料足以判定。材料不完整时，正断言、负断言和未达到的下限都保留 unavailable，而不是据空白认定结果。

## 版本边界

`ToolMatch`、scoped Assertion、Analysis 与 Report 作者 API 都不用 `V1` 或 `V2` 后缀。中高层 breaking
change 通过包与 API 升级交付，不要求用户改写已封口的 Record。

只有 `RecordAttachment` 的持久 schema 与跨进程 wire codec 使用版本号。Assertions current envelope 是
schemaVersion `3`；持久 payload 规则见 [Architecture](../architecture.md)。

Sandbox 专属结果断言见 [断言 Sandbox 结果](../../sandbox/library/asserting-results.md)。
