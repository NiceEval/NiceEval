# Assertions —— Score Eval

Score Eval 的完整 dual-mode 边界在 [Assertions](../README.md#score-eval)。本页只定义 score 如何由
已登记 entry 累加。

## 默认仅保存 evaluation

每条 Assertion 默认保存 evaluation、evidence 和 diagnostic，不自动贡献数值。这个规则对 Boolean、
measurement、scope 与 Judge 一致。

```ts
turn.calledTool("search");
turn.judge.autoevals.closedQA("回答完整");
```

以上两条都是合法的 record-only Assertion。

## 显式贡献

`handle.score(n)` 让已有 Assertion 贡献 score。`n` 必须 finite 且大于零，并且同一 handle 最多配置一次。

```ts
turn.calledTool("search").score(2);
turn.judge.autoevals.closedQA("回答完整").score(5);
```

Boolean matched 贡献 `n`，mismatched 贡献 `0`。measurement 为 `m` 时贡献 `m * n`。因此 measurement
为 `.8` 且 `.score(5)` 时，贡献是 `+4`。

`t.score(n)` 只属于 `ScoreTestContext`。它直接登记 contribution，`n` 必须 finite 且不小于零：

```ts
t.score(5).label("人工评分");
```

返回的 `DirectScoreHandle` 只允许 `key` 与 `label`，不能再加 score、threshold 或 control。

## threshold 与 stop

Score measurement 可以没有 threshold 直接封口。`.atLeast(n)` 只增加局部 `met` / `below` condition，
不改变 contribution；`.score(n).atLeast(x)` 与 `.atLeast(x).score(n)` 同义。

Boolean handle 可以直接 `await .orStop()`。measurement 必须先 `.atLeast(n)` 才能使用 `.orStop()`。
正常 below stop 仍产出 `scored` grading，并保留 stop cause。

## 可排名性

正常没有贡献项的 Score Eval 得到正式 `score: 0`。只有配置 score 的 Assertion、direct score 或 control
Assertion 的 `unavailable` / `errored` 才使 grading 不可排名。record-only Assertion 的 Issue 不作废正式 score。
