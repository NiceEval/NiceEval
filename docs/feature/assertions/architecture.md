# Assertions —— 架构

`niceeval.assertions` 是一个 Attempt-owned、auditable、non-executable 的 `RecordAttachment`。它的 envelope 当前为 `schemaVersion: 2`，保存已经结束的检查事实；解释它不需要作者调用图、matcher 或 evaluator 内部实现。

它是 [Record architecture](../record/architecture.md) 定义的九个固定 durable family 之一。Record protocol 不提供第三方 family、字段 writer 或 schema registry：第三方只能在 Assertions entry 内提供可解释的 criterion schema。Verdict、earned score 和 Assertion source-site 视图都从 Core、Assertions 与既有固定 family 的 sealed 事实读侧形成，不能各自变成新的持久 family。

## 版本边界

`niceeval.assertions` 的 family identity 不带版本；当前 envelope 的 `schemaVersion` 是 `2`。当前领域类型不带版本后缀；v1/v2 只存在于 package-private wire codec 与相邻 migration identity。普通 reader 只接受 exact-current，普通 writer 只写 v2。

Record maintenance 独占历史 codec、blob closure、文件 I/O、Git restore point、sentinel、atomic physical rewrite 与最终 exact-current 验证。Assertions attachment 只提供纯 `1→2` payload transform。未来升级必须继续形成 `1→2→3` 相邻链。

```text
author calls / evaluator internals / producer control flow
                    ↓
          producer evaluates and seals
                    ↓
          niceeval.assertions
          ├─ entries: criterion, materials, evaluation, decision,
          │           policy, contribution, explanation retention
          └─ sourceSites: entryId → Sources item join
                    ↓
    Verdict / Score / source navigation DomainView
                    ↓
          closed analysis or report output
```

`sourceSites` 是 Assertions payload 的字段，不是物理 send Navigation Attachment。它只保存已执行 entry 的 source mapping；源码内容仍属于 origin Run-owned Sources family。精确 join 与显示规则见 [Source sites](architecture/source-sites.md)。

matcher diagnostic 在求值时只保留 8 个代表候选与决定结果的 witness／counterexample，并在进入 payload 前限制为 64 个节点与 64 KiB。决定性 witness 即使位于第 10,001 个候选也必须保留。

超限时只裁 nondecisive samples 与 root summaries。截断只影响 `explanationRetention`，不改变 criterion、materials、evaluation、decision、policy、contribution、Verdict 或 score。

4 MiB 是 Assertions JSON framing 的上限，不是一次 Assertion 求值可观察材料的上限。超过 32 KiB，或深度、数组项数等 shape 不适合内联的 source / evidence snapshot 自动成为本 Attachment 自己的 blob。若解释合计仍使 framing 超限，producer 只压缩 `explanationRetention`。它不拆出重复 document，也不删除 entry 或语义字段。只有不可裁的语义 framing 自身超限时才拒绝发布。

## Current 外层 payload

writer 产出的 current payload 是 `AssertionsAttachment`。所有契约拥有的 object 都 exact decode；不在下列形状中的字段一律拒绝。`BoundedJsonValue` 是唯一允许任意 JSON key 的值域，只用于 snapshot 或 criterion 的 raw `data`，不是开放 metadata。decoder 限制深度为 8、对象键数为 64、数组项数为 256、单字符串为 8 KiB，且整个 payload 最多 4 MiB。

```ts
type BoundedJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BoundedJsonValue[]
  | { readonly [key: string]: BoundedJsonValue };

type BoundedJsonObject = {
  readonly [key: string]: BoundedJsonValue;
};

type AssertionEntryId = string;

type AssertionDisplay = {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
};

type AssertionsAttachment = {
  readonly entries: readonly AssertionEntry[];
  readonly sourceSites: readonly AssertionSourceSite[];
};

type AssertionEntry = {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionDisplay;
  readonly criterion:
    | { readonly state: "available"; readonly value: BuiltInCriterion | ThirdPartyCriterion }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
  readonly materials: {
    readonly source:
      | AssertionMaterial
      | { readonly kind: "unavailable"; readonly reason: "not-recorded" };
    readonly evidence: readonly AssertionMaterial[];
    readonly coverage: AssertionCoverage;
    readonly limitations: readonly AssertionLimitation[];
  };
  readonly evaluation: {
    readonly observed: AssertionFactValue;
    readonly receipt?: AssertionCollectionReceipt;
  };
  readonly decision: AssertionDecision;
  readonly policy: AssertionDecisionPolicy;
  readonly contribution: ScoreContribution;
  readonly explanationRetention: ExplanationRetention;
};

type AssertionEntryOuter = Omit<AssertionEntry, "criterion"> & {
  readonly criterion:
    | { readonly state: "available"; readonly value: BoundedJsonObject }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
};
```

reader 先以 outer shape exact decode：除了 `criterion` 暂时只要求为有界 JSON object 外，其余 document 与 entry 字段已经完整验证。这样 reader 能先确定 entry 边界，再局部解释 criterion，而不会把未知 criterion 当成整个 payload 损坏。

`entryId` 精确匹配 `ae_[a-z0-9]{20}`，只在这份 Attachment 内唯一。`entries` 顺序就是原始声明／展示顺序；它不从 key、label、数组位置、源码或材料推导。一个 document 最多 4,096 个 entry；key、label、groupPath 的每项都是无控制字符、最多 256 code points 的文本，group 深度最多 16。

## Criterion envelope 与内建 criterion

criterion 的 outer envelope 只有两种 exact object。third-party 形态就是精确的 `{ name, schemaId, data }`；它没有额外 discriminator 或自由字段。builtin 形态保留 `id` 和 raw JSON `data`，以便未知的未来 builtin 仍可在单条 entry 内显示 unsupported。

builtin `id`、third-party `name` 与 `schemaId` 都是最多 128 bytes 的 ASCII identifier，不允许控制字符或空值。builtin `id` 的 `/vN` 后缀是 criterion schema version，不是 filesystem path；这些值是 schema 选择 identity，不是作者传入的可执行 evaluator 名。

```ts
type BuiltInCriterionEnvelope = {
  readonly kind: "builtin";
  readonly id: string;
  readonly data: BoundedJsonValue;
};

type ThirdPartyCriterion = {
  readonly name: string;
  readonly schemaId: string;
  readonly data: BoundedJsonValue;
};

type CriterionEnvelope = BuiltInCriterionEnvelope | ThirdPartyCriterion;

type BuiltInCriterion =
  | {
      readonly kind: "builtin";
      readonly id: "value-match/v1";
      readonly data: {
        readonly subject: "explicit-value";
        readonly matcher:
          | { readonly state: "declared"; readonly name: string }
          | { readonly state: "unavailable" };
      };
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
      readonly data: BoundedJsonObject;
    }
  | {
      readonly kind: "builtin";
      readonly id: "direct-score/v1";
      readonly data: { readonly source: "author" };
    };
```

这些 data 是可离线解释的闭合类别，不保存 `Match` object、predicate、regex、Judge client、collector 或作者 API 对象。第三方闭包不可序列化时，writer 使用诚实的 declared/unavailable 状态，不伪造 AST。criterion 以外的 materials、evaluation、decision、policy、contribution 与 explanation retention 提供本次检查的唯一审计事实。

第二层按 identity 处理 criterion：已知 builtin 的 `id` 用相应 exact schema decode；third-party 的 `{ name, schemaId }` 选择已安装的精确 schema，再 decode `data`。未知 builtin `id` 或未安装的第三方 schema 使这条 entry 为 `unsupported`；envelope、known builtin data 或 third-party data 不合法时，这条 entry 为 `invalid`。二者都不重新执行 evaluator。

```ts
type AssertionEntryRead =
  | { readonly state: "available"; readonly entry: AssertionEntry }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionEntryOuter;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionEntryOuter;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };
```

若 document framing、entry 字段边界、entryId 唯一性、JSON 限额或 own blob closure 无法验证，整个 Assertions family 是 `invalid`。只有已经通过 outer decode 的单条 criterion 问题才使用上面的 entry-local state；一个第三方 criterion 不会拖垮同一 Attempt 的其它 Assertions，也不会改写 Verdict。

## 材料、coverage、limitations 与 diff evidence

current material 只来自有界 snapshot 或本 Assertions Attachment 自己的 blob closure。`RecordBlobRef` 的 owner 与 closure 规则由 [Record architecture](../record/architecture.md#attachment-closure-与读取状态) 定义：只有该 family 的 typed builder 能 mint 它，且一个 ref 只能留在自己的 family 与 owner 内。Assertions 不保存另一个 Attachment 的 `RecordBlobRef`、attachment name、磁盘 path 或可变“最新状态”。

每个 own blob ref 在整个 payload 中恰出现一次，符合 Record 的双向 closure 校验。同一大材料被多个 entry 需要时，producer 为每处 mint 独立 ref／bytes，或改存各自的有界 snapshot；它不能共享一个 ref。

```ts
type AssertionMaterial =
  | {
      readonly kind: "snapshot";
      readonly value: BoundedJsonValue;
    }
  | {
      readonly kind: "blob";
      readonly ref: RecordBlobRef;
      readonly encoding: "utf-8" | "binary";
      readonly byteLength: number;
      readonly sha256: Sha256Digest;
      readonly preview: string;
    };

type AssertionCoverage =
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

type AssertionLimitation =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | { readonly kind: "sampled"; readonly captured: number; readonly knownTotal?: number }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };
```

`byteLength`、`fieldCount`、`captured`、`knownTotal` 与 `omittedBytes` 都是 finite non-negative integers；preview 最多 8 KiB。coverage 是 entry-owned producer 事实，不是 Record envelope 的字段。`complete` 不允许 limitations；`partial` 至少有一个相符 limitation；`unavailable` 与 `not-applicable` 不伪装成空 evidence。snapshot、preview 与 blob bytes 都先经过 secret/redaction policy，不能携带函数、native bytes 或当前 worktree。

Sandbox diff Assertion 仍可保存实际检查过的路径、摘要和 evidence，但不能借用 FileChanges 的 blob ref。完整 file revision
只属于 FileChanges family；该 family 保存按 send 区间排列的端点轨迹，不保存 `net` 或 hunk。需要同时展示 trajectory
与 Assertion 的 consumer 由 Analysis 组合两个已验证的固定 family，而不是建立跨 owner ref。collector 的 partial
前缀不能被 Assertion 或 Report 补成完整事实。

scope Assertion 将 call-time vector cut 归一为 snapshot；它不保留一个可在 reader 时打开的 Session、Turn、Conversation 或其它 Attachment ref。

高基数 collection 不把 candidates、完整 tool occurrences、diff changes、occurrence ID list 或 Judge trace 搬进 payload。它对全量或决定性前缀求值，并保存 O(1) receipt：`examined`、`matched`、`mismatched`、`unavailable`、`knownTotal`、`complete`、`exhaustive` 与 `decisive`。

- absence 只有 complete + exhaustive + matched=0 + unavailable=0 才 matched；找到 witness 可提前 mismatch。
- exact 只有 exhaustive exact count 且 unavailable=0 才 matched；n+1 可提前 exceeded，too few 在不完整输入下 unavailable。
- at-least 达到 n 可提前 matched；未达到 n 只有 exhaustive 且 unavailable=0 才 mismatch。

evaluation/source coverage（语义）、persisted explanation retention（有界）与 display window（有界）是三个独立维度。裁剪 display 或 explanation 不得改变 evaluation、decision、gate、Verdict 或 score。

## Evaluation、decision、policy 与 score contribution

每个 entry 的 evaluation 一次封口。`observed` 无损区分 boolean outcome、measurement、direct score 与 Judge 的结构化 measurement；它不复制 diagnostic。

Judge 实际返回的 rationale、evidence、detail、citations 才能以 available 事实进入有界 explanation/material，未返回分别是 unavailable/not-recorded。输入材料只属于 materials，不能冒充 Judge returned evidence。Agent-as-Judge trace 暂不持久化。

```ts
type AssertionFactValue =
  | { readonly kind: "unavailable"; readonly reason: "not-recorded" | "not-declared" | "source-unavailable" }
  | { readonly kind: "value"; readonly value: null | boolean | number | string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly AssertionFactValue[] }
  | { readonly kind: "fields"; readonly fields: readonly { readonly label: string; readonly value: AssertionFactValue }[] };

type GateDisposition =
  | "not-gate"
  | "satisfied"
  | "failed"
  | "unavailable"
  | "not-applicable";

type NoScoreContribution = { readonly state: "not-scored" };

type EarnedScoreContribution = {
  readonly state: "earned";
  readonly points: number;
  readonly earned: number;
};

type UnavailableScoreContribution = {
  readonly state: "unavailable";
  readonly points: number;
  readonly reason: "source-unavailable" | "evaluation-errored" | "not-applicable";
};

type ScoreContribution = NoScoreContribution | EarnedScoreContribution | UnavailableScoreContribution;

type AssertionDecision = {
  readonly result: "matched" | "mismatched" | "unavailable" | "errored" | "not-applicable";
  readonly reason: string | null;
  readonly gate: GateDisposition;
};

type AssertionDecisionPolicy = {
  readonly requirement:
    | { readonly state: "available"; readonly value: "required" | "optional" }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
  readonly condition:
    | { readonly state: "available"; readonly value: { readonly kind: "boolean"; readonly expected: true } | { readonly kind: "at-least"; readonly threshold: number } | { readonly kind: "record-only" } }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
};

type ExplanationRetention =
  | { readonly state: "retained"; readonly value: AssertionFactValue }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" };
```

`points` 与 `earned` 都是 finite non-negative numbers；`earned` 不大于 `points`。Score Eval 按已封口 entries 和其 rubric 在读侧汇总 earned score：没有 gate，正常低分或零分仍是 `passed`。执行错误或必要 score source 不可用时，已知 contribution 必须保留为可审计下界；读侧标明 partial 或 unavailable，绝不补 `0`。详见 [Score Eval](library/score-points.md) 与 [Verdict architecture](../verdict/architecture.md)。

## 内嵌 source sites 与 Sources join

source site 持久内容只能在 Assertions payload 或既有 Sources family 中出现。Assertions 保存 join 所需的最小位置事实；Sources 保存 origin Run 的源文件 manifest 与 own blobs。两者之外没有 source-navigation family。

```ts
type AssertionSourceRole =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

type AssertionSourcePosition = {
  readonly line: number;
  readonly column: number;
};

type AssertionSourceSite = {
  readonly entryId: AssertionEntryId;
  readonly sourceOrder: number;
  readonly role: AssertionSourceRole;
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: AssertionSourcePosition;
  readonly end: AssertionSourcePosition;
};
```

每个 row 的 `entryId` 必须属于同一 payload 的 entry；`sourceOrder` 在整个 Attempt 的 source sites 内唯一。rows 先按 `entryId`、再按 `sourceOrder` canonical 排序。`sourceItemId` 与 `sha256` 必须共同匹配该 Attempt exact origin Run 的 Sources manifest；它们不是 path、数组下标、blob key 或跨 owner capability。`role` 只标记确实执行过的 declaration 或 modifier；没有执行到的源码不产生 row。

source mapping 不能重新计算 criterion、points、gate、unavailable 或 Verdict。一个 entry 有多个 row 时，位置可以全部显示，但 Assertion summary 与 score contribution 仍按 `entryId` 只计算一次。没有 matching row、Sources 不是 `available`，或 join／坐标不成立时，source-navigation DomainView 仅把对应位置标为 `unmapped`。

## v1 → v2 相邻迁移

package-private v1 codec 只为 maintenance 存在。纯相邻 transform 只保留 v1 严格能证明的
display、result/gate/score 与 sourceSites。

v1 的 subject、evidence 与 diagnostic 无法区分 source、检查条件、observed、expected 与 explanation。
迁移时按以下方式明确丢弃：

- `materials.source` 写为 `unavailable/not-recorded`；
- evidence 与 limitations 写为空；
- coverage 写为 `unavailable/not-collected`；
- explanation 写为 `unavailable/not-recorded`。

这些旧字段不得以 snapshot、summary、legacy marker 或递归 object 冒充 current 事实。

若被丢弃的 v1 material 引用了 own blob，maintenance 同时物理删除失去引用的 blob，并把删除路径纳入 plan、sentinel 与 Git recovery write set；迁移后的双向 closure 不保留 orphan blob。

v1 没有持久化 criterion expression、measurement/threshold、Judge rationale/citations 时，对应 current field 一律写 `unavailable { reason: "not-recorded" }`。transform 不得从 diagnostic、score ratio 或零值反推。

v1 `gate` 为 `satisfied`、`failed`、`unavailable` 或 `not-applicable` 已证明该 entry 是 required gate，因此迁移为 requirement available/required。condition 仍 unavailable/not-recorded。只有 `gate: "not-gate"` 时 requirement 也是 unavailable/not-recorded。这样 required-unavailable 的旧 Verdict 保持 errored。

物理 payload 与 envelope 的 rewrite、Git/sentinel/recovery 和最终验证由 Record maintenance 执行。transform 本身绝不读写磁盘。

## 读取与读侧形成

固定 family 的 Host 只可能形成 `available`、`not-recorded` 或 `invalid`。`available` 才会提供 immutable payload 与 own blob closure；其余状态不会被消费端补成空 entries、零分或 passed。unknown、future 或不相容 durable bytes 在 reader session 形成前返回 `unsupported-format`。完整 Host 契约见 [Record architecture](../record/architecture.md#attachment-closure-惰性读取与-cache)。

Verdict 使用 Core outcome、sealed Assertions 与 skip 做确定性 fold；Score 从 Assertions contribution 与 rubric 形成。source navigation 则由 [Analysis Library](../analysis/library.md) 的 `query()` 产生已发布 `DomainView`。
这些读侧值不打开 Record path、不猜当前 worktree、不重跑 evaluator，也不回写 durable bytes。

## 相关阅读

- [Assertions](README.md) —— 作者面与范围。
- [Evidence](architecture/evidence.md) —— material 的采集边界。
- [Source sites](architecture/source-sites.md) —— Assertions 内嵌 mapping 与 Sources join。
- [Score Eval](library/score-points.md) —— score state、points 与 rubric。
- [Verdict architecture](../verdict/architecture.md) —— 四态折叠。
- [Record architecture](../record/architecture.md) —— owner、closure、九个 fixed family 与 source-local read。
- [Analysis Library](../analysis/library.md) —— `query()` 与 `DomainView`。
