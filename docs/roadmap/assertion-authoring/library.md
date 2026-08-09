# Assertion 作者面 —— Library

## 评估事实

值 matcher、作用域检查与 Sandbox 检查都先返回受 `t` 管理的评估事实。
创建事实不会隐式改变 Attempt 判定，也不会隐式计分。

Judge 的公开句柄不在本轮迁移范围；隔离边界见 [Architecture · Legacy Judge bridge](architecture.md#legacy-judge-bridge)。

```ts
type FactPhase = "now" | "final";
declare const factBrand: unique symbol;

interface BooleanFact<out R = unknown, P extends FactPhase = FactPhase> {
  readonly kind: "boolean";
  readonly phase: P;
  readonly [factBrand]: () => R;
}

interface ScoreFact<P extends FactPhase = FactPhase> {
  readonly kind: "score";
  readonly phase: P;
  readonly [factBrand]: () => number;
}

interface EvidenceSource<out T, P extends FactPhase = "final"> {
  readonly phase: P;
}

interface TestContext {
  check<T, R extends T>(subject: T, match: BooleanMatch<T, R, "value">): BooleanFact<R, "now">;
  check<T, R extends T, P extends FactPhase>(
    subject: EvidenceSource<T, P>,
    match: BooleanMatch<T, R, "value">,
  ): BooleanFact<R, P>;

  check<T>(subject: T, match: ScoreMatch<T>): ScoreFact<"now">;
  check<T, P extends FactPhase>(subject: EvidenceSource<T, P>, match: ScoreMatch<T>): ScoreFact<P>;
}
```

Boolean Fact 产出 `passed | failed | unavailable`。
通过 type guard 或 Standard Schema 收窄的类型保存在 `R`，事实通过 `require` 后返回原 candidate 的收窄视图。

Score Fact 产出 `[0,1]` 内的归一化分数或 `unavailable`。
自定义 scorer 返回非有限值或范围外数值时属于 evaluator error，运行时不能 clamp。

```ts
const answer = t.check(turn.message, and(includes("Brooklyn"), excludes("draft")));
const quality = t.check(turn.message, similarity(expected));
const source = t.check(
  t.sandbox.file("experiments/local.ts"),
  and(includes("runtime:python"), excludes("runtime:node")),
);
```

File source 在一条事实内只读取一次，组合子 matcher 共用同一个 string candidate：

| File resolution | Fact outcome |
|---|---|
| available UTF-8 text | 运行 matcher |
| missing / invalid UTF-8 | `failed` |
| permission / transport / timeout / terminated | `unavailable`，reason=`sandbox-file-unavailable` |
| provider 返回非法 envelope | evaluator error |

missing 不会变成空字符串，因此 `excludes()` 不能让不存在的文件假通过。

## 明确登记判定

`t.assert()` 和 `t.require()` 都明确表示“这个事实必须通过”。
差别只在控制流：`assert` 继续收集独立事实，`require` 结束依赖失败结果的后续路径。

```ts
interface FactUseOptions {
  readonly key?: string;
  readonly label?: string;
}

interface ScoreThresholdOptions extends FactUseOptions {
  readonly atLeast: number;
}

interface TestContext {
  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options?: FactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: ScoreThresholdOptions): void;

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require(fact: ScoreFact<"now">, options: ScoreThresholdOptions): Promise<number>;

  require<T, R extends T>(
    value: T,
    match: BooleanMatch<T, R, "value">,
    options?: FactUseOptions,
  ): Promise<R>;
}
```

```ts
t.assert(answer);
t.assert(quality, { atLeast: 0.7, label: "回答质量" });
t.assert(source);

const config = await t.require(t.check(rawConfig, matches(ConfigSchema)));
const command = await t.require(commandResult, commandSucceeded(), { label: "测试命令" });
```

`key` 是跨 Grading 对齐 Fact 用途的稳定作者身份，`label` 只负责人读展示。
inline `test(t)` 中 key 可省略；提供时必须在该 Eval definition 内唯一。

key 必须匹配 `[a-z0-9][a-z0-9._/-]{0,127}`。
它不能包含凭据、动态 locator、数组下标或运行后才知道的值。

`require(value, matcher)` 是立即值检查的便捷形态。
它在内部原子创建一个 Boolean Fact、登记 `require` 用途并返回同一个 value 的收窄类型。

`require` 只接受 `phase: "now"` 的事实。
Turn 是不可变即时事实，session 在事实创建处捕获 snapshot；`t` 聚合与最终 Sandbox diff 属于 `final`，不能作为中途控制流前提。

未通过的 `assert` 不阻止后面的 TypeScript 代码执行。
未通过或无法求值的 awaited `require` 已经登记判定用途，再通过受管控制信号结束依赖路径；它不是 execution error。
控制信号发出前 collector 已关闭；作者 catch rejection 也不能恢复路径，后续受管调用会再次得到同一信号。

`require` 返回受管 thenable，类型上仍满足 `Promise<R>`。
它有 `created → observed-pending → settled` 生命周期：`await` 或 `.then(...)` 开始观察，Fact 和登记的 continuation 都完成后才算 settled。
下一个由 Eval 作者触发的受管边界到来时，`created` 表示 requirement 从未观察，`observed-pending` 表示依赖尚未完成；两者都是 author error。
因此浮空 Promise、只登记 `.then(...)` 就立刻继续 `send`，以及丢下未 settle 的链后返回，都不能冒充已表达的控制流。

## 证据适用范围

通用 `optional()` 不属于目标 API。
Eval 作者若只是想留下不影响判定的说明，使用 `t.diagnostic()`；连续质量属于 Score Fact，应明确 `assert` 或 `score`。

usage 证据存在一个窄入口：

```ts
declare const usageCoverageBrand: unique symbol;

interface UsageEvidenceFact<P extends FactPhase = FactPhase> extends BooleanFact<unknown, P> {
  readonly [usageCoverageBrand]: true;
}

interface TestContext {
  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options?: FactUseOptions): void;
}
```

只有 core 的 usage 事实生产者能返回 `UsageEvidenceFact`。
现有 Judge 句柄、Sandbox、普通 matcher、自定义 evaluator 与其它证据通道不能传给 `assertIfCovered()`。

`assertIfCovered()` 先求值事实。
部分 usage 证据已经足以证明 passed 或 failed 时保留该结果；只有事实为 unavailable，且原因完全来自 Agent 创建时声明 usage 不可用，判定用途才成为 `notApplicable`。

Agent 创建时声明 usage complete，运行中再因截断或协议降级变成 unavailable 时不能得到 `notApplicable`。
这类结果仍是证据不足，并按普通硬约束处理。

通过制 Eval 的全部 Fact 判定用途都是 `notApplicable`，且没有 legacy Judge assertion 时，Attempt 是 `skipped`，不能显示为绿色通过。

## 明确登记计分

`t.score()` 只存在于 `defineScoreEval` 的 context。
按事实计分和作者直接给分使用不相交的参数形状：

```ts
interface ScoreTestContext extends TestContext {
  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key?: string; readonly max: number },
  ): void;

  score(label: string, direct: { readonly key?: string; readonly earned: number }): void;
  finishScore(): ScoreCompletion;
}

declare const scoreCompletionBrand: unique symbol;

interface ScoreCompletion {
  readonly [scoreCompletionBrand]: true;
}
```

Boolean Fact 通过挣得 `max`，失败挣 0；Score Fact 按 `max × normalizedScore` 计分。
`max` 必须是正有限数，`earned` 必须是非负有限数。

```ts
const changed = t.sandbox.fileChanged("experiments/local.ts");
t.assert(changed);
t.score("runtime 配置修复", changed, { max: 2 });

const quality = t.check(turn.message, similarity(expectedAnswer));
t.assert(quality, { atLeast: 0.7 });
t.score("回答质量", quality, { max: 20 });

t.score("代码精简", { earned: tierPoints });
return t.finishScore();
```

同一个事实最多登记一个判定用途和一个计分用途，两者可以同时存在。
因此硬约束兼计分写成相邻的 `assert` 与 `score`，事实仍只求值一次。

`defineScoreEval.test` 返回私有品牌 `ScoreCompletion`。
正常尾部和有意提前完成都使用 `return t.finishScore()`。
需要说明分支原因时，先调用 `t.diagnostic(...)`；运行时不能可靠判断同一个调用在源码里是“尾部”还是“提前”，因此完成 token 不接受 reason。

`finishScore()` 原子关闭 collector，之后再登记事实或用途属于 author error。
正常路径没有任何计分用途或 legacy Judge assertion 时，`finishScore()` 也是 author error。
显式零分使用 `t.score(label, { earned: 0 })`，不能靠空 Eval 表达；Judge-only Score Eval 由隔离 sidecar 证明它并非空测试。

`require` 未通过、`require` 无法求值、legacy Judge `.stopOnFailure()` 未通过与 `t.skip()` 是合法终止路径，不要求执行到不可达的 `finishScore()`。
通过制 Eval 正常结束时必须至少有一个 Fact 判定用途或 legacy Judge assertion，除非路径已经显式 `t.skip()`。

这里没有 Eval 级满分声明。
所有计分用途仍然逐项累加，`finishScore()` 只关闭控制流，不检查 `Σ max`。

## Replayable grading 的用途 key

[可重评分 Eval](../replayable-grading/README.md)复用同一套 Fact 与用途 API，但把 key 提升为必填：

```ts
interface KeyedFactUseOptions extends FactUseOptions {
  readonly key: string;
}

interface KeyedScoreThresholdOptions extends KeyedFactUseOptions {
  readonly atLeast: number;
}

interface ReplayGradingFactUses {
  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options: KeyedFactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: KeyedScoreThresholdOptions): void;
  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options: KeyedFactUseOptions): void;
}

interface ReplayScoreFactUses extends ReplayGradingFactUses {
  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key: string; readonly max: number },
  ): void;
  score(label: string, direct: { readonly key: string; readonly earned: number }): void;
}
```

一个 GradingDefinition 内的 Fact use key 全局唯一。
同一 Fact 同时用于判定与计分时，两项使用不同 key，但继续按同一个 `factId` 复用求值结果。

Grading context 不提供 `require()`。
它不能改变已经封口的 Agent 控制流；`assert()` 只登记当前 Grading 的 Claim。

## Tool 与 event 事实

presence、absence、count 与 order 复用同一个单 occurrence match。
接收者方法返回 Fact，不登记判定策略：

```ts
interface CollectionMatch {
  readonly count?: number;
}

interface ScopedFacts<P extends FactPhase> {
  calledTool(match: ToolMatch, options?: CollectionMatch): BooleanFact<LogicalToolOccurrence, P>;
  notCalledTool(match: ToolMatch): BooleanFact<void, P>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanFact<void, P>;

  event(match: EventMatch, options?: CollectionMatch): BooleanFact<MatchableEvent, P>;
  notEvent(match: EventMatch): BooleanFact<void, P>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanFact<void, P>;
}
```

```ts
t.assert(turn.calledTool(commandMatch("niceeval", {
  argsStart: ["show"],
  status: "completed",
})));

t.assert(turn.toolOrder([
  commandMatch("niceeval", { argsStart: ["exp", "local"] }),
  commandMatch("niceeval", { argsStart: ["show"], status: "completed" }),
]));

t.assert(turn.notCalledTool(
  toolMatch({ input: referencesAnyPath([".niceeval", "evals", "agents"]) }),
));
```

`commandMatch()` 与 `toolMatch()` 都匹配同一个 logical tool occurrence。
需要同时约束 command 与 Adapter 工具分类时，使用 `and(commandMatch(...), toolMatch(...))`；两个分支不会分别寻找 occurrence。

禁止任一候选工具使用 `or()`，要求同一 occurrence 同时满足多个条件才使用 `and()`。
负存在性继续由 `notCalledTool()` 表达，不为判定策略增加另一套词汇。

## Sandbox 事实

文件材料与 agent 归因 diff 都属于 `t.sandbox`：

```ts
interface EvalSandbox {
  changedPaths(paths: readonly string[]): BooleanFact<void, "final">;
  noChanges(): BooleanFact<void, "final">;
  fileChanged(path: string, options?: {
    before?: BooleanMatch<string, string, "value">;
    after?: BooleanMatch<string, string, "value">;
  }): BooleanFact<void, "final">;
  fileDeleted(path: string): BooleanFact<void, "final">;
  file(path: string): EvidenceSource<string, "final">;
}
```

`changedPaths()` 比较应用 `EvalDefinition.diff.ignore` 后的 exact path set。
顺序无意义，重复 expected path 是 author error；added、modified、deleted 与净改回但确实触及的 path 都计入。

`fileChanged(path, options)` 的 before / after matcher 必须由同一条 change entry 满足。
文本关系继续复用 `includes()` / `excludes()`，不增加 `beforeIncludes` 一类关系别名。

工具输入负约束使用 `notCalledTool(toolMatch({ input }))`。
证据不完整且没有已知命中时 Fact 为 unavailable；这项组合不冒充 OS 审计。

## 普通路径边界

`niceeval/expect` 只导出独立工厂。
字面文本用 `includes()` / `excludes()`，RegExp 用 `pattern()`，结构验证用 `matches()`。

领域 occurrence 使用 `toolMatch()` / `eventMatch()` / `commandMatch()`，布尔组合使用 `and()` / `or()`。
不同时提供 `match.*`、fluent 同义入口或递归 JSON AST。

一次性自定义值条件使用 label 必填的 `satisfies()`；复用检查或 scorer 使用 `defineValueMatch()` / `defineScoreMatch()`。
这些是 value-only 入口，不能扩张 ToolMatch / EventMatch，也不能自行返回 unavailable。
