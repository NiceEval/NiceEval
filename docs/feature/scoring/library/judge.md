# LLM-as-judge

Judge 用独立裁判模型评价规则难以表达的开放式结果。

```ts
t.judge.autoevals.factuality(expected).atLeast(0.8);
t.judge.autoevals.closedQA("是否适合 10 岁小孩理解");
t.judge.autoevals.summarizes(source);

turn.judge.autoevals.closedQA("这一轮是否回答问题?").gate();
```

只有三个固定入口，不提供平铺别名；第二参数统一是 `{ on?: string; model?: string }`：

- `closedQA(question, opts?)` —— `question` 是让裁判回答的封闭式问题。
- `factuality(expected, opts?)` —— `expected` 是对照用的事实参考答案。
- `summarizes(source, opts?)` —— `source` 是被总结的原始材料。

## 默认材料

- `t.judge` 默认评主 session 对话。
- `session.judge` 默认评该 session 对话。
- `turn.judge` 默认评 `turn.message`。
- `{ on }` 显式指定 diff、文件内容或任意其它材料。

```ts
t.judge.autoevals.closedQA("diff 是否只修改目标逻辑?", {
  on: t.sandbox.diff.get("src/weather.ts"),
}).atLeast(0.7);
```

## 模型与鉴权

模型优先级：单次 `{ model }` → eval judge config → 项目 judge config → `NICEEVAL_JUDGE_MODEL`。没有内置默认模型。

```ts
// 单条断言换更强的裁判,不动全局配置
t.judge.autoevals.factuality("布鲁克林今天是晴天", { model: "gpt-4o" }).atLeast(0.8);
```

没有解析到模型或 API key 时，该条 judge 断言记录为 `outcome: "unavailable"`（带原因，如 `judge-model-unresolved`），绝不静默消失。写下的 rubric 默认要求可评估——无论 soft 还是 gate，unavailable 都使 attempt `errored`（评不了的结论不可信，不能算通过，也不该算 agent 答错）；确实允许这条 rubric 缺席时显式链 `.optional()`，它的 unavailable 只保留在记录里，不影响判定。折叠规则见 [Severity 与 Verdict](../architecture/severity-and-verdict.md)。CI 不需要从报告里是否有分数反推 judge 是否真的跑了：缺 key 直接红，optional 的 unavailable 在记录里可查。

Judge 默认 soft、无阈值，只记录分数；`.atLeast(x)` 添加 soft 阈值，`.gate(x?)` 变成硬要求；`.optional()` 声明允许缺席。severity（影不影响判定）与 optional（证据允许不允许缺席）是两个正交维度：

```ts
t.judge.autoevals.closedQA("回答是否切题?");                    // soft:记分;评不了 → errored
t.judge.autoevals.closedQA("是否遵守安全规范?").gate(0.8);      // gate:硬要求;评不了 → errored
t.judge.autoevals.closedQA("文风是否友好?").optional();          // 允许缺席:评不了只记录
```

分数、阈值、评分材料与 unavailable 在 show / view 里各显示成什么，见 [断言与 Turn 的展示](display.md#judge)。
