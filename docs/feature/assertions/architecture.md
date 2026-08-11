# Assertions —— 架构

完整语义在 [Assertions](README.md)。本页规定 entry、结果与两种 grading 的内部不变量。

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
subject 字段与 limitations。secret 不进入任一字段。

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
出现 `unavailable` / `errored` 时，Score grading 才不可排名。不参与 score 的 Assertion 的同类问题只保留
Issue，正式 score 仍有效。execution 或 transport error 使 Score grading 为 `errored`，已有数值只作为
`partialScore`。普通 cleanup diagnostic 不会自动作废 score。

## Eval projection

writer 对 ECMAScript `JSON.stringify(document)` 的紧凑 UTF-8 结果执行同一个 4 MiB 限制。越界时在 whole Run seal 前以 `record-input-invalid` 拒绝；外部损坏造成的越界或非法值成为同名 `ChannelProjectionResult.invalid`。

## 封口与 replay

`.orStop()` 封口它的 entry。test settle 封口其余 entry。连续 measurement 在 Pass Eval 封口时若没有
`atLeast`，就是作者错误；Score Eval 的 measurement 可以直接封口。

作者 API、matcher 名称、collector、memoization、channel 需求图、evaluation algorithm 和 `stopOnFailure` 都不进入这份 document。上层可以替换这些实现，只要 producer 继续写出同一冻结投影，Record reader 与标准 Report 就无需改变。

`ReadPreserved(oldChannelFile, newReader)` 适用于任何历史 writer 产生、同时满足 FileValid、TransportValid 与 ContractValid 的 `niceeval.assertions/v1` channel file。外部编辑不是受支持的写入协议。

新 reader 必须把它解码成 JSON 深等价的值。数组顺序有义，对象 key 顺序与 JSON 空白无义。

`DisplayEquivalent(leftDecoded, rightDecoded, definition, runtime)` 只约束确定性的标准 Assertions projection。固定 fixture 使两份 decoded value 逐字段相等时，同一标准 requirement、Report definition 与 runtime 必须形成相等的 `PageModel` 和 `textAlternative`。

show 与 view 消费同一份 `ReportExecution`。从旧 Record 重新 export 只承诺当前 exporter 能成功消费，不承诺导出目录逐 byte 相等，也不约束读取时间或随机源的用户自定义 Report。

这项承诺从第一版 `niceeval.record/v1` writer 开始。实现时必须保存第一版 writer 产生的原始 fixture bytes；未来 reader 不能用未来 writer 重新生成 fixture 来替代跨代证明。

未来若只是 payload 字段或限制变化，发布 `niceeval.assertions/v2` 并永久保留 `/v1` decoder 与标准 Attempt detail 消费入口；只有业务语义真正改变才换新的描述性 ChannelName。不能在同一个 schema ID 下接受两种 shape。

## 数据归属

Assertion collector 只消费调用方提供的值和已经交付的通道数据。它不打开 Record 路径，不读 ReportInput，也不生成报告页面。

source 位置信息可选。存在时，`path` 与 `digest` 必须匹配 Attempt origin Run 的 `niceeval.sources/v1` entry；Report 经 origin Run 的该 Channel 读取快照，不读取当前 worktree。第三方包不写入项目源码内容。

通道文件由 Attempt owner 在 whole Run 发布前写入，发布后属于 immutable Run。Sample 始终不读取业务通道；外部改动 bytes 不会得到 Record 的编辑、revision 或修复语义。

## 与 Verdict 和 Reports 的关系

producer 在内存中根据 assertion 求值结果、执行错误和 strict policy 形成 `niceeval.verdict/v1`，再分别写入两个独立通道。Verdict 规则由 [Verdict](../verdict/architecture.md) 单点定义。

Sample 只保留 Attempt 核心和分母，不读取 assertion。标准 Attempt detail 的永久内建 requirement 让 composition adapter 把 Assertions `ChannelProjectionResult` 放进内部 ReportInput。

Report 不能自行读取文件或重新计算 Attempt 业务状态。

## 相关阅读

- [Assertion 证据与完整性](architecture/evidence.md)
- [Assertion 展示](library/display.md)
- [Assertion Library](library.md)
- [Verdict](../verdict/README.md)
- [Record 通道](../record/architecture.md#channel-identity-与局部演进)
