# 用明确阈值守住质量

开放式质量检查应把阈值写在消费 Fact 的位置，而不是依赖运行时模式。
先用代表性结果校准 rubric 和阈值，再把已确定的要求写成一个稳定的 verdict use。

```typescript
const quality = turn.judge.autoevals.closedQA("回答是否完整且准确？");
t.assert(quality, { atLeast: 0.8, label: "回答质量" });
```

需要在同一行阻止依赖后续步骤时使用 `require`：

```typescript
const quality = turn.judge.autoevals.closedQA("回答是否满足安全要求？");
await t.require(quality, { atLeast: 0.9, label: "安全质量" });
await t.send("继续执行下一步");
```

这两种写法都创建一个 verdict use。分数低于阈值时 Attempt `failed`；Judge 无法评估时 Attempt `errored`，不会把配置或网络问题伪装成 Agent 失败。

计分制若要按质量比例给分，使用 score use：

```typescript
const quality = turn.judge.autoevals.closedQA("说明是否清晰？");
t.score("说明质量", quality, { max: 20 });
```

同一 Fact 可同时有一个 verdict use 和一个 score use，evaluator 仍只运行一次。

## 相关阅读

- [Verdict 与 Fact use](../architecture.md) —— 终态折叠规则。
- [Judge](../../judge/library.md) —— ScoreFact 与配置。
