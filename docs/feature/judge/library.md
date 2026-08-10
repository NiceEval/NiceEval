# Judge —— 库用法

Judge 的三个 recipe 都返回 `ScoreFact<"now">`：`closedQA`、`factuality` 和 `summarizes`。它们只创建惰性的 Fact；判定、控制流和计分分别由 `t.assert`、`await t.require` 与 `t.score` 声明。

```ts
const correctness = turn.judge.autoevals.factuality("Brooklyn 的天气是晴朗。");
t.assert(correctness, { atLeast: 0.9, label: "天气事实" });

const summary = t.judge.autoevals.summarizes("原始需求", {
  input: "请总结需求。",
  output: t.reply,
});
t.assert(summary, { atLeast: 0.8 });
```

`ScoreFact` 的分数必须是有限数字且位于 `[0,1]`。Judge 返回无效结构或范围外分数时，Fact 是 evaluator error；NiceEval 不裁剪分数。

## Capability 与配置

Eval 的 `judge` 字段既声明 capability，也确定是否可以创建 Judge Fact：

```ts
defineEval({ judge: true, test });

defineScoreEval({
  judge: { model: "judge-model", timeoutMs: 120_000 },
  test,
});
```

- `true` 从 Experiment 和项目 `defineConfig` 继承每个 Judge 配置字段。
- 对象声明 capability，并按字段替换 Experiment 与项目配置。
- 未声明时，读取 `t.judge.autoevals.*` 或 `turn.judge.autoevals.*` 并创建 Fact 会立即报 author error。

字段按 Eval 对象、Experiment、项目 Config 的顺序选择。`baseUrl` 默认 `https://api.openai.com/v1`，`apiKeyEnv` 默认 `OPENAI_API_KEY`，`timeoutMs` 默认 180000 毫秒。

Runner 在规划时冻结一次求值后的配置。同一份不可变值进入 fingerprint、预检和 evaluator；没有单个 Fact 的 model override。`result.json` 只保留 credential selector 名，不保留 key。

```ts
export default defineConfig({
  judge: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
  },
});
```

## 材料边界

根级 `t.judge` 必须显式接收结构化材料：

```ts
const source = await t.sandbox.readText("README.md");
const fact = t.judge.autoevals.closedQA("文档是否说明安装步骤？", {
  input: source,
  output: t.reply,
});
t.assert(fact, { atLeast: 0.8 });
```

传文件时，先通过公开 `Sandbox` API 读取成字符串，再放入 `{ input, output }`。Judge 不接受路径猜测、`{ on }`、隐式 last input 或单次模型替换。

`turn.judge` 把该 immutable Turn 的原始 user input 和 assistant output 冻结为材料，因此 recipe 只接收标准：

```ts
const turn = await t.send("用两句话说明风险。");
t.assert(turn.judge.autoevals.closedQA("回答是否恰好说明风险？"), { atLeast: 0.8 });
```

没有 `session.judge`。跨 Turn 的判断由作者在根级 API 中显式组合文本材料。

## 消费、控制流与计分

通过制 Eval 使用 verdict use：

```ts
t.assert(turn.judge.autoevals.closedQA("回答是否切题？"), { atLeast: 0.75 });
```

需要立即决定后续控制流时使用 `require`。它立即开始该 Fact 的求值，达到阈值才继续；低分、unavailable 或 evaluator error 都结束依赖路径，最终 Fact/use 图决定 Attempt 终态。

```ts
await t.require(turn.judge.autoevals.factuality("答案必须是 42。"), { atLeast: 1 });
```

计分 Eval 可以只创建 score use，也可以与 verdict use 复用同一 Fact：

```ts
const quality = turn.judge.autoevals.summarizes("原始材料");
t.assert(quality, { atLeast: 0.7 });
t.score("摘要质量", quality, { max: 20, key: "summary-quality" });
```

一个悬空 Judge Fact 是 author error。检查在受管边界和正常返回时发生，且不会启动 evaluator 请求。Judge evaluator 在一个 Attempt 内按 Fact 声明顺序串行；进度显示 `judge · <check>` 和已耗时，已知批次才显示 `k/n`。

Judge 没有 `soft`、`optional`、`observe`、`gate`、`points` 或链式 use API。

## 无配置、预检与 evaluator 失败

没有 model、key 或 provider 时，Runner 不做网络预检。被消费的 Judge Fact 产生普通 `unavailable`，reason 分别是 `judge-model-unresolved` 或 `judge-key-unresolved (...)`，并且不发网络请求。普通 verdict use 因此使通过制 Attempt `errored`；计分 use 使计分 Attempt `unavailable` 或 `errored`，取决于图中的其它问题。

已配置 model 和 key 的 capability 会在派发前做 endpoint 预检。真实预检失败是 setup error：受影响 Attempt 不执行 agent，也不伪造 Judge Fact。它与 evaluator 请求失败不同；后者只产生被消费 Fact 的普通 `unavailable`，保留 reason 和裁剪、脱敏后的 evidence。

Judge 最多进行三次物理 evaluator 调用。408、429、5xx 和连接类失败可在同一 `timeoutMs` 总预算内重试。其它协议或响应结构问题不被伪装为成功。rationale 写入通用 `explanation` 字段；`evidence` 只保存裁剪和脱敏后的判分材料。

## 持久化与读取

schema 17 的 `result.json` 直接保存 `factResults` 与 `factUses`，算法标识为 `fact-use/v2`。Judge 没有 sidecar 或专用结果联合；show、view、failure feedback 与 reporter 都从同一张 Fact/use 图读取。

成功且已消费的 Judge ScoreFact 可以进入 `examScore`。有 score use 的同一 Fact 只进入 `totalScore`。Braintrust 导出 normalized score，并在存在 verdict use 时用稳定 use key 导出 0 或 1 的 threshold verdict；unavailable 与 evaluator error 只进入 metadata。
