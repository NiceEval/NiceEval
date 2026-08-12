# PLAN-5 Library

## Record package

PLAN-5 继续使用通用 `RecordAttachment` closure，不给 Core 增加业务名字：

```ts
interface PhysicalFactPackageDefinition<Owner, Payload> {
  readonly owner: Owner;
  readonly family: RecordAttachmentFamily<Owner, Payload>;
  readonly bounds: PhysicalPackageBounds;
}

declare const definePhysicalFactPackage: <Owner, Payload>(input: {
  readonly owner: Owner;
  readonly family: RecordAttachmentFamily<Owner, Payload>;
  readonly bounds: PhysicalPackageBounds;
}) => PhysicalFactPackageDefinition<Owner, Payload>;

declare const definePackageProjector: <Owner, Payload, Views>(input: {
  readonly family: RecordAttachmentFamily<Owner, Payload>;
  readonly project: (value: RecordAttachmentValue<Payload>) => Views;
}) => PackageProjector<Owner, Payload, Views>;

declare const definePackageAccess: <Owner, Payload>(input: {
  readonly owner: PackageOwnerSelection<Owner>;
  readonly family: RecordAttachmentFamily<Owner, Payload>;
}) => PackageAccess<Owner, Payload>;

type PackageOwnerSelection<Owner> = Owner extends "attempt"
  ? { readonly grain: "attempt"; readonly from: "origin-attempt" }
  : Owner extends "run"
    ? { readonly grain: "run"; readonly from: "selected-run" | "origin-run" }
    : never;

declare const definePackageProjection: <Owner, Payload, Views>(input: {
  readonly access: PackageAccess<Owner, Payload>;
  readonly projector: PackageProjector<Owner, Payload, Views>;
}) => PackageProjectionDefinition<Owner, Views>;
```

`project` 同步消费一份已经完整验证并 materialize 的 package。它不能打开 Record、读取其它 family、选择
Run、建立跨 owner relation 或改变 Sample denominator。

## Local projections

```ts
interface OtelLocalViews {
  readonly spans: readonly OtelSpanView[];
  readonly operations: readonly GenAIOperationView[];
  readonly usage: readonly UsageObservationView[];
  readonly timing: readonly TimingIntervalView[];
  readonly anchors: readonly OtelAnchorView[];
}

declare const otelPackage: PhysicalFactPackageDefinition<
  "attempt",
  SafeOtelPackageV1
>;

declare const otelProjector: PackageProjector<"attempt", SafeOtelPackageV1, OtelLocalViews>;
```

一个 physical package 可以投影多个逻辑 views，因为它们共享同一份输入 closure；这不等于 projector
执行跨包 join。Projection result 保留 package identity、exact owner ref、frozen view identity、schema
identity、collection state 与 local entity identities。

```ts
interface ProjectedPackageSet<ViewToken, Owner, Views> {
  readonly view: ViewToken;
  readonly projection: PackageProjectionId;
  readonly slots: readonly ProjectedPackageSlot<Owner, Views>[];
}

type ProjectedPackageSlot<Owner, Views> =
  | { readonly state: "excluded"; readonly slot: LogicalSlot; readonly reason: ExclusionReason }
  | { readonly state: "not-recorded"; readonly slot: LogicalSlot }
  | { readonly state: "core-invalid"; readonly slot: LogicalSlot; readonly problem: CoreProblem }
  | {
      readonly state: "included";
      readonly slot: LogicalSlot;
      readonly owner: Owner;
      readonly result: ProjectedPackageResult<Views>;
    };

type ProjectedPackageResult<Views> =
  | {
      readonly state: "available";
      readonly representation: "direct" | "physical" | "legacy";
      readonly locator: RecordAttachmentLocator;
      readonly family: RecordAttachmentFamilyId;
      readonly schema: RecordAttachmentSchemaId;
      readonly collection: PackageCollectionState;
      readonly value: Views;
    }
  | {
      readonly state: "package-result";
      readonly representation: "direct" | "physical" | "legacy";
      readonly locator: RecordAttachmentLocator;
      readonly family: RecordAttachmentFamilyId;
      readonly result: Exclude<
        RecordAttachmentRead<unknown>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly state: "capture-expectation";
      readonly packageKind: PhysicalPackageKind;
      readonly expectation: "unsupported" | "not-enabled";
      readonly reason: CaptureSupportReason | CaptureEnablementReason;
    }
  | {
      readonly state: "representation-unavailable";
      readonly receiptLocator: RecordAttachmentLocator;
      readonly receipt: Exclude<
        RecordAttachmentRead<unknown>,
        { readonly state: "available" } | { readonly state: "unavailable" }
      >;
    };

type ProjectionViews<Definition> = Definition extends PackageProjectionDefinition<
  unknown,
  infer Views
> ? Views : never;

type ProjectedGraphResults<Graph> = {
  readonly [Key in keyof Graph]: ProjectedPackageResult<ProjectionViews<Graph[Key]>>;
};
```

Projection 只能通过活着的 `AnalysisSampleHandle<ViewToken>` 发起。`ViewToken` 由 handle mint 且不能由
作者构造；实现同时核对 reader-owned frozen view identity。

```ts
interface AnalysisSampleHandle<ViewToken> {
  projectPackage<Owner, Payload, Views>(
    access: PackageAccess<Owner, Payload>,
    projector: PackageProjector<Owner, Payload, Views>,
  ): Effect.Effect<
    ProjectedPackageSet<ViewToken, OwnerRef<Owner>, Views>,
    RecordReadError | ProjectionLimitError
  >;
  project<Owner, Views>(
    definition: PackageProjectionDefinition<Owner, Views>,
  ): Effect.Effect<
    ProjectedPackageSet<ViewToken, OwnerRef<Owner>, Views>,
    RecordReadError | ProjectionLimitError
  >;
  projectRepresentation<Owner, Physical, Legacy>(
    definition: RepresentationProjectionDefinition<Owner, Physical, Legacy>,
  ): Effect.Effect<
    ProjectedRepresentationSet<ViewToken, OwnerRef<Owner>, Physical, Legacy>,
    RecordReadError | ProjectionLimitError
  >;
  readonly relations: RelationAssembler<ViewToken>;
}
```

Representation selection 是静态有限分支图：

```ts
type PackageProjectionGraph<Owner> = Readonly<
  Record<string, PackageProjectionDefinition<Owner, unknown>>
>;

type PhysicalProjectionGraph<Owner> = Readonly<
  Partial<Record<PhysicalPackageKind, PackageProjectionDefinition<Owner, unknown>>>
>;

declare const defineRepresentationProjection: <
  Owner,
  Physical extends PhysicalProjectionGraph<Owner>,
  Legacy extends PackageProjectionGraph<Owner>,
>(input: {
  readonly receipt: PackageProjectionDefinition<Owner, CaptureReceiptView>;
  readonly physical: Physical;
  readonly legacy: Legacy;
}) => RepresentationProjectionDefinition<Owner, Physical, Legacy>;

interface ProjectedRepresentationSet<ViewToken, Owner, Physical, Legacy> {
  readonly view: ViewToken;
  readonly slots: readonly ProjectedRepresentationSlot<Owner, Physical, Legacy>[];
}

type ProjectedRepresentationSlot<Owner, Physical, Legacy> =
  | { readonly state: "excluded"; readonly slot: LogicalSlot; readonly reason: ExclusionReason }
  | { readonly state: "not-recorded"; readonly slot: LogicalSlot }
  | { readonly state: "core-invalid"; readonly slot: LogicalSlot; readonly problem: CoreProblem }
  | {
      readonly state: "included";
      readonly slot: LogicalSlot;
      readonly owner: Owner;
      readonly result:
        | {
            readonly state: "physical";
            readonly receipt: CaptureReceiptView;
            readonly projections: ProjectedGraphResults<Physical>;
          }
        | { readonly state: "legacy"; readonly projections: ProjectedGraphResults<Legacy> }
        | {
            readonly state: "representation-unavailable";
            readonly receiptLocator: RecordAttachmentLocator;
            readonly receipt: Exclude<
              RecordAttachmentRead<unknown>,
              { readonly state: "available" } | { readonly state: "unavailable" }
            >;
          };
    };
```

```ts
interface CaptureReceiptView {
  readonly representation: "physical-v1";
  readonly packages: Readonly<Record<PhysicalPackageKind,
    | { readonly expectation: "sealed" }
    | { readonly expectation: "unsupported"; readonly reason: CaptureSupportReason }
    | { readonly expectation: "not-enabled"; readonly reason: CaptureEnablementReason }
  >>;
}
```

Receipt 不保存 package 的 complete/partial；`sealed` 要求 aggregate validation 找到对应 package，具体
collection state 只由该 package 自己拥有。

Definition 在 I/O 前闭合 receipt、physical 与 legacy 的全部候选 families。执行先读 Receipt：只有 Receipt
`unavailable` 才激活 legacy；available Receipt 按 profile 激活 physical branch。Receipt 的
migration-required、migration-unavailable、unsupported 或 invalid 形成 `representation-unavailable`。
未激活 branch 不读取，也不产生 problem；callback 不能动态增加 family。

Receipt 的 `unsupported` / `not-enabled` expectation 形成独立 `capture-expectation`，不冒充
Attachment `unsupported` 或 anchor `unmatched`。Receipt 是 authoritative selection：reader 不为检测旧新
并存而检查未激活 branch 是否存在。Official writer 的 aggregate validation 在新 Run 发布前拒绝双写；
对已存或第三方 bytes，读取时忽略未选 representation。

Physical graph 的 key 必须是 `PhysicalPackageKind`，host 把 Receipt 中同 key 的 expectation 映射到
该 node。`sealed` 才读 package；`unsupported` / `not-enabled` 直接产生对应的
`capture-expectation`。Legacy graph 没有 Receipt expectation，每个 node 保留自己的 Attachment 读取状态。

## Relations

```ts
interface RelationAssembler<ViewToken> {
  build<Inputs, Row>(
    definition: RelationBuilder<Inputs, Row>,
    input: Inputs,
  ): Effect.Effect<RelationTable<Row>, RelationInputError>;
}

interface AttemptPhysicalProjectionGraph {
  readonly "agent-events": PackageProjectionDefinition<"attempt", AgentEventLocalViews>;
  readonly otel: PackageProjectionDefinition<"attempt", OtelLocalViews>;
  readonly timing: PackageProjectionDefinition<"attempt", TimingLocalViews>;
  readonly diagnostics: PackageProjectionDefinition<"attempt", DiagnosticLocalViews>;
}

interface AttemptLegacyProjectionGraph {
  readonly conversation: PackageProjectionDefinition<"attempt", ConversationLocalViews>;
  readonly usage: PackageProjectionDefinition<"attempt", UsageLocalViews>;
  readonly timing: PackageProjectionDefinition<"attempt", TimingLocalViews>;
  readonly diagnostics: PackageProjectionDefinition<"attempt", DiagnosticLocalViews>;
}

interface AttemptFactRelationInputs<ViewToken> {
    readonly observability: ProjectedRepresentationSet<
      ViewToken,
      AttemptRef,
      AttemptPhysicalProjectionGraph,
      AttemptLegacyProjectionGraph
    >;
    readonly commands: ProjectedPackageSet<ViewToken, AttemptRef, CommandLocalViews>;
    readonly assertions: ProjectedPackageSet<ViewToken, AttemptRef, AssertionLocalViews>;
    readonly verdict: ProjectedPackageSet<ViewToken, AttemptRef, VerdictLocalViews>;
    readonly score?: ProjectedPackageSet<ViewToken, AttemptRef, ScoreLocalViews>;
}

declare const attemptFactRelations: <ViewToken>() => RelationBuilder<
  AttemptFactRelationInputs<ViewToken>,
  AttemptFactRow
>;
```

`RelationAssembler` 绑定一个 `AnalysisSampleHandle` 与它的 base population。核心 join 是 pure。
入口先核对所有 projection sets 的 view token、population alignment、exact owner 与 package
provenance。不同 snapshot、owner 或 Sample 混用返回 `RelationInputError`，不会产生部分 rows。
成功后按 logical slots 穷尽返回：

```ts
type RelationSlot<T> =
  | { readonly state: "excluded"; readonly slot: LogicalSlot; readonly reason: ExclusionReason }
  | { readonly state: "not-recorded"; readonly slot: LogicalSlot }
  | { readonly state: "core-invalid"; readonly slot: LogicalSlot; readonly problem: CoreProblem }
  | { readonly state: "included"; readonly slot: LogicalSlot; readonly value: RelationCell<T> };

interface RelationTable<Row> {
  readonly slots: readonly RelationSlot<Row>[];
}

type AttemptFactRelations = RelationTable<AttemptFactRow>;

type RelationCell<T> =
  | { readonly state: "matched"; readonly value: T; readonly anchors: readonly DurableAnchor[] }
  | { readonly state: "unmatched"; readonly reason: RelationReason }
  | { readonly state: "ambiguous"; readonly candidates: readonly DurableAnchor[] }
  | {
      readonly state: "package-result";
      readonly representation: "direct" | "physical" | "legacy";
      readonly locator: RecordAttachmentLocator;
      readonly family: RecordAttachmentFamilyId;
      readonly result: Exclude<RecordAttachmentRead<unknown>, { readonly state: "available" }>;
    }
  | {
      readonly state: "capture-expectation";
      readonly packageKind: PhysicalPackageKind;
      readonly expectation: "unsupported" | "not-enabled";
      readonly reason: CaptureSupportReason | CaptureEnablementReason;
    }
  | {
      readonly state: "representation-unavailable";
      readonly receiptLocator: RecordAttachmentLocator;
      readonly reason: RepresentationReason;
    };
```

`package-result` 原样保留 unavailable、migration-required、migration-unavailable、unsupported 与 invalid，
不折成一个 missing 状态。只有 packages available 后的 anchor 问题才使用 `unmatched` 或 `ambiguous`。
不同 view/owner/Sample token 在入口返回 typed failure，不产生 rows。所有情况都不从 population 删除 slot。

Host 先按 Sample 顺序传递 excluded、not-recorded 与 core-invalid，只对 included slot 调用
builder 的 pure `relate`。因此第三方 builder 不能通过少返回 rows 改变 denominator。

## Anchors 与多源 observations

```ts
declare const defineCaptureAnchor: <Kind extends string, Version extends number>(input: {
  readonly kind: Kind;
  readonly issuer: CaptureAnchorIssuer;
  readonly version: Version;
}) => CaptureAnchorDefinition<Kind, Version>;

interface CaptureAnchor<Kind, Version, Value> {
  readonly owner: RecordAttemptRef;
  readonly issuer: CaptureAnchorIssuer;
  readonly kind: Kind;
  readonly version: Version;
  readonly value: Value;
}

interface CaptureContext<Attempt, SendAnchor> {
  readonly attempt: Attempt;
  readonly send: SendAnchor;
}

interface ObservationCandidateGroup<Value> {
  readonly anchor: DurableAnchor;
  readonly candidates: readonly SourceQualified<Value>[];
  readonly coverage: RelationCoverage;
}

type ReconciledObservation<Value> =
  | { readonly state: "agreement"; readonly value: Value; readonly sources: readonly ObservationSource[] }
  | { readonly state: "conflict"; readonly candidates: readonly SourceQualified<Value>[] }
  | { readonly state: "independent"; readonly candidates: readonly SourceQualified<Value>[] }
  | { readonly state: "partial"; readonly candidates: readonly SourceQualified<Value>[] };
```

Anchor issuer 在事件发生处 mint identity，并通过 branded `CaptureContext` 传给其它 collectors。其它
producer 只能保存它，不能从文本、时间、provider ID 或 local ID 重建。

Relations 只形成 `ObservationCandidateGroup`，不判断数值 agreement/conflict。Usage/timing metric 或普通
纯函数必须接收显式 public `ObservationReconciliationPolicy`，再形成 `ReconciledObservation`。Built-in
policy 也通过同一公开参数声明；Relations 不静默 union、比较容差或挑选 observation producer。

## Relation cardinality

```ts
type RelationCardinality = "one" | "optional-one" | "many" | "non-empty-many";

declare const defineAnchorRelation: (input: {
  readonly from: CaptureAnchorDefinition<string, number>;
  readonly to: CaptureAnchorDefinition<string, number>;
  readonly cardinality: RelationCardinality;
}) => AnchorRelationDefinition;
```

| relation | cardinality |
|---|---|
| send → agent events | non-empty-many |
| send → OTel operations | many |
| agent command reference → command | one |
| assertion → send | optional-one |
| Verdict evidence → assertions | many |

Package-local operation → spans 和 assertion entry → assertion 由 package schema 与 Projection 验证，不重新
进入跨包 Relations。Capture runtime 保存 issuer mint registry；同一 anchor 在多包中的 references
是合法传播，只有重复 origin mint 才使 aggregate invalid。Aggregate 不验证 cross-package target
cardinality，否则会与 read-time dangling 状态冲突。

`many` 允许零个 target，返回 matched-empty collection。`non-empty-many` 的下界不满足才是
unmatched；超过 `one` 或 `optional-one` 的上界才是 ambiguous。

## Public relation extension

```ts
type IncludedSlotResult<Input> = Input extends { readonly slots: readonly (infer Slot)[] }
  ? Extract<Slot, { readonly state: "included" }> extends { readonly result: infer Result }
    ? Result
    : never
  : never;

type IncludedProjectedInputs<Inputs> = {
  readonly [Key in keyof Inputs]: IncludedSlotResult<Inputs[Key]>;
};

declare const defineRelationBuilder: <Inputs, Row>(input: {
  readonly relate: (input: IncludedProjectedInputs<Inputs>) => RelationCell<Row>;
}) => RelationBuilder<Inputs, Row>;
```

第三方 package、projector、anchor vocabulary 与 relation builder 使用同一组 public constructors。
`attemptFactRelations()` 只是组合这些 primitives 的 built-in relation；host 不向它注入 private path、arbitrary owner
lookup 或 legacy backfill。

## Report author facade

普通 Report 作者不必逐包调用：

```ts
const attempts = attemptFacts({
  fields: {
    conversation: true,
    usage: true,
    timing: true,
    commands: true,
    assertions: true,
    verdict: true,
  },
});
```

`attemptFacts()` 只是 Report query declaration。Host 展开它需要的 representation branches、逐包
Projection 与 `attemptFactRelations()`。绑定 `AnalysisSampleHandle` 后才执行 I/O 并产生
Sample-aligned relations。Built-in 和第三方 Report 使用同一入口。高级脚本仍可直接消费
local projections 与 relation builders，但不能取得 arbitrary path/owner lookup。
