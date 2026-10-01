# 上下文材料 Match —— Library

```ts
export type ReadonlyMaterial<T> =
  T extends ManagedToolCalls | ManagedEventOccurrences ? T
  : T extends (...args: infer A) => infer R ? (...args: A) => ReadonlyMaterial<R>
  : T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<K, ReadonlyMaterial<V>>
  : T extends ReadonlySet<infer V> ? ReadonlySet<ReadonlyMaterial<V>>
  : T extends object ? { readonly [K in keyof T]: ReadonlyMaterial<T[K]> } : T;
export type MatchContext<C> = ReadonlyMaterial<C>;

export interface MaterialItem<T> { readonly id: string; readonly value: T }
export interface MaterialCaptureBudget {
  readonly maxItems?: number;
  readonly maxBytes?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}
export type MaterialCollection<T> =
  | { readonly state: "complete"; readonly items: readonly MaterialItem<T>[] }
  | { readonly state: "partial"; readonly items: readonly MaterialItem<T>[]; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };

declare const materialContextBrand: unique symbol;
declare const materialValueBrand: unique symbol;
// 私有 brand 隐藏 reader 与 predicate，ctx 逆变，材料值协变。
export interface MaterialMatch<in C, out T> {
  readonly kind: "material";
  readonly [materialContextBrand]: (ctx: C) => void;
  readonly [materialValueBrand]: T;
}
export function defineMaterialMatch<C, T>(definition: {
  readonly name: string;
  readonly capture?: MaterialCaptureBudget;
  readonly read: (ctx: MatchContext<C>) => MaterialCollection<ReadonlyMaterial<T>>;
  readonly match: BooleanMatch<ReadonlyMaterial<T>, ReadonlyMaterial<T>>;
}): MaterialMatch<C, ReadonlyMaterial<T>>;

// 同一工厂的两个重载：读取 Agent 的受管工具集合或事件集合。
export function defineMaterialMatch<C>(definition: {
  readonly name: string;
  readonly capture?: MaterialCaptureBudget;
  readonly read: (ctx: MatchContext<C>) => ManagedToolCalls;
  readonly match: ToolMatch;
}): MaterialMatch<C, ToolOccurrenceView>;
export function defineMaterialMatch<C>(definition: {
  readonly name: string;
  readonly capture?: MaterialCaptureBudget;
  readonly read: (ctx: MatchContext<C>) => ManagedEventOccurrences;
  readonly match: EventMatch;
}): MaterialMatch<C, EventOccurrenceView>;

// 附加到已有 check 的单参数重载。其它 value/Match 组合保持各自语义。
check<T>(match: MaterialMatch<AppContext, T>): BooleanAssertionHandle<Kind, void>;
closeQA<T>(match: MaterialMatch<AppContext, T>, question: string,
  options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
```

材料 Match 只声明能力。框架在 `check` 或 `closeQA` 调用时注入当前接收者的只读 ctx，调用 reader 一次并复制事实。
Reader 同步且纯，不调用断言、模型或世界操作。Ctx 类型不兼容时编译失败，构造伪品牌在运行时失败。
`and` 和 `or` 使用现有单项 Match，每次只判断同一事实。

```ts
type GameEvent = {
  readonly actorId: string;
  readonly speech: { readonly text: string; readonly tags: readonly string[] };
};
type GameContext = { readonly speech: MaterialCollection<GameEvent> };
const saidMatch = (match: BooleanMatch<GameEvent, GameEvent>) =>
  defineMaterialMatch<GameContext, GameEvent>({
    name: "speech", read: ctx => ctx.speech, match,
  });

const adapter = defineAdapter({
  name: "application",
  create: async ctx => createApplication(ctx), // 返回 GameContext；事实由应用拥有。
  assertions({ check }) {
    return {
      said(match: BooleanMatch<GameEvent, GameEvent>) {
        return check(saidMatch(match));
      },
    };
  },
});

adapter.defineEval({ name: "speech quality", test(t) {
  t.said(and(npcMatch({ id: "a" }), sayMatch())).gate();
  t.closeQA(saidMatch(npcMatch({ id: "a" })), "每句是否自然完整？").gate(.8);
  const usage = t.usage;
  t.check(usage.totalTokens, atMost(10000)).gate();
  t.check(t.elapsedMs, atMost(30000)).gate();
  t.maxCost(1).gate();
}});
```

`createApplication` 返回 Adapter 原有上下文，不增加材料工厂声明、注册或绑定。
业务可在上下文提供只读集合或读取方法；上例只为展示最小形状。
同一次 Match 可以跨 Attempt 复用声明，每次读取的都是调用处 ctx。

## 官方统计

`usage` 和 `elapsedMs` 是 getter。读到的嵌套值全部不可变，后续上报不能改变旧变量。
Agent 的 turn、session、attempt 与 Adapter 的 attempt 使用相同的字段和未知值语义。

```ts
interface EvalUsage {
  readonly source: "agent" | "adapter" | "unavailable";
  readonly scope: "turn" | "session" | "attempt";
  readonly basis: "reported-sends" | "recorded-calls" | "unbound";
  readonly cut: "call-time";
  readonly inputTokens: NumericMaterial; // 未缓存桶
  readonly inputTotalTokens: NumericMaterial; // 独立输入总量，或三个互斥输入桶之和
  readonly outputTokens: NumericMaterial;
  readonly cacheReadTokens: NumericMaterial;
  readonly cacheWriteTokens: NumericMaterial;
  readonly totalTokens: NumericMaterial; // 完整输入加输出；reasoning 不重复计算
  readonly costs: {
    readonly state: "complete" | "partial" | "unavailable";
    readonly values: readonly {
      readonly currency: string;
      readonly value: string; // canonical decimal
      readonly source: "reported" | "estimated" | "mixed";
      readonly coveredContributions: number;
      readonly reportedContributions: number;
      readonly estimatedContributions: number;
    }[];
    readonly totalContributions: number;
  };
}
interface EvalMetrics<Kind> {
  readonly usage: EvalUsage;
  readonly elapsedMs: NumericMaterial;
  maxTokens(maximum: number): BooleanAssertionHandle<Kind, number>;
  maxCost(usd: number | string): BooleanAssertionHandle<Kind, string>;
}
```

Adapter 统计直接投影 `recordUsage` 账本，不读取 journal。每个物理请求的最终快照只记一次，失败和重试保留。
Agent 统计读取 SessionManager 保存的逐次 send 贡献与 coverage，不伪造模型请求明细。`basis` 表明证据范围的区别。

每个字段在缺项时为 lower-bound 或 unavailable。没有上报不补零，报告零则保留零。
`maxTokens` 判断 `usage.totalTokens`。每项有独立输入总量时优先使用它，不能再次加缓存。
缺少独立总量时才加三个互斥输入桶；有缺项则为下限。
Agent 内部 `cacheCreationTokens` 对应公开 `cacheWriteTokens`，reasoning 是输出的已含明细。

`maxCost(usd)` 比较美元金额，优先实扣；缺少实扣时仅使用显式价目表估算。
按证据项分别估算，未知费用或其它币种让上限判断不可判定，已知下限超过上限仍可失败。
`maxCost` 接收有限非负 number 或 canonical 非负十进制字符串，字符串最多 128 字符。
非法输入在登记处抛 TypeError。

Number 以当前 JavaScript 数值的十进制拼写为准，不能恢复已经丢失的精度；精确边界使用字符串。
逐项 number 成本与单价在进入官方投影时规范化，随后乘法、除以百万、累加和比较全部使用十进制定点。裁判费用留在托管 Judge 审计，应用用量不包含它。

`elapsedMs` 是当前 Attempt 的 runtime 墙钟毫秒数；游戏内完成时间属于业务 Match。

## 接收者与类型贯穿

```ts
export interface AgentMatchContext<S extends "turn" | "session" | "attempt" =
  "turn" | "session" | "attempt"> {
  readonly scope: S;
  readonly toolCalls: ManagedToolCalls<S>;
  readonly eventOccurrences: ManagedEventOccurrences<S>;
  readonly usage: EvalUsage;
}

interface AssertionCheck<Kind, C = unknown> {
  <T>(match: MaterialMatch<C, T>): CheckedBooleanHandle<Kind, void>;
  // 既有 value/BooleanMatch、numeric 与 ScoreMatch 重载保持原形状。
}
interface JudgePresetMethods<Kind, C = unknown> {
  closeQA<T>(match: MaterialMatch<C, T>, question: string,
    options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
  // 其余四个现成裁判保持各自材料签名。
}
interface AdapterAssertionsFactoryContext<C extends object> {
  readonly app: Readonly<C>;
  readonly check: AssertionCheck<"polymorphic", C>;
}
```

`EvalContext<Kind, Flags, C>` 的 check 和现成裁判均携带 C，统计 getter 属于中立 EvalMetrics。
Adapter Eval input 把 create 返回的 C 传入 EvalContext，factory 与 eval 不擦除它。
Agent root、session、turn 分别传入对应 AgentMatchContext 的 scope 类型。

Agent Match ctx 不暴露主 session 的 reply/events，也不暴露 send、check、judge 等控制方法。
工具和消息从两个正式受管集合读取；scope 为 attempt 时集合包含整个 Attempt，scope 为 session/turn 时仅包含该接收者。

```ts
const callsMatch = (match: ToolMatch) =>
  defineMaterialMatch<AgentMatchContext>({
    name: "calls", read: ctx => ctx.toolCalls, match,
  });
turn.closeQA(callsMatch(toolMatch({ name: "file_read" })), "这些读取是否足以核对配置？").gate(.8);
```

普通材料的 T 表示已冻结 DTO。Reader 输出和 predicate 输入均为 ReadonlyMaterial<T>。
业务事件本身定义为深只读时，直接使用 defineValueMatch<GameEvent>；可变业务模型使用 defineValueMatch<ReadonlyMaterial<Model>>。
嵌套数组、读取方法返回值、Map/Set 的读接口在 ctx 类型中只读。函数调用的副作用仍受纯 reader 契约约束，TypeScript 不构成 JavaScript 沙箱。

## 容量配置

`capture` 约束读取集合的扫描和不可变捕获，属于材料 Match 声明。
`closeQA` 的 `maxMaterialBytes` 约束全部命中材料，`maxAuditBytes` 约束完整裁判审计；两者不约束未命中项。
预算参数必须是范围内的正整数；非法配置在构造或断言登记处抛 TypeError，合法预算耗尽则不可判定。

| 预算 | 默认 | 可配置上限 |
|---|---:|---:|
| capture.maxItems | 256 | 16384 |
| capture.maxBytes | 49152 | 4194304 |
| capture.maxNodes | 16384 | 1048576 |
| capture.maxDepth | 32 | 64 |
| Judge maxMaterialBytes | 32768 | 4194304 |
| Judge maxAuditBytes | 98304 | 8388608 |

`capture.maxBytes` 包含集合状态、每项身份、原文、元数据与正式 undefined 标记。
`maxMaterialBytes` 包含交给裁判的验收问题、全部命中项及其身份，不包含未命中的事实材料。
请求协议和引用 schema 的完整字节仍计入审计预算，不能靠材料预算掩盖请求大小。
审计计量也包含持久 envelope 的 JSON 转义与 manifest，不把二次编码的增加字节藏在预算外。
超限不抽样，不按成功结果过滤，不缩短业务观测时段。

预算停止的完整性收据与 capacity-limited limitation 保留未穷尽事实，未知 omittedBytes 为 null。

```ts
type OperationsContext = { readonly operations: MaterialCollection<GameEvent> };
const operationsMatch = (match: BooleanMatch<GameEvent, GameEvent>) =>
  defineMaterialMatch<OperationsContext, GameEvent>({
    name: "operations", read: ctx => ctx.operations, match,
    capture: { maxItems: 4096, maxBytes: 4 * 1024 * 1024,
      maxNodes: 262144, maxDepth: 32 },
  });
t.check(operationsMatch(npcMatch({ id: "a" }))).gate();
t.closeQA(operationsMatch(npcMatch({ id: "a" })), "这些操作是否合理应对局势？", {
  maxMaterialBytes: 2 * 1024 * 1024,
  maxAuditBytes: 8 * 1024 * 1024,
}).score(100);
```

示例的 ctx.operations 是应用提供的正式只读操作集合，不要求评估正文展开取数。
受管工具与事件材料使用同一 capture 配置，不因数组品牌而回到固定 256 项上限。

## 单个业务事实评分

集合材料与单个事实使用同一接收者注入机制，消费方式由 Match 的类型决定。
`defineContextMatch` 读取恰好一个聚合事实，再使用现有 BooleanMatch 或 ScoreMatch。
它不对集合逐项评分，不计算平均值，也不替业务决定聚合规则。

```ts
export type MatchFact<T> =
  | { readonly state: "available"; readonly value: T }
  | { readonly state: "unavailable"; readonly reason: string };
export type FactCaptureBudget = Omit<MaterialCaptureBudget, "maxItems">;
export interface ContextBooleanMatch<in C, out T> {
  readonly kind: "context-boolean";
  readonly [materialContextBrand]: (ctx: C) => void;
  readonly [materialValueBrand]: T;
}
export interface ContextScoreMatch<in C, out T> {
  readonly kind: "context-score";
  readonly [materialContextBrand]: (ctx: C) => void;
  readonly [materialValueBrand]: T;
}
export function defineContextMatch<C, T>(definition: {
  readonly name: string;
  readonly read: (ctx: MatchContext<C>) => MatchFact<ReadonlyMaterial<T>>;
  readonly match: BooleanMatch<ReadonlyMaterial<T>, ReadonlyMaterial<T>>;
  readonly capture?: FactCaptureBudget;
}): ContextBooleanMatch<C, ReadonlyMaterial<T>>;
export function defineContextMatch<C, T>(definition: {
  readonly name: string;
  readonly read: (ctx: MatchContext<C>) => MatchFact<ReadonlyMaterial<T>>;
  readonly match: ScoreMatch<ReadonlyMaterial<T>>;
  readonly capture?: FactCaptureBudget;
}): ContextScoreMatch<C, ReadonlyMaterial<T>>;

check<T>(match: ContextBooleanMatch<AppContext, T>):
  BooleanAssertionHandle<Kind, void>;
check<T>(match: ContextScoreMatch<AppContext, T>):
  MeasurementAssertionHandle<Kind>;
```

Read 返回 available 是作者对这份单个事实充分性的明确声明。
日志缺失、业务完成边界未知等不能生成一个虚构的零值；reader 返回 unavailable，框架不调用 scorer。
需要上下界的事实可以保留正式 NumericMaterial，评分规则必须自行遵守其证据精度。

```ts
type CompletionFact =
  | { readonly completed: true; readonly boundaryEventId: string;
      readonly gameSeconds: number }
  | { readonly completed: false; readonly observationEndEventId: string;
      readonly observedGameSeconds: number };
type CompletionContext = { readonly completion: MatchFact<CompletionFact> };
const 完成耗时效率 = defineContextMatch<CompletionContext, CompletionFact>({
  name: "completion efficiency",
  read: ctx => ctx.completion,
  match: defineScoreMatch<CompletionFact>({
    name: "completion efficiency score",
    score: fact => fact.completed ? Math.max(0, 1 - fact.gameSeconds / 180) : 0,
  }),
});
t.check(完成耗时效率).score(50);
```

业务 reader 可在纯函数内计算事实，示例只展示已投影事实的最小形式。
完整观测已证明没有完成时，可评分为零；缺失完成边界和观测结束证据时为 unavailable，两者不能混同。
完成边界、业务指标和原始证据 ID 进入审计，整份 ctx 与 journal 不进入普通断言快照。
本地 ScoreMatch 与已有托管 ScoreMatch 都可复用；后者仍由正式 gateway 拥有模型调用与预算。
`closeQA` 接收集合 MaterialMatch，不把单个评分事实当成命中集合。

## 应用层默认材料与通用问答

`check` 是统一的断言入口，`closeQA` 将材料选择与验收问题组合为一个受管评分 Match，再交给同一接收者的 `check`。
`usedNoTools`、`calledTool` 与游戏自定义断言属于应用层；它们封装材料读取与既定判据，不建立另一套 evaluator。
`usedNoTools()` 不接受额外 Match。`closeQA` 是应用共用的问答能力，允许作者显式收窄材料。

通用应用入口仍为 `closeQA(materialMatch, question, options?)`。核心不会从任意应用 ctx 猜测默认取数方式。
Agent 应用为 attempt、session、turn 提供默认完整历史与现有领域 Match 的简写：

```ts
interface AgentJudgePresetMethods<Kind, C> extends JudgePresetMethods<Kind, C> {
  closeQA(question: string, options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
  closeQA(match: EventMatch | ToolMatch, question: string,
    options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
  closeQA<T>(match: MaterialMatch<C, T>, question: string,
    options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
}
t.closeQA("整个任务是否完成了用户要求？");
turn.closeQA("这轮是否解释清楚？");
turn.closeQA(eventMatch("message", { role: "assistant" }), "这些解释是否清楚？");
turn.usedNoTools().gate();
```

未提供 Match 时，Agent 材料由当前 scope 的正式 recorded event ledger 形成，不只取最终回答。
每项保留 eventId、sessionId、turnId、sessionSequence 和原始正式事件；工具事件附其正式逻辑 occurrence 与输入、回执和状态。
默认数据来自全部 sealed observed send，不以已经返回 handle 的 Turn 列表代替。失败或中断后保存的正式事件同样保留。

用户与助手消息、工具开始和终结、失败与取消、上下文注入、压缩、子任务及输入请求等正式事件均保留。
正式字段为 summary 的内容仍标为 summary，不冒充原始请求或完整输出；缺失关系保持明确未知。
该材料不包含应用没有上报的 provider 原始请求，不补造正文。

默认材料 reader 由 Agent 应用封装，不新增公开材料注册、绑定或 ctx 名称探测。
它使用接收者在 reader 前捕获的正式 cut；不在 Match 构造时捕获旧事实。
同会话先按该 cut 的前缀关联 started/finished，再选择当前 Turn 的事件。旧 Turn 不取得后续回执，B 轮可保留同前缀内 A 轮输入。
Agent 默认源捕获使用已有合法上限：16384 项、4 MiB、1048576 节点、深度 64。

需要其它源预算或领域材料时显式构造 MaterialMatch；Judge 材料和审计预算仍由 options 独立配置。

提供 EventMatch 时读取该 scope 的 eventOccurrences，提供 ToolMatch 时读取 toolCalls，并复用原受管领域 evaluator。
EventMatch 保留既有三类薄事件视图；需要工具输入与回执的问题使用 ToolMatch 或 MaterialMatch。
领域简写同用上述捕获上限，不在 predicate 前截断后宣称完整。

提供 MaterialMatch 时直接使用它的 ctx reader。三条归一化路径都形成同一个材料问答 Match，并交给 `check`。
空集合、完整性、全量顺序、预算、引用、取消和用量语义不因默认简写改变。
额外参数、普通值 Match、ScoreMatch、出现次数 Match 均不成为隐式材料入口。

### 默认与领域材料的完整性

| 问答材料 | 必需通道 | 不牵连的通道 |
|---|---|---|
| Agent 默认历史 | events、messages、actions，以及正式 cut 内的全部 sealed observed | usage、data |
| EventMatch 的三类事件集合 | events、messages、actions；三类事件共享一个完整集合 | usage、data |
| ToolMatch 的工具集合 | actions 与正式工具关系 | messages、usage、data |

任一必需通道 partial/unavailable、正在进行的 send、缺失正式段或真截断都使材料不可判定。
默认历史保留 orphan 或 ambiguous 行并声明 partial，零模型调用；不按问题文本猜测未知关系是否重要。
完整正式 summary 不等于缺源；需要缺失原文才能回答的问题由 Judge 返回 insufficient-evidence。
跨 Session 只承诺首次出现分组与各 sessionSequence，不能据数组顺序推断跨会话的墙钟因果。
