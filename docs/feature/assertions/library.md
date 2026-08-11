# Assertions —— Library

完整持久化语义在 [Assertions](README.md)。所有作者入口都遵守“调用即登记；handle 只配置同一 entry”。`entryId` 由 producer 分配；作者的 key、label 与 groupPath 只服务展示。

## 显式值

```ts
const config = t.check(rawConfig, matches(ConfigSchema))
  .key("config-valid")
  .label("配置有效");

t.check(turn.message, includes("完成"))
  .label("说明完成");
```

`t.check(value, match)` 只接收两个参数。它不接收 options、已有 handle、已有 Assertion 或省略 Match 的一参数形式。

## scope 与 Judge

```ts
const turn = await t.send("总结需求。");

turn.succeeded().label("Turn 完成");
turn.calledTool("search", { count: { atLeast: 1 } }).label("搜索资料");
turn.judge.autoevals.summarizes(source).label("摘要质量");
```

scope 方法与 Judge recipe 已经登记 Assertion，不能再交给 `check`。它们和显式值比较共享 snapshot、criterion、sealed result 与读取协议。

## handle 配置

| 方法 | 适用范围 | 效果 |
|---|---|---|
| `.key(value)` | 所有 Assertion | 设置人读的稳定展示 key。 |
| `.label(value)` | 所有 Assertion | 设置人读标签。 |
| `.atLeast(n)` | measurement | 设置有限 `[0,1]` threshold。 |
| `.gate()` | 有 threshold 或 Boolean result 的 Assertion | 让不满足条件参与四态 Verdict fold。 |
| `.score(points)` | Score Eval 的已有 Assertion | 让该 entry 按 `points` 贡献 earned score。 |
| `.ifCovered()` | Usage Assertion | 已声明不可用时投影为 not-applicable。 |
| `.orStop()` | Boolean 或已 threshold 的 measurement | 等待同一 entry，并停止当前 continuation。 |

同一字段重复配置、非法数值、封口后配置与 detached async 配置都是作者错误。

## 两种 Eval

`defineEval` 创建 Pass Eval。Boolean condition 默认是 gate；measurement 必须 `.atLeast(n)`，Pass context 不提供 `t.score` 或 handle `.score`。

```ts
turn.judge.autoevals.closedQA("回答是否可执行？")
  .atLeast(0.8)
  .label("可执行性");
```

`defineScoreEval` 创建 Score Eval。Assertion 默认只保存 evaluation；`.score(points)` 才贡献数值，`.gate()` 才令该条件改变 Verdict。`t.score(points)` 直接登记带 direct-score criterion 的 Assertion entry。

```ts
turn.calledTool("search").score(2).label("检索");
t.score(1).label("人工加分");
```

两种 Eval 的每个 Attempt 都有 Verdict。Score Eval 另外有 Score Attachment；points、gate 与 score state 的关系见 [Score Eval](library/score-points.md)。

## 组

`t.group(title, fn)` 只写 display 的 `groupPath` 与 source organization。它不改变 subject、criterion、结果、Eval 类型或 route identity。

```ts
await t.group("输出", () => {
  t.check(turn.message, includes("下一步")).label("给出下一步");
  turn.judge.autoevals.closedQA("是否容易执行？").label("可执行性");
});
```

值比较见 [Value assertions](library/value-assertions.md)，scope 见 [Scoped assertions](library/scoped-assertions.md)，Score Eval 见 [Score Eval](library/score-points.md)。
