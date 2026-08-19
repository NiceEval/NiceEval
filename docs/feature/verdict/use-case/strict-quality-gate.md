# 用 gate 守住质量

开放式质量检查先用代表性结果校准 rubric 和阈值，再用 `.gate(n)` 把已确定的要求写成稳定的 Pass Eval Assertion。
`.atLeast(n)` 只保留局部 condition，不参与 Verdict fold。

```typescript
turn.judge.autoevals.closedQA("回答是否完整且准确？")
  .gate(0.8)
  .label("回答质量");
```

measurement 低于阈值时 Attempt 为 `failed`；Judge 无法评估时 Attempt 为 `errored`，
不会把配置或网络问题伪装成 Agent 失败。

需要让依赖后续步骤在阈值不满足时停下的场景，在同一 handle 上 await `.orStop()`：

```typescript
const quality = turn.judge.autoevals.closedQA("回答是否满足安全要求？")
  .gate(0.9)
  .label("安全质量");
await quality.orStop();
await t.send("继续执行下一步");
```

`.orStop()` 只停止当前 continuation。正常 stop 后 Attempt 仍按触发 Assertion 得到 `failed` Verdict。

计分制若要按质量比例贡献分数，使用 `.score(points)`：measurement `m` 贡献 `m * points`。

```typescript
turn.judge.autoevals.closedQA("说明是否清晰？")
  .score(20)
  .label("说明质量");
```

## 边界

- Pass Eval 的 measurement 必须有 threshold；用 `.gate(n)` 时低于阈值为 `failed`，用 `.atLeast(n)` 时只保存 condition。
- Score Eval 没有 `.gate()`；`.score(points)` 按 measurement 比例贡献分数，低分不改变 Verdict。
- gate 无法评估（Judge 缺 key、证据不可用）为 `unavailable`，Attempt 为 `errored`，不是 `failed`。

## 相关阅读

- [Verdict 与 AssertionResult](../architecture.md) —— Pass fold 规则。
- [Judge](../../judge/library.md) —— Judge evaluator 与配置。
- [Assertions · Score Eval](../../assertions/library/score-points.md) —— score contribution。
