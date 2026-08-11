# 用明确阈值守住质量

开放式质量检查用 `.atLeast(n)` 把 measurement 封口成 Boolean condition，不依赖运行时模式。
先用代表性结果校准 rubric 和阈值，再把已确定的要求写成稳定的 Assertion。

```typescript
turn.judge.autoevals.closedQA("回答是否完整且准确？")
  .atLeast(0.8)
  .label("回答质量");
```

measurement 低于阈值时 Attempt 为 `failed`；Judge 无法评估时 Attempt 为 `errored`，
不会把配置或网络问题伪装成 Agent 失败。

需要让依赖后续步骤在阈值不满足时停下的场景，在同一 handle 上 await `.orStop()`：

```typescript
const quality = turn.judge.autoevals.closedQA("回答是否满足安全要求？")
  .atLeast(0.9)
  .label("安全质量");
await quality.orStop();
await t.send("继续执行下一步");
```

`.orStop()` 只停止当前 continuation。正常 stop 后 Attempt 仍按触发 Assertion 得到 `failed` Verdict。

计分制若要按质量比例贡献分数，使用 `.score(n)`：measurement `m` 贡献 `m * n`。

```typescript
turn.judge.autoevals.closedQA("说明是否清晰？")
  .score(20)
  .label("说明质量");
```

同一 Assertion 可同时配置 `.atLeast(n)` 与 `.score(n)`，evaluator 仍只运行一次。
顺序可互换，两种配置都只更新同一 entry。

## 相关阅读

- [Verdict 与 AssertionResult](../architecture.md) —— Pass fold 规则。
- [Judge](../../judge/library.md) —— Judge evaluator 与配置。
- [Assertions · Score Eval](../../assertions/library/score-points.md) —— score contribution。
