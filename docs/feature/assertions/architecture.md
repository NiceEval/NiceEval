# Assertions —— 架构

完整语义在 [Assertions](README.md)。本页规定 entry、结果、Record 和两种 grading 的内部不变量。

## 一个 entry，一次 evaluation

每次作者入口调用向 Attempt collector 登记一个 entry。entry 在调用时冻结 identity、subject snapshot、
evaluator、callsite、source order 与 groupPath。handle 只能写尚未封口的 policy 槽。

```text
explicit value + Match ──┐
scope receiver ──────────┼─► registered Assertion entry ─► raw evaluation
Judge recipe ────────────┤                 │                     │
direct t.score ──────────┘                 ▼                     ▼
                                   AssertionHandle         AssertionResult
```

raw evaluation 可以在登记后启动，并只运行一次。`score`、`atLeast` 与 `orStop` 都复用这一次结果；
它们不读取新 subject，也不重启 evaluator。

## AssertionResult

每条 `AssertionResult` 至少包含：

| 字段组 | 内容 |
|---|---|
| entry | 稳定 entry id、key、label、groupPath、source order。 |
| subject | 带 kind、schema 与 identity 的 `subjectSnapshotRef`；根并发 scope 使用 vector cut 或等价 snapshot ref。 |
| location | callsite 与 policy locations。 |
| evaluator | identity、必填 version、完整安全 structured config；digest 只补充身份，不能代替 config。 |
| evaluation | Boolean `matched`、有限 `[0,1]` measurement、finite `>=0` direct score、`unavailable` 或 `errored`。 |
| evidence | versioned evidence envelope：判定见证、coverage、evaluator-specific payload、evidence refs 与 limitations。 |
| policy | `score?`、`atLeast?` 与 `orStop?`。 |
| projection | pass 或 score projection，以及 `scoreContribution?`、`condition?`、`stopTriggered?`。 |

`subjectSnapshotRef` 指向 sealed Observation 或稳定引用，不能指向可变的“最后状态”。secret 不进入任一字段。

## Assertion 可解释闭包

AssertionResult 不是只保存 `matched` / `mismatched` 或最终成功 / 失败。它必须与引用的证据一起形成
**Assertion 可解释闭包**：reader 不重新运行 evaluator，也能说明作者检查了什么、实际观察到什么、为何得到
该 evaluation，以及它如何影响当前 Eval。

这个闭包是 Assertion 侧的数据要求，不是新的单一 JSON 容器，也不要求内联 evaluator 读过的全部原始字节。
Assertion collector 只声明 structured payload、证据引用和哪些依据是必需的；Record 决定文件布局、去重、
携带与发布方式。

同一闭包至少回答：

- 哪条作者调用登记了 Assertion，调用时的 subject 或 scope snapshot 是什么；
- 哪个明确版本的 evaluator 以什么完整安全 config 求值；
- evaluator 得到的 raw evaluation、判定见证与 evidence coverage；
- 哪些大型或共享证据由 ref 指向，以及哪些内容经过 redaction、truncation 或不可用；
- 作者配置的 policy，以及 Pass 或 Score projection。

`expected: calledTool("search")`、`received: 0 matching calls` 只是 reader 从这些结构化字段产生的文案，
不作为 AssertionResult 的唯一事实保存。未来 renderer 可以改变文字与布局，但不能改变 sealed evaluation。

## 判定见证与 evidence

`evidence` 不能是无版本、可选的任意 JSON 袋。每个 evaluator identity / version 都在 evaluator registry
中声明 config schema、evidence schema、每种 evaluation 必需的判定见证、coverage 要求与安全限制。

```ts
interface EvaluatorEvidenceEnvelope {
  readonly schema: {
    readonly id: string;
    readonly version: number;
  };
  readonly decisionWitness: JsonValue;
  readonly coverage: JsonValue;
  readonly payload: JsonValue;
  readonly refs: readonly EvidenceRef[];
  readonly limitations: readonly EvidenceLimitation[];
}

interface EvidenceLimitation {
  readonly kind: "redacted" | "truncated" | "unavailable";
  readonly path: string;
  readonly reason: string;
  readonly originalBytes?: number;
}
```

payload 仍是 JSON 数据，但其形状由 `schema.id` / `schema.version` 对应的 registry schema 校验；它不是未包装的
`JsonValue` 契约。未知 evaluator 或 evidence version 只能安全地展示通用结构，不能用当前版本规则重解释。

判定见证是 evaluator 求值时产生的有界结构化依据，不是密码学证明、预制展示字符串或 replay 输入。`matched`
可以与 redacted / truncated 共存，因为 evaluation 可能基于运行时完整 subject；此时 limitations 必须如实
展示。若安全持久化后连 registry 要求的最小判定见证都无法保留，entry 必须封口为 `unavailable`，不能只写
`matched` 或 `mismatched`。

例如：

- `commandSucceeded()` 的见证至少包含 command observation identity、exit code、signal、duration 与
  coverage；stdout / stderr 可以只保存 evidence ref。输出截断不改变基于 exit code 已封口的 evaluation。
- `calledTool("search")` 与 `loadedSkill("browser")` 的见证至少包含 scope snapshot ref、coverage 和
  observed / matched count。它还包含匹配 event refs 与 evaluator config，不能退化成源码、期望、结果三段字符串。
- 依赖文本内容的 evaluator 保存安全的匹配范围、excerpt 或 subject ref。无法安全保存最小依据时得到
  `unavailable`。

## Pass 与 Score projection

Pass projection 把 Boolean result 或 thresholded measurement 映射为 matched / mismatched，并由
execution outcome 共同折叠 Attempt Verdict：

| 优先级 | 条件 | Verdict |
|---|---|---|
| 1 | execution error，或参与 Pass grading 的 unavailable / errored | `errored` |
| 2 | 任一 Boolean condition mismatched | `failed` |
| 3 | 显式 skip，且没有更高优先级条件 | `skipped` |
| 4 | 其余情形 | `passed` |

Score projection 只累计 contribution。正常 measurement 或 Boolean mismatch 不会使 score 失效。

```ts
type ScoreGrading =
  | { readonly status: "scored"; readonly score: number; readonly stop?: StopCause }
  | { readonly status: "unavailable" | "errored"; readonly partialScore: number; readonly issues: readonly Issue[] }
  | { readonly status: "skipped" };
```

只有已配置 `.score()` 的 Assertion、直接 `t.score()`，或调用 `.orStop()` 的 control Assertion
出现 `unavailable` / `errored` 时，Score grading 才不可排名。record-only Assertion 的同类问题只保留
Issue，正式 score 仍有效。execution 或 transport error 使 Score grading 为 `errored`，已有数值只作为
`partialScore`。普通 cleanup diagnostic 不会自动作废 score。

## AttemptRecord

`AttemptRecord` 以 `evaluationKind` 为互斥 union，execution outcome 独立保存：

```ts
type AttemptRecord =
  | {
      readonly evaluationKind: "pass";
      readonly executionOutcome: ExecutionOutcome;
      readonly verdict: "passed" | "failed" | "errored" | "skipped";
      readonly assertionResults: readonly AssertionResult[];
    }
  | {
      readonly evaluationKind: "score";
      readonly executionOutcome: ExecutionOutcome;
      readonly grading: ScoreGrading;
      readonly assertionResults: readonly AssertionResult[];
    };
```

Score Attempt 没有 `verdict` 字段。Pass Attempt 没有 score projection。`schemaVersion: 19` 与
`evaluationAlgorithm: "assertion/v1"` 原子启用；读取器只接受该协议。

## 封口与 replay

`.orStop()` 封口它的 entry。test settle 封口其余 entry。连续 measurement 在 Pass Eval 封口时若没有
`atLeast`，就是作者错误；Score Eval 的 measurement 可以直接封口。

`show`、`view`、JSON、export 与 source 标注只读取 sealed projection。可重评分从 sealed
Observation/ref graph 产生新的 immutable claim，绝不改写旧 claim；旧 AssertionResult 不能让任意 inline
JavaScript value 自动重评。
