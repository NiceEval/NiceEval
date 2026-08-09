# Assertion 作者面

Eval 作者先创建 Fact，再显式声明每个 Fact 的 use。producer、verdict、控制流和计分不混在链式 handle 中。

```ts
const turn = await t.send("修复 runtime 配置。");
const changed = t.sandbox.fileChanged("experiments/local.ts");
const quality = turn.judge.autoevals.closedQA("回答是否解释了修复？");

t.assert(changed);
t.assert(quality, { atLeast: 0.8 });
t.score("配置修复", changed, { max: 2 });
return t.finishScore();
```

Judge 是 native `ScoreFact<"now">` producer。它和值、scope、Sandbox Fact 共享 collector、可达性、memoization、source、持久化形状和读取面。

## 词汇

- `t.check`、scope producer、Sandbox producer 与 Judge recipe 创建 BooleanFact 或 ScoreFact。
- `t.assert` 创建 verdict use，并在收尾时求值。
- `await t.require` 创建 verdict use，立即求值并表达后续代码依赖。
- `t.score` 只在 `defineScoreEval` 创建 score use。

每个 Fact 最多有一个 verdict use 和一个 score use。没有 use 的 Fact 是 author error，且不请求 Judge evaluator。

不存在 `.gate()`、`.soft()`、`.optional()`、`.observe()`、`.points()`、`.stopOnFailure()` 或运行期 `--strict`。作者在 use 调用处直接写阈值、label、key 与分值。

## Judge capability

`defineEval` 和 `defineScoreEval` 的 `judge?: true | JudgeConfig` 是 capability 声明。`true` 继承 Experiment/Config；对象声明并按字段替换。未声明 capability 的 Judge recipe 是同步 author error。

根级 `t.judge` 显式接收 `{ input, output }`。`turn.judge` 冻结该 Turn 的原始 user input 和 assistant output。没有 `session.judge`、`{ on }`、路径猜测、隐式 last input 或单个 Fact model override。

## 入口

- [Library](library.md) —— API、phase、use 与计分。
- [Matching](matching.md) —— Match 的纯比较语义。
- [Architecture](architecture.md) —— config、图、状态、record、progress 和读取边界。
- [CLI](cli.md) —— terminal、退出码、摘要和 JSON。
- [类型原型](reference/README.md) —— 作者面类型约束。
