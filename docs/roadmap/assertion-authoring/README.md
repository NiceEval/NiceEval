# Assertion 作者面

## 用户需要

Eval 作者先描述一个可求值的事实，再明确选择它影响判定、控制流还是分数。
事实本身不携带严重度、计分值或停止策略，同一事实只求值一次。

```ts
const changed = t.sandbox.fileChanged("experiments/local.ts", {
  before: includes("runtime:node"),
  after: includes("runtime:python"),
});

t.assert(changed);
t.score("runtime 配置修复", changed, { max: 2 });
```

判定与控制流使用两个直接动词：

```ts
t.assert(turn.succeeded());

const config = await t.require(t.check(rawConfig, matches(ConfigSchema)));
```

`t.assert(fact)` 要求事实通过，但继续执行后续独立检查。
`await t.require(fact)` 也要求事实通过，并说明后续代码依赖它；失败或无法求值时结束依赖路径。

## 一套正交词汇

作者面分为三层：

- `t.check(subject, matcher)`、作用域方法与 Sandbox 方法只创建评估事实；
- `t.assert()`、`t.require()` 与受限的 `t.assertIfCovered()` 只创建判定用途；
- `t.score()` 只创建计分用途，并且只存在于 `defineScoreEval`。

新的 Fact 作者面不包含 `.gate()`、`.soft()`、`.optional()`、`.stopOnFailure()` 或 `.points()`。
CLI 也不提供 `--strict` 来改写源码已经声明的判定语义。

`.points(n)` 不作为 `t.score()` 的链式别名存在。
链式别名会重新把事实生产、判定和计分压回一个 handle，使调用顺序再次承担隐藏策略。

`t.score(label, fact, { max })` 明确表示按事实计分。
作者已经算好分数时使用 `t.score(label, { earned })`，两个签名不会靠位置参数猜含义。

## 本轮 Judge 边界

本 Roadmap 不修改任何公开 LLM / Judge API。
`t.judge.autoevals.*` 与 `turn.judge.autoevals.*` 的方法名、参数、返回句柄链、配置求值、网络调用和诊断语义保持现状；它们不是本轮公开 Fact producer。

实现只在 `buildJudge()` 已有的 `deps.record(...)` 注入缝上接一个私有 legacy Judge adapter。
它让 Judge spec 继续只求值一次，并把 adapter 归一化出的封闭 `LegacyJudgeAssertionResult` 作为隔离 sidecar 交给 Attempt 折叠；Fact 图不遍历它，Eval 作者也拿不到 `JudgeFact`。
这项兼容岛仍保留 Judge 现有的链式策略，后续若要迁移必须单独设计和验收，不能顺手改进本轮 Assertion 实现。

## 证据与比较

`includes()`、`pattern()`、`referencesAnyPath()`、`toolMatch()`、`commandMatch()`、`eventMatch()` 与布尔组合器都从 `niceeval/expect` 构造纯 `Match`。
matcher 不知道 Eval 类型，也不决定判定或计分用途。

`t`、session 与 turn 的领域方法消费同一份 `ToolMatch` / `EventMatch`，接收者只改变 scope。
文件 source、diff 和文件行为统一留在 `t.sandbox`。

普通 API 不接受未包装 selector、string shorthand、`match.*` namespace、递归 JSON rule 或第二套 order 语义。
结构数据使用 `equals()` 或 Standard Schema 的 `matches()`；CLI 的业务含义不固化成某个 JSON envelope。

## 结果边界

Boolean Fact 的求值结果是 `passed | failed | unavailable`。
Score Fact 的可用结果是 `[0,1]` 归一化分数；非有限值或越界值属于 evaluator error，不能裁剪。

事实结果与用途结果分别留档。
同一个事实可以各有一个判定用途和一个计分用途，报告因此能说明“事实是什么”“为何不通过”和“挣了多少分”，不再从字段组合反推角色。

`defineScoreEval` 允许在同一次 Agent Attempt 中同时写约束和计分。
约束失败产生 `invalid`，诊断保留已挣分数，但聚合贡献固定为 0；证据不足产生 `unavailable`，聚合贡献为 `null`。

## 研究取舍

- [Eve](../../research/assertion-api-dx/eve.md) 的 scope-first receiver 和独立 `require` 证明了“事实在哪里”与“后续代码是否依赖它”应直接可读；NiceEval 因而保留 receiver，但把 Fact 与用途彻底拆开。
- [Inspect AI](../../research/assertion-api-dx/inspect-ai.md) 的 `unscored`、[Braintrust](../../research/assertion-api-dx/braintrust-autoevals.md) 的 `score=None` 和 [smevals](../../research/assertion-api-dx/smevals.md) 的 `score: null` 都拒绝用假零分表示未完成评分；NiceEval 用显式 `unavailable` 联合保留原因。
- [Pydantic Evals](../../research/assertion-api-dx/pydantic-evals.md) 的具名多结果和 [LangSmith](../../research/assertion-api-dx/langsmith.md) 的 feedback key 说明了稳定人类名称的价值；NiceEval 把 `key` 放在 Fact use，不让它冒充 Fact 或 Evidence identity。
- [Ori Eval](../../research/assertion-api-dx/ori-eval.md) 的 Jest 式 `to*` 方法很易上手，但 NiceEval 不复制第二套 matcher method；值关系继续统一进 `niceeval/expect`。

## 入口

- [Library](library.md) —— Fact、`assert`、`require` 与 `score` 的公开形状。
- [Rule](matching.md) —— matcher 的组合与消歧语义。
- [Architecture](architecture.md) —— Fact 图、证据、结果状态与 Record 边界。
- [CLI](cli.md) —— `--strict` 退出后的退出码、展示与 JUnit 映射。
- [Use Case](use-case/README.md) —— 两道单轮 Harness 的完整调用。
- [类型原型](reference/README.md) —— 可独立运行的 TypeScript refinement 证明。
- [Research](../../research/assertion-api-dx/README.md) —— 外部 eval 框架的作者体验对照。

稳定 regrade identity 不由 matcher name 或展示 label 冒充。
Fact 用途可以声明稳定 `key`；replayable grading 中每个 `assert`、`assertIfCovered` 与 `score` 都必须提供 key。

key 只负责跨 Grading 对齐作者声明，不替代 `factId`、Claim identity 或 evidence locator。
Execution 与 Grading 怎样分离、选择和落盘，由[可重评分 Eval](../replayable-grading/README.md)定义。
