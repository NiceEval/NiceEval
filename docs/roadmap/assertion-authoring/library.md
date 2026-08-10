# Assertion 作者面 —— Library

## Fact producer

```ts
const value = t.check(turn.message, includes("done"));
const score = t.check(turn.message, similarity("done"));
const file = t.sandbox.file("README.md");
const documented = t.check(file, includes("Install"));
```

BooleanFact 表示可通过或失败的证据。ScoreFact 表示 `[0,1]` 归一化分数。producer 只创建节点，不读取 deferred evidence 或改变 Attempt 终态。

## Fact use

```ts
t.assert(value, { key: "reply-done", label: "回复完成" });
t.assert(score, { atLeast: 0.8, label: "回复质量" });

const parsed = await t.require(t.check(raw, matches(Schema)));
await t.require(score, { atLeast: 0.9 });
```

BooleanFact 的 verdict use 不需要阈值。ScoreFact 的 verdict use 必须提供有限 `[0,1]` `atLeast`。`assert` 延迟求值；`require` 只接收 `now` Fact，并且在创建 use 后立即求值。

`key` 是可选的稳定 use identity，`label` 是人读标题。key 在一个 Eval 内唯一。

## Judge Fact

```ts
export default defineEval({
  judge: true,
  async test(t) {
    const turn = await t.send("概括变更。");
    const quality = turn.judge.autoevals.summarizes("原始需求");
    t.assert(quality, { atLeast: 0.8 });
  },
});
```

三个 Judge recipe 都返回 `ScoreFact<"now">`。根级 recipe 的第二参数是 `{ input: string, output: string }`。文件材料必须先经 `await t.sandbox.readText(path)` 读取为字符串。

## Score Eval

```ts
const quality = turn.judge.autoevals.closedQA("回答是否清楚？");
t.score("回答质量", quality, { max: 10, key: "quality" });
t.score("格式", { earned: 1, key: "format" });
```

`score` 仅存在于 `defineScoreEval`。Fact score use 的 `max` 必须为正有限数；direct score 的 `earned` 必须为非负有限数。Score Eval 正常返回时自动收尾；没有 score use 时得到 0 分，并保留空 Fact/use 图。

## 错误时点

- 未声明 Judge capability、重复 use key、同一 Fact 的第二个同类 use、非法阈值或悬空 Fact 都是 author error。
- 未配置 model 或 key 的已消费 Judge Fact 是 ordinary unavailable，不发网络请求。
- evaluator 网络失败是 ordinary unavailable；非法 score 或结构是 evaluator error。
- 已配置 endpoint 的真实预检失败是 setup error，不伪造 Fact。
