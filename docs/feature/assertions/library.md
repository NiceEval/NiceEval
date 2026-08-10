# Assertions —— 库用法

常见 verdict 在一个调用中完成：

```ts
const turn = await t.send("解释变更。");

t.check(turn.message, includes("变更"), { label: "说明变更" });
t.check(turn.succeeded());
```

`check` 是同步 verdict consumer。它接收 BooleanFact 时返回同一 Fact；接收 value 或 EvidenceSource 加 BooleanMatch 时返回 BooleanFact。连续分数先用 `ScoreMatch.atLeast(n)` 或 `ScoreFact.atLeast(n)` 绑定阈值，`check` 再登记 verdict 并返回底层 ScoreFact。scope、Sandbox 与 Judge 仍是惰性 producer，不会仅因创建而改变 verdict、得分或调用外部 evaluator。

## 判定 use

```ts
const booleanFact = turn.succeeded();
const scoreFact = turn.judge.autoevals.closedQA("回答是否清楚？");

t.check(booleanFact, { key: "answer-present", label: "回答存在" });
t.check(scoreFact.atLeast(0.8), { label: "质量" });

const config = await t.require(rawConfig, matches(ConfigSchema));
const normalized = await t.require(
  turn.judge.autoevals.closedQA("回答是否给出下一步？").atLeast(0.9),
);
```

`check` 在 Attempt 收尾时求值，并允许后续独立代码继续执行。`require` 是立即 verdict consumer，所有 overload 都返回 Promise。它接收 `phase: "now"` Fact 或 value 加 Match，并在不满足时停止依赖路径；BooleanMatch 返回原 candidate 的 refinement，ScoreMatch 返回归一化分数。最终 Fact 与 EvidenceSource 不能传给 `require`。`key` 在一个 Eval 内唯一，匹配 `[a-z0-9][a-z0-9._/-]{0,127}`；`label` 只用于人读展示。

`atLeast()` 接受有限 `[0,1]` 数字。它只创建一个不可变 threshold view，不创建 Fact、不登记 use，也不启动 matcher 或 Judge。`check` 与 `require` 消费这个 view；同一底层 Fact 仍最多只有一个 verdict use。

`key` 与 `label` 仍是 consumer metadata，放在 `check` 或 `require` 的 options 中。阈值不属于 options，因为它决定连续分数怎样成为判定条件。

`check` 返回 Fact 是为了把同一证据再交给一次 `score`，不是为了再次 `check`。例如先用 thresholded ScoreMatch 创建并判定 ScoreFact，再把返回值传给 `score`；对返回 Fact 再登记 verdict use 是 author error。

`checkIfCovered` 只接受核心 usage evidence Fact，并同步返回同一 Fact。它把 Agent 创建时已声明为不可用的 usage 证据记为 `notApplicable`；不适用于 Judge、Sandbox、普通 matcher 或自定义 evaluator。

## 计分 use

`t.score` 只存在于 `defineScoreEval`：

```ts
const quality = turn.judge.autoevals.closedQA("回答是否清楚？");
t.score("回答质量", quality, { max: 20, key: "answer-quality" });
t.score("回复长度", turn.message, similarity("简洁回答"), { max: 4, key: "reply-length" });
t.score("人工规则", { earned: 2, key: "manual-rule" });
```

Boolean Fact 通过得 `max`，失败得 0；ScoreFact 得 `max × normalizedScore`。`max` 必须为正有限数，direct `earned` 必须为非负有限数。每个 Fact 最多有一个 score use。

`defineScoreEval` 在 `test` 正常返回时自动收尾。没有登记 score use 的正常路径也是有效计分结果，得到 0 分且保留空 Fact/use 图；需要说明某项明确得到零分时使用 `t.score(label, { earned: 0 })`。

## Phase 与 deferred evidence

`now` Fact 可以用于 `require`。Turn 的事件与输出在 Turn 完成后不可变，因此是 `now`。根 `t` 聚合、最终 diff 和 `t.sandbox.file(path)` 是 `final`，只能由 `check` 或 `score` 在收尾时消费。

```ts
const readme = t.sandbox.file("README.md");
t.check(readme, includes("Install"));
```

文件内容只在 Fact 求值时经公开 Sandbox API 读取一次。缺失文件不是空字符串；读取失败按证据状态进入该 Fact。
