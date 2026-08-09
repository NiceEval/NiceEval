# Assertions —— 库用法

先创建 Fact，再在 `t` 上消费它：

```ts
const turn = await t.send("解释变更。");
const hasSummary = t.check(turn.message, includes("变更"));
const completed = turn.succeeded();

t.assert(hasSummary, { label: "说明变更" });
t.assert(completed);
```

`t.check`、turn/session scope 方法和 `t.sandbox` Fact producer 都是惰性的。它们不会仅因创建而改变 verdict、得分或调用外部 evaluator。

## 判定 use

```ts
t.assert(booleanFact, { key: "answer-present", label: "回答存在" });
t.assert(scoreFact, { atLeast: 0.8, label: "质量" });

const config = await t.require(t.check(rawConfig, matches(ConfigSchema)));
await t.require(scoreFact, { atLeast: 0.9 });
```

`assert` 在 Attempt 收尾时求值，并允许后续独立代码继续执行。`require` 只接受 `phase: "now"` Fact，立即求值，并在不满足时停止依赖路径。`key` 在一个 Eval 内唯一，匹配 `[a-z0-9][a-z0-9._/-]{0,127}`；`label` 只用于人读展示。

ScoreFact 的 verdict use 必须给出 `{ atLeast }`。阈值必须是有限 `[0,1]` 数字。

`assertIfCovered` 只接受核心 usage evidence Fact。它把 Agent 创建时已声明为不可用的 usage 证据记为 `notApplicable`；不适用于 Judge、Sandbox、普通 matcher 或自定义 evaluator。

## 计分 use

`t.score` 只存在于 `defineScoreEval`：

```ts
const quality = turn.judge.autoevals.closedQA("回答是否清楚？");
t.score("回答质量", quality, { max: 20, key: "answer-quality" });
t.score("人工规则", { earned: 2, key: "manual-rule" });
return t.finishScore();
```

Boolean Fact 通过得 `max`，失败得 0；ScoreFact 得 `max × normalizedScore`。`max` 必须为正有限数，direct `earned` 必须为非负有限数。每个 Fact 最多有一个 score use。

正常 `defineScoreEval` 路径必须返回 `t.finishScore()`，并至少登记一个 score use。显式零分写 `t.score(label, { earned: 0 })`。

## Phase 与 deferred evidence

`now` Fact 可以用于 `require`。Turn 的事件与输出在 Turn 完成后不可变，因此是 `now`。根 `t` 聚合、最终 diff 和 `t.sandbox.file(path)` 是 `final`，只能由 `assert` 或 `score` 在收尾时消费。

```ts
const readme = t.sandbox.file("README.md");
t.assert(t.check(readme, includes("Install")));
```

文件内容只在 Fact 求值时经公开 Sandbox API 读取一次。缺失文件不是空字符串；读取失败按证据状态进入该 Fact。
