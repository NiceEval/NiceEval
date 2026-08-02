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

模型优先级：单次 `{ model }` → Experiment judge config → Eval judge config → 项目 judge config。没有内置默认模型，也没有环境变量层。
模型和端点是配置，只从代码来（[边界](../../architecture.md#配置从代码来凭据从环境来)）。

```ts
// 单条断言换更强的裁判,不动全局配置
t.judge.autoevals.factuality("布鲁克林今天是晴天", { model: "gpt-4o" }).atLeast(0.8);
```

端点默认是官方的 `https://api.openai.com/v1`。接 OpenAI 兼容代理时在 `judge.baseUrl` 里显式写出来，niceeval 不去环境里找代理地址。

API key 是凭据，只从环境变量读。`judge.apiKeyEnv` 指定读哪个变量，不指定时读 `NICEEVAL_JUDGE_KEY`。Judge 不借用被测应用的 `OPENAI_API_KEY` 或某个 Agent 的 key。

```ts
// niceeval.config.ts —— 走自己的网关,凭据放 .env 里的 MY_GATEWAY_KEY
export default defineConfig({
  judge: { model: "gpt-5.4-mini", baseUrl: "https://gateway.example.com/v1", apiKeyEnv: "MY_GATEWAY_KEY" },
});
```

Judge 评不出可信分数时，该条断言记录为 `outcome: "unavailable"`，并带机器可读 `reason` 与一层人读 `evidence`。它绝不静默消失，也绝不落成 0 分的通过记录。

运行期没有解析到模型时，reason 是 `judge-model-unresolved`；key 变量缺失时是 `judge-key-unresolved`。请求失败或响应中取不出分数时，reason 是 `judge-call-failed`，状态码与异常摘要进入 `evidence`。请求失败包括 HTTP 非 2xx、连接中断与调用超时；响应失败包括协议不符与分数缺失。

写下的 rubric 默认要求可评估。无论 soft 还是 gate，unavailable 都使 Attempt `errored`。
`.optional()` 只允许这条运行期判分证据缺席；此时 unavailable 保留在记录里，但不影响 Verdict。
折叠规则见 [Severity 与 Verdict](../verdict/architecture.md)。

## 调用预算与执行顺序

每次判分调用有界：`judge.timeoutMs` 毫秒内拿不到响应就中断这次调用，按 `judge-call-failed` 记 unavailable，`evidence` 写明超时秒数。默认 180_000：判分材料可以是整段长会话，更短的上限会把慢而能用的网关判成评不了，三分钟足以把「慢」与「挂死」分开。`timeoutMs` 与 `model` / `baseUrl` / `apiKeyEnv` 同链逐字段解析：Experiment 写了哪个字段就覆盖本次运行，没写的字段继续从 Eval、项目 config 取，都没写才落默认值；只有 model 允许单条断言再覆盖。

```ts
// niceeval.config.ts —— 网关慢但确实能用,给它更长预算
export default defineConfig({
  judge: { model: "gpt-5.4-mini", baseUrl: "https://gateway.example.com/v1", timeoutMs: 300_000 },
});
```

判分调用不重试。判分请求不是幂等读取，连接断开或超时后的暗中重放会为同一条 rubric 产生第二笔模型费用；偶发失败按 unavailable 契约留记录，要不要再评由重跑决定。

一个 attempt 内的断言按声明顺序逐条求值，judge 也不例外。attempt 之间已经并发，attempt 内再并发 judge 只会放大网关限流，而判分不重试，一次 429 就让整条 attempt errored。正在评哪条 judge，live 面板的断言求值行以 `judge k/n` 推进显示，契约见 [CLI · Attempt 阶段](../experiments/cli.md#attempt-阶段)。

Judge 默认 soft、无阈值，只记录分数；`.atLeast(x)` 添加 soft 阈值，`.gate(x?)` 变成硬要求；`.optional()` 声明允许缺席。severity（影不影响判定）与 optional（证据允许不允许缺席）是两个正交维度：

```ts
t.judge.autoevals.closedQA("回答是否切题?");                    // soft:记分;评不了 → errored
t.judge.autoevals.closedQA("是否遵守安全规范?").gate(0.8);      // gate:硬要求;评不了 → errored
t.judge.autoevals.closedQA("文风是否友好?").optional();          // 允许缺席:评不了只记录
```

分数、阈值、评分材料与 unavailable 在 show / view 里各显示成什么，见 [断言与 Turn 的展示](../assertions/library/display.md#judge)。

## 校验时点

配置解析只做无副作用的静态校验，例如 `baseUrl` 是否是合法 URL、`apiKeyEnv` 是否是合法环境变量名；**仅仅配置 Judge 不发网络请求**。此后的验证分两个时点：派发前的判分预检验证端点连通与鉴权（见下节），分数是否真的评得出来（协议相符、响应里取得出分数）在某条 judge assertion 首次执行时才知道，并按上面的 unavailable 契约记录在该条断言上。

运行期时点让 `.optional()` 有完整含义：响应不可解析、单次调用失败都可以由作者逐条决定是否允许缺席。
未执行 judge assertion 的 eval 不受 Judge 配置影响；全部结果携带时也不会产生额外网络请求。

从配置到确认分数真的评出来的完整走法，见用例[接上一个兼容网关，并确认它真的在打分](use-case/verify-judge.md)。

## 派发前预检

一次 `exp` 运行的计划里存在**要真派发、且会执行 judge 断言**的 eval 时，运行器在派发任何 attempt 之前对判分端点做一次最小探测请求，验证连通与鉴权。探测不判分、不产生模型费用。目的只有一个：判分端点不可用要在烧 agent 成本**之前**知道，而不是每条 attempt 跑完十分钟 agent 工作后才在 `assertions.evaluate` 阶段撞出一堆 unavailable。

两种情况不预检：Experiment、Eval 与项目都没配置 judge（运行期按 `judge-model-unresolved` 记录）；计划里含 judge 的 eval 全部命中携带、没有要派发的 attempt。

**探测预算**：每次探测 20 秒超时；传输失败（超时、连接建立失败、断连）后重试一次，**每次探测各自拥有完整的 20 秒预算**，两次都失败才判预检失败。端点已给出 HTTP 回应（非 2xx）不重试——回应是确定性答案，再探一次不会变。判分调用不重试是因为判分请求非幂等、重放产生第二笔模型费用；探测请求没有判分语义、成本可忽略，重试只为把瞬时网络抖动与真不可用分开，两条规则不冲突。

**预检失败只作废需要 judge 的 eval，不拦整次运行**：

- 这些 eval 的全部计划 attempt 不派发、不创建沙箱，逐条落成 `errored`。
  错误形状是 `error.code: "judge-precheck-failed"` 加 `error.phase: "judge.precheck"`，落盘与其它派发前确定性失败（如 `experiment-setup-failed`）同构。
- 不含 judge 断言的 eval 照常派发，一条 judge 配置问题不没收整批与它无关的结果。
- `error.message` 带实际探测的端点与失败原因（超时秒数或状态码）。超时的 `fix:` 首选提示是「端点接受连接但不回，先查同一账号的其它流量是否占满了网关并发」，其次才是核对 `baseUrl`——这两种错的症状一样，前者更常见也更难想到。

`.optional()` 不豁免预检：它允许的是运行期单条证据缺席、其余照评；预检失败意味着端点整体不可用，继续派发只会烧掉 agent 成本再产出同样的缺席记录。要在没有判分端点的环境跑这些 eval，在那个环境的配置里不写 judge——运行期逐条落 unavailable，`.optional()` 照常放行。

预检期间与失败后的终端反馈见 [CLI · 判分预检的显示](../experiments/cli.md#判分预检的显示)。
