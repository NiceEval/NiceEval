# Assertion 作者面

Assertion-first 把“作者写下一条评估陈述”作为唯一入口语义。`t.check(value, match)`、scope 方法、
Judge recipe 与 Score Eval 的直接 `t.score(n)` 都在调用时登记 entry；没有先生产中间结果、再登记消费的两步模型。

完整领域定义由 [Assertions](../../feature/assertions/README.md) 单独维护。本 Roadmap 说明作者面、
Record 协议和 runner 如何落实这份目标契约。

```ts
const turn = await t.send("修复 runtime 配置。");

t.check(turn.message, includes("已修复"))
  .key("repair-explained")
  .label("说明修复");

turn.succeeded().label("Turn 完成");
turn.judge.autoevals.closedQA("回答是否解释了修复？")
  .atLeast(0.8)
  .label("修复质量");
```

每个返回值都是同一条已登记 entry 的 AssertionHandle。`key`、`label`、`atLeast`、`score`、
`ifCovered` 与 `orStop` 只配置该 entry。

## 已定边界

- `t.check` 严格只有 `(value, match)` 两个参数。
- Pass Eval 用 Boolean Assertion 与 thresholded measurement 得到 Verdict。
- Score Eval 默认只保存 Assertion evaluation；`.score(n)` 与 `t.score(n)` 显式贡献 score。
- Judge recipe 直接登记 measurement Assertion。
- Usage Assertion 才有 `ifCovered()`。
- `.orStop()` 是同一 handle 的 async barrier，不是另一条 Assertion。
- schema 19 的 `assertionResults` 是结果协议的单一真相。

## 入口

- [Library](library.md) — API、两种 Eval 与控制流。
- [Matching](matching.md) — Match 的纯比较边界。
- [Architecture](architecture.md) — entry、snapshot、封口与 Record。
- [CLI](cli.md) — progress、show、JSON 与读取面。
- [类型原型](reference/README.md) — 正反向 TypeScript 契约。
- [Harness 诊断](use-case/harness-diagnostics.md) — 用公开结果完成诊断闭环。
