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

## 统一保存模型

所有 Assertion 都是同一个模型：

```text
subject (a) + evaluator / Match (b) ──► evaluation
```

`t.check(a, b)` 由作者显式给出 `a` 和 `b`。`loadedSkill(...)`、`calledTool(...)`、`succeeded()` 与 Judge
recipe 是它的特殊化入口：receiver 和方法替作者取得 `a`，方法参数构造 `b`，随后登记同一种 Assertion。

| 作者写法 | subject `a` | evaluator / Match `b` |
|---|---|---|
| `t.check(value, match)` | 已求值的 `value` snapshot。 | `match` identity、version 与 config。 |
| `turn.calledTool("search")` | Turn scope 中的 normalized tool occurrences。 | tool name、input、count 与 status expectation。 |
| `turn.loadedSkill("browser")` | Turn scope 中的 normalized skill occurrences。 | skill name 与其它 expectation。 |
| `turn.succeeded()` | Turn 的可信终态 snapshot。 | succeeded evaluator。 |
| Judge recipe | Judge material 与 subject snapshot。 | recipe、rubric、model-facing config 与 evaluator version。 |

因此 scoped 方法不能只保存 true / false。它们必须像 `t.check(a, b)` 一样保存 `a`、`b` 和 evaluation。

## AssertionResult

每条 `AssertionResult` 至少包含：

| 字段组 | 内容 |
|---|---|
| entry | 稳定 entry id、key、label、groupPath、source order。 |
| subject | `a` 的安全结构化 snapshot 或能取得该内容的稳定 ref；包含实际输出或 occurrence context。 |
| location | callsite 与 policy locations。 |
| evaluator | `b` 的 identity、version 与完整安全 config。 |
| evaluation | Boolean `matched`、有限 `[0,1]` measurement、finite `>=0` direct score、`unavailable` 或 `errored`。 |
| evidence | subject 的 coverage、补充说明、共享 evidence refs 与 redacted / truncated / unavailable limitations。 |
| policy | `score?`、`atLeast?` 与 `orStop?`。 |
| projection | pass 或 score projection，以及 `scoreContribution?`、`condition?`、`stopTriggered?`。 |

例如 `t.check(await runCommand(...), commandSucceeded())` 保存已求值 `CommandResult` 的安全内容或引用、
`commandSucceeded` 的 evaluator config，以及 evaluation。`await` 只负责先取得 `a`，不形成第四种数据。

`subjectSnapshotRef` 不能指向可变的“最后状态”。大型内容可以使用 ref，但 Assertion 仍必须声明要保留的
subject 字段与 limitations。Record 决定这些数据怎样落盘；Assertion 不规定文件布局。secret 不进入任一字段。

`expected: calledTool("search")` 与 `received: 0 matching calls` 只是 reader 从 `a`、`b` 和 evaluation
生成的文案，不是唯一保存内容。未来 renderer 可以改变文字与布局，但不能改变 sealed evaluation。

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
