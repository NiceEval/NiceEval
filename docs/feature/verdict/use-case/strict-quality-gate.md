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

计分制若要按质量比例贡献分数，使用 `.score(points)`：measurement `m` 贡献 `m * points`。

```typescript
turn.judge.autoevals.closedQA("说明是否清晰？")
  .score(20)
  .label("说明质量");
```

   ```bash
   npx niceeval exp compare --strict
   ```

5. `--strict` 下红掉的题就是质量退化清单,照常拿 locator 下钻;确认阈值和断言都可信后,把该断言改成
   `.gate(x)`,从此不依赖 flag、任何模式都执法。

## 边界

- Gate 断言不受 `--strict` 影响,任何模式下不通过都 failed——`--strict` 只对带通过线、但尚未声明 gate 的 condition 生效。
- 没有 threshold 的纯留档 Assertion 在 `--strict` 下也只留档:没有线就没有「低于线」。
- 断言评不了(judge 缺 key、证据 Attachment 不完整)是 `unavailable` 走 errored,不是 failed——`--strict` 不改变这条(见 [CLI](../cli.md))。

## 相关阅读

- [Verdict 与 AssertionResult](../architecture.md) —— Pass fold 规则。
- [Judge](../../judge/library.md) —— Judge evaluator 与配置。
- [Assertions · Score Eval](../../assertions/library/score-points.md) —— score contribution。
