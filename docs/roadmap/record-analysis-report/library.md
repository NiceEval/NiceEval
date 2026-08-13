# Record → Analysis → Report —— Library

本页定义三层组合调用面。RecordAttachment adapter、installation、owner-specific binding 与 migration target 的通用
语法以 [adapter SPI](../record-attachment-authoring/library.md) 为单源。

普通 consumer 不从 `niceeval/record/adapter` 导入。他们调用领域 SDK、`niceeval/analysis` 与 `niceeval/report`。

## Record host runtime

`niceeval/record/host` 只向 application 与 CLI host 提供 root runtime。所有 facet 都有 nominal identity；弱 facet 不能
结构性升级成强 facet。

```ts
interface RecordSnapshotSource {
  readonly withSnapshot: <A, E, R>(
    use: (reader: RecordReader) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RecordOpenError | RecordReadError, R>;
}

interface RecordInvocationAccess extends RecordSnapshotSource {
  readonly withWriteSession: <A, E, R>(
    use: (session: RecordWriteSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RecordOpenError | RecordWriteError, R>;
}

type NonEmptyReadonlyArray<A> = readonly [A, ...A[]];

interface RecordAttachmentHostConfig {
  readonly install: readonly RecordAttachmentInstallation[];
}

type RecordMigrationGitSafety =
  | { readonly state: "git-restore-point"; readonly commit: string }
  | { readonly state: "not-git-worktree" }
  | { readonly state: "root-outside-worktree" }
  | {
      readonly state: "portable-root-dirty";
      readonly entries: readonly string[];
    };

type RecordMigrationAttachmentPlan =
  | {
      readonly state: "current";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly schemaId: string;
      readonly count: number;
    }
  | {
      readonly state: "migrate";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly edges: NonEmptyReadonlyArray<{
        readonly from: string;
        readonly to: string;
      }>;
      readonly count: number;
    }
  | {
      readonly state: "migration-unavailable";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly blockedAt: {
        readonly from: string;
        readonly to: string;
      };
      readonly reason: string;
      readonly count: number;
    }
  | {
      readonly state: "unsupported";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly schemaId: string;
      readonly count: number;
    };

type RecordMigrationCorePlan =
  | { readonly state: "current"; readonly format: string }
  | {
      readonly state: "migrate";
      readonly from: string;
      readonly to: string;
      readonly edges: NonEmptyReadonlyArray<{
        readonly from: string;
        readonly to: string;
      }>;
    };

interface RecordMigrationPlanSummary<State extends "needed" | "not-needed"> {
  readonly state: State;
  readonly root: string;
  readonly git: RecordMigrationGitSafety;
  readonly core: RecordMigrationCorePlan;
  readonly attachments: readonly RecordMigrationAttachmentPlan[];
}

declare const recordMigrationPlanTypeId: unique symbol;

type RecordMigrationPlan =
  | {
      readonly [recordMigrationPlanTypeId]: typeof recordMigrationPlanTypeId;
      readonly state: "needed";
      readonly summary: RecordMigrationPlanSummary<"needed">;
    }
  | {
      readonly [recordMigrationPlanTypeId]: typeof recordMigrationPlanTypeId;
      readonly state: "not-needed";
      readonly summary: RecordMigrationPlanSummary<"not-needed">;
    };

// Planner 的 state 由 summary 内容唯一决定：
// needed iff core 或至少一个 Attachment 的 state 是 "migrate"；
// 否则 core 必须是 "current"，且所有 Attachment 只能是
// "current" | "migration-unavailable" | "unsupported"，plan 为 not-needed。

type RecordMigrationAuthorizationDecision =
  | { readonly state: "use-git-restore-point" }
  | { readonly state: "accept-data-loss" };

declare const recordMigrationAuthorizationTypeId: unique symbol;

type RecordMigrationAuthorization =
  | {
      readonly [recordMigrationAuthorizationTypeId]:
        typeof recordMigrationAuthorizationTypeId;
      readonly state: "git-restore-point";
      readonly commit: string;
    }
  | {
      readonly [recordMigrationAuthorizationTypeId]:
        typeof recordMigrationAuthorizationTypeId;
      readonly state: "accept-data-loss";
    };

type RecordMigrationAttachmentReceipt =
  | {
      readonly state: "already-current";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly schemaId: string;
      readonly count: number;
    }
  | {
      readonly state: "migrated";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly edges: NonEmptyReadonlyArray<{
        readonly from: string;
        readonly to: string;
      }>;
      readonly count: number;
    }
  | {
      readonly state: "preserved-migration-unavailable";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly reason: string;
      readonly count: number;
    }
  | {
      readonly state: "preserved-unsupported";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly schemaId: string;
      readonly count: number;
    };

type RecordMigrationReceipt =
  | {
      readonly state: "not-needed";
      readonly plan: RecordMigrationPlanSummary<"not-needed">;
      readonly authorization: { readonly state: "not-required" };
      readonly attachments: readonly RecordMigrationAttachmentReceipt[];
    }
  | {
      readonly state: "migrated";
      readonly plan: RecordMigrationPlanSummary<"needed">;
      readonly authorization:
        | { readonly state: "git-restore-point"; readonly commit: string }
        | { readonly state: "accept-data-loss" };
      readonly attachments: readonly RecordMigrationAttachmentReceipt[];
    };

type RecordMigrationAuthorizationError =
  | {
      readonly code: "record-migration-git-restore-point-unavailable";
      readonly git: Exclude<
        RecordMigrationGitSafety,
        { readonly state: "git-restore-point" }
      >;
    }
  | { readonly code: "record-migration-plan-not-actionable" };

type RecordHostOperationError =
  | { readonly code: "record-runtime-closed" }
  | { readonly code: "record-root-invalid" }
  | {
      readonly code: "record-io-error" | "record-permission-denied";
      readonly operation: string;
      readonly path: string;
    }
  | {
      readonly code: "record-maintenance-busy";
      readonly requested: "shared" | "exclusive";
    }
  | {
      readonly code: "record-git-command-failed";
      readonly operation:
        | "locate-worktree"
        | "read-head"
        | "inspect-status";
    };

type RecordMigrationSourceIssue =
  | { readonly code: "record-core-invalid" }
  | {
      readonly code: "record-attachment-invalid";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly schemaId: string;
      readonly reason: "payload" | "closure" | "path";
    };

type RecordCoreMigrationPlanIssue =
  | {
      readonly code: "record-core-migration-edge-missing";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly code: "record-core-migration-source-unsupported";
      readonly format: string;
    };

type RecordAccessRuntimeOpenError =
  | {
      readonly code: "record-attachment-installation-invalid";
      readonly index: number;
    }
  | {
      readonly code: "record-attachment-adapter-definition-invalid";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly issues: NonEmptyReadonlyArray<string>;
    }
  | {
      readonly code: "record-attachment-registry-conflict";
      readonly owner: "run" | "attempt";
      readonly name: string;
    };

type RecordMigrationPlanError =
  | RecordHostOperationError
  | { readonly code: "record-migration-interrupted" }
  | { readonly code: "record-migration-source-invalid"; readonly issues: NonEmptyReadonlyArray<RecordMigrationSourceIssue> }
  | { readonly code: "record-core-migration-plan-invalid"; readonly issues: NonEmptyReadonlyArray<RecordCoreMigrationPlanIssue> };

type RecordMigrationError =
  | RecordHostOperationError
  | { readonly code: "record-migration-interrupted" }
  | { readonly code: "record-migration-plan-stale" }
  | { readonly code: "record-migration-authorization-invalid" }
  | {
      readonly code: "record-core-migration-step-failed";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly code: "record-attachment-migration-step-failed";
      readonly owner: "run" | "attempt";
      readonly name: string;
      readonly from: string;
      readonly to: string;
    };

interface RecordMaintenanceAccess {
  readonly inspect: RecordMaintenanceInspect;
  readonly clean: RecordClean;
  readonly planMigration: () => Effect.Effect<
    RecordMigrationPlan,
    RecordMigrationPlanError,
    never
  >;
  readonly authorizeMigration: (input: {
    readonly plan: Extract<RecordMigrationPlan, { readonly state: "needed" }>;
    readonly decision: RecordMigrationAuthorizationDecision;
  }) => Either.Either<
    RecordMigrationAuthorization,
    RecordMigrationAuthorizationError
  >;
  readonly migrate: (input:
    | {
        readonly plan: Extract<
          RecordMigrationPlan,
          { readonly state: "not-needed" }
        >;
      }
    | {
        readonly plan: Extract<
          RecordMigrationPlan,
          { readonly state: "needed" }
        >;
        readonly authorization: RecordMigrationAuthorization;
      }
  ) => Effect.Effect<
    RecordMigrationReceipt,
    RecordMigrationError,
    never
  >;
}

interface RecordAccessRuntime {
  readonly snapshots: RecordSnapshotSource;
  readonly invocation: RecordInvocationAccess;
  readonly maintenance: RecordMaintenanceAccess;
}

declare const openRecordAccessRuntime: (input: {
  readonly root: RecordRoot;
  readonly recordAttachments: RecordAttachmentHostConfig;
}) => Effect.Effect<
  RecordAccessRuntime,
  RecordAccessRuntimeOpenError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLock |
    RecordWriterLock | RecordEntropy | RecordGit
>;
```

runtime 绑定 canonical root、filesystem、lock authority、installed registry、generation allocator 与本地 verified-read
cache。真实 read、write 与 maintenance 发生在 facet child Scope；outer runtime 空闲时不持 lease。

`recordAttachments.install` 是 application 明确信任的第三方 opaque installations。runtime open 时把它们与固定的
official installations 编译成 immutable registry；Plugin mount、Record bytes 与 Layer 都不能隐式增加 family。

`niceeval/record/host` 同时导出 `makeRecordRoot`、`NodeRecordHostLive` 和上述 plan／authorization／receipt／error types。
application 在最外层 `Effect.provide(NodeRecordHostLive)`，内部不启动第二个 Effect runtime。

`RecordMigrationPlan` 是 package-minted、root/runtime-affine 的 opaque 值。private state 绑定 source fingerprint、exact
installation identities、完整相邻 graph、Git inspection 与 source validation。只有 `summary` 可序列化；复制 JSON
不能恢复 plan。authorization 也由同一 facet 针对 exact needed plan mint，不能伪造或用于另一个 runtime。

plan state 不做启发式判断：当且仅当 Core 是 `migrate`，或至少一个 Attachment family 是 `migrate` 时，plan 才是
`needed`。若 Core 是 `current`，并且所有 family 都是 `current | migration-unavailable | unsupported`，plan 必须是
`not-needed`；后两态保留 exact source 并进入 receipt，不会单独触发 rewrite。混合 plan 中只要另一个 Core／family 可迁移，
整体仍是 `needed`，不可迁移与不支持的 family 继续按 preserved state 返回。

`not-needed` plan 不要求 authorization。needed plan 必须先经过 `authorizeMigration()`；API 不根据 Git 状态自动选择
`accept-data-loss`。成功 receipt 只在 target bytes、最终 `record.json`、sentinel 删除与目录 sync 全部完成后返回。
sentinel 创建后的 failure、defect 或 interruption不返回 receipt，并保留 fail-closed 状态。

`RecordInvocationAccess` 可以在 write session 内用 `session.view` 做 reuse planning，并在 session 关闭后通过继承的
`withSnapshot()` 打开 fresh reader。`RecordReader` 是完整 `FrozenRecordView`，也是 `selectAnalysisSample()` 的精确
输入；它只存在于 host callback，不进入 Analysis 或 Report 作者 API。

## Producer 只提交 sealed domain value

普通 Eval 作者只调用领域 SDK。领域 SDK 在 `niceeval/record/adapter` 中定义 adapter 与 binding：

```ts
const adapter = defineRecordAttachmentAdapter({
  owner,
  name,
  versions,
  current,
  migrations,
  adapt: adaptSealedValue,
  project: projectCurrentValue,
});

const binding = defineAttemptRecordAdapterBinding({
  adapter,
  behaviorIdentity,
  open,
  seal,
  release,
});
```

host 从 linked binding 推导内部 grant、owner lease 与 canonical command。SDK callback 只看到领域 identity、exit、signal
与自己的 session；不看到 definition、root、writer 或 path。

canonical data flow 是：

```text
actual owner open
  → reserve family + pending total obligation
  → producer open / seal / release
  → sealed domain value
  → adapter current target
  → immutable payload snapshot + blob closure
  → tracked Effect command
  → generic writer + accepted event
```

第三方与 official bindings 使用同一个 flow。官方没有另一个 Effect facade。

## Record host 安装 opaque capability

```ts
export default defineConfig({
  recordAttachments: {
    install: [domainRecordInstallation],
  },
});
```

`install` 只接受 `RecordAttachmentInstallation`。它允许 reader 与 maintenance 使用 adapter family，不允许构造 binding。
Plugin mount 不自动安装，普通 read 不自动 migrate。

## 领域 SDK 内部的 Projection kernel

领域 SDK 可以用 adapter 私有 projector 构造以下通用 declarations：

```ts
declare const attemptSlotProjection: <Value>(
  projector: RecordAttachmentProjector<"attempt", Value>,
) => RecordProjection<"attempt-slot", Value>;

declare const attemptOriginRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"attempt-origin-run", Value>;

declare const selectedRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"selected-run", Value>;
```

Projection SPI 保留低层执行 primitive，供 Analysis compiler 与领域 SDK 集成：

```ts
declare const projectAnalysisSample: <Access, Value>(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly projection: RecordProjection<Access, Value>;
}) => Effect.Effect<
  ProjectedSample<Access, Value>,
  RecordReadError | ProjectionLimitError
>;
```

领域 SDK 把 declaration 收进 fields，不把 projection executor 导出给普通 Analysis：

```ts
const measurementByAttempt = attemptSlotProjection(
  adapter.projector,
);

const measurementFields = defineAnalysisFields({
  id: "com.example.measurement",
  population: logicalSlots,
  dependencies: { measurement: measurementByAttempt },
  materialize: ({ population, dependencies }) =>
    population.rows((slot) =>
      measurementCells(slot, dependencies.measurement.at(slot.key)),
    ),
});

export const measurementValue = measurementFields.measure({
  id: "measurement-value",
  cell: "value",
  rollup: logicalSlotRollup({ withinEval: mean, acrossEvals: mean }),
  denominator: allLogicalSlots,
  evidence: allDenominatorAttemptRefs,
});

export const analyzeMeasurement = (sampleHandle: AnalysisSampleHandle) =>
  analyze({ sampleHandle, fields: { value: measurementValue } });
```

SDK 不导出 adapter、raw reader、versioned payload、`measurementByAttempt` 或 `projectAnalysisSample()`。field materializer
必须保留 Sample identity、denominator、每 slot 穷尽状态、issues 与 refs。
`migration-required | migration-unavailable | unsupported | invalid` 不能被隐藏。

## Analysis 作者面

Analysis SDK 的公开扩展单位不是 projection 字符串，而是 nominal population 上的 fields：

```ts
declare const AnalysisPopulationType: unique symbol;
declare const AnalysisFieldType: unique symbol;

interface AnalysisPopulation<Id extends string, Member> {
  readonly id: Id;
  readonly [AnalysisPopulationType]: (member: Member) => Member;
}

interface Dimension<Population, Value> {
  readonly id: string;
  readonly [AnalysisFieldType]: {
    readonly population: Population;
    readonly role: "dimension";
    readonly value: Value;
  };
}

interface Measure<Population, Value> {
  readonly id: string;
  readonly [AnalysisFieldType]: {
    readonly population: Population;
    readonly role: "measure";
    readonly value: Value;
  };
}

interface AnalysisRelation<From, To> {
  readonly id: string;
  readonly from: From;
  readonly to: To;
}
```

`Id` 与 symbol 共同形成 nominal identity；`id` 只用于诊断与静态输出，不允许两个独立 constructor 因字符串相同而互相
兼容。grain 只作解释文字，例如“每个 logical slot 一行”。

### 定义 population 与 relation

```ts
declare const defineAnalysisPopulation: <
  const Id extends string,
  Dependencies extends AnalysisDependencyShape,
  Member,
>(input: {
  readonly id: Id;
  readonly dependencies: Dependencies;
  readonly materialize: (context: {
    readonly sample: AnalysisSample;
    readonly dependencies: MaterializedAnalysisDependencies<Dependencies>;
    readonly members: AnalysisPopulationMembersBuilder<Id, Member>;
  }) => AnalysisPopulationMembers<Id, Member>;
}) => AnalysisPopulation<Id, Member>;

interface AnalysisPopulationMembersBuilder<Id extends string, Member> {
  readonly from: <Source>(
    source: readonly Source[],
    options: {
      readonly key: (source: Source) => string;
      readonly value: (source: Source) => Member;
    },
  ) => AnalysisPopulationMembers<Id, Member>;
}

declare const defineAnalysisRelation: <From, To, Dependencies>(input: {
  readonly id: string;
  readonly from: From;
  readonly to: To;
  readonly dependencies: Dependencies;
  readonly assemble: (context: {
    readonly from: MaterializedPopulation<From>;
    readonly dependencies: MaterializedAnalysisDependencies<Dependencies>;
    readonly rows: AnalysisRelationRowsBuilder<From, To>;
  }) => ExhaustiveAnalysisRelation<From, To>;
}) => AnalysisRelation<From, To>;
```

`members.from()` 对 stable key 做非空、唯一与确定性校验。Relation 仍遵守既有 same-Sample 规则：它必须穷尽 source
population，并显式返回 matched、unmatched、ambiguous 与 input-state cells。它不按数组位置、数值容差或最近时间猜
关系。

### 在 population 上定义 fields

字段 materializer 只能通过 materialized population 的 `rows()` 形成 aligned rows：

```ts
type AnalysisFieldCell<Value, Issue, Ref> =
  | {
      readonly state: "value";
      readonly value: Value;
      readonly issues: readonly Issue[];
      readonly refs: readonly Ref[];
    }
  | {
      readonly state: "empty";
      readonly issues: readonly Issue[];
      readonly refs: readonly Ref[];
    }
  | {
      readonly state: "missing";
      readonly reason: string;
      readonly issues: readonly Issue[];
      readonly refs: readonly Ref[];
    }
  | {
      readonly state: "invalid";
      readonly issues: NonEmptyReadonlyArray<Issue>;
      readonly refs: readonly Ref[];
    };

interface MaterializedPopulation<Population> {
  readonly rows: <Row>(
    materialize: (member: AnalysisPopulationMember<Population>) => Row,
  ) => AnalysisRows<Population, Row>;
}

declare const defineAnalysisFields: <
  Population,
  Dependencies extends AnalysisDependencyShape,
  Row extends Readonly<Record<string, AnalysisFieldCell<unknown, unknown, unknown>>>,
>(input: {
  readonly id: string;
  readonly population: Population;
  readonly dependencies: Dependencies;
  readonly materialize: (context: {
    readonly population: MaterializedPopulation<Population>;
    readonly dependencies: MaterializedAnalysisDependencies<Dependencies>;
  }) => AnalysisRows<Population, Row>;
}) => AnalysisFieldSet<Population, Row>;
```

`population.rows(callback)` 对 population 的每个 member 恰好调用一次，并保留 package-minted row identity。作者不能先
filter 一份数组再冒充完整 population。少行、重复 identity、foreign identity 或依赖 iteration order 的 row 是
`AnalysisExecutionProblem`，与合法的 `empty`／`missing` cell 分开。

`dependencies` 可以接领域 SDK 私有的 projection declaration、同 population field set，以及经显式 relation 对齐后的
field。它不能接 runtime branch、reader、Effect 或在 callback 中发现的新依赖。

field set 再把具名 cell 导出成 Dimension 或 Measure：

```ts
interface AnalysisFieldSet<Population, Row> {
  readonly dimension: <Key extends keyof Row & string>(input: {
    readonly id: string;
    readonly cell: Key;
    readonly missing: DimensionMissingPolicy<Row[Key]>;
    readonly stableIdentity?: boolean;
  }) => Dimension<Population, AnalysisCellValue<Row[Key]>>;

  readonly measure: <Key extends keyof Row & string>(input: {
    readonly id: string;
    readonly cell: Key;
    readonly rollup: MeasureRollup<Population, AnalysisCellValue<Row[Key]>>;
    readonly denominator: MeasureDenominator<Population, Row[Key]>;
    readonly evidence: MeasureEvidencePolicy<Population, Row[Key]>;
    readonly unit?: string;
    readonly format?: MetricFormat;
    readonly better?: "higher" | "lower";
  }) => Measure<Population, AnalysisCellValue<Row[Key]>>;
}
```

`stableIdentity: true` 只允许 value 在该 population 内非空、唯一且跨相同事实重建稳定的 Dimension。它可作为
PageFamily route key；普通 group label 不能冒充 identity。

Measure 的 descriptor 只保存 policy。`MeasureRollup` 明确 population 的评测分区与 attempt dedupe key，并声明
`withinEval` 和 `acrossEvals` reducer。`MeasureDenominator` 决定哪些 member 进入 denominator；
`MeasureEvidencePolicy` 决定哪些 member refs 随结果保留。本次 value、state、observed、denominator、issues 与 refs 只出现在 materialized
`MetricValue`，不复制到 descriptor。

### 直接执行 Analysis fields

普通 Analysis script 的唯一 field executor 是：

```ts
declare const analyze: <Fields extends AnalysisFieldShape>(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly fields: Fields & SamePopulationFields<Fields>;
}) => Effect.Effect<
  AnalysisExecution<Fields>,
  AnalysisCompileError | RecordReadError | ProjectionLimitError
>;

interface AnalysisExecution<Fields extends AnalysisFieldShape> {
  readonly rows: MaterializedAnalysisRows<Fields>;
  readonly problems: readonly AnalysisExecutionProblem[];
}
```

local constructor validation 失败抛出带 `AnalysisDefinitionIssue[]` 的 `AnalysisDefinitionError`，令可信 module load 失败。

跨 descriptor 的 cycle、population mismatch 与 field identity collision 由 compiler 在任何 Record I/O 前返回
`AnalysisCompileError`。materialization 的 population／row 违约进入 closed `AnalysisExecutionProblem`；Attachment 六态
仍是 row cell 与 host problem。

底层 I/O／permission／decode transport failure 保持 `RecordReadError`，不能伪装成 measure missingness。

compiler 只闭合本次 `analyze({ fields })` 请求的有限 DAG。相同 projection、relation 与 field-set materializer 在一次
execution 中至多执行一次；它不预编译全程序，也不允许 callback 在 materialization 后追加依赖。

## Report 作者面

Report 作者只组合同一 nominal population 上的 Dimension 与 Measure：

```ts
declare const aggregate: <
  Population,
  const By extends Readonly<Record<string, Dimension<Population, unknown>>>,
  const Values extends Readonly<Record<string, Measure<Population, unknown>>>,
>(input: {
  readonly by: By;
  readonly values: Values;
}) => ReportData<Population, AggregateRow<Population, By, Values>>;

interface ReportData<Population, Row> {
  readonly population: Population;
  readonly [ReportDataType]: Row;
}

type AggregateRow<Population, By, Values> = {
  readonly [ReportRowKeyType]: ReportRowKey;
} & {
  readonly [Key in keyof By]: MaterializedDimensionValue<By[Key]>;
} & {
  readonly [Key in keyof Values]: MaterializedMetricValue<Values[Key]>;
};
```

`ReportData` 是静态 declaration，不是 Promise、数组或 iterable。它不能 `await`，没有 `.map()`／`.filter()`／
`.toSorted()`。需要改变 population 或 metric 口径时定义 Analysis field；`Bars`／`Table`／`Scatter` 的 `sort`、`limit`
与显示格式只在 materialization 后改变可见结果。

### aggregate 的固定算法

1. type 与 runtime nominal identity 都要求 `by`／`values` 属于同一个 population；不自动执行 relation。
2. materialize 该 population、fields 与穷尽 cells；dimension 的 missing／invalid 形成显式 coordinate，不静默删 row。
3. 按完整 dimension coordinate 分组；同一 measure 按自己的 rollup basis 去重 Attempt，再先执行 `withinEval`，后执行
   `acrossEvals`。不能把所有 Attempt 摊平后直接平均。
4. denominator policy 对完整 population members 计数；`observed` 只数产生数值的 cells。`empty`、`missing` 与
   `invalid` 不伪装成零，也不能靠删除 member 缩小 denominator。
5. evidence policy 合并所有 denominator members 的 refs，包括合法 empty／null 读数对应的 Attempt；issues 保留产出方与
   field identity。多个 measure channel 各自保留 coverage 与 refs，不提前取交集或并集。
6. reducer 使用 checked finite arithmetic。overflow、`NaN` 或 infinity 形成 invalid issue 与 `value: null`；空集合也是
   `null`，从不补零。
7. row key 由 population identity 与完整 canonical dimension coordinate 形成。measure、sort、limit 与 format 不参与。

内建 `condition`、`memory`、`passRate`、`costUSD` 与 GPU SDK 的 `gpuEnergyJoules` 都属于 built-in `logicalSlots`
population。`passRate` 与 `gpuEnergyJoules` 各自声明两级 rollup，因而组合到一张表时仍先折同一 eval 的重复 Attempt，再
跨 eval 折叠；添加 GPU measure 不会改变质量或成本的权重。

### Page、component 与 PageFamily

```tsx
const leaderboard = aggregate({
  by: { condition, memory },
  values: { passRate, costUSD, gpuEnergyJoules },
});

const Leaderboard = defineComponent(() => (
  <Bars
    points={leaderboard}
    x="condition"
    y="passRate"
    color="memory"
    sort={{ field: "passRate", direction: "desc" }}
    layout="horizontal"
  />
));

export default defineReport({
  id: "memorybench",
  pages: [{
    id: "overview",
    route: "/",
    render: () => <Leaderboard />,
  }],
});
```

字符串 id／route 由 constructor 内部验证；Report 作者不使用 branded constructor 或 `Either`。`defineComponent()` 与
Page `render` 只组合 descriptor，不取得 Sample、projection、reader、Effect 或 Calculation state。

PageFamily 的精确形状是：

```ts
declare const definePageFamily: <Population, Row, Key>(input: {
  readonly id: string;
  readonly data: ReportData<Population, Row>;
  readonly key: ReportDataIdentityDimension<Population, Row, Key>;
  readonly route: (key: Key) => string;
  readonly render: (input: { readonly key: Key; readonly row: ClosedReportRow<Row> }) => ReportNode;
}) => PageFamily<Row, Key>;

interface PageFamily<Row, Key> {
  readonly target: (key: Key) => ReportTarget;
}
```

family 必须显式列入 `defineReport.pages`。compiler 按 family object identity 验证 target，不从 route string 查找；
materialization 验证 key 唯一、instance 存在且 route 无冲突。key 必须来自 stable identity Dimension，不使用 opaque
`ReportRowKey` 或数组 index。

Report 可以显式声明 evidence family：

```ts
export default defineReport({
  id: "memorybench",
  pages: [overview, attemptDetailsPageFamily],
  evidence: { attempt: attemptDetailsPageFamily },
});
```

默认链接只在 `MetricValue` 恰好一个 ref、该 ref kind 有唯一显式 family、对应 instance 存在时形成。否则保留 exact
refs 与 coverage，但不生成 target。多个 refs 不任选一个；组件不暗中注册 Page 或 projection。

`Bars`、`Table` 与 `Scatter` 使用每行固有的 `ReportRowKey`，不以显示字段或声明 index 代替身份。每个 measure channel
分别消费 value、state、unit、format、better、observed／denominator、issues 与 refs。

Report TSX 使用 `niceeval/report` 自有 JSX runtime。CLI loader 自动应用；独立 `tsc`／编辑器需要 extend package 的
report tsconfig preset，或声明 `/** @jsxImportSource niceeval/report */`。runtime 只接受 semantic primitives 与纯
custom components，不接受 DOM intrinsic，也不进入 closed `ReportExecution`。

普通 `defineComponent()` 只能组合既有 primitives。新增真正 `ReportBlock`／Chart mark 必须同时定义 terminal、Web 与
static face，不属于普通 renderer plugin。

## Report host 的精确读取入口

已经持有 snapshot 的 host 在 reader Scope 内调用：

```ts
const sampleHandle = yield* selectAnalysisSample(reader, selection);
const execution = yield* executeReport({ sampleHandle, report });
```

两个签名固定为：

```ts
declare const executeReport: (input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
}) => Effect.Effect<
  ReportExecution,
  ReportExecutionError,
  never
>;

declare const executeReportFromRecord: (input: {
  readonly root: RecordRoot;
  readonly recordAttachments: RecordAttachmentHostConfig;
  readonly selection: AnalysisSelectionRequest;
  readonly report?: Report;
}) => Effect.Effect<
  ReportExecution,
  RecordAccessRuntimeOpenError | RecordReaderOpenError | AnalysisSelectionError |
    ReportExecutionError,
  RecordFileSystem | RecordMaintenanceLock
>;
```

`executeReportFromRecord()` 是默认 application／CLI 的一次性组合入口。它用相同 `recordAttachments` 编译读取 registry，
再于 `Effect.scoped()` 中打开 reader、完成 selection 与 `executeReport()`。已有 `RecordAccessRuntime` 的 host 使用
`withSnapshot()` 与第一种入口，不另开 root。

两条入口形成同一种 `ReportExecution`。它不含 reader、handle、Scope、path、callback 或延迟 I/O；`show`、`view` 与
static export 只消费这个 closed value。

Report definition 的 local id／route／component shape invalid 令 trusted module load 失败。dependency cycle、population
mismatch、field identity collision 或未注册 PageFamily target 在任何 Projection I/O 前成为 `ReportExecutionError`。

materialization 后发现的 aligned-row、family instance 或 route collision 进入 execution problem inventory；static export
对 missing／duplicate target fail closed。

Attachment 领域缺失仍是 `MetricValue` state／host problem，不伪装成 compiler failure。

## Capability 可见性

| 调用者 | 可见 | 明确不可见 |
|---|---|---|
| 普通 Eval／Experiment／Plugin consumer | 领域 Plugin、meter、`t.check`、`t.sandbox.*` | adapter、grant、lease、versioned payload、Record command |
| 领域 SDK 作者 | `/record/adapter`、schema／migration、sealed adaptation、owner binding | root、raw writer、owner-wide allowlist |
| Record／maintenance host | runtime facet、opaque installation、migration plan | writable adapter、producer session、owner lease |
| Analysis 作者 | population、relation、Dimension／Measure、`analyze()`、closed rows | writer、schema、blob closure、renderer |
| Report 作者 | Analysis fields、`ReportData`、Page／PageFamily、host problems | projection、Sample handle、reader、migration、writer |
| 内建 adapter 作者 | package-private official adapter 与同形 binding | raw draft bypass |

## 中立性不变量

第三方与官方共同经过以下机制：adapter compiler、owner-specific binding、total obligation、Scope 与 current target。后续
路径也相同，包括 schema／plain-data／closure validation、tracked command、poison、sink、reader、Projection 与
migration orchestration。

authority 差异只在 official namespace token、导出边界与 installation package owner。第三方不能冒充 `niceeval.*`，
官方不能绕过 canonical kernel。
