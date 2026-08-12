# Judge —— Library

`closedQA`、`factuality` 与 `summarizes` 都直接登记 measurement Assertion。它们返回同一 entry 的
AssertionHandle；没有需要交给另一条 `check`、require 或 score API 的中间对象。

```ts
const correctness = turn.judge.autoevals.factuality("Brooklyn 的天气是晴朗。")
  .atLeast(0.9)
  .label("天气事实");

const summary = t.judge.autoevals.summarizes("原始需求", {
  input: "请总结需求。",
  output: t.reply,
}).score(10).label("摘要质量");
```

上例的第一条属于 Pass Eval，第二条属于 Score Eval。Pass measurement 必须 threshold；Score measurement
可以贡献 score，threshold 只增加局部 condition。

## Capability 与配置

Eval 的 `judge` 字段声明 Judge capability：

```ts
defineEval({ judge: true, test });

defineEval({
  judge: { model: "judge-model", timeoutMs: 120_000 },
  test,
});
```

- `true` 从 Experiment 和项目 `defineConfig` 继承配置字段。
- 对象声明 capability，并按字段替换外层配置。
- 未声明时创建 Judge Assertion 是同步作者错误。

Runner 在规划时冻结一次求值后的配置。同一不可变值进入 fingerprint、预检与 evaluator；Record 只保存
credential selector，不保存 key。

## 材料边界

根级 `t.judge` 必须显式提供结构化材料：

```ts
const source = await t.sandbox.readText("README.md");

t.judge.autoevals.closedQA("文档是否说明安装步骤？", {
  input: source,
  output: t.reply,
}).atLeast(0.8).label("安装说明");
```

`turn.judge` 在调用时冻结该 Turn 的原始 input 与 output。没有 `session.judge`、路径猜测、隐式 last
input 或单项 model override。

## 求值、控制与错误

Judge evaluation 对同一 entry memoize 一次。handle 可以跨 `await` 配置，但不重读材料或重启模型。
同一 Attempt 的 Judge evaluator 按 source order 进入受管 serial lane；Attempt 之间仍可并发。

thresholded measurement 可以 `await .orStop()`。below 触发 authoring stop latch；捕获 reject 不会恢复
后续 NiceEval API 的登记能力。未 threshold 的 measurement 不能 `.orStop()`。

没有 model、key 或 provider 时不发网络预检，Assertion 为 `unavailable` 并保留机器可读 reason。完整配置
的 endpoint 预检失败是 setup error，受影响 Attempt 不执行 Agent，也不伪造 AssertionResult。

模型请求后的传输失败是 `unavailable`。无效响应、非有限数值和区间外数值是 `errored`。理由写入
explanation 或 Judge rationale，evidence 只保存裁剪与脱敏后的材料。

## 读取

schema 19 的 `result.json` 以 `assertionResults` 保存 Judge evaluation 与 policy projection。show、view、
failure feedback 和 reporter 使用同一投影；Judge 没有专用展示分支。
