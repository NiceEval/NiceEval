---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 裁判评质量：规则写不出对错时

“语气是否专业”“说明是否清楚”这类问题没有稳定的精确 matcher。
LLM-as-judge 的三个 factory 都从 `niceeval/expect` 构造纯 managed Match：封闭式问题用 `closedQA`，有事实参考答案用 `factuality`，评摘要质量用 `summarizes`。作者以 `check({ input, output }, match)` 登记 measurement Assertion。

## 全流程

1. 在 eval 上声明 capability。`true` 继承 Experiment 与项目配置；对象可替换字段：

   ```typescript
   import { defineEval } from "niceeval";
   import { closedQA } from "niceeval/expect";

   export default defineEval({
     judge: true,
     async test(t) {
       const turn = await t.send("帮我拟一封跟进邮件。");
       turn.check(
         { input: turn.input, output: turn.message },
         closedQA("语气是否专业？").atLeast(0.8),
       ).gate().label("专业语气");
     },
   });
   ```

2. Turn 公开 readonly `input` 与 `message`，作者把它们显式组成材料。跨轮或非会话材料同样由作者选择字符串并传给 `t.check`：

   ```typescript
   const notes = await t.sandbox.readText("NOTES.md");
   t.check(
     { input: "请完成重构并写说明。", output: notes },
     closedQA("是否说明了风险和回滚？").atLeast(0.7),
   ).gate().label("重构说明");
   ```

3. 先在 Match 上配置 threshold，再在已登记 handle 上配置用途。Pass Eval 的 thresholded handle 用无参 `.gate()`；Score Eval 的未 threshold 或 thresholded handle 用 `.score(points)` 贡献分数：

   ```typescript
   const quality = turn.check(
     { input: turn.input, output: turn.message },
     closedQA("回答是否切题且完整？").atLeast(0.8),
   ).gate().label("回答质量");
   // defineScoreEval 中：省略 `.atLeast(0.8)` 后用 `.score(20)`，让 measurement 0.8 贡献 16
   ```

## 边界

- 未声明 `judge` 却创建 Judge Assertion 是同步作者错误。
- 没有 Judge namespace、`{ on }`、路径猜测、隐式最后输入或单次 `{ model }` 替换。文件材料必须先经公开 Sandbox API 读成字符串。
- Judge Match 由 `check` 登记后只结算一次，写一条 AssertionResult；factory 不登记，也不拥有第二条消费 API。
- 没有模型或 key 时不会做网络预检。Judge Assertion 为 `unavailable`；在 Pass Eval 它使 Attempt `errored`。已配置端点的预检失败是 setup error；运行期传输失败是 `unavailable`。
- “必须出现某个词”这类精确规则应使用 `includes` 等 matcher。Judge 只能看见传入材料，不能据此推断未提供的工具调用或文件内容。

## 相关阅读

- [Judge](../../judge/library.md) —— recipe、配置、材料和失败语义。
- [Assertions](../../assertions/README.md) —— measurement、threshold 与 `.orStop()`。
- [Score Eval](../../assertions/library/score-points.md) —— measurement 计分。
