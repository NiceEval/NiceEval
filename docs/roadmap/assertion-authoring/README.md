# Assertion 作者面

## 用户需要

Eval 作者只需要回答三类问题：拿什么证据、如何比较、观察哪个 scope。普通调用应能在一行内读完，不先声明共享 matcher，不暴露 Match AST，也不让 `t.check()` 同时承担文件读取、JSON 查询和领域事件解释。

```ts
t.check(t.sandbox.file("experiments/local.ts"), and(includes("runtime:python"), excludes("runtime:node"))).points(2).gate();
t.check(t.sandbox.file("src/index.ts"), not(pattern(/console\.log\s*\(/, { stripComments: true })));
turn.calledTool(commandMatch("niceeval", { argsStart: ["show"], status: "completed" })).gate();
turn.toolOrder([
  commandMatch("niceeval", { argsStart: ["exp", "local"] }),
  commandMatch("niceeval", { argsStart: ["show"], status: "completed" }),
]).gate();
```

这里有一套统一语法，而不是三套 DSL：

- `t.check(subject, matcher)` 把值或延迟 source 与纯 matcher 配对；
- `includes()`、`pattern()`、`referencesAnyPath()`、`toolMatch()`、`commandMatch()`、`eventMatch()` 与布尔组合器都从 `niceeval/expect` 构造纯 `Match`；
- `t`、session、turn 的领域断言消费同一个 `ToolMatch` / `EventMatch`，接收者只改变 scope；
- 文件 source、diff 和文件行为统一留在 `t.sandbox`。

## 最小扩展

本 Roadmap 只补现有词汇无法诚实表达的能力：

- matcher 与 severity、threshold、optional、points 分离；登记策略只在 Assertion handle；
- 布尔 matcher 可用 `and()` / `or()` 正交组合，连续评分 matcher 不进入布尔组合；
- 字面文本、RegExp 与 Standard Schema 分别使用 `includes()` / `excludes()`、`pattern()` 与 `matches()`，不因统一语法丢失现有 `stripComments`；
- presence、absence、count 与 order 复用同一份单 occurrence `ToolMatch` / `EventMatch`；
- `commandMatch()` 是一类 `ToolMatch`，消费 Observation Protocol 的 logical command，不要求作者知道 Adapter 工具名，也不匹配 raw shell text；
- `t.sandbox.file(path)` 是延迟 `EvidenceSource<string>`，缺失文件不能冒充空字符串；
- `notCalledTool(toolMatch({ input }))` 复用工具负存在性；`changedPaths()`、`noChanges()` 与带内容条件的 `fileChanged()` 补齐 Harness 所需的标准事实。

普通 API 只提供独立 matcher 工厂，不再允许直接传 selector 对象、string shorthand、`match.*` namespace、fluent 同义入口、递归 JSON rule、匿名 `where` 或第二套 order 语义。结构数据继续用 `equals()` 或 Standard Schema 的 `matches()`；CLI 的业务含义由公开输出与完整 Turn 语义判断，不把某个 JSON envelope 固化进 core。

需要自定义值关系时，具名 `satisfies()`、`defineValueMatch()` 与 `defineScoreMatch()` 是高级逃生口。
它们不能创建 ToolMatch / EventMatch，也不能自行制造 unavailable；Observation Protocol coverage 仍由 core 拥有。

## 结果边界

确定性 Assertion 继续产生 `passed | failed | unavailable`：

- available candidate 与 matcher 不符是 failed；
- source、logical command 或 coverage 不足，且事实仍可能成立，是 unavailable；
- matcher、Adapter 或 provider 违反自身协议，才使 Attempt errored。

布尔组合不会掩盖证据缺口：`and()` 中 failed 压过 unavailable；`or()` 中 passed 压过 unavailable。两者按声明顺序求值全部子项以保留诊断，但 matcher 抛错仍是 evaluator defect。

## 入口

- [Library](library.md) —— 公开方法与类型形状。
- [Rule](matching.md) —— matcher 的组合与消歧语义。
- [Architecture](architecture.md) —— source、command projection、coverage 与错误分类。
- [Use Case](use-case/README.md) —— 两道单轮 Harness 的用户需要与最终调用。
- [类型原型](reference/README.md) —— 可独立运行的 TypeScript refinement 与 handle 状态机证明。
- [Research](../../research/assertion-api-dx/README.md) —— 外部 eval 框架的作者体验对照。

稳定 regrade identity 不由 matcher name 或 `.label()` 冒充。
保存 matcher spec、版本、证据以及可寻址 key 属于后续 regrade 设计；本 Roadmap 不继续扩 matcher 承担它。
