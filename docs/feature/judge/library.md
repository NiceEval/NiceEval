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

运行期没有解析到模型时，reason 是 `judge-model-unresolved`。请求失败或响应中取不出分数时，
reason 是 `judge-call-failed`，状态码与异常摘要进入 `evidence`。请求失败包括 HTTP 非 2xx、
连接中断与调用超时；响应失败包括协议不符与分数缺失。

写下的 rubric 默认要求可评估。无论 soft 还是 gate，unavailable 都使 Attempt `errored`。
`.optional()` 只允许这条运行期判分证据缺席；此时 unavailable 保留在记录里，但不影响 Verdict。
折叠规则见 [Severity 与 Verdict](../verdict/architecture.md)。

`.optional()` 不能放宽已配置 Judge 的启动期完整性。配置声明模型后，缺 key 或端点预检失败
仍在派发前中止 Invocation。

Judge 默认 soft、无阈值，只记录分数；`.atLeast(x)` 添加 soft 阈值，`.gate(x?)` 变成硬要求；`.optional()`
声明允许缺席。severity（影不影响判定）与 optional（证据允许不允许缺席）是两个正交维度：

```ts
t.judge.autoevals.closedQA("回答是否切题?");                    // soft:记分;评不了 → errored
t.judge.autoevals.closedQA("是否遵守安全规范?").gate(0.8);      // gate:硬要求;评不了 → errored
t.judge.autoevals.closedQA("文风是否友好?").optional();          // 允许缺席:评不了只记录
```

分数、阈值、评分材料与 unavailable 在 show / view 里各显示成什么，见 [断言与 Turn
的展示](../assertions/library/display.md#judge)。

## 派发前预检

配了 `judge` 就在任何 attempt 派发之前预检一次：确认模型与 key 解析得到，并发一个最小请求确认端点真的可达。
它作用于整次 invocation——判分端点不通时，让整批 attempt 各自烧完 agent 成本再逐条 `judge-call-failed`，
比派发前停下来贵得多。

预检有两层预算：

- **单次探测 20s 上限。** 网关接受了连接却一直不回时按超时中止，报「端点无响应」并指路 `judge.baseUrl`
  与网关，不把通用 abort 甩给用户。
- **传输层错误退避重试至多两次。** 连接建立失败、连接中途断开这类「换个时机大概率能过」的错误按 [`network`
  的判据](../error-classification/README.md#分类)重试；有 HTTP 状态码回来的（401、404、400）
  一律不重试——它们同因必复现，重试只是把同一个配置错误多问三遍。重试期间运行级预检行不消失、elapsed
  继续增长（见 [Experiments · judge 预检的显示](../experiments/cli.md#judge-预检的显示)）。这与 turn 层、
  provisioning 层的有界重试是同一条纪律：派发前的一次网络抖动不该让整批 attempt 一条都起不来。

重试耗尽或不可重试的预检失败中止本次运行，按[错误反馈契约](../../error-feedback.md#消息三段式)给出 `fix:`。
鉴权失败（401 / 403）的下一步要同时点名两处解析口径：省略 `baseUrl` 时打的是官方端点
`https://api.openai.com/v1`，key 读的是 `judge.apiKeyEnv` 指定的变量或 `NICEEVAL_JUDGE_KEY`。
接兼容网关却只配 key，会导致网关凭据被发到官方端点。OpenAI 返回的「Incorrect API key provided」
不会提示端点选错，因此 `fix:` 必须同时点名这两处解析结果。

**预检失败不降级成 warning，也不读取断言级 `.optional()`。** 预检验证的是作者已经配置给本次 Invocation
的共享 Judge 基础设施，不是某一条 Assertion 的运行结果；断言链只有进入 `test(t)` 后才构造，
不能反向改变派发前配置是否完整。要容忍单条运行期调用失败，在该断言上写 `.optional()`；要让整批在 Judge
基础设施不可用时仍执行，就不要为这次 Invocation 配置 Judge。

从配置到确认分数真的评出来的完整走法，见用例[接上一个兼容网关，并确认它真的在打分](use-case/verify-judge.md)。
