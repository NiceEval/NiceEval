# Assertions —— 自定义 Match

完整模型见 [Assertions](../README.md)。自定义 Match 只描述“这个 value 怎样比较”，不描述作者位置、
scope、policy 或运行控制。

## Match 的边界

一个 Match 必须可复用、不可变、确定性且无副作用。自定义 Match 可以返回 Boolean result，或 finite `[0,1]`
measurement。它不能保存 subject identity、callsite、groupPath、`key`、`label`、score 或 threshold，也不能自行从 ctx 取值。
受管 collection combinator 的求值结果是 `matched`、`mismatched` 或 `unavailable`，并按需带 typed artifact；它们不是不带状态的 boolean。

```ts
const hasRequiredFields = defineValueMatch({
  name: "has-required-fields",
  evaluate: (value: unknown) =>
    isRecord(value) && typeof value.id === "string" && typeof value.title === "string",
});

t.check(payload, hasRequiredFields).label("返回必填字段");
```

Match 与 Assertion 分工明确：Match 比较 value；`t.check(value, match)` 读取调用时 value 并登记
Assertion；handle 再配置同一 entry。

## 连续 evaluator

连续 evaluator 的工厂返回不可变 `ScoreMatch<T>`。`.atLeast(n)` 是 Match combinator：它在登记前返回
`ThresholdedScoreMatch<T>`，把有限 `[0,1]` threshold 与 evaluator 一起形成完整 Match。它不读取 subject、ctx 或登记状态。

Pass Eval 对 thresholded Match 返回的 handle 可用无参 `.gate()` 把局部 condition 纳入 Verdict。Score Eval 对未 threshold
或已 threshold Match 都可 `.score(points)`；thresholded handle 还可 `.orStop()`。

```ts
const similarity = defineScoreMatch({
  name: "answer-similarity",
  score: (actual: string) => compare(actual, expected),
});

pass.check(reply, similarity.atLeast(0.8)).gate();
score.check(reply, similarity).score(5);
score.check(reply, similarity.atLeast(0.8)).score(5);
```

只有 `atLeast` 属于 `ScoreMatch`，并返回新的 thresholded Match。`gate()`、`score(points)` 与 `orStop()` 是登记后的
AssertionHandle policy；handle 不接比较值，其中只有 Pass 的无参 `gate()` 改变 Verdict。

## 第三方 criterion

第三方 evaluator 可以有自己的 criterion schema，但 Assertions current payload 只保存精确的 `{ name, schemaId, data }`。
它不保存 evaluator 函数、模块对象、闭包或运行时 dependency graph，也不能由此增加 durable family。`schemaId`
未安装或 `data` 无法解码时，reader 只把该 entry 标为 `unsupported` 或 `invalid`；同一 Attachment 的其它
entry 继续可读。
