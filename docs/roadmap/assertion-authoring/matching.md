# Assertion 作者面 —— Match 与组合

## 值 matcher

`t.check()` 的第二参数是纯比较器，不携带判定用途、计分用途或控制流策略：

```ts
type MatchDomain = "value" | "tool" | "event";
declare const matchInputBrand: unique symbol;
declare const matchRefinementBrand: unique symbol;
declare const thresholdedScoreMatchBrand: unique symbol;

interface Match<in T, D extends MatchDomain> {
  readonly domain: D;
  readonly name: string;
  readonly [matchInputBrand]: (candidate: T) => void;
}

interface BooleanMatch<in T, out R extends T, D extends MatchDomain = "value"> extends Match<T, D> {
  readonly kind: "boolean";
  readonly [matchRefinementBrand]: () => R;
}

interface ScoreMatch<in T> extends Match<T, "value"> {
  readonly kind: "score";
  atLeast(threshold: number): ThresholdedScoreMatch<T>;
}

interface ThresholdedScoreMatch<in T> {
  readonly kind: "thresholded-score-match";
  readonly [thresholdedScoreMatchBrand]: (candidate: T) => void;
}

type ValueMatch<T, R extends T = T> = BooleanMatch<T, R, "value"> | ScoreMatch<T>;
type ToolMatch<R extends LogicalToolOccurrence = LogicalToolOccurrence> = BooleanMatch<LogicalToolOccurrence, R, "tool">;
type EventMatch<R extends MatchableEvent = MatchableEvent> = BooleanMatch<MatchableEvent, R, "event">;
```

三个 brand 都由 declaration 私有持有，不导出。输入 brand 与 refinement brand 分开，使 `ScoreMatch<T>` 的 `T` 只处于逆变位置；它不会伪造一个没有意义的输出 refinement。`ThresholdedScoreMatch` 是不透明 verdict 输入，不属于 `ValueMatch`，不能进入 `score()` 或布尔组合。

`ScoreMatch.atLeast(n)` 同步校验有限 `[0,1]` 阈值并返回冻结的纯 view。它保留底层 matcher identity，但不求值、不创建 Fact、不登记 use。只有 `check(valueOrSource, thresholdedMatch)` 或 `require(value, thresholdedMatch)` 会消费它；旧写法 `check(value, scoreMatch, { atLeast: n })` 是类型错误。

普通作者使用具名工厂，不能手写 selector object。matcher 成功后的 `R` 必须是原 candidate 的收窄类型，不是转换后的新值。
`matches(schema)` 只验证 Standard Schema，并按 `InferInput` 收窄；schema transform 的 `InferOutput` 不会替换原 candidate。

内部候选求值结果固定为 `matched | mismatched | unavailable`。
`matched` 携带同一个 candidate 的 refinement，另外两种携带非空诊断；`unavailable` 还携带 coverage reason。

它不使用 `passed | failed`，因为一笔 occurrence mismatch 不等于集合 Fact failed。

文本 matcher 只消费 string，不把任意值 `String()` 后搜索：

```ts
interface TextMatchOptions {
  readonly stripComments?: boolean;
}

declare function includes(text: string, options?: TextMatchOptions): BooleanMatch<string, string>;
declare function excludes(text: string, options?: TextMatchOptions): BooleanMatch<string, string>;
declare function pattern(expression: RegExp, options?: TextMatchOptions): BooleanMatch<string, string>;
declare function not<T>(match: BooleanMatch<T, T, "value">): BooleanMatch<T, T, "value">;
```

`includes()` / `excludes()` 分别表示字面子串存在与不存在；`pattern()` 才执行 RegExp。
带 `g` 或 `y` 的 RegExp 每次求值前把 `lastIndex` 归零，matcher 不修改作者传入实例的最终 `lastIndex`。
负正则写 `not(pattern(/.../))`；`not()` 只接受 value-domain BooleanMatch，不接受 ToolMatch、EventMatch 或 ScoreMatch，也不产生补集 refinement。

`stripComments` 保留现有能力，先按 NiceEval 的代码注释规则得到纯文本，再执行对应关系。
它不是通用语言 parser；无法可靠识别的文件类型应省略该选项。
`equals()` 是深相等，`matches()` 消费 Standard Schema。identifier slot 继续使用直接传入的 string exact；工具名、事件类型、executable、argv token 与 Sandbox path 都属于 identifier。

```ts
t.check(t.reply, includes("Brooklyn"));
t.check(
  t.sandbox.file("experiments/local.ts"),
  and(includes("runtime:python"), excludes("runtime:node")),
);
t.check(
  t.sandbox.file("src/index.ts"),
  not(pattern(/console\.log\s*\(/, { stripComments: true })),
);
t.check(turn.data, matches(ResultSchema));
```

关系由 matcher 名字决定，不由接收位置猜：没有未包装 string＝contains、直接 RegExp＝pattern，也没有 `{ contains, excludes }` 这一套旁路 rule。

### Standard Schema 与原值

```ts
declare function matches<S extends StandardSchemaV1>(
  schema: S,
): BooleanMatch<unknown, StandardSchemaV1.InferInput<S>, "value">;
```

`t.require(raw, matches(schema))` 通过后返回严格同一个 `raw`，类型只收窄到 `InferInput<S>`。
例如 `StandardSchemaV1<string, number>` 的 transform schema 通过后仍返回 string，不返回 number。
作者需要 transform output 时应显式调用 schema parser；转换不是比较。

coerce 或 preprocess schema 的 `InferInput` 若为 unknown，matcher 不承诺更窄类型。
[`type-prototype.ts`](reference/type-prototype.ts) 使用真实 `@standard-schema/spec` 类型锁定这项行为。

### 自定义 value matcher

内置 matcher 不足时，value domain 保留两个具名高级工厂：

```ts
declare function satisfies<T, R extends T>(label: string, predicate: (value: T) => value is R): BooleanMatch<T, R>;
declare function satisfies<T>(label: string, predicate: (value: T) => boolean | Promise<boolean>): BooleanMatch<T, T>;

declare function defineValueMatch<T, R extends T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => value is R;
}): BooleanMatch<T, R>;
declare function defineValueMatch<T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => boolean | Promise<boolean>;
}): BooleanMatch<T, T>;

declare function defineScoreMatch<T>(spec: {
  readonly name: string;
  readonly score: (value: T) => number | Promise<number>;
}): ScoreMatch<T>;
```

`satisfies()` 适合调用点的一次性条件，label 必填并进入 matcher detail。可复用 matcher 使用 `defineValueMatch()`；连续分数使用 `defineScoreMatch()`。
同步 type guard 可以收窄原 candidate；异步 boolean evaluator 不收窄。

自定义 matcher 不能返回 unavailable。throw、reject、非 boolean 结果、非有限 score 或 `[0,1]` 外 score 都是 evaluator defect，使 Attempt errored。
unavailable 只由标准 EvidenceSource、coverage-aware 内置 matcher、Judge 或 provider 等具名 evidence owner 产生。
这些工厂只创建 value matcher，不允许自定义 ToolMatch 或 EventMatch 绕过 Observation Protocol coverage。

现有 `makeAssertion()` 的能力由两条路径接替：boolean checker 使用 `defineValueMatch()`，连续 scorer 使用 `defineScoreMatch()`。
它们只创建 Match。判定阈值与计分由 `t.check()` / `t.require()` / `t.score()` 明确登记；value 或 source 加 Match 的调用会原子创建 Fact 并登记 use。

### `referencesAnyPath()`

```ts
declare function referencesAnyPath(
  paths: readonly [string, ...string[]],
): BooleanMatch<JsonValue, JsonValue, "value">;
```

`referencesAnyPath()` 在 plain JSON 的 string leaves 中匹配数组内任一路径。它遍历 array element 和 plain-object own data-property value，不匹配 key，也不调用 getter、`toJSON()` 或 `String()`。非 plain JSON、accessor 或 cycle 是 provider / evaluator defect，不能静默跳过。

路径把 `/` 与 `\\` 统一为 separator，移除空 component 与 `.`，保留 `..`，并按大小写精确的完整 component sequence 匹配。它不执行 cwd 或 symlink resolution，不展开子进程变量或 shell expression，也不处理 URL encoding 或文件系统大小写 profile。

例如 `.niceeval`、`./.niceeval/x`、`C:\\repo\\agents\\a` 与 `cat evals/x` 分别命中对应 pattern；`myagents`、`agents-old` 与 `.niceevaluation` 不命中。空数组、空路径、规范化后为空或重复的 pattern 都是同步 author error。

## `and()` 与 `or()`

两者至少接收两个同 domain 的 `BooleanMatch<T, R, D>`；`similarity()` 等连续 `ScoreMatch` 在类型层不能进入组合。

```ts
type RefinementOf<M> = M extends BooleanMatch<infer _T, infer R, infer _D> ? R : never;
type RefinementIntersection<M extends readonly unknown[]> = M extends readonly [infer Head, ...infer Tail]
  ? RefinementOf<Head> & RefinementIntersection<Tail>
  : unknown;

declare function and<
  T,
  R extends T,
  D extends MatchDomain,
  const Rest extends readonly [
    BooleanMatch<NoInfer<T>, T, NoInfer<D>>,
    ...BooleanMatch<NoInfer<T>, T, NoInfer<D>>[],
  ],
>(first: BooleanMatch<T, R, D>, ...rest: Rest): BooleanMatch<T, T & R & RefinementIntersection<Rest>, D>;

declare function or<
  T,
  R extends T,
  D extends MatchDomain,
  const Rest extends readonly [
    BooleanMatch<NoInfer<T>, T, NoInfer<D>>,
    ...BooleanMatch<NoInfer<T>, T, NoInfer<D>>[],
  ],
>(first: BooleanMatch<T, R, D>, ...rest: Rest): BooleanMatch<T, T & (R | RefinementOf<Rest[number]>), D>;
```

第一个 matcher 固定 candidate 与 domain，后续 matcher 只能消费同一 candidate、属于同一 domain。
`and()` 返回 refinement 交集，`or()` 返回 refinement 并集；两者至少接收两项。
[`type-prototype.ts`](reference/type-prototype.ts) 还锁定跨 domain、ScoreMatch 与 `not(commandMatch(...))` 都是编译错误。

求值规则：

- `and()`：任一 mismatched → mismatched；否则任一 unavailable → unavailable；否则 matched；
- `or()`：任一 matched → matched；否则任一 unavailable → unavailable；否则 mismatched；
- 两者按声明顺序 await 全部子项，输出每个未通过子项的诊断；
- 子 matcher 抛错不是 mismatched 或 unavailable，而是 evaluator defect；
- source resolution 在组合之外先执行一次，因此 `or()` 不能用另一分支掩盖文件读取失败。

JavaScript / `any` 的登记边界仍校验至少两项、同 domain 和布尔种类。
诊断按组合树和子项索引保留，经现有脱敏与预算规则写入 FactResult；内部 evaluator defect 不能被另一个决定性分支掩盖。

`not()` 采用同一三态：matched 与 mismatched 互换，unavailable 保持 unavailable，evaluator defect 继续抛出。
它不进入 tool / event domain；集合负存在性仍由 `notCalledTool()` / `notEvent()` 表达。

## 单 occurrence `ToolMatch`

```ts
type ToolStatus = "pending" | "completed" | "failed" | "rejected";
type LogicalCommandOccurrence = LogicalToolOccurrence & {
  readonly command: Extract<CommandProjection, { readonly kind: "command" }>;
};

declare function commandMatch(executable: string, options?: {
  argsStart?: readonly string[];
  excludes?: readonly string[];
  status?: ToolStatus;
}): ToolMatch<LogicalCommandOccurrence>;

declare function toolMatch(name: string, options?: {
  input?: BooleanMatch<JsonValue, JsonValue, "value">;
  status?: ToolStatus;
}): ToolMatch;

declare function toolMatch(options: {
  input: BooleanMatch<JsonValue, JsonValue, "value">;
  status?: ToolStatus;
}): ToolMatch;

interface ScopedFacts<P extends FactPhase> {
  calledTool(match: ToolMatch, options?: { count?: number }): BooleanFact<LogicalToolOccurrence, P>;
  notCalledTool(match: ToolMatch): BooleanFact<void, P>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanFact<void, P>;
}
```

`toolMatch()` 与 `commandMatch()` 都返回 domain=`tool` 的 `BooleanMatch`。command 没有独立 identity，因此不占一个 Match domain，也不再嵌进 `toolMatch()`。省略 `status` 表示“不限制 lifecycle”；需要 completed 必须显式写。无 name overload 必须携带 `input`，不能用空对象匹配所有工具，也不扩张为只含 status 的重复入口。直接传 `{ name, status }` 与 string shorthand 都不是公共入口。

`name`、`input`、logical command 与 `status` 都在同一笔 occurrence 上求值。需要同时约束 command 与 Adapter 工具分类时，使用 `and(commandMatch(...), toolMatch(...))`；两个 matcher 不会各自搜索 occurrence。字段 definite mismatch 压过 unavailable。当前不公开 `output`，因为缺失 output 还没有 `absent | opaque` 的证据状态，不能诚实地区分“确定没有”与“没观察到”。次数不属于 matcher：

```ts
t.check(turn.calledTool(toolMatch("shell", { status: "completed" }), { count: 1 }));
t.check(turn.notCalledTool(toolMatch("shell", { input: matches(ForbiddenInputSchema) })));
t.check(turn.calledTool(
  and(commandMatch("niceeval", { argsStart: ["show"] }), toolMatch("shell", { status: "completed" })),
));
```

`notCalledTool(match)` 的逻辑是“scope 内不存在满足 match 的 occurrence”。因此：

- 禁止 A 或 B 任一工具出现，写 `notCalledTool(or(toolMatch("A"), toolMatch("B")))`；
- 只禁止同一笔 occurrence 同时满足 A 与 B，写 `notCalledTool(and(A, B))`；
- `notCalledTool(and(A, B))` 不会禁止只满足 A 或只满足 B 的 occurrence。

Value matcher 只能经 `toolMatch({ input })` 提升到 tool domain。
`notCalledTool(or(A, B))` 在一个三态 Fact 内保留正确的德摩根语义，不应拆成两个各自登记的判定用途。

`toolOrder()` 用单调 cursor 消费不同 occurrence，只证明 request subsequence；它不证明前一项 finish-before-start，也不建立因果关系。

`calledTool(..., { count })` 是 exact count，必须是正 safe integer；零次使用 `notCalledTool()`。tool count 按 distinct occurrence identity，`toolOrder()` 按 occurrence start position 匹配有序子序列，每项消费不同 occurrence。partial / opaque 证据继续分别计算 definite path 与 possible path，不能把缺证据折成 failed。

## `commandMatch()`

`command` 只读取 durable logical projection：

1. logical executable 与第一个参数 exact；
2. logical argv 以 `argsStart` 逐 token exact 开头；
3. logical argv 不含任一 `excludes` exact token。

Adapter 先证明 original argv，Observation Protocol 再统一处理 direct、exact `pnpm exec`、`pnpm --silent exec` 与无 runner-option 的 exact `npx`。core 不按工具名、input key 或 raw shell text猜 command；opaque logical command 产生 unavailable。

`commandMatch()` 只保留 `executable`、`argsStart`、`excludes` 与共用 lifecycle `status`。cwd、env、raw text、wrapper、stdout、RegExp 与 predicate 不进入它；新增透明 wrapper 只能升级封闭 normalizer profile，不能开放 Eval 侧 registry。

`status` 不属于 command projection，而是 `toolMatch()` 与 `commandMatch()` 共用的 lifecycle evidence。
只有可信 `TurnOutcome.waiting` 下仍未解决的 operation，或原生协议明确给出的 pending，才能 definite match `pending`。
partial stream 中只有 start、没有可信 finish 时，status 是 unavailable，不能冒充 pending。

## `eventMatch()`

Tool 与 event 是两个观察层级，不是两套同义断言：

- tool occurrence 是一次归一化的逻辑调用；started 与 finished 被关联成同一 identity，适合判断 name、input、status、次数与调用 request 次序；
- event 是 typed timeline 中的一行；同一 tool occurrence 的 started 与 finished 是两个 event，message 也是 event，适合表达 lifecycle 与消息之间的时序。

因此默认优先用 `calledTool`、`notCalledTool` 和 `toolOrder`。只有需求必须区分 started / finished，或必须把工具 lifecycle 与 message 排在同一时间线上时，才进入 event 层。作者面保持 scope producer 与 matcher 分离的 `turn.event(eventMatch(...))`，不增加 `t.event(type, opts)` 这种把两层折成一个调用的旁路。

event 作者面不泄露 raw Adapter `StreamEvent`。`eventMatch` 与 `eventsSatisfy` 只读取一份封闭、冻结的 `AssertionEvent` 投影：

```ts
declare const assertionEventIdentityBrand: unique symbol;
declare const toolOccurrenceIdentityBrand: unique symbol;

type AssertionEventIdentity = string & { readonly [assertionEventIdentityBrand]: true };
type ToolOccurrenceIdentity = string & { readonly [toolOccurrenceIdentityBrand]: true };

interface EventPosition {
  readonly turnOrdinal: number;
  readonly eventOrdinal: number;
}

interface AssertionToolReference {
  readonly id: ToolOccurrenceIdentity;
  readonly name: string;
}

type AssertionEvent =
  | { readonly id: AssertionEventIdentity; readonly position: EventPosition;
      readonly type: "message"; readonly role: "assistant" | "user"; readonly text: string }
  | { readonly id: AssertionEventIdentity; readonly position: EventPosition;
      readonly type: "operation.started"; readonly tool: AssertionToolReference }
  | { readonly id: AssertionEventIdentity; readonly position: EventPosition;
      readonly type: "operation.finished"; readonly tool: AssertionToolReference;
      readonly status: "completed" | "failed" | "rejected" };
```

`AssertionEvent.id` 是稳定 event identity，`tool.id` 是关联 started/finished 的 logical occurrence identity。两者用不同 nominal brand 区分，字符串内容没有协议语义，也不能与 raw `operationId` 互换；作者只应依赖相等关系。投影不公开 raw operationId、Adapter metadata、output 或 command projection；普通字段匹配仍交给 `eventMatch` 与嵌套 `ToolMatch`。

`eventMatch()` 返回 domain=`event` 的 `BooleanMatch`，并按 event type 使用封闭 options 映射。普通 message 字段复用文本 matcher；tool start/finish 必须关联 logical occurrence 后复用同一个 `ToolMatch`，event 自己不复制 name/input/command/status：

```ts
interface EventOptionsByType {
  readonly message: { readonly role?: "assistant" | "user"; readonly text?: BooleanMatch<string, string, "value"> };
  readonly "operation.started": { readonly tool?: ToolMatch };
  readonly "operation.finished": { readonly tool?: ToolMatch };
}

declare function eventMatch<K extends keyof EventOptionsByType>(
  type: K,
  options?: EventOptionsByType[K],
): EventMatch<Extract<AssertionEvent, { readonly type: K }>>;

interface AggregateEventFacts<P extends FactPhase> {
  event(match: EventMatch, options?: { count?: number }): BooleanFact<AssertionEvent, P>;
  notEvent(match: EventMatch): BooleanFact<void, P>;
}

interface OrderedEventFacts<P extends FactPhase> extends AggregateEventFacts<P> {
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanFact<void, P>;
  eventsSatisfy(
    label: string,
    predicate: (events: readonly AssertionEvent[]) => boolean | Promise<boolean>,
  ): BooleanFact<void, P>;
}

t.check(turn.event(eventMatch("message", { role: "assistant", text: includes("done") })));
t.check(turn.eventOrder([
  eventMatch("operation.finished", { tool: toolMatch("send_email", { status: "rejected" }) }),
  eventMatch("message", { role: "assistant", text: includes("not sent") }),
]));
```

关联器按流位置把 started 与 finished 配成一笔唯一 occurrence。
`operationId` 只是允许完成后复用的配对 token，不能作为全局 identity。

- `event()` 的 exact count 是正 safe integer；零次使用 `notEvent()`；
- event count 按 distinct event identity；
- `eventOrder()` 按 `EventPosition` 消费不同事件，证明有序子序列；未匹配事件可以穿插；
- 同一 tool occurrence 的 start 与 finish 是两个 event。

`toolOrder()` 按 occurrence start position 只证明 request subsequence。只有在 `eventOrder()` 中显式排列前一笔 finish 与下一笔 start，才证明 finish-before-start。

`toolOrder`、`eventOrder` 与 `eventsSatisfy` 只存在于一个 Turn 或一个 Session。Session 内的 `EventPosition` 按 `(turnOrdinal, eventOrdinal)` 形成全序；Turn 使用这份顺序的单轮切片。根 `t` 可以聚合 event/tool presence、absence 与 count，但多个 Session 可以并发，因此根 scope 不提供这三个 order-sensitive producer。

`eventsSatisfy(label, predicate)` 只保留给内置 matcher 无法表达的跨事件关联，例如“finished event 中的关联 token 必须等于随后 message 引用的 token”。任意 predicate 没有可证明的单调性，所以它只在 scope 的 event evidence complete 时运行；证据不完整直接产生 unavailable，不能把当前切片的 `false` 当成 failed。

这个入口把作者耦合到 typed event stream，predicate throw/reject 属于 evaluator defect，因此不应用于普通 presence、count 或 order；这些需求必须走具名 producer。核心后续补出稳定的具名语义时，应以具名 matcher/producer 取代这个 escape hatch。

## 不提供通用 JSON rule

本作者面不增加 `JsonRule`、`shape`、数组 `exact/unordered`、field presence 或匿名 predicate。应用已经拿到的结构值用 `equals()` 或 `matches(schema)`；`niceeval show` 的业务诊断不通过匹配某个公开 JSON envelope来冒充语义判断。
