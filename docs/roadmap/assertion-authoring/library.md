# Assertion 作者面 —— Library

## Consumer-first verdict

```ts
t.check(turn.message, includes("done"));
t.check(turn.message, similarity("done").atLeast(0.8));
t.check(t.sandbox.file("README.md"), includes("Install"));
```

BooleanFact 表示可通过或失败的证据。ScoreFact 表示 `[0,1]` 归一化分数。scope、Sandbox 与 Judge producer 只创建节点，不读取 deferred evidence 或改变 Attempt 终态。value 或 EvidenceSource 加 Match 的 `check` 会创建节点并同步登记 verdict use。

## Fact use

```ts
const booleanFact = turn.succeeded();
const scoreFact = turn.judge.autoevals.closedQA("回答是否清楚？");

t.check(booleanFact, { key: "reply-done", label: "回复完成" });
t.check(scoreFact.atLeast(0.8), { label: "回复质量" });

const parsed = await t.require(raw, matches(Schema));
const normalized = await t.require(
  turn.judge.autoevals.closedQA("回答是否给出下一步？").atLeast(0.9),
);
```

BooleanFact 的 verdict use 不需要阈值。连续分数必须先经 `ScoreMatch.atLeast(n)` 或 `ScoreFact.atLeast(n)` 形成 threshold view。`check` 同步返回底层 existing Fact 或新 Fact，并在收尾时求值。`require` 的每个 overload 都返回 Promise；Boolean 路径返回原 candidate 的 refinement，分数路径返回归一化分数。

`atLeast()` 在调用时校验有限 `[0,1]` 阈值。它是纯包装，不创建 Fact、不登记 use、不求值。value/source 的 thresholded match 与 existing ScoreFact 的 thresholded view 都只能交给 `check` 或 `require`；`score` 只接受未阈值化的 Match/Fact。

`key` 是可选的稳定 use identity，`label` 是人读标题。key 在一个 Eval 内唯一。

## Judge Fact

```ts
export default defineEval({
  judge: true,
  async test(t) {
    const turn = await t.send("概括变更。");
    const quality = turn.judge.autoevals.summarizes("原始需求");
    t.check(quality.atLeast(0.8));
  },
});
```

三个 Judge recipe 都返回 `ScoreFact<"now">`。根级 recipe 的第二参数是 `{ input: string, output: string }`。文件材料必须先经 `await t.sandbox.readText(path)` 读取为字符串。

## Score Eval

```ts
const quality = turn.judge.autoevals.closedQA("回答是否清楚？");
t.score("回答质量", quality, { max: 10, key: "quality" });
t.score("回复相似度", turn.message, similarity("清楚回答"), { max: 4, key: "reply-similarity" });
t.score("格式", { earned: 1, key: "format" });
```

`score` 仅存在于 `defineScoreEval`。existing Fact 计分返回同一 Fact；value 或 source 加 Match 计分返回新 Fact；direct score 返回 `void`。Fact score use 的 `max` 必须为正有限数；direct score 的 `earned` 必须为非负有限数。Score Eval 正常返回时自动收尾；没有 score use 时得到 0 分，并保留空 Fact/use 图。

## 错误时点

- 未声明 Judge capability、重复 use key、同一 Fact 的第二个同类 use、非法阈值或悬空 Fact 都是 author error。
- 未配置 model 或 key 的已消费 Judge Fact 是 ordinary unavailable，不发网络请求。
- evaluator 网络失败是 ordinary unavailable；非法 score 或结构是 evaluator error。
- 已配置 endpoint 的真实预检失败是 setup error，不伪造 Fact。
