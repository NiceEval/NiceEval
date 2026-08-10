# 裁判评质量：规则写不出对错时

“语气是否专业”“说明是否清楚”这类问题没有稳定的精确 matcher。
LLM-as-judge 的三个 recipe 都创建 `[0,1]` 的 `ScoreFact`：封闭式问题用 `closedQA`，有事实参考答案用 `factuality`，评摘要质量用 `summarizes`。

## 全流程

1. 在 eval 上声明 capability。`true` 继承 Experiment 与项目配置；对象可替换字段：

   ```typescript
   export default defineEval({
     judge: true,
     async test(t) {
       const turn = await t.send("帮我拟一封跟进邮件。");
       const professional = turn.judge.autoevals.closedQA("语气是否专业？");
       t.check(professional.atLeast(0.8), { label: "专业语气" });
     },
   });
   ```

2. `turn.judge` 绑定这一 immutable Turn 的原始用户输入与助手输出。跨轮或非会话材料使用根级 `t.judge`，并显式传入字符串材料：

   ```typescript
   const notes = await t.sandbox.readText("NOTES.md");
   const documented = t.judge.autoevals.closedQA("是否说明了风险和回滚？", {
     input: "请完成重构并写说明。",
     output: notes,
   });
   t.check(documented.atLeast(0.7), { label: "重构说明" });
   ```

3. 用 Fact use 声明这条 rubric 的用途。`check` 设置阈值并继续；`require` 在当前位置立即求值；计分 Eval 用 `score` 按连续分比例给分：

   ```typescript
   const quality = turn.judge.autoevals.closedQA("回答是否切题且完整？");
   t.check(quality.atLeast(0.8));
   // 在 defineScoreEval 中：t.score("回答质量", quality, { max: 20 });
   ```

## 边界

- 未声明 `judge` 却创建 Judge Fact 是同步作者错误。
- 没有 `session.judge`、`{ on }`、路径猜测、隐式最后输入或单次 `{ model }` 替换。文件材料必须先经公开 Sandbox API 读成字符串。
- Fact 创建惰性；没有 `check`、`require` 或 `score` 消费的 Judge Fact 是作者错误，且不会请求模型。
- 没有模型或 key 时不会做网络预检。消费后的 Fact 是 `unavailable`，Attempt 因此 `errored`。已配置端点的预检失败是 setup error；运行期传输失败是 `unavailable` Fact。
- “必须出现某个词”这类精确规则应使用 `includes` 等 matcher。Judge 只能看见传入材料，不能据此推断未提供的工具调用或文件内容。

## 相关阅读

- [Judge](../../judge/library.md) —— recipe、配置、材料和失败语义。
- [Verdict 与 Fact use](../../verdict/architecture.md) —— 阈值与终态。
- [计分 Fact](../../assertions/library/score-points.md) —— ScoreFact 计分。
