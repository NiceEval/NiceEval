# Assertion 作者面 —— 架构

## 不可变配置与 capability

Judge 只在 Eval 声明 `judge?: true | JudgeConfig` 时可用。`true` 表示 capability 存在并继承 Experiment/Config；对象也声明 capability，并逐字段替换。

规划每个 Experiment × Eval pair 时调用一次配置求值，得到冻结的：

```ts
interface ResolvedJudgeConfig {
  readonly model?: string;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly timeoutMs: number;
}
```

这一个对象进入 fingerprint、预检、Attempt evaluator 和 run record identity。没有第二次配置求值、单 Fact model override 或源码正则检测 Judge 使用情况。

未声明 capability 后创建 Judge Fact 是同步 author error。model、key 或 provider 缺失时，Runner 跳过网络预检；被消费的 Fact 是 ordinary unavailable，且零网络。

已配置 model 与 key 时，Runner 在派发前预检 endpoint。真实失败作为 `judge-precheck-failed` setup error 阻止受影响 Attempt 的 agent 执行；它不制造假的 `factResults` 行。

## Fact producer 与材料

```text
Boolean Match / scope / Sandbox / Judge recipe
                     │
                     ▼
            owned Fact node (lazy)
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
      verdict use            score use
```

根级 Judge recipe 必须接收 `{ input, output }`。`turn.judge` 在 Turn 完成时绑定原始 user input 与 assistant output。没有 `session.judge`、`{ on }`、路径猜测或隐式 last input。

文件材料先走公开 Sandbox API：

```ts
const input = await t.sandbox.readText("prompt.md");
const fact = t.judge.autoevals.closedQA("是否回答问题？", {
  input,
  output: turn.message,
});
```

三个 recipe 都返回 `ScoreFact<"now">`。创建 Fact 只注册 node；`check`、`require` 或 `score` 才让它可达。没有 use 的 Fact 是 author error，且不启动 evaluator。

每个 node memoize 一次 evaluator promise。一个 Fact 最多登记一个 verdict use 与一个 score use。依赖 Fact 随 root use 可达；不可达 node 不读取 deferred evidence 或调用 Judge。

连续分数的阈值不放在 consumer options。`ScoreMatch.atLeast(n)` 创建 `ThresholdedScoreMatch`，`ScoreFact.atLeast(n)` 创建指向同一 owned Fact 的 `ThresholdedScoreFact`。两种 view 都是冻结的纯描述：不创建 Fact、不登记 use、不改变可达性。

`check` 或 `require` 只在消费 threshold view 时把 `n` 写进 verdict use。value/source 加 thresholded match 时，Fact 与 use 仍在一个事务内创建；existing ScoreFact 的 view 保留原 producer location，consumer location 指向 `check` 或 `require`。`score` 拒绝 threshold view，只消费底层连续分数。

## 求值、串行与控制流

收尾阶段以 source order 求值可达 Fact。Judge node 使用同一 Attempt 的 serial lane；require 立即启动的 Judge 也进入该 lane。Attempt 间仍可并发。

进度内容是 `judge · <check>` 加已耗时。只有收尾前已知的可达 Judge 批次才显示 `k/n`；不猜测动态或未到达节点。

`require` 在调用时原子登记 verdict use、检查悬空 Fact，并立即开始 `now` Fact 求值。分数路径从 threshold view 取得阈值；满足后返回 normalized score。failed、unavailable 或 evaluator error 用受管控制信号结束依赖路径。作者必须观察其 Promise；未观察或仍 pending 的 requirement 在下一受管边界是 author error。

ScoreFact 的有效分数是有限 `[0,1]`。collector 拒绝 clamp。evaluator 返回非法结构、非法 error 或越界 score 时生成 evaluator error。

## Fact 结果与 Attempt 折叠

`EvaluationFactResult` 的共同字段包括 `factId`、`name`、source location、依赖、`expected`、`received`、`explanation` 和 `evidence`。`explanation` 放 rationale；`evidence` 只放裁剪、脱敏后的判分材料。

Boolean Fact 的成功状态是 `passed` 或 `failed`。ScoreFact 的成功状态是 `scored` 和 `normalizedScore`。两类 Fact 还可为 `unavailable`、`errored` 或未到达状态。

通过制折叠顺序是：被消费 evaluator error 或 ordinary unavailable → `errored`；failed verdict use → `failed`；全部 verdict use `notApplicable` → `skipped`；否则 `passed`。

计分制先累加成功 score use 的 `earned`。failed verdict use 产生 `invalid` 和 `creditedScore: 0`；error 产生 `errored`；unavailable 产生 `unavailable`；skip 产生 `skipped`；其余为 `scored`。`earnedScore` 是诊断值，不能替代 aggregation 的 `creditedScore`。

Judge evaluator 的 transport 或 HTTP 失败是普通 Fact unavailable。模型响应的非法结构或非法 score 是 evaluator error。两者不会转写成假的零分。

## 原子 Record 协议

schemaVersion 18 与 `evaluationAlgorithm: "fact-use/v3"` 一起切换。Attempt 直接持久化：

```ts
interface AttemptFactRecord {
  readonly factResults: readonly EvaluationFactResult[];
  readonly factUses: readonly (VerdictFactUseResult | ScoreFactUseResult)[];
  readonly scoreResult?: ScoreFactAttemptOutcome;
}
```

旧 schema 整份 unsupported。reader 不做部分兼容、字段猜测、迁移或回退。结果协议中没有 assertion sidecar、handle 快照、collector adapter、专用 Judge issue reference 或第二套 evaluator union。

## 读取与 exporter

show、view、source、failure feedback、task history、report entity list 和 reporter 都只投影 `factResults` 与 `factUses`。通用摘要依次考虑：score terminal、失败 use、被消费的 unavailable/error Fact、成功 ScoreFact。

Braintrust 对已消费成功 ScoreFact 导出 normalized score。该 Fact 有 verdict use 时，另按稳定 use key 导出 0/1 threshold verdict。unavailable 和 error 只进入 metadata。

`examScore` 只聚合已消费、成功且没有 score use 的 ScoreFact，每 Fact 一次。有 score use 的 Fact 只进入 `totalScore`，防止同一 Judge 分数被计两次。
