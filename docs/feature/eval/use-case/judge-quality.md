# 裁判评质量：规则写不出对错时

## 解决什么问题

「语气是否专业」「diff 是否只改了目标逻辑」这类问题没有可以 `includes` 的标准答案。
LLM-as-judge 用独立裁判模型打 0.
.
1 的分，再由阈值决定它是观测指标还是硬门槛。
入口只有三个，不用挑：封闭式问题用 `closedQA`，有事实参考答案用 `factuality`，评总结质量用 `summarizes`。

## 全流程

1. 挂在哪个接收者上决定默认评什么材料：`t.judge` 评主 session 整段对话，`turn.judge` 只评那一轮的回复：

   ```typescript
   const draft = await t.send("帮我拟一封跟进邮件。");
   draft.judge.autoevals.closedQA("语气是否专业?").atLeast(0.6);   // 这一轮
   t.judge.autoevals.closedQA("多轮之间口径是否一致?").atLeast(0.7); // 整段对话
   ```

2. 评对话之外的材料（diff、文件、任意字符串）用 `{ on }` 显式传值：

   ```typescript
   t.judge.autoevals.closedQA("diff 是否只修改目标逻辑?", {
     on: t.sandbox.diff.get("src/weather.ts"),
   }).atLeast(0.7);
   ```

3. 用阈值声明这条 rubric 的分量。
   judge 默认 soft、无阈值、只记分——适合新写的 rubric 先跑几轮看分布；`.atLeast(x)` 加软阈值；确认可靠后毕业成 `.gate(x)` 硬门槛：

   ```typescript
   t.judge.autoevals.closedQA("回答是否切题?");                 // 只记分
   t.judge.autoevals.closedQA("是否遵守安全规范?").gate(0.8);   // 硬要求
   ```

4. 裁判模型的优先级是：单次 `{ model }` → Experiment 的 `judge` 字段 → Eval 的 `judge` 字段 → 项目配置。
   没有内置默认模型，也没有进程变量层：

   ```typescript
   t.judge.autoevals.factuality("布鲁克林今天是晴天", { model: "gpt-4o" }).atLeast(0.8);
   ```

## 边界

- 找不到模型或 API key 时，judge 断言记 `unavailable` 并使 attempt `errored`——写下的 rubric 默认要求可评估，缺 key 直接红，不会静默消失。
  确实允许缺席的 rubric 显式链 `.optional()`。
- 判断「必须提到某个词」这类可精确表达的规则，用 `includes` 等 matcher，不要浪费一次 judge 调用。
- 期望输出接近逐字稳定时用 `similarity`（编辑距离）就够；judge 留给真正开放式的质量问题。
- judge 的评分材料必须让裁判看得见完整证据：评「agent 是否用了正确渠道」这类过程问题时，材料里要包含过程信息，或改用过程断言（见[过程与成本](process-and-cost.md)）。

## 相关阅读

- [Judge](../../judge/library.md) —— 三个入口、模型求值与 unavailable 语义的单源契约。
- [Severity 与 Verdict](../../verdict/architecture.md) —— soft 阈值怎样在 `--strict` 下收紧。
- [Assertions · 作用域](../../assertions/architecture/scopes.md) —— 各接收者 judge 的默认材料。
- [Assertions · 计分粒度](../../assertions/library/score-points.md) —— Judge 分数进质量分列，两个都通过的模型质量差可比；计分制里链 `.points(n)` 按连续分比例挣分。
