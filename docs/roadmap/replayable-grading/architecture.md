# 可重评分 Eval —— Architecture

## 两个 plane

```text
Execution plane
  definition + Agent + Sandbox
  -> Observation + Provenance + exported Ref manifest
  -> ExecutionOutcome
  -> sealed ExecutionGraph

Grading plane
  sealed ExecutionGraph + current GradingDefinition
  -> Fact + Claim
  -> GradingResult
  -> sealed GradingGraph
```

`ExecutionOutcome.completed` 只说明驱动和证据采集完成，不表示答案通过。
评分状态只属于 `InlineEvaluationResult` 或 `GradingResult`。

## 状态机

Replayable Attempt 以 `execution.finished` 终结 execution graph：

```ts
type ExecutionOutcome =
  | { readonly status: "completed" }
  | { readonly status: "errored"; readonly error: ExecutionError }
  | { readonly status: "skipped"; readonly reason: string };
```

default grading 只在 Execution graph sealed 后运行。
每个 Grading graph 以 `grading.finished` 引用自己的 `GradingResult`。

目标 Observation Protocol 不再让一个混合 `attempt.finished` 同时引用 Observation 与 Verdict Claim。
Inline Eval 仍可把两类节点保存在同一 graph，但必须分别产出 ExecutionOutcome 与 InlineEvaluationResult。

## GradingResult

结果按 evaluation kind 判别，内部完整复用 Assertion Roadmap 的 Fact trace、issues、分数与终态字段：

```ts
type GradingResult =
  | ({ readonly evaluationKind: "pass" } & PassAttemptResult)
  | ({ readonly evaluationKind: "score" } & ScoreAttemptResult);
```

replayable grading 的每个 Fact use 都按 Assertion 契约携带 definition 内唯一的必填 `key`。
Writer 把它保存在 `FactUseResult`；Fact 图仍用 `factId`，Claim 仍用自己的 opaque identity，证据边仍用 `GraphEvidenceTarget`。
key 只用于跨 Grading 对齐作者声明，不能成为其中任何一种身份的替代品。

证据缺失或 producer 无法求值时，Fact 产生结构化 `unavailable`。
通过制的 required Fact unavailable 折成 `errored`；计分制折成 `unavailable` 与 `creditedScore: null`。

matcher 或 evaluator 违反自身协议时才是 evaluator defect。
两种 evaluation kind 都把 defect 折成 `errored`。

## Ref identity 与兼容

Runner 为每条 Agent Session 与 Turn 分配 durable opaque ID。
Provider 原生 ID 只进入 provenance，不能成为 NiceEval 引用身份。

Execution definition 保存 produced Ref schema；每次执行保存绑定 opaque ID 的 Ref manifest。
Grading definition 保存 required Ref schema。

兼容检查逐路径比较 required subset：

| Produced / required | 结果 |
|---|---|
| required path 存在且 kind 相同 | compatible |
| produced 多出未使用 path | compatible |
| required path 缺失 | incompatible |
| 同 path 的 Ref kind 改变 | incompatible |

schema digest 标识一份 schema并加速完全相等判断，但不能替代 subset 算法。
不兼容时不执行 grading callback、matcher 或 Fact evaluator。

## Session 与 diff selector

bare ReplaySession 表示完整 sealed Session。
`session.through(turn)` 建立带 opaque turn ID / event cursor cutoff 的 SessionView。

`g.sandbox.during(turn)` 读取该 Turn 的 send window。
展示 token `turn2` 不是 identity，也不能参与 send 区间归因。

NiceEval 原生同一 workdir 的 send window 串行。
原生 sealed Record 出现重叠属于 producer / Record defect，不能伪装成普通 Fact unavailable。

coverage complete 且没有变化时，逐 Turn diff 是 available empty。
没有 Sandbox、Provider 不支持 diff 或内容被有界省略时，Fact 按自己所需证据返回结构化 unavailable。

## 三类 fingerprint

单一 `configHash` 不再同时表示 execution 与 grading 可比性。

| Identity | 包含 | 排除 |
|---|---|---|
| `executionConfigHash` | Agent、model、reasoning、flags、Sandbox 与共享 execution 条件 | rubric、grading inputs 与 report-only metadata |
| `executionFingerprint` | 上一项，加 execution source/inputs、Ref produced schema、Adapter 与 Observation 版本 | grading source 与 projector |
| `inlineFingerprint` | execution 与交错 evaluation source、Fact policy、现有 inline Judge config 与 adapter evaluator identity | report-only inputs |
| `gradingFingerprint` | grading source/inputs、required refs、Fact/Match/projector 版本 | Agent 与 Sandbox execution 配置 |

source closure 以 definition 中的 `source: import.meta.url` 为根。
项目内 runtime import、字面 dynamic import 与受管 inputs 进入对应 closure；type-only import 不进入。

外部 package identity 保存 package、实际安装版本、subpath、export condition 与 lockfile integrity。
workspace/link package 按真实路径当本地 source closure；没有可信版本资料时哈希运行时入口 closure。

## 当前 link discovery

`grade --run` 从目标 SampleManifest 取得 Eval ID，再在当前 checkout 对这些 ID 执行 declarative Eval discovery。
当前 `.eval.ts` 是 execution/grading 链接的唯一执行权威。

discovery 可以初始化 side-effect-free definition module，但不调用 execution inputs、execution callback、Agent 或 Sandbox。
只有当前 grading definition 的 `inputs()` 在 grading owner capture 下执行。

历史 link 只用于 provenance、delta、reuse 与诊断，不是代码 fallback。
当前 Eval、组合入口或 grading module 缺失时，结果是 `grading-definition-unavailable`。

definition source locator 持久化为项目相对 path 或 package locator，不保存宿主绝对 `file://` URL。
Record 中归档的源码只供审计，永远不执行。

## Graph 与强边

```text
Run root
  -> ExecutionGraph*
  -> default GradingRun
       -> SampleManifest
            -> ExecutionGraph*
       -> GradingGraph*
            -> ExecutionGraph* through GraphEvidenceTarget
```

Grading Claim 使用带完整 graph ref 的依据：

```ts
interface GraphEvidenceTarget {
  readonly source: RecordGraphRef;
  readonly target: EvidenceTarget;
}
```

发布 Grading 前，Writer 验证 source graph sealed、target 可达且 schema 可读。
这条跨 graph edge 对 copy、export、publish 与 GC 都是 strong edge。

SampleManifest 强引用 Execution graph，但被携带 Attempt 所属的 Run 只保存 scalar `sourceRunId` 与 carry provenance。
GradingRun 也只把 owning run ID 当 provenance，因此内容图没有反向环。

## SampleManifest 与 current

每个 Experiment Run 都向 Record 写入一份 SampleManifest：

```ts
interface SampleManifest {
  readonly id: string;
  readonly digest: string;
  readonly executionConfigHash: string;
  readonly candidateEvalIds: readonly string[];
  readonly entries: readonly SampleManifestEntry[];
  readonly coverage: SampleCoverage;
}
```

entry 保存 Eval ID、expected fingerprint、ExecutionGraph ref、执行该 Attempt 的 Run ID、carry provenance 与 disposition。
Reader 不从历史 Run 临时补 Attempt。

Record index 为每个 Experiment 保存显式 `currentExecutionRunRef`。
Writer 按 Record sequence 原子推进它，不按 `producedAt` 扫描。

execution plane incomplete 时，current Manifest 保留 coverage gap，不回退旧 Run。
default grading incomplete 不妨碍 execution plane 成为 current，但 GradedSample 必须显示 grading gap。

## GradingRun 与 GradedSample

每个 Experiment Run 各自拥有 default GradingRun。
一次 Invocation 选择多个 Experiment 时，报告组合多份 GradedSample，不创建 Invocation 级 GradingRun。

```ts
interface GradingRun {
  readonly id: string;
  readonly sampleManifest: RecordGraphRef;
  readonly plan: GradingPlanManifest;
  readonly completion: "complete" | "incomplete" | "interrupted";
  readonly entries: readonly GradingRunEntry[];
}
```

GradingPlanManifest 是 Runner 在规划时写入的内部 manifest，不是公开 authoring API。
它把当前 Eval grading definition 与 grading inputs 固化到每个 Experiment × Eval entry。

混合 GradedSample 使用穷尽联合：

```ts
type GradedSampleEntry =
  | { readonly kind: "inline"; readonly result: InlineEvaluationResult }
  | { readonly kind: "graded"; readonly result: GradingResult; readonly grading: RecordGraphRef }
  | { readonly kind: "execution-terminal"; readonly outcome: ExecutionOutcome }
  | { readonly kind: "grading-gap"; readonly disposition: GradingGap };
```

inline 结果不会因 profile 不适用而消失。
execution skipped、grading skipped 与 grading gap 也不会在 coverage 中合并。

## Grading reuse

Grading reuse 与 execution carry 是两道独立门。
一次新 GradingRun 只有同时满足以下条件才引用旧 Grading：

1. source 是 exact ExecutionGraph RecordGraphRef；
2. gradingFingerprint 与 GradingPlanManifest 完全相同；
3. 旧 Grading graph sealed，跨图 closure 完整；
4. 结果是 pass 的 `passed | failed`，或 score 的 `scored | invalid`；
5. 当前 grading inputs 与 private digests 都能重新证明。

命中后 entry 写 `reused`，并强引用原 Grading，不复制 Claim。
`errored`、`unavailable` 与 `skipped` 默认重新执行 grading。

`--force` 只绕过 Grading reuse。
它不会重跑 Agent，也不会修改旧 Grading。

## GradingRun completion

GradingRun graph 在工作时 open，结束后 sealed。
批次完成度与单项结果正交：一批可以 `complete`，同时包含 errored 或 unavailable 的 GradingResult。

中断保留已经完成的 Grading，未到达项写 disposition，并以 `interrupted` 封口。
结构缺口使批次无法遍历完成时以 `incomplete` 封口。

default GradingRun 非 complete 时，所属 Run 也以相同非 complete 状态封口。
已 sealed 且 execution completed 的 graph 仍可被之后的新 GradingRun 使用。

## 行为矩阵

| 变化或输入 | 可 regrade | 可成为当前 execution | 结果 | 需要重跑 Agent |
|---|---|---|---|---|
| execution source 改变 | 旧 graph 只可显式历史评分 | 否 | 新 executionFingerprint | 是 |
| grading source 改变 | 是 | 是 | 新 Grading / GradingRun | 否 |
| fixture / prepare 改变 | 旧 graph 只可历史评分 | 否 | execution changed | 是 |
| required evidence 缺失 | 可以运行到 unavailable | 是 | pass errored / score unavailable | 补证据时是 |
| required Ref 不兼容 | 否 | 是 | grading gap: incompatible | 需要对应 Ref 时是 |
| execution graph incomplete | 否 | coverage gap | invalid target | 是 |
| graph corrupt / dangling | 否 | 否 | corrupt Record | 修复 Record graph 或重跑 |
| grading module 缺失 | 否 | 是 | grading-definition-unavailable | 否 |
| private grading input 缺失 | 否 | 是 | grading-input-unavailable | 否 |

历史 Claim 可读与当前 checkout、源码及私有输入可复核是两件事。
报告同时显示历史结果可读性与 private/source reproducibility 状态。
