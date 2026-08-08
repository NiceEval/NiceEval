# Assertion 作者面 —— Library

本页定义 matcher、scope assertion、handle 与依赖值的公开形状。
运行时数据模型和三态求值见 [Architecture](architecture.md)。

## 值 matcher

值 matcher 从 `niceeval/expect` 导出：

```ts
import {
  commandSucceeded,
  defineAssertion,
  equals,
  excludes,
  includes,
  isDefined,
  isFalse,
  isTrue,
  matches,
  satisfies,
  similarity,
} from "niceeval/expect";
```

公开词汇如下：

| Matcher | 默认角色 | 用途 |
|---|---|---|
| `includes(needle, opts?)` | gate | 字符串包含或 RegExp 命中 |
| `excludes(needle, opts?)` | gate | 字符串不包含或 RegExp 不命中 |
| `equals(expected)` | gate | descriptor-safe snapshot 的完整结构相等 |
| `matches(schema)` | gate | Standard Schema 验证 |
| `similarity(expected)` | 无通过线的 soft | 归一化编辑距离，只写连续分 |
| `satisfies(predicate)` | 必须先 `.label()` | 同步 boolean predicate 或 type predicate |
| `isDefined()` | gate | 排除 `null | undefined` 并提供 refinement |
| `isTrue()` / `isFalse()` | gate | 严格 boolean 检查 |
| `commandSucceeded()` | gate | `CommandResult.exitCode === 0`，并提供命令失败诊断 |

`similarity()` 没有通用的默认及格线。
需要判定时，作者显式链 `.atLeast(x)` 或 `.gate(x)`；不链时它只贡献质量分。

回答版式规则不进入内置词汇。
URL 数量、Markdown 小节数与类似任务标准使用 `satisfies`、`defineAssertion` 或 Judge。

### Matcher 类型

```ts
declare const assertionInput: unique symbol;
declare const refinementOutput: unique symbol;

interface ValueAssertion<T = unknown> {
  /** Internal variance brand; not author-settable. */
  readonly [assertionInput]: (value: T) => void;
  label(name: string): ValueAssertion<T>;
  gate(threshold?: number): ValueAssertion<T>;
  atLeast(threshold: number): ValueAssertion<T>;
  soft(): ValueAssertion<T>;
  optional(): ValueAssertion<T>;
}

interface RefinementAssertion<T, S extends T> extends ValueAssertion<T> {
  /** Internal refinement brand; not author-settable. */
  readonly [refinementOutput]: S;
  label(name: string): RefinementAssertion<T, S>;
  gate(threshold?: number): RefinementAssertion<T, S>;
  atLeast(threshold: number): RefinementAssertion<T, S>;
  soft(): RefinementAssertion<T, S>;
  optional(): RefinementAssertion<T, S>;
}

interface UnlabeledRefinement<T, S extends T> {
  label(name: string): RefinementAssertion<T, S>;
}
```

Matcher 是不可变值。
每个 modifier 返回新值，原 matcher 可在多个 `t.check` 或 `t.require` 调用中安全复用。

`.label()` 要求非空、有界文本。
它只改变人读标题，不改变 matcher 算法、`groupPath`、scope、源码位置或 source order。

### `satisfies` 与 refinement

```ts
function satisfies<T, S extends T>(
  predicate: (value: T) => value is S,
): UnlabeledRefinement<T, S>;

function satisfies<T>(
  predicate: (value: T) => boolean,
): UnlabeledRefinement<T, T>;

function isDefined<T>(): RefinementAssertion<T, NonNullable<T>>;
```

`satisfies(predicate)` 先返回未命名 type-state。
它只能继续链 `.label(nonBlank)`，不能直接传给 `t.check` 或 `t.require`。
JavaScript 或 `any` 绕过静态类型时，调用边界同样拒绝未命名 predicate。

```ts
const oneFile = satisfies(
  (files: readonly string[]): files is readonly [string] => files.length === 1,
).label("恰好一个文件");

const [path] = await t.require(files, oneFile);
```

`t.check(value, satisfies(...)).label(...)` 不成立。
predicate 在 `t.check` 发生前必须已有可诊断标题。

所有 predicate 都是严格同步函数。
返回值必须恰为 boolean；thenable、truthy object、number、string、`undefined` 或 throw 都属于 evaluator defect。
异步自定义逻辑只使用 [`defineAssertion`](#defineassertion)。

### 声明值 snapshot

`equals` 与声明式 match 对象在 builder 调用时取得不可变 snapshot。
walker 只读取 own property descriptor，不调用 getter、`toJSON`，也不沿 prototype 取值。

接受的结构是：

- `null`、boolean、string 与有限 number；
- dense array；
- prototype 为 `Object.prototype | null`，且只含 own enumerable string-keyed data property 的 plain object；
- `JsonMatch` 额外允许 RegExp 与同步 predicate 作为叶。

拒绝 `undefined`、array hole、`NaN`、Infinity、bigint、symbol key/value、accessor、额外 array property、cycle 与 class instance。
`Date`、`Map`、`Set` 和 typed array 也不属于声明值。
共享但无环的引用按每个出现位置展开。

RegExp 只保存 `source` 与 `flags`。
每次测试 candidate 时创建新实例，因此 `g` / `y` 的 `lastIndex` 与调用者之后的 mutation 都不影响结果。
predicate leaf 只保留函数引用，snapshot 阶段不调用它；closure state 由作者拥有，matcher 求值时才读取。

`matches(schema)` 持有 Standard Schema 协议值，不把 schema class 送入上述 walker。

## `t.check` 与 typed `t.require`

```ts
declare const deferredFileContentBrand: unique symbol;

interface DeferredFileContent {
  readonly [deferredFileContentBrand]: "deferred-file-content";
}

type ImmediateValue<T> = T & {
  readonly [deferredFileContentBrand]?: never;
};

interface PassFailTestContext {
  check(file: DeferredFileContent, assertion: ValueAssertion<string>): AssertionHandle;
  check<T>(value: ImmediateValue<T>, assertion: ValueAssertion<T>): AssertionHandle;

  require<S extends string>(
    file: DeferredFileContent,
    assertion: RefinementAssertion<string, S>,
  ): Promise<S>;
  require(file: DeferredFileContent, assertion: ValueAssertion<string>): Promise<string>;
  require<T, S extends T>(
    value: ImmediateValue<T>,
    assertion: RefinementAssertion<T, S>,
  ): Promise<S>;
  require<T>(value: ImmediateValue<T>, assertion: ValueAssertion<T>): Promise<T>;
}

interface RequireScoreOptions {
  readonly points: number;
}

interface ScoreTestContext {
  check(file: DeferredFileContent, assertion: ValueAssertion<string>): ScoreAssertionHandle;
  check<T>(value: ImmediateValue<T>, assertion: ValueAssertion<T>): ScoreAssertionHandle;

  require<S extends string>(
    file: DeferredFileContent,
    assertion: RefinementAssertion<string, S>,
    options?: RequireScoreOptions,
  ): Promise<S>;
  require(
    file: DeferredFileContent,
    assertion: ValueAssertion<string>,
    options?: RequireScoreOptions,
  ): Promise<string>;
  require<T, S extends T>(
    value: ImmediateValue<T>,
    assertion: RefinementAssertion<T, S>,
    options?: RequireScoreOptions,
  ): Promise<S>;
  require<T>(
    value: ImmediateValue<T>,
    assertion: ValueAssertion<T>,
    options?: RequireScoreOptions,
  ): Promise<T>;
}
```

普通 generic overload 在类型层排除 `DeferredFileContent`；该品牌只走 file-aware overload。
JavaScript 入口也先按品牌分流，不能把 token 当成返回值。

`t.require` 只写入一条 Assertion，并固定使用 gate 与 stop control。
matcher 提供 evaluator、threshold、label、detail 与 optional；`t.require` 把 severity 提升为 gate，并保留显式 threshold。
没有 threshold 时使用 gate 默认线 1。

Score eval 的第三参是唯一 points 配置入口。
`points` 必须为正有限数；省略表示该 requirement 不进入得分面。
Pass/Fail eval 在静态类型和 JavaScript runtime 都拒绝第三参。

passed 时 `t.require` 返回原值或 refinement 后的 `S`。
failed 与 unavailable 都不返回；optional 只改变 unavailable 对 Verdict 的影响。
evaluator defect 直接使 Attempt errored。

## `defineAssertion`

异步或需要结构化诊断的 matcher 用 `defineAssertion`：

```ts
type CustomAssertionEvaluation =
  | {
      score: number;
      expected?: string;
      received?: string;
      evidence?: string;
    }
  | {
      unavailable: true;
      reason: string;
      evidence?: string;
    };

interface DefineAssertionSpec<T> {
  readonly name: string;
  readonly severity?: "gate" | "soft";
  readonly threshold?: number;
  evaluate(
    value: T,
    ctx: { readonly signal: AbortSignal },
  ): CustomAssertionEvaluation | Promise<CustomAssertionEvaluation>;
}

function defineAssertion<T>(spec: DefineAssertionSpec<T>): ValueAssertion<T>;
```

`name` 是 required author title。
返回的 matcher 仍可用 `.label()` 给某一次消费换人读标题。

合法 score 是有限的 `0..1`。
只有显式 `{ unavailable: true }` 表示预期的不可评估状态。
custom reason 必须是 1 到 64 个字符的 lowercase kebab slug；`AssertionResult.reason` 写成 `custom:<slug>`。

signal 由 Attempt deadline 与用户取消拥有。
`defineAssertion` 没有单项 timeout 选项；它和其它 Attempt 工作共用这一条 deadline。
evaluator 应响应 signal 并释放外部资源；collector 也会主动让 evaluator Promise 与 signal 竞争，不因一个永不 settle 的 Promise 卡住收尾。
取消、普通 rejection 与 late rejection 的分类见 [Architecture · Evaluator 边界](architecture.md#evaluator-边界)。

## 已登记 handle

值 matcher 不可变，已登记 handle 则指向一条 pending Assertion。

```ts
interface AssertionHandle {
  label(name: string): AssertionHandle;
  gate(threshold?: number): AssertionHandle;
  atLeast(threshold: number): AssertionHandle;
  soft(): AssertionHandle;
  optional(): AssertionHandle;
  stopOnFailure(): Promise<void>;
}

interface ScoreAssertionHandle {
  label(name: string): ScoreAssertionHandle;
  points(n: number): ScorePointHandle;
  gate(threshold?: number): ScoreAssertionHandle;
  atLeast(threshold: number): ScoreAssertionHandle;
  soft(): ScoreAssertionHandle;
  optional(): ScoreAssertionHandle;
  stopOnFailure(): Promise<void>;
}

interface ScorePointHandle {
  label(name: string): ScorePointHandle;
  gate(threshold?: number): ScorePointHandle;
  optional(): ScorePointHandle;
  stopOnFailure(): Promise<void>;
}
```

modifier 更新同一条 pending Assertion 并返回同一逻辑 handle。
alias 会观察到相同配置；不要把 handle 当不可变 matcher 分支复用。

求值一开始，handle 立即冻结。
`stopOnFailure()`、`t.require` 与 finalize 都是冻结点；之后经任何 alias 调 modifier 都同步报 author error。

`.stopOnFailure()` 必须 `await`：

```ts
await turn.calledTool("shell")
  .label("执行命令")
  .points(1)
  .gate()
  .stopOnFailure();
```

passed 时 Promise fulfill 为 `undefined`。
failed 或 unavailable 写入各自 outcome 后中止依赖代码；evaluator defect 进入 Attempt error。
没有通过线的 pure soft handle 不能调用 `.stopOnFailure()`。

浮空调用不受支持。
框架不会在下一个 `t.*` 边界补结算，也不会删除已经发生的副作用或后续 Assertion 来模拟 `await`。

## Scope assertion

turn、session 与 `t` 共享下面的词汇；接收者决定事实范围与 snapshot 时机：

```ts
type CountMatch =
  | number
  | { readonly min: number; readonly max?: number }
  | { readonly min?: number; readonly max: number };

interface ToolMatch {
  readonly input?: JsonMatch;
  readonly output?: JsonMatch;
  readonly status?: "pending" | "completed" | "failed" | "rejected";
  readonly count?: CountMatch;
}

interface SubagentMatch {
  readonly status?: "pending" | "completed" | "failed";
  readonly remoteUrl?: string | RegExp | ((url: string) => boolean);
  readonly output?: JsonMatch;
  readonly count?: CountMatch;
}

interface ScopedAssertions<H> {
  succeeded(): H;
  parked(): H;
  messageIncludes(token: string | RegExp): H;
  calledTool(name: string, match?: ToolMatch): H;
  notCalledTool(name: string, match?: Omit<ToolMatch, "count">): H;
  toolOrder(names: readonly [string, string, ...string[]]): H;
  usedNoTools(): H;
  maxToolCalls(max: number): H;
  loadedSkill(skill: string): H;
  calledSubagent(name: string, match?: SubagentMatch): H;
  noFailedActions(): H;
  event(match: EventMatch, opts?: { readonly count?: CountMatch }): H;
  notEvent(match: EventMatch): H;
  eventOrder(sequence: readonly [EventMatch, EventMatch, ...EventMatch[]]): H;
  maxTokens(max: number): H;
  maxCost(usd: number): H;
}
```

`CountMatch` 的 number 表示 exact count；range 至少有一端。
所有数都是非负 safe integer，且 `min <= max`。
省略 count 等价于 `{ min: 1 }`。

`notCalledTool` 与 `notEvent` 不接收 count。
它们就是 count 0 的专名，不产生“没有恰好两次”一类双重语义。

工具名同时匹配 canonical name 与 adapter 保留的 original name。
`input`、`output`、`status` 与 count 作用于同一批 logical occurrences。

### `EventMatch`

```ts
type TextMatch = string | RegExp;

type MessageEventMatch =
  | {
      readonly type: "message";
      readonly text?: TextMatch;
      readonly role?: never;
      readonly origin?: never;
    }
  | {
      readonly type: "message";
      readonly role: "assistant";
      readonly text?: TextMatch;
      readonly origin?: never;
    }
  | {
      readonly type: "message";
      readonly role: "user";
      readonly origin?: "eval" | "agent";
      readonly text?: TextMatch;
    };

type EventMatch =
  | ({ readonly type: "tool"; readonly name?: string } & Omit<ToolMatch, "count">)
  | ({ readonly type: "subagent"; readonly name?: string } & Omit<SubagentMatch, "count">)
  | MessageEventMatch
  | { readonly type: "skill"; readonly skill?: TextMatch }
  | ({ readonly type: "input-request" } & InputRequestFilter)
  | { readonly type: "thinking"; readonly text?: TextMatch }
  | { readonly type: "context"; readonly text?: TextMatch; readonly source?: TextMatch }
  | { readonly type: "compaction"; readonly reason?: TextMatch }
  | { readonly type: "error"; readonly message?: TextMatch };
```

同一 EventMatch 内的字段是 AND。
string 严格相等，RegExp 按 pattern 测试；string 不暗含 contains。
`InputRequestFilter` 的文本字段也复用 `TextMatch`，不增加 predicate 形态。
包含语义使用 `messageIncludes` 或显式 RegExp。

EventMatch 不接受 count，也不接受通用 text predicate。
`event()` 的第二参才拥有 count；`eventOrder()` 类型上至少两项。
`toolOrder()` 同样要求至少两个非空工具名。
JavaScript 或 `any` 传入不足两项、空名字或非法 matcher 时，登记边界同步报 author error。

`event()` 对 tool 与 subagent 数 logical occurrence，不数 start / finish raw frames。

### 两种顺序

`toolOrder` 是 logical tool start 的名字子序。
pending occurrence 也拥有可信 start，可出现在任意位置。

`eventOrder` 是非重叠 sequence。
tool 与 subagent 使用 start-to-finish interval；下一项必须在前一项结束后开始。
普通 message、thinking 等事件是单点。
最终一项可以是 open operation，非最终项必须 closed。

两种 order 都只在同一 session 内找链。
turn 只看本轮；session 可以跨自己的 turns；`t` 要求至少一个 session 内存在完整链。
算法和 evidence 规则见 [Architecture · Order](architecture.md#order)。

### `eventsSatisfy`

```ts
interface TurnEventGroup {
  readonly turn: string;
  readonly events: readonly StreamEvent[];
}

interface SessionEventGroup {
  readonly session: string;
  readonly turns: readonly TurnEventGroup[];
}

turn.eventsSatisfy(
  label: string,
  predicate: (events: readonly StreamEvent[]) => boolean,
): Handle;

session.eventsSatisfy(
  label: string,
  predicate: (turns: readonly TurnEventGroup[]) => boolean,
): Handle;

t.eventsSatisfy(
  label: string,
  predicate: (sessions: readonly SessionEventGroup[]) => boolean,
): Handle;
```

label required。
对应 scope 的 events channel 全部 complete 后，框架才调用 predicate 一次。
输入是 event-only immutable view，不暴露 status、data、usage、coverage 或 Record 字段。

## `requireInputRequest`

`t.requireInputRequest(filter?)` 与 session receiver 保留同步、assertion-backed 语义。
它要求对应 session snapshot 中恰好一项待回答请求并返回该 `InputRequest`。

- 0 项且 events complete：failed；
- 0 项且 events 非 complete：unavailable；
- 2 项以上：确凿 failed；
- 1 项且 events complete：passed 并返回；
- failed 与 unavailable 都通过内部同步 control signal 中止依赖代码。

`t` 版本只驱动 primary session，不读取 attempt aggregate。
写入的 Assertion scope 是 primary session 及其 `through` turn。

没有 `requireToolCall`、`requireSubagentCall` 或 generic `requireEvent`。
消费 exact-one 值的重复真实需求出现前，普通存在性使用 scope assertion，数据依赖使用 typed `t.require`。

## Sandbox Assertion

aggregate 入口增加 `noChanges()`：

```ts
t.sandbox.fileChanged(path);
t.sandbox.fileDeleted(path);
t.sandbox.notInDiff(pattern);
t.sandbox.noChanges();
```

Sandbox-backed turn 额外暴露：

```ts
interface TurnChanges<H> {
  fileChanged(path: string): H;
  fileDeleted(path: string): H;
  notInDiff(pattern: string | RegExp): H;
  noChanges(): H;
}

turn.changes.fileChanged("evals/policy/cancel.eval.ts");
```

turn changes 只筛选该 turn 对应 send 区间的 before/after delta。
它不提供 `readText`、`runCommand`、diff material 或第二次采集。
session 没有 changes 入口。

`fileChanged` 表示所选 delta 中 path 是 added 或 modified；`fileDeleted` 表示 deleted。
`noChanges` 只证明应用固定 ignore/include 规则后，所选 delta 为空。
缺少目标 send 区间或 diff export 失败时结果是 unavailable；缺区间不等于没有变化。

Direct Agent 的类型不暴露 `t.sandbox` 或 `turn.changes`。
JavaScript 越过 capability 类型时，登记 diff consumer 会同步报 author error。

### Delayed file

```ts
t.check(t.sandbox.file(path), equals(original));
```

`t.sandbox.file(path)` 在 consumer 求值边界读取文本：

| File resolution | Matcher | Assertion outcome |
|---|---|---|
| available text | 调用一次 | 按 matcher |
| provider 明确 not found | 不调用 | failed，`received` 显示 missing path |
| permission、transport、timeout、terminated 或未知读取失败 | 不调用 | unavailable，reason=`sandbox-file-unavailable` |

missing 不会变成 `undefined`、空串或私有 sentinel。
因此 `excludes`、schema 与 custom string matcher 都不能在文件不存在时假通过。
要证明删除使用 `fileDeleted(path)`。

`t.check` 延迟到 finalize；`await t.require(t.sandbox.file(...), matcher)` 在调用点求值并返回真实 string 或 refinement 后的 string subtype。

## Judge 交接

Judge handle 没有 `.label()`。
每个 `t.judge.llm`、session Judge 或 turn Judge 都使用 required `name` 作为唯一 author title，同时保留 points、severity、optional 与 awaited stop modifiers。

结构化 JSON 材料与二元 Judge 分数只在原生 Runtime 定义：

- [`material.json`](../llm-judge-runtime/library.md#材料) —— eager、descriptor-safe JCS snapshot；
- [`scoreMode: "binary"`](../llm-judge-runtime/library.md#judge-check) —— completed Decision 只接受 score 0 或 1。

Eval 仍须在定义期声明 `judge.llm.uses`。
`material.json` 产生 `application/json` text part，只需要现有 `media: ["text"]`。
