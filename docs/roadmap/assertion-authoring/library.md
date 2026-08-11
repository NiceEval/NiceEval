# Assertion 作者面 —— Library

完整入口见 [Assertions](../../feature/assertions/README.md)。本页列出目标类型面。

## Pass Eval

```ts
const parsed = t.check(raw, matches(ConfigSchema))
  .key("config")
  .label("配置有效");

const reply = await t.check(raw, matches(ConfigSchema)).orStop();
turn.judge.autoevals.closedQA("回答是否可执行？").atLeast(0.8);
```

`t.check(value, match)` 严格有两个参数。Boolean handle 可 `.orStop()`；measurement 必须先 `.atLeast(n)`。
Pass context 不提供 `t.score` 或 handle `.score`。

## Score Eval

```ts
turn.calledTool("search").score(2).label("检索");
turn.judge.autoevals.closedQA("回答完整").score(5);
t.score(1).label("人工加分");
```

`.score(n)` 配置同一 Assertion 的 contribution。`t.score(n)` 直接登记 contribution，返回只可配置 key 与
label 的 handle。measurement 可无 threshold 封口；`.atLeast(n)` 只增加 local condition。两种顺序都合法：

```ts
turn.judge.autoevals.closedQA("回答完整").score(5).atLeast(0.8);
turn.judge.autoevals.closedQA("回答完整").atLeast(0.8).score(5);
```

## Usage 与控制

Usage Assertion 才有 `.ifCovered()`。`.orStop()` 必须 await；触发后设置 authoring stop latch，后续
NiceEval 作者 API 拒绝登记。它不会撤销已经发生的 JavaScript 副作用。
