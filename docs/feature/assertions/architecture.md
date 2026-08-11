# Assertions —— 架构

`niceeval.assertions/v1` 是一个 Attempt-owned、auditable、non-executable 的 `RecordAttachment`。它只保存已经结束的检查事实；Record、Projection 和 Report 不需要作者 API、matcher 或 collector 才能解释它。

```text
author API / matcher / collector / control flow
                    ↓
          producer evaluates and seals
             ↙                    ↘
niceeval.assertions/v1    niceeval.verdict/v1 (+ score for Score Eval)
             ↓
  declared RecordProjection → closed report document
```

## 稳定 payload

`niceeval.assertions/v1` 的 payload 是 exact JSON。它的外层 framing、entry order 和每个 entry 的稳定字段由本 schema 解码；criterion 本身依其判别成员解码。

```ts
type AssertionsDocumentV1 = {
  readonly entries: readonly AssertionEntryV1[];
};

type AssertionEntryV1 = {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplayV1;
  readonly criterion: BuiltInCriterionV1 | ThirdPartyCriterionV1;
  readonly subject: CapturedMaterialV1;
  readonly evidence: readonly CapturedMaterialV1[];
  readonly coverage: AssertionCoverageV1;
  readonly result: SealedAssertionResultV1;
  readonly points?: number;
};

type ThirdPartyCriterionV1 = {
  readonly kind: "third-party";
  readonly name: string;
  readonly schemaId: string;
  readonly data: JsonValue;
};
```

`BuiltInCriterionV1` 是封闭的 discriminated union。成员包括 value match、scope status、event occurrence、Judge measurement、Sandbox result 与 direct score；每个成员都有包拥有的 exact shape。它不保存函数、class、matcher object、collector object 或可执行 expression。

第三方 criterion 的精确边界只有 `{ name, schemaId, data }`。`name` 表示产品身份，`schemaId` 表示解释版本，`data` 是该 schema 的 exact JSON payload。未知字段、替代的 raw matcher 或没有 schema identity 的第三方数据都不属于 v1。

`AssertionEntryId` 精确匹配 `ae_[a-z0-9]{20}`。它只在这份 Attachment 内唯一，且不会从 display、source、criterion 或材料派生。两个 entry 同名合法；重复 `entryId` 使 Attachment invalid。

## 材料、coverage 与限制

`CapturedMaterialV1` 只有两种形态：有界的安全 snapshot，或指向本 Attempt 已封口 Attachment／owner-local blob 的稳定 ref。ref 不跨 Record root、owner 或 Attachment closure；snapshot 不保存 secret、函数、native bytes 或可变“最新状态”。

每个 entry 必须保存下列 completeness 事实：

| 字段 | 含义 |
|---|---|
| coverage | `complete`、`partial`、`unavailable` 或 `not-applicable`，以及具名原因。 |
| limitations | `redacted`、`sampled`、`truncated` 或 criterion 定义的其它可解释限制。 |
| subject | criterion 读取的快照或 ref；scope subject 保存 call-time cut。 |
| evidence | 支持 evaluation 的 refs 或预览，不以“没有读到”替代“没有发生”。 |

document 最多 4,096 个 entries。每个 entry 的字符串、snapshot、preview、ref 数与 limitation 数都有固定解码上限；整个紧凑 JSON payload 最多 4 MiB。上限、Unicode、ref closure 或 entry framing 不合法时，该 Attachment 是 invalid。

`entries` 数组顺序就是原始声明／展示顺序。Projection 可按这个顺序显示，但详情 route 只使用 `entryId`，不使用数组位置、label、key、groupPath 或 source。

## sealed evaluation 与局部 criterion 失败

`SealedAssertionResultV1` 保存 producer 已经结束的 evaluation 与 result：matched、mismatched、unavailable、errored 或 not-applicable，以及可审计的原因与必要材料。reader 不重新运行 criterion，也不从当前源码、最后一个 Turn 或新的 Judge 调用推断结果。

reader 先验证 entry framing，再分别解码 criterion。未知内建 discriminator、未知第三方 `schemaId` 或第三方 `data` 的 decode failure 只产生该 entry 的 `unsupported` 或 `invalid` criterion read。其 `entryId`、display、materials、coverage 与 sealed result 仍可供诊断；同一 Attachment 的其它 entry 不受影响。

只有无法安全定位 entry、重复 identity、超出全局界限、envelope 损坏或 payload 不是 JSON 时，reader 才返回 `RecordAttachmentRead.invalid`。这一区分让一个插件或自定义 criterion 的问题不能使整个 Attempt detail 不可读。

## 分值、Verdict 与 Score

`points` 是 finite、非负的 Assertion 分值。它只在 Score Eval 中参与 earned score 计算；`evaluationKind` 永远不是 `points`，只可能是 `pass` 或 `score`。

每个 Attempt 都由独立的 `niceeval.verdict/v1` Attachment 保存四态 Verdict。Score Eval 还写 `niceeval.score/v1`：gate failed 会形成 `failed` Verdict，但所有已封口的 points 仍构成 earned score。execution error 或不可用 score source 不会伪造零分；它们使 Score Attachment 成为 partial 或 unavailable，具体矩阵由 [Score Eval](library/score-points.md) 与 [Verdict](../verdict/architecture.md) 单点定义。

`points`、gate disposition、availability 与 sealed result 都是事实。作者 API 的对象与调用顺序不序列化；`.score()`、`.gate()`、`.atLeast()` 只产生闭合 criterion 或 result，不能留下可再次执行的调用痕迹。`.orStop()`、`stopOnFailure` 与 memoization 是 producer 控制流，不进入稳定 payload。

## 归属与 Projection

collector 在归一每个已求值 entry 时分配 `entryId`，再在 whole Run 发布前写入这份 Attachment。它不打开 Record 路径，不读取 Report 的 Projection，不生成页面，也不把 Fact/use graph 序列化进 payload。

source 信息存在时，只能引用 Attempt origin Run 的 source snapshot。第三方 criterion 不把当前项目源码、token 或本机路径塞入 entry。

Sample 只保留 Core 与分母。标准 detail Report 通过 `RecordProjection` 声明 Assertions Attachment，形成自包含的 `niceeval.report-document/v1`。
static export、show 与 view 共享该 document，不能重新读取 Record 或重新执行 criterion。

## schema 演进

payload shape、media type、closedness 或解释改变时，发布同 name 的相邻 `RecordAttachmentSchemaId`。family 为相邻版本显式提供无损 converter，或显式声明 `not-losslessly-migratable`；普通 reader 不自动迁移。

converter 只读取精确旧 payload，不读取当前 Eval、源码、网络、进程变量或新的 evaluation。不可无损时，`niceeval migrate` 保留旧 bytes 并返回 `migration-unavailable`，不补默认值或重算 Assertions。

## 相关阅读

- [Assertions](README.md) —— 作者面与范围。
- [Evidence](architecture/evidence.md) —— material 的采集边界。
- [Score Eval](library/score-points.md) —— score state 与 points。
- [Verdict](../verdict/architecture.md) —— 四态折叠。
- [RecordAttachment](../record/architecture.md#recordattachment) —— owner、读取与发布。
