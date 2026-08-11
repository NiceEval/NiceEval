# Assertions —— Library

完整语义在 [Assertions](README.md)。所有作者入口都遵守“调用即登记；handle 只配置同一 entry”。

## 显式值

```ts
const config = t.check(rawConfig, matches(ConfigSchema))
  .key("config-valid")
  .label("配置有效");

t.check(turn.message, includes("完成"))
  .label("说明完成");
```

`t.check(value, match)` 只接收两个参数。它不接收 options、已有 handle、已有 Assertion 或省略 Match 的
一参数形式。

## scope 与 Judge

```ts
const turn = await t.send("总结需求。");

turn.succeeded().label("Turn 完成");
turn.calledTool("search", { count: { atLeast: 1 } }).label("搜索资料");
turn.judge.autoevals.summarizes(source).label("摘要质量");
```

scope 方法与 Judge recipe 已经登记 Assertion，不能再交给 `check`。它们和显式值比较共享 key、label、
snapshot、结果与读取协议。

## handle 配置

| 方法 | 适用范围 | 效果 |
|---|---|---|
| `.key(value)` | 所有 Assertion | 设置稳定 entry key。 |
| `.label(value)` | 所有 Assertion | 设置人读标签。 |
| `.atLeast(n)` | measurement | 设置有限 `[0,1]` threshold。 |
| `.score(n)` | Score Eval 的已有 Assertion | 让该 entry 贡献 score。 |
| `.ifCovered()` | Usage Assertion | 声明时 usage 不可用投影为 `notApplicable`。 |
| `.orStop()` | Boolean 或已 threshold 的 measurement | 结算同一 entry，并作为 async barrier。 |

同一字段重复配置、非法数值、封口后配置与 detached async 配置都是作者错误。

## 两种 Eval

Pass Eval 用 Boolean condition。measurement 必须 `.atLeast(n)`，且 Pass context 不提供 `t.score` 或
handle `.score`。

```ts
turn.judge.autoevals.closedQA("回答是否可执行？")
  .atLeast(0.8)
  .label("可执行性");
```

Score Eval 默认保存 Assertion evaluation。`.score(n)` 才贡献数值；`t.score(n)` 直接登记 contribution。

```ts
turn.calledTool("search").score(2).label("检索");
t.score(1).label("人工加分");
```

## 组

`t.group(title, fn)` 只写 `groupPath` 与 source organization。它不改变 subject、evaluator、policy 或
Eval 类型。

```ts
await t.group("输出", () => {
  t.check(turn.message, includes("下一步")).label("给出下一步");
  turn.judge.autoevals.closedQA("是否容易执行？").label("可执行性");
});
```

值比较见 [Value assertions](library/value-assertions.md)，scope 见
[Scoped assertions](library/scoped-assertions.md)，Score Eval 见 [Score Eval](library/score-points.md)。
