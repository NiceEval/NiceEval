# 原生 LLM Judge Runtime —— Library

LLM Judge 只接收 [Judge Check](../material/library.md#recipe-与-check)。Material View 与 selector 不在本篇重复定义。

```ts
const check = judge.check({
  recipe: judging.recipes[0],
  material: {
    task: turn.material.input,
    reply: turn.material.reply,
    criterion: judging.material.criterion,
  },
});

t.check(
  check,
  judge.llm().atLeast(0.8),
)
  .gate()
  .label("回答完整");
```

## Profile

Profile 只拥有一次模型执行的连接与限制。当前 Feature 由 `judgeRuntime` 配置；以下显式 Profile 是后续目标：

```ts
interface LlmJudgeProfile {
  readonly identity: string;
  readonly provider: JudgeProvider;
  readonly model: string;
  readonly endpoint?: URL;
  readonly credentialSelector: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxCost?: Money;
}
```

Credential selector 可以进入 Record，credential value 不进入。省略调用处的 `profile` 时，从 Eval capability、Experiment 与项目配置中按既定层级取得一个冻结 profile；不存在时 Assertion 为 unavailable。

## Recipe Graph

Recipe 拥有 slot schema、rubric、anchors、Decision schema 与静态 Judge Graph。Graph 节点只能读取当前 Check 的具名 slot 或前序节点的结构化结果；不能打开 workspace、调用工具、读取网络或扩张 manifest。自定义 Recipe 是声明式、带稳定 identity 且有 canonical content digest 的受管值，不接受任意执行 callback。

Profile 不携带 rubric，recipe 不携带 provider credential、threshold、score contribution 或 control。改变 profile、recipe control 或 presentation protocol 都会产生新的 Judge Evaluation identity。

Score Eval 中，同一 entry 可以写成 `t.check(check, judge.llm().atLeast(0.8)).score(5)`。threshold 只增加局部 condition，不改变 score。

## 显式 batch

单次调用永不隐式合批。Recipe 声明 `batchSafe: true`，并且所有 Check 求值得到完全相同的 canonical visibility manifest 与 security/runtime profile 时，作者可以调用：

```ts
const [accuracy, clarity] = t.judge.llm.batch(
  [accuracyCheck, clarityCheck],
  { profile: qualityJudge },
);
```

返回的每个 handle 仍对应一条独立 Assertion 与 Decision。完整准入和失败语义见[拆分或显式合批维度](../material/use-case/split-or-batch-dimensions.md)。
