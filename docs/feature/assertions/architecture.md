# Assertions —— 架构

Assertion 是一次 Attempt 内规范化的检查事实。值 matcher、作用域检查、Sandbox 检查、资源限制和 Judge 都先形成 producer 内存结果，再由 producer 写入 Attempt-owned `RecordAttachment`。Attachment 名称是 `niceeval.assertions`，首个精确 payload schema 是 `niceeval.assertions/v1`。

## 一个 entry，一次 evaluation

```text
assert-first author API / matcher / collector / evaluation order
                      ↓
        producer 内存求值与 Verdict 折叠
               ↙                 ↘
niceeval.assertions Attachment  niceeval.verdict Attachment
               ↓
      标准 Attempt detail Report
```

## 稳定 RecordAttachment payload

`niceeval.assertions/v1` 是 Attempt-owned `RecordAttachment` 的独立 `RecordAttachmentSchemaId`。它的 `application/json` payload 从 `niceeval.record/v1` 的第一次发布起冻结为以下 document：

```ts
type AssertionsDocument = {
  entries: readonly AssertionEntry[];
};

type AssertionEntry = CheckEntry | DirectScoreEntry;

type EntryContext = {
  name: string;
  groupPath: readonly string[];
  detail?: string;
  source?: {
    path: string;
    digest: string;
    line: number;
    column: number;
  };
};

type CheckEntry = EntryContext & {
  kind: "check";
  decision:
    | { kind: "gate"; threshold: number }
    | { kind: "soft"; threshold: number }
    | { kind: "observe" };
  availability: "required" | "optional";
  result:
    | {
        state: "available";
        score: number;
        expected?: string;
        received?: string;
        evidence?: string;
      }
    | {
        state: "unavailable";
        reason: string;
        evidence?: string;
      };
  award:
    | { kind: "none" }
    | { kind: "conditional"; available: number };
};

type DirectScoreEntry = {
  kind: "score";
  name: string;
  groupPath: readonly string[];
  source?: {
    path: string;
    digest: string;
    line: number;
    column: number;
  };
  points: number;
};
```

对象是精确对象，任何未知字段、缺失字段、错误联合或重复 object key 都使此 `RecordAttachment` invalid。条目按声明顺序保存；同名条目合法，由数组位置区分。对象 key 顺序在成功 JSON parse 后无义。

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
| gate 与最终通过线 | `decision.kind: "gate"` 与显式 threshold |
| 带通过线的 soft | `decision.kind: "soft"` 与显式 threshold |
| 不设通过线的纯观测 | `decision.kind: "observe"` |
| required / optional | 对应的 `availability` |
| 条件给分 / 直接给分 | conditional award / direct score entry |
| `stopOnFailure` 与其它控制流 | 不写入此 Attachment |

例如 `t.check(await runCommand(...), commandSucceeded())` 保存已求值 `CommandResult` 的安全内容或引用、
`commandSucceeded` 的 evaluator config，以及 evaluation。`await` 只负责先取得 `a`，不形成第四种数据。

`subjectSnapshotRef` 不能指向可变的“最后状态”。大型内容可以使用 ref，但 Assertion 仍必须声明要保留的
subject 字段与 limitations。secret 不进入任一字段。

`expected: calledTool("search")` 与 `received: 0 matching calls` 只是 reader 从 `a`、`b` 和 evaluation
生成的文案，不是唯一保存内容。未来 renderer 可以改变文字与布局，但不能改变 sealed evaluation。

## Pass 与 Score projection

Pass projection 把 Boolean result 或 thresholded measurement 映射为 matched / mismatched，并由
execution outcome 共同折叠 Attempt Verdict：

所有限制都是 `niceeval.assertions/v1` 的 schema 契约，不能在同一个 schema decoder 中放宽。

Score projection 只累计 contribution。正常 measurement 或 Boolean mismatch 不会使 score 失效。

按 entries 声明顺序，以 ECMAScript Number 累加所有 direct points 与 conditional available，结果也必须有限。这条上限保证单个 Attempt 的标准 Assertions 分数聚合闭合；它不限制完整 Report semantic document 的总内存。

只有已配置 `.score()` 的 Assertion、直接 `t.score()`，或调用 `.orStop()` 的 control Assertion
出现 `unavailable` / `errored` 时，Score grading 才不可排名。不参与 score 的 Assertion 的同类问题只保留
Issue，正式 score 仍有效。execution 或 transport error 使 Score grading 为 `errored`，已有数值只作为
`partialScore`。普通 cleanup diagnostic 不会自动作废 score。

## Eval projection

writer 对 ECMAScript `JSON.stringify(document)` 的紧凑 UTF-8 结果执行同一个 4 MiB 限制。越界时在 whole Run seal 前以 `record-input-invalid` 拒绝；外部损坏造成的越界或非法值成为此 Attachment 的 `RecordAttachmentRead.invalid`。

## 封口与 replay

`.orStop()` 封口它的 entry。test settle 封口其余 entry。连续 measurement 在 Pass Eval 封口时若没有
`atLeast`，就是作者错误；Score Eval 的 measurement 可以直接封口。

作者 API、matcher 名称、collector、memoization、证据依赖图、evaluation algorithm 和 `stopOnFailure` 都不进入这份 document。上层可以替换这些实现，只要 producer 继续写出同一冻结 payload，Record reader 与标准 Report 就无需改变。

`niceeval.assertions/v1` 的读取只接受同时满足 FileValid、TransportValid 与 ContractValid 的历史 Attachment payload。外部编辑不是受支持的写入协议。

支持该 schema 的 reader 必须把它解码成 JSON 深等价的值。数组顺序有义，对象 key 顺序与 JSON 空白无义。

确定性的标准 Assertions projection 只读取已解码的 payload。固定 fixture 使两份 decoded value 逐字段相等时，同一标准 requirement、Report definition 与 runtime 必须形成相等的 `niceeval.report-document/v1` semantic document。

show、view 与 static export 都从同一份 semantic document 派生。它们消费同一份 `ReportExecution`；从旧 Record 重新 export 只承诺当前 exporter 能成功消费，不承诺导出目录逐 byte 相等，也不约束读取时间或随机源的用户自定义 Report。

这项承诺从 `niceeval.assertions/v1` writer 开始。实现时必须保存该版本 writer 产生的原始 fixture bytes；未来 reader 不能用未来 writer 重新生成 fixture 来替代跨代证明。

## Attachment schema 演进

`niceeval.assertions/v1` 是独立的 Attempt `RecordAttachment` schema，不继承 Record Core 的版本或 decoder 承诺。assert-first 作者模型、matcher 和求值顺序变化时，只要这份 payload 的事实含义不变，就不改 Attachment schema，也不改 Record Core。

payload shape、media type、closedness 或解释变化时，发布同名的相邻 schema，例如 `niceeval.assertions/v2`。family 必须为 `v1 → v2` 二选一：提供只读取精确旧 payload 的无损 converter，或声明 `not-losslessly-migratable`。converter 不读取当前 Eval、源码、网络、进程变量或新的求值结果。

普通 reader 不自动迁移。不可无损迁移时，`niceeval migrate` 保留旧 Attachment bytes 并报告 warning，不补默认值、不删除历史事实。业务 family 本身改变时才发布新的 Attachment name；同一个 schema ID 绝不接受两种 shape。

## 数据归属

Assertion collector 只消费调用方提供的值和 producer 已归一的运行数据。它不打开 Record 路径，不读取 Report 的 projection 或 Calculation，也不生成报告页面。

source 位置信息可选。存在时，`path` 与 `digest` 必须匹配 Attempt origin Run 的 `niceeval.sources/v1` Attachment entry；Report 经声明的 origin-Run projection 读取快照，不读取当前 worktree。第三方包不写入项目源码内容。

Attachment payload 由 Attempt owner 在 whole Run 发布前写入，发布后属于 immutable Run。Sample 始终不读取业务 Attachment；外部改动 bytes 不会得到 Record 的编辑、revision 或修复语义。

## 与 Verdict 和 Reports 的关系

producer 在内存中根据 assertion 求值结果、执行错误和 strict policy 形成 `niceeval.verdict/v1`，再分别写入两个独立 Attempt Attachment。Pass Eval 与 Score Eval 的每个 Attempt 都写入四态 Verdict；Score Eval 另外写入独立的 `niceeval.score/v1` Attachment。Assertions 的 `points` 只是题内挣分，绝不形成第三种 `evaluationKind`。Verdict 规则由 [Verdict](../verdict/architecture.md) 单点定义。

Sample 只保留 Attempt 核心和分母，不读取 assertion。标准 Attempt detail 通过 `RecordProjection` 声明它需要的 Assertions Attachment，并把投影值包装进闭合的 Report semantic document。

Report 不能自行读取文件或重新计算 Attempt 业务状态。

## 相关阅读

- [Assertion 证据与完整性](architecture/evidence.md)
- [Assertion 展示](library/display.md)
- [Assertion Library](library.md)
- [Verdict](../verdict/README.md)
- [RecordAttachment](../record/architecture.md#recordattachment)
