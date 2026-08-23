# 可重评分 Eval —— 架构

完整 Assertion 语义在 [Assertions](../../feature/assertions/README.md)。Replayable Grading 只从 sealed Execution source 与当前 GradingDefinition private input 建立新的评分；它不重新进入被测 Agent 或 live Sandbox。

## Execution source

Execution graph 保存 Session/Turn input 与 reply、Action occurrence/result、显式 captured custom material、provenance、可信终态与 ExecutionOutcome。每个 source 使用 graph-scoped semantic ref；seal 后不能修改、补采或跨 graph 重解释。

GradingDefinition 通过具名 Turn ref 和封闭 selector 选择 source。没有隐式 `last` / `current`、Session snapshot、跨 Attachment blob ref 或“沿用旧 Assertion 的 material”。缺失 source、incomplete collection 或无法隔离的 result 按 [Judge Material coverage](../judge-runtimes/material/architecture.md#绑定coverage-与顺序) 成为 unavailable。

当前 definition 的 rubric、anchors、reference/custom bytes 与受管 loader 是 evaluator private inputs。它们不从历史 Record 执行源码，也不访问 live workspace 或任意 evidence network。

## JudgeEvaluation 与 GradingClaim

Judge Evaluation 是 evaluator occurrence，拥有 MaterialBindingManifest、presented/investigation closure 与 Decision。Grading Claim 引用一个 Evaluation，再拥有 subject/check identity、AssertionResult、evaluation kind、threshold、score contribution 与 control policy。

```text
Execution source refs + current evaluator private inputs
                         │
                         ▼
                   JudgeEvaluation
                         │
                         ▼
                    GradingClaim
```

`evaluatorPrivateInputDigest` 只纳入 rubric、anchors、Decision protocol、definition reference/custom bytes 与 loader identity。它进入 manifest 和 Judge Evaluation reuse identity。

GradingDefinition identity/version 与 claim policy digest 纳入 evaluation kind、threshold、score contribution 和 control。这两个值只进入 Grading Claim identity。

因此只改 threshold、score 或 control 会创建新 Claim，并复用完整旧 Evaluation。改 material、reference、rubric、runtime、安全协议、workspace capability 或 batch composition 必须创建新 Evaluation。

若存在纳入整个 GradingDefinition 的宽 digest，它不能参与 Evaluation reuse。

`--force` 在相同 eligibility identity 下创建新的 Evaluation occurrence 和 Claim，并保存 forced provenance。随机 evaluator 可以在相同 reuse identity 下存在多个 occurrence；identity 表示复用资格，不冒充 Decision 的内容决定性。

Claim 使用下面的穷尽持久语义：

```ts
interface GradingClaim {
  readonly id: GradingClaimRef;
  readonly gradingDefinitionIdentity: string;
  readonly gradingDefinitionVersion: string;
  readonly executionSubjectRef: ExecutionSubjectRef;
  readonly checkDeclarationIdentity: string;
  readonly evaluationKind: "pass" | "score";
  readonly assertionPolicy: AssertionPolicy;
  readonly judgeEvaluationRef: JudgeEvaluationRef;
  readonly assertionResult: AssertionResult;
}
```

Assertion label 是展示字段，不改变 Judge Evaluation。它是否改变 Claim 的展示 identity，沿 [Assertion](../../feature/assertions/README.md) 的现有规则处理。

## projection

Pass grading 使用 Boolean condition 与 thresholded measurement 折叠 Verdict。Score grading 累加显式
score contribution。Record-only Assertion 的问题只保留 Issue；参与 score 的 Assertion 或 control Assertion
不可用时，grading 保存 `partialScore` 并不可排名。

每个 Claim 以精确 semantic ref 指向具体 sealed graph subject，并以 `JudgeEvaluationRef` 引用完整旧 Evaluation。引用不复制 evidence，也不借用其它 owner 的 blob。

## GradingRun 与 GradedSample

GradingRun 是对一个 Experiment Run 的 `SampleManifest` 执行或复用全部 Grading 的持久批次。SampleManifest 固定候选分母、每个成员的 Execution graph ref、carry provenance 与 coverage；历史重评不能按时间猜当前成员。

每个 GradedSample 保存所选 Execution、Judge Evaluation refs、Grading Claims 与 `GradingResult`。GradingResult 按 pass 或 score evaluation kind 判别，与 ExecutionOutcome 分开：Pass 结果可以折叠 Verdict；Score 结果只有累计 score、partialScore 与 ranking eligibility。

## 读取

`show`、`view`、JSON 与 export 从所选 GradingRun 的 sealed Claims 离线投影，不重新运行 evaluator。读面分别显示声明、已定位 source、已交付材料与调查项；未启动 evaluator 时不伪造 presentation。
