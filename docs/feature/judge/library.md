# Judge —— 库用法

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

模型优先级：单次 `{ model }` → eval judge config → 项目 judge config。没有内置默认模型，也没有环境变量层。
模型和端点是配置，只从代码来（[边界](../../architecture.md#配置从代码来凭据从环境来)）。

```ts
// 单条断言换更强的裁判,不动全局配置
t.judge.autoevals.factuality("布鲁克林今天是晴天", { model: "gpt-4o" }).atLeast(0.8);
```

端点默认是官方的 `https://api.openai.com/v1`。接 OpenAI 兼容代理时在 `judge.baseUrl` 里显式写出来，
niceeval 不去环境里找代理地址。

API key 是凭据，只从环境变量读。`judge.apiKeyEnv` 指定读哪个变量，不指定时读
`NICEEVAL_JUDGE_KEY`。Judge 不借用被测应用的 `OPENAI_API_KEY` 或某个 Agent 的 key。

```ts
// niceeval.config.ts —— 走自己的网关,凭据放 .env 里的 MY_GATEWAY_KEY
export default defineConfig({
  judge: { model: "gpt-5.4-mini", baseUrl: "https://gateway.example.com/v1", apiKeyEnv: "MY_GATEWAY_KEY" },
});
```

Judge 评不出可信分数时，该条断言记录为 `outcome: "unavailable"`，并带机器可读 `reason`
与一层人读 `evidence`。它绝不静默消失，也绝不落成 0 分的通过记录。

运行期没有解析到模型时，reason 是 `judge-model-unresolved`；key 变量缺失时是
`judge-key-unresolved`。请求失败或响应中取不出分数时，reason 是 `judge-call-failed`，状态码与
异常摘要进入 `evidence`。请求失败包括 HTTP 非 2xx、
连接中断与调用超时；响应失败包括协议不符与分数缺失。

写下的 rubric 默认要求可评估。无论 soft 还是 gate，unavailable 都使 Attempt `errored`。
`.optional()` 只允许这条运行期判分证据缺席；此时 unavailable 保留在记录里，但不影响 Verdict。
折叠规则见 [Severity 与 Verdict](../verdict/architecture.md)。

Judge 默认 soft、无阈值，只记录分数；`.atLeast(x)` 添加 soft 阈值，`.gate(x?)` 变成硬要求；`.optional()`
声明允许缺席。severity（影不影响判定）与 optional（证据允许不允许缺席）是两个正交维度：

```ts
t.judge.autoevals.closedQA("回答是否切题?");                    // soft:记分;评不了 → errored
t.judge.autoevals.closedQA("是否遵守安全规范?").gate(0.8);      // gate:硬要求;评不了 → errored
t.judge.autoevals.closedQA("文风是否友好?").optional();          // 允许缺席:评不了只记录
```

分数、阈值、评分材料与 unavailable 在 show / view 里各显示成什么，见 [断言与 Turn
的展示](../assertions/library/display.md#judge)。

## 校验时点

配置解析只做无副作用的静态校验，例如 `baseUrl` 是否是合法 URL、`apiKeyEnv` 是否是合法环境变量名；
**仅仅配置 Judge 不发网络请求**。模型、key 和端点是否真的可用，在某条 judge assertion 首次执行时才
验证，并按上面的 unavailable 契约记录在该条断言上。

这个时点让 `.optional()` 有完整含义：缺模型、缺 key、鉴权失败、端点不可达和响应不可解析都可以由
作者逐条决定是否允许缺席。未执行 judge assertion 的 eval 不受 Judge 配置影响；全部结果携带时也不会
产生额外网络请求。想在昂贵评测前确认网关时，运行一个只含 judge assertion 的小型验证 eval，见下方用例。

从配置到确认分数真的评出来的完整走法，见用例[接上一个兼容网关，并确认它真的在打分](use-case/verify-judge.md)。
