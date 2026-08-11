# Assertions —— 架构

`niceeval.assertions/v1` 是一个 Attempt-owned、auditable、non-executable 的
`RecordAttachment`。它保存已经结束的检查事实；Record、Projection 和 Report 不需要作者调用图、
matcher 或 evaluator 内部实现才能解释它。

```text
author calls / evaluator internals / producer control flow
                    ↓
          producer evaluates and seals
             ↙                    ↘
niceeval.assertions/v1    niceeval.verdict/v1 (+ score for Score Eval)
             ↓
  declared RecordProjection → closed report document
```

## v1 外层 payload

writer 产出的 v1 payload 是 `AssertionsDocumentV1`。所有契约拥有的 object 都 exact decode；不在下列形状中的
字段一律拒绝。`BoundedJsonValueV1` 是唯一允许任意 JSON key 的值域，只用于 snapshot 或 criterion 的 raw `data`，
不是开放 metadata。decoder 限制深度为 8、对象键数为 64、数组项数为 256、单字符串为 8 KiB，且整个 payload
最多 4 MiB。

```ts
type BoundedJsonValueV1 =
  | null
  | boolean
  | number
  | string
  | readonly BoundedJsonValueV1[]
  | { readonly [key: string]: BoundedJsonValueV1 };

type BoundedJsonObjectV1 = {
  readonly [key: string]: BoundedJsonValueV1;
};

type AssertionEntryId = string;

type AssertionDisplayV1 = {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
};

type AssertionsDocumentV1 = {
  readonly entries: readonly AssertionEntryV1[];
};

type AssertionsDocumentOuterV1 = {
  readonly entries: readonly AssertionEntryOuterV1[];
};

type AssertionEntryV1 = {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplayV1;
  readonly criterion: BuiltInCriterionV1 | ThirdPartyCriterionV1;
  readonly subject: AssertionMaterialV1;
  readonly evidence: readonly AssertionMaterialV1[];
  readonly coverage: AssertionCoverageV1;
  readonly limitations: readonly AssertionLimitationV1[];
  readonly result: SealedAssertionResultV1;
};

type AssertionEntryOuterV1 = {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplayV1;
  readonly criterion: BoundedJsonObjectV1;
  readonly subject: AssertionMaterialV1;
  readonly evidence: readonly AssertionMaterialV1[];
  readonly coverage: AssertionCoverageV1;
  readonly limitations: readonly AssertionLimitationV1[];
  readonly result: SealedAssertionResultV1;
};
```

`AssertionsDocumentV1` 是 writer 可写的形状。reader 先以 `AssertionsDocumentOuterV1` exact decode：除了
`criterion` 暂时只要求为有界 JSON object 外，其余 document 与 entry 字段已经完整验证。这样 reader 能先确定
entry 边界，再局部解释 criterion，而不会把未知 criterion 当成整个 payload 损坏。

`entryId` 精确匹配 `ae_[a-z0-9]{20}`，只在这份 Attachment 内唯一。`entries` 顺序就是原始声明／展示顺序；
它不从 key、label、数组位置、源码或材料推导。一个 document 最多 4,096 个 entry；key、label、groupPath
的每项都是无控制字符、最多 256 code points 的文本，group 深度最多 16。

## Criterion envelope 与内建 criterion

criterion 的 outer envelope 只有两种 exact object。third-party 形态就是精确的
`{ name, schemaId, data }`；它没有额外 discriminator 或自由字段。builtin 形态保留 `id` 和 raw JSON
`data`，以便未知的未来 builtin 仍可在单条 entry 内显示 unsupported。

builtin `id`、third-party `name` 与 `schemaId` 都是最多 128 bytes 的 ASCII identifier，不允许控制字符或空值。
builtin `id` 的唯一 `/vN` 后缀只是 schema version，不是 filesystem path；这些值是 schema 选择 identity，不是作者传入的
可执行 evaluator 名。

```ts
type BuiltInCriterionEnvelopeV1 = {
  readonly kind: "builtin";
  readonly id: string;
  readonly data: BoundedJsonValueV1;
};

type ThirdPartyCriterionV1 = {
  readonly name: string;
  readonly schemaId: string;
  readonly data: BoundedJsonValueV1;
};

type CriterionEnvelopeV1 = BuiltInCriterionEnvelopeV1 | ThirdPartyCriterionV1;

type BuiltInCriterionV1 =
  | {
      readonly kind: "builtin";
      readonly id: "value-match/v1";
      readonly data: { readonly subject: "explicit-value" };
    }
  | {
      readonly kind: "builtin";
      readonly id: "scope-status/v1";
      readonly data: {
        readonly scope: "turn" | "session" | "attempt";
        readonly assertion: "succeeded" | "no-failed-actions";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "occurrence/v1";
      readonly data: {
        readonly scope: "turn" | "session" | "attempt";
        readonly occurrence: "tool" | "skill" | "event";
        readonly assertion: "present" | "absent" | "count";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "judge-measurement/v1";
      readonly data: {
        readonly recipe: "closed-qa" | "factuality" | "summarizes";
        readonly scale: "unit-interval";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "sandbox-result/v1";
      readonly data: {
        readonly operation: "command" | "path" | "file" | "diff" | "usage";
      };
    }
  | {
      readonly kind: "builtin";
      readonly id: "direct-score/v1";
      readonly data: { readonly source: "author" };
    };
```

这些 data 是可离线解释的闭合类别，不保存 `Match` object、predicate、regex、Judge client、collector 或
作者 API 对象。criterion 以外的 display、subject、evidence 与 sealed result 才提供本次检查的审计材料。

`BuiltInCriterionEnvelopeV1` 与 `CriterionEnvelopeV1` 是 reader 的 raw identity 阶段形状，不是当前 writer 的
开放写入类型。writer 只写 `BuiltInCriterionV1` 的六个成员，或第三方的 exact 三字段形态；未来 writer 写出的
未知 builtin `id` 仍可由旧 reader 保留为 raw entry 并局部显示 unsupported。

第二层按 identity 处理 criterion：已知 builtin 的 `id` 用相应 `BuiltInCriterionV1` exact schema decode；
third-party 的 `{ name, schemaId }` 选择已安装的精确 schema，再 decode `data`。未知 builtin `id` 或未安装的
third-party schema 使这条 entry 为 `unsupported`；envelope、known builtin data 或 third-party data 不合法时，
这条 entry 为 `invalid`。二者都不重新执行 evaluator。

```ts
type AssertionEntryReadV1 =
  | { readonly state: "available"; readonly entry: AssertionEntryV1 }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionEntryOuterV1;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionEntryOuterV1;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };
```

若 document framing、entry 字段边界、entryId 唯一性、JSON 限额或 own blob closure 无法验证，整个
Attachment 是 `RecordAttachmentRead.invalid`。只有已经通过 outer decode 的单条 criterion 问题才使用上面的
entry-local state；因此一个第三方 criterion 不会拖垮同一 Attempt 的其它 Assertions、Verdict 或 Projection。

## 材料、coverage 与 limitations

v1 的 material 只来自有界 snapshot 或本 Assertions Attachment 自己的 blob closure。`RecordBlobRef` 的唯一
owner 是 [Record Library](../record/library.md#blob-closure写入-builder-与读取-value)：只有该 family 的 typed
builder 能 mint 它，`blobRefs(payload)` 也只接受同一 Attachment 的 ref。v1 不保存另一个 Attachment 的
`RecordBlobRef`、attachment name、磁盘 path 或可变“最新状态”。

每个 own blob ref 在整个 payload 中恰出现一次，符合 Record 的双向 closure 校验。同一大材料被多个 entry 需要时，
producer 为每处 mint 独立 ref／bytes，或改存各自的有界 snapshot；它不能共享一个 ref。

```ts
type AssertionMaterialV1 =
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValueV1;
    }
  | {
      readonly kind: "blob";
      readonly ref: RecordBlobRef;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      readonly preview: string;
    };

type AssertionCoverageV1 =
  | { readonly state: "complete" }
  | {
      readonly state: "partial";
      readonly reason: "sampled" | "truncated" | "redacted" | "provider-limited";
    }
  | {
      readonly state: "unavailable";
      readonly reason: "not-collected" | "source-unavailable" | "producer-failed";
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "optional-material" | "unsupported-subject";
    };

type AssertionLimitationV1 =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | { readonly kind: "sampled"; readonly captured: number; readonly knownTotal?: number }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };
```

`byteLength`、`fieldCount`、`captured`、`knownTotal` 与 `omittedBytes` 都是 finite non-negative integers；preview
最多 8 KiB。coverage 是 entry-owned producer 事实，不是 Record envelope 的字段。`complete` 不允许
limitations；`partial` 至少有一个相符 limitation；`unavailable` 与 `not-applicable` 不伪装成空 evidence。
snapshot、preview 与 blob bytes 都先经过 secret/redaction policy，不能携带函数、native bytes 或当前 worktree。

scope Assertion 将 call-time vector cut 归一为 snapshot；它不保留一个可在 reader 时打开的 Session、Turn、
Conversation 或其它 Attachment ref。

## Sealed result、gate 与 score contribution

每个 entry 的 evaluation 一次封口。result 有闭合 state、gate disposition 与 score contribution；它不保存
await 顺序、early stop、memo table 或以后还能调用的 evaluator。

```ts
type GateDispositionV1 =
  | "not-gate"
  | "satisfied"
  | "failed"
  | "unavailable"
  | "not-applicable";

type NoScoreContributionV1 = { readonly state: "not-scored" };

type EarnedScoreContributionV1 = {
  readonly state: "earned";
  readonly points: number;
  readonly earned: number;
};

type UnavailableScoreContributionV1 = {
  readonly state: "unavailable";
  readonly points: number;
  readonly reason: "source-unavailable" | "evaluation-errored" | "not-applicable";
};

type SealedAssertionResultV1 =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: NoScoreContributionV1 | EarnedScoreContributionV1;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: NoScoreContributionV1 | EarnedScoreContributionV1;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContributionV1 | UnavailableScoreContributionV1;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: NoScoreContributionV1 | UnavailableScoreContributionV1;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: NoScoreContributionV1 | UnavailableScoreContributionV1;
    };
```

`points` 与 `earned` 都是 finite non-negative numbers；`earned` 不大于 `points`。Score Eval 汇总每个
`earned` contribution 得到独立 `niceeval.score/v1` Attachment。gate failed 会让 Verdict 成为 `failed`，但不改写
已经 sealed 的 earned 值。执行错误或 score source unavailable 则保留已知 contribution，并让 Score Attachment
成为 partial 或 unavailable；它们不会伪造 0。

## 归属、Projection 与演进

producer 在 whole Run 发布前分配 entryId、归一 material 并写入 Assertions Attachment。它不打开 Record path、
不读取 Report Projection，也不把作者调用图或 evaluator internals 序列化进 payload。

标准 detail Report 只声明 Assertions Attachment，并消费其 exact payload 与 own blob closure，形成自包含的
`niceeval.report-document/v1`。v1 display 不保存 source path 或跨 Attachment source ref；需要源码导航的 Report
必须另行声明它自己的 origin-source input，不能让 Assertions detail 在 reader 时猜测当前 worktree。

payload、own blob closure 语义或解释改变时，发布同 name 的相邻 `RecordAttachmentSchemaId`。family 为相邻版本提供
无损 converter，或显式声明 `not-losslessly-migratable`；普通 reader 不自动迁移。converter 只读取精确旧 payload，
不读取当前 Eval、源码、网络、进程变量或新的 evaluation。不可无损时，`niceeval migrate` 保留旧 bytes 并返回
`migration-unavailable`，不补默认值或重算 Assertions。

## 相关阅读

- [Assertions](README.md) —— 作者面与范围。
- [Evidence](architecture/evidence.md) —— material 的采集边界。
- [Score Eval](library/score-points.md) —— score state 与 points。
- [Verdict](../verdict/architecture.md) —— 四态折叠。
- [RecordAttachment](../record/architecture.md#recordattachment-与完整-blob-closure) —— owner、closure 与发布。
