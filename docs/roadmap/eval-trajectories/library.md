# Eval Trajectory —— Library

Trajectory 从 `niceeval/trajectory` 导出，State identity 从 `niceeval/state` 导出。trajectory ID 不接受作者填写：
`trajectories/memory/recall/trajectory.ts` 的 exact ID 是 `memory/recall`。每个 `nodes` key 形成
`memory/recall/<key>`，因此改 key 是身份变更。

```ts
import { defineEvalTrajectory } from "niceeval/trajectory";

export default defineEvalTrajectory({
  state: trajectoryState,
  nodes: {
    seed: {
      eval: seedEval,
      dependsOn: [],
      persistence: { kind: "commit", checkpointFrom: "root" },
    },
    recall: {
      eval: recallEval,
      dependsOn: ["seed"],
      persistence: { kind: "commit", checkpointFrom: "seed" },
    },
    inspect: {
      eval: inspectEval,
      dependsOn: ["recall"],
      persistence: { kind: "read", checkpointFrom: "recall" },
    },
  },
});
```

`checkpointFrom` 必须是 `root` 或 `dependsOn` 中一项。`commit` node 才能成为另一条 node 的
`checkpointFrom`。一个 checkpoint predecessor 只能有一个 commit child。一个 trajectory execution 绑定一份
`StateRegionRef`；需要两条可写状态线时，定义两个 trajectory execution，Runner 不自动 merge state。

```ts
import type {
  Cohort,
  ComparableStateCheckpointRef,
  StateBinding,
  StateCheckpointRef,
  StateDebugReason,
  StateRegionRef,
} from "niceeval/state";

type TrajectoryNodeKey = string;

declare const TrajectoryIdTypeId: unique symbol;
declare const TrajectoryExecutionIdTypeId: unique symbol;
declare const TrajectoryNodeIdTypeId: unique symbol;
declare const TrajectorySlotIdTypeId: unique symbol;
declare const RunIdTypeId: unique symbol;

interface TrajectoryId {
  readonly [TrajectoryIdTypeId]: typeof TrajectoryIdTypeId;
}

interface TrajectoryExecutionId {
  readonly [TrajectoryExecutionIdTypeId]: typeof TrajectoryExecutionIdTypeId;
}

interface TrajectoryNodeId {
  readonly [TrajectoryNodeIdTypeId]: typeof TrajectoryNodeIdTypeId;
}

interface TrajectorySlotId {
  readonly [TrajectorySlotIdTypeId]: typeof TrajectorySlotIdTypeId;
}

interface RunId {
  readonly [RunIdTypeId]: typeof RunIdTypeId;
}

interface EvalTrajectoryInput<Nodes extends Record<TrajectoryNodeKey, TrajectoryNodeInput>> {
  readonly state: TrajectoryStateBinding;
  readonly nodes: Nodes;
}

interface TrajectoryStateBinding {
  readonly binding: StateBinding;
  readonly root: TrajectoryStateRoot;
}

interface TrajectoryNodeInput {
  readonly eval: EvalDefinition;
  readonly dependsOn: readonly TrajectoryNodeKey[];
  readonly persistence: TrajectoryNodePersistence;
}

type TrajectoryNodePersistence =
  | {
      readonly kind: "read";
      readonly checkpointFrom: "root" | TrajectoryNodeKey;
    }
  | {
      readonly kind: "commit";
      readonly checkpointFrom: "root" | TrajectoryNodeKey;
    };

interface ExpectedTrajectorySlot {
  readonly slotId: TrajectorySlotId;
  readonly nodeId: TrajectoryNodeId;
  readonly checkpointFrom: "root" | TrajectoryNodeId;
  readonly persistence: "read" | "commit";
}

interface TrajectoryFrontier {
  readonly completedNodeIds: readonly TrajectoryNodeId[];
  readonly readyNodeIds: readonly TrajectoryNodeId[];
  readonly pendingNodeIds: readonly TrajectoryNodeId[];
}

type NonEmptyReadonlyArray<A> = readonly [A, ...A[]];

type TrajectoryDebugReason =
  | StateDebugReason
  | "root-checkpoint-debug"
  | "resume-checkpoint-debug";

type ComparableTrajectoryState = {
  readonly comparability: "comparable";
  readonly debugReasons: readonly [];
};

type DebugTrajectoryState = {
  readonly comparability: "debug";
  readonly debugReasons: NonEmptyReadonlyArray<TrajectoryDebugReason>;
};

type TrajectoryStateRoot =
  | ({ readonly kind: "fresh" } & ComparableTrajectoryState)
  | ({
      readonly kind: "restore";
      readonly checkpoint: ComparableStateCheckpointRef;
    } & ComparableTrajectoryState)
  | ({
      readonly kind: "restore";
      readonly checkpoint: StateCheckpointRef;
    } & DebugTrajectoryState);

type ComparableResumeLocator = {
  readonly format: "niceeval-trajectory-resume/v1";
  readonly trajectoryId: TrajectoryId;
  readonly runId: RunId;
  readonly trajectoryExecutionId: TrajectoryExecutionId;
  readonly frontier: TrajectoryFrontier;
  readonly cohort: Cohort;
  readonly region: StateRegionRef;
  readonly checkpoint: ComparableStateCheckpointRef;
} & ComparableTrajectoryState;

type DebugResumeLocator = {
  readonly format: "niceeval-trajectory-resume/v1";
  readonly trajectoryId: TrajectoryId;
  readonly runId: RunId;
  readonly trajectoryExecutionId: TrajectoryExecutionId;
  readonly frontier: TrajectoryFrontier;
  readonly cohort: Cohort;
  readonly region: StateRegionRef;
  readonly checkpoint: StateCheckpointRef;
} & DebugTrajectoryState;

type ResumeLocator = ComparableResumeLocator | DebugResumeLocator;
```

`TrajectoryStateRoot` 和 `ResumeLocator` 的 checkpoint 始终是一份 exact `StateCheckpointRef`，而不是单独
checkpoint token。若 `comparability: "comparable"`，它的 `checkpoint.contentDigest` 必填、`debugReasons` 为空；
若为 `debug`，reasons 必须是非空的封闭 `TrajectoryDebugReason` 集合，checkpoint 可以没有 digest。Library 不接受
object literal 作为 resume 授权；locator 的文本形式只能由 CLI parser 生成或读取。

definition 允许声明 exact debug root，原因是 declaration 只描述 provider-issued state；是否执行它由 CLI 的
显式 `--debug` 决定。没有这个 flag 的 start / resume 在建立 Run 或 State lifecycle 前 fail closed。

## Definition 错误

| code | 条件 |
|---|---|
| `trajectory-id-invalid` | 路径不能派生一个 exact trajectory ID |
| `trajectory-node-key-invalid` | key 为空或不符合 node ID 语法 |
| `trajectory-dependency-missing` | `dependsOn` 指向不存在的 key |
| `trajectory-cycle` | 图中存在有向环 |
| `trajectory-checkpoint-parent` | `checkpointFrom` 不是 root 或已声明依赖 |
| `trajectory-checkpoint-noncommit` | child 从 read node 取得 checkpoint |
| `trajectory-state-fork` | 同一 predecessor 有两个 commit child |
| `trajectory-state-identity-invalid` | root checkpoint 与 `StateRegionRef` 的 provider / namespace / cohort / schema / region 不一致 |

这些错误在 discovery / link 结束，不建立 execution、不 acquire StateProvider、也不写 Run。debug root 不是 definition
错误；没有 `--debug` 而执行 debug root 才是 CLI 的 fail-closed error。
