# State —— Library

State 从 `niceeval/state` 导出。所有 identity component 都是 provider-issued opaque handle；作者只能从 provider
取得它们，不能用 object literal、字符串或类型断言构造。公开 `StateCheckpointRef` 是唯一的 checkpoint
reference 名称，`contentDigest` 也只在这个形状上公开。

```ts
import { Effect, Scope } from "effect";
import type { SandboxIsolationIssue, SandboxPath } from "niceeval/sandbox";
import type {
  StateProvider as PublicStateProvider,
  StateRegionRef as PublicStateRegionRef,
} from "niceeval/state";

declare const provider: PublicStateProvider;
declare const target: PublicStateRegionRef;

const binding = Either.getOrThrow(provider.bind({
  target,
  expected: { kind: "fresh", expectedPredecessor: null },
}));
const execution = provider.acquire(binding);
// execution: Effect.Effect<StateLease, StateFailure, Scope.Scope>
```

`acquire()`、`restore()`、`commit()` 与 `reconcile()` 都保留 Effect v3 的 typed failure。内部模块不启动
runtime；只有 CLI 或应用最外层在关闭 Scope 后运行 Effect。

```ts
declare const StateProviderIdTypeId: unique symbol;
declare const StateNamespaceTypeId: unique symbol;
declare const StateSchemaTypeId: unique symbol;
declare const CohortTypeId: unique symbol;
declare const RegionTypeId: unique symbol;
declare const CheckpointTypeId: unique symbol;
declare const FenceTypeId: unique symbol;
declare const StateExecutionIdTypeId: unique symbol;
declare const StateCommitIdTypeId: unique symbol;
declare const StatePersistenceBoundaryIdTypeId: unique symbol;

interface StateProviderId {
  readonly [StateProviderIdTypeId]: typeof StateProviderIdTypeId;
}

interface StateNamespace {
  readonly [StateNamespaceTypeId]: typeof StateNamespaceTypeId;
}

interface StateSchema {
  readonly [StateSchemaTypeId]: typeof StateSchemaTypeId;
}

interface Cohort {
  readonly [CohortTypeId]: typeof CohortTypeId;
}

interface Region {
  readonly [RegionTypeId]: typeof RegionTypeId;
}

interface Checkpoint {
  readonly [CheckpointTypeId]: typeof CheckpointTypeId;
}

interface FencingToken {
  readonly [FenceTypeId]: typeof FenceTypeId;
}

interface StateExecutionId {
  readonly [StateExecutionIdTypeId]: typeof StateExecutionIdTypeId;
}

interface StateCommitId {
  readonly [StateCommitIdTypeId]: typeof StateCommitIdTypeId;
}

interface StatePersistenceBoundaryId {
  readonly [StatePersistenceBoundaryIdTypeId]: typeof StatePersistenceBoundaryIdTypeId;
}

interface StateContentDigest {
  readonly algorithm: "sha256";
  readonly value: string;
}

/** Provider-issued identity is inseparable from its Cohort. */
interface StateProviderIdentity {
  readonly provider: StateProviderId;
  readonly namespace: StateNamespace;
  readonly cohort: Cohort;
  readonly schema: StateSchema;
}

/** Region is valid only for the Cohort carried in this same reference. */
interface StateRegionRef extends StateProviderIdentity {
  readonly region: Region;
}

/** The only public exact checkpoint reference. */
interface StateCheckpointRef extends StateRegionRef {
  readonly checkpoint: Checkpoint;
  readonly contentDigest?: StateContentDigest;
}

type StatePersistenceSurface =
  | {
      readonly kind: "sandbox-path";
      readonly match: "exact" | "subtree";
      readonly path: SandboxPath;
    }
  | {
      readonly kind: "external-resource";
    };

interface StatePersistenceBoundary extends StateRegionRef {
  readonly boundaryId: StatePersistenceBoundaryId;
  readonly surfaces: readonly [
    StatePersistenceSurface,
    ...StatePersistenceSurface[],
  ];
}

interface StateBinding {
  readonly provider: StateProvider;
  readonly target: StateRegionRef;
  readonly boundary: StatePersistenceBoundary;
  readonly expected: ExpectedPersistence;
}

type ComparableStateCheckpointRef = StateCheckpointRef & {
  readonly contentDigest: StateContentDigest;
};

type NonEmptyReadonlyArray<A> = readonly [A, ...A[]];

type StateDebugReason =
  | "content-digest-unavailable"
  | "cas-guarantee-unavailable"
  | "idempotency-guarantee-unavailable"
  | "fencing-guarantee-unavailable";

type StateExecutionComparability =
  | { readonly kind: "comparable" }
  | {
      readonly kind: "debug";
      readonly reasons: NonEmptyReadonlyArray<StateDebugReason>;
    };

type ExpectedPersistence =
  | {
      readonly kind: "fresh";
      readonly expectedPredecessor: null;
    }
  | {
      readonly kind: "restore";
      readonly expectedPredecessor: StateCheckpointRef;
    };

type ComparableExpectedPersistence =
  | {
      readonly kind: "fresh";
      readonly expectedPredecessor: null;
    }
  | {
      readonly kind: "restore";
      readonly expectedPredecessor: ComparableStateCheckpointRef;
    };

interface StateProvider {
  readonly providerId: StateProviderId;
  readonly namespace: StateNamespace;
  readonly schema: StateSchema;
  readonly bind: (
    input: StateBindingInput,
  ) => Either.Either<StateBinding, StateBindingError>;
  readonly acquire: (
    binding: StateBinding,
  ) => Effect.Effect<StateLease, StateFailure, Scope.Scope>;
}

interface StateBindingInput {
  readonly target: StateRegionRef;
  readonly expected: ExpectedPersistence;
}

type StateBindingError =
  | { readonly code: "state-boundary-unavailable" }
  | { readonly code: "state-boundary-identity-mismatch" }
  | { readonly code: "state-boundary-surface-invalid" };

interface StateLeaseBase {
  readonly executionId: StateExecutionId;
  readonly target: StateRegionRef;
  readonly fence: FencingToken;
  readonly restore: (
    input: { readonly checkpoint: StateCheckpointRef },
  ) => Effect.Effect<StateRestoreReceipt, StateFailure, Scope.Scope>;
  readonly commit: (
    input: StateCommitRequest,
  ) => Effect.Effect<StateCommitReceipt, StateFailure, Scope.Scope>;
  readonly reconcile: (
    input: StateReconcileRequest,
  ) => Effect.Effect<StateReconciliation, StateFailure, Scope.Scope>;
}

type StateLease =
  | (StateLeaseBase & {
      readonly expected: ComparableExpectedPersistence;
      readonly comparability: { readonly kind: "comparable" };
    })
  | (StateLeaseBase & {
      readonly expected: ExpectedPersistence;
      readonly comparability: {
        readonly kind: "debug";
        readonly reasons: NonEmptyReadonlyArray<StateDebugReason>;
      };
    });

type StateRestoreReceipt =
  | {
      readonly checkpoint: ComparableStateCheckpointRef;
      readonly comparability: { readonly kind: "comparable" };
    }
  | {
      readonly checkpoint: StateCheckpointRef;
      readonly comparability: {
        readonly kind: "debug";
        readonly reasons: NonEmptyReadonlyArray<StateDebugReason>;
      };
    };

interface StateCommitRequest {
  readonly commitId: StateCommitId;
  readonly expectedPredecessor: StateCheckpointRef | null;
  readonly fence: FencingToken;
}

interface StateReconcileRequest {
  readonly commitId: StateCommitId;
  readonly expectedPredecessor: StateCheckpointRef | null;
  readonly fence: FencingToken;
  readonly indeterminateReceipt: StateCommitIndeterminateReceipt;
}
```

`contentDigest` 在 `StateCheckpointRef` 上是可选字段，只有 `ComparableStateCheckpointRef` 将它收紧为必填。
首次 acquire 若 provider 不能提供 digest，或不能保证 CAS、同一 `commitId` 的 idempotency、fencing，Runner
立即将 lease 的 `comparability` 固定成 `debug`。任何后续 ref 缺 digest 也只能向 `debug` 降级，不能补写或猜算
digest 使 execution 恢复可比较。

`StateProvider.bind()` 是无 I/O 的声明归一化边界。它验证 boundary 与 target 的 provider、namespace、Cohort、
schema、Region 全部相同；Sandbox path 必须是目标 Sandbox 内的规范虚拟路径，selector 互不重叠。
`external-resource` 只表示同一 Region 的 provider-owned 外部载体，不授权忽略任何 Sandbox 路径变化。
无法签发完整 boundary 时 planning 失败，不能退回作者路径字符串或污染启发式。

`StateProvider.acquire()` 只接受这份已封口的 `StateBinding`，不会从 target 与 expected 重新推导或丢失 boundary。

```ts
type FencingOutcome = "accepted" | "rejected" | "unknown";

type StateAcceptedCommitReceipt =
  | {
      readonly status: "committed" | "replayed";
      readonly commitId: StateCommitId;
      readonly expectedPredecessor: StateCheckpointRef | null;
      readonly newCheckpoint: ComparableStateCheckpointRef;
      readonly comparability: { readonly kind: "comparable" };
      readonly fencing: "accepted";
    }
  | {
      readonly status: "committed" | "replayed";
      readonly commitId: StateCommitId;
      readonly expectedPredecessor: StateCheckpointRef | null;
      readonly newCheckpoint: StateCheckpointRef;
      readonly comparability: {
        readonly kind: "debug";
        readonly reasons: NonEmptyReadonlyArray<StateDebugReason>;
      };
      readonly fencing: "accepted";
    };

type StateCommitRejectedReceipt = {
  readonly status: "rejected";
  readonly commitId: StateCommitId;
  readonly expectedPredecessor: StateCheckpointRef | null;
  readonly newCheckpoint: null;
  readonly comparability: StateExecutionComparability;
  readonly fencing: "rejected";
  readonly reason: "predecessor-mismatch" | "fence-rejected";
};

type StateCommitIndeterminateReceipt = {
  readonly status: "indeterminate";
  readonly commitId: StateCommitId;
  readonly expectedPredecessor: StateCheckpointRef | null;
  readonly newCheckpoint: null;
  readonly comparability: StateExecutionComparability;
  readonly fencing: "unknown";
  readonly reason: "transport-lost" | "provider-unavailable";
};

type StateCommitReceipt =
  | StateAcceptedCommitReceipt
  | StateCommitRejectedReceipt
  | StateCommitIndeterminateReceipt;

type StateReconciliation =
  | {
      readonly status: "committed";
      readonly receipt: StateAcceptedCommitReceipt;
      readonly commitId: StateCommitId;
      readonly expectedPredecessor: StateCheckpointRef | null;
      readonly newCheckpoint: StateCheckpointRef;
      readonly fencing: "accepted";
    }
  | {
      readonly status: "not-committed";
      readonly commitId: StateCommitId;
      readonly expectedPredecessor: StateCheckpointRef | null;
      readonly newCheckpoint: null;
      readonly fencing: "rejected";
    };

type StateOperation = "acquire" | "restore" | "commit" | "reconcile" | "release";

type StateMutationClassification =
  | {
      readonly kind: "intentional-state";
      readonly boundaryId: StatePersistenceBoundaryId;
    }
  | {
      readonly kind: "unexpected-mutation";
      readonly issue: SandboxIsolationIssue;
    }
  | {
      readonly kind: "classification-unavailable";
      readonly reason: "observation-partial" | "observation-unavailable";
    };

type StateFailure =
  | {
      readonly _tag: "StateAcquireUnavailable";
      readonly target: StateRegionRef;
    }
  | {
      readonly _tag: "StateCohortNotFound";
      readonly identity: StateProviderIdentity;
    }
  | {
      readonly _tag: "StateCheckpointNotFound";
      readonly checkpoint: StateCheckpointRef;
    }
  | {
      readonly _tag: "StateIdentityMismatch";
      readonly expected: StateProviderIdentity;
      readonly received: StateProviderIdentity;
    }
  | {
      readonly _tag: "StateDigestMismatch";
      readonly checkpoint: StateCheckpointRef;
      readonly expected: StateContentDigest;
      readonly received: StateContentDigest | null;
    }
  | {
      readonly _tag: "StateConflict";
      readonly expectedPredecessor: StateCheckpointRef | null;
      readonly actualPredecessor: StateCheckpointRef | null;
    }
  | {
      readonly _tag: "StateLeaseLost";
      readonly target: StateRegionRef;
      readonly fence: FencingToken;
    }
  | {
      readonly _tag: "StateTransferFailed";
      readonly operation: "restore" | "commit" | "reconcile";
    }
  | {
      readonly _tag: "StateCommitIndeterminate";
      readonly commitId: StateCommitId;
      readonly expectedPredecessor: StateCheckpointRef | null;
      readonly fence: FencingToken;
    }
  | {
      readonly _tag: "StateTimeout";
      readonly operation: StateOperation;
    }
  | {
      readonly _tag: "StateInterrupted";
      readonly operation: StateOperation;
    };
```

`StateCommitId` 只由 Runner mint。相同 `commitId` 的重复提交必须回显同一份 accepted receipt，不能产生第二个
checkpoint。

`indeterminate` receipt 的唯一后续 API 是带同一 `commitId`、同一完整 `expectedPredecessor` 与同一 fence 的
`reconcile()`。它只能得到确定 committed、确定 not-committed，或 `StateCommitIndeterminate` failure；后两者都停止
execution，不能换 ID 重写。

`StateProvider` 不接收通用 JSON state payload；它在自己的 scoped lease 内捕获和写入它拥有的状态。

`StateMutationClassification` 由 Sandbox isolation 对实际 observation 与 provider-issued boundary 做纯分类。
它不是 State failure、Assertion 或 Verdict。任何 access、reset、cleanup、symlink、isolation 或 commit failure
保持自己的 typed owner；分类结果不能删除、改写或降级这些问题。
