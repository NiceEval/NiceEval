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

## Analysis 的 Projection kernel

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

PLAN-1 的唯一公开执行 primitive 仍是：

```ts
declare const projectAnalysisSample: <Access, Value>(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly projection: RecordProjection<Access, Value>;
}) => Effect.Effect<
  ProjectedSample<Access, Value>,
  RecordReadError | ProjectionLimitError
>;
```

领域 SDK 对普通 Analysis 再包装领域名：

```ts
export const projectMeasurement = (sampleHandle: AnalysisSampleHandle) =>
  projectAnalysisSample({
    sampleHandle,
    projection: measurementByAttempt,
  });
```

SDK 不导出 adapter、raw reader 或 versioned payload。领域 projected value 必须保留 Sample identity、denominator、每 slot
穷尽状态、issues 与 refs。`migration-required | migration-unavailable | unsupported | invalid` 不能被隐藏。

## Relations 与 Derivation

Relations 只消费同一 Sample 的 closed projections：

```ts
declare function defineRelationAssembler<Inputs, Cell>(input: {
  readonly inputs: ProjectionShape<Inputs>;
  readonly assemble: (
    inputs: SameSample<Inputs>,
  ) => ExhaustiveRelationValue<Cell>;
}): RelationAssemblerDefinition<Inputs, Cell>;
```

host 在调用前验证 SameSample identity，返回后验证完整 population。unmatched、ambiguous、input state 与 relation
coverage 是成功值中的数据，不能少返回 cell 缩小分母。

Derivation 是普通纯函数。若结果声称具有统计或完整度口径，其 shape 必须显式携带 observed、denominator、state、issues
与 refs。host 不猜业务分母，也不要求通用 metric constructor。

## Report 的领域 input manifest

`reportInputs()` 保存一个 Report 自己需要的有限 declarations。SDK 可以导出领域命名 input：

```ts
const inputs = reportInputs({
  measurement: measurementByAttempt,
});
```

Report host 在 Page、Calculation 或 renderer callback 前执行同一个 Projection kernel。manifest 不是通用 graph；没有公开
node、edge、scheduler 或 runtime branch。

Calculation 只调用普通领域函数：

```ts
const summary = defineCalculation({
  id: summaryId,
  inputs,
  completeness: "allow-partial",
  calculate: ({ inputs }) =>
    deriveMeasurement(inputs.measurement),
});
```

Page 只消费 closed calculation value。Report host 无条件保留 Sample denominator、Attachment read states、coverage、
migration hints 与 execution problems。callback 不能删除这些 problems，也不能取得 Sample handle、reader 或 maintenance。

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

## Capability 可见性

| 调用者 | 可见 | 明确不可见 |
|---|---|---|
| 普通 Eval／Experiment／Plugin consumer | 领域 Plugin、meter、`t.check`、`t.sandbox.*` | adapter、grant、lease、versioned payload、Record command |
| 领域 SDK 作者 | `/record/adapter`、schema／migration、sealed adaptation、owner binding | root、raw writer、owner-wide allowlist |
| Record／maintenance host | runtime facet、opaque installation、migration plan | writable adapter、producer session、owner lease |
| Analysis 作者 | 领域 projection API、closed values、穷尽状态 | definition、reader、schema、blob closure |
| Report 作者 | 领域 Report input、closed summary、host problems | Sample handle、reader、migration、writer |
| 内建 adapter 作者 | package-private official adapter 与同形 binding | raw draft bypass |

## 中立性不变量

第三方与官方共同经过以下机制：adapter compiler、owner-specific binding、total obligation、Scope 与 current target。后续
路径也相同，包括 schema／plain-data／closure validation、tracked command、poison、sink、reader、Projection 与
migration orchestration。

authority 差异只在 official namespace token、导出边界与 installation package owner。第三方不能冒充 `niceeval.*`，
官方不能绕过 canonical kernel。
