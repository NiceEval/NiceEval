# Eval Trajectory —— Architecture

## 数据关系

```text
trajectory definition (path-derived exact TrajectoryId)
  └─ explicit DAG of node IDs and expected slots
      └─ trajectory execution (State cohort + region identity)
          └─ immutable segment Run (RunId)
              ├─ complete expectedNodeIds / expectedSlots
              ├─ executed node outcomes
              ├─ resumed-prefix provenance
              └─ frontier + optional exact resume locator
```

一个 segment Run 是 immutable 的完整边界。start、planned breakpoint、受控 interruption 或 resume 都建立新的 Run；
它们不修改先前 Run，也不把后续 node 追加到旧 Run。

```ts
interface TrajectoryRunReceiptV1 {
  readonly schema: "niceeval.trajectory/v1";
  readonly runId: RunId;
  readonly trajectoryId: TrajectoryId;
  readonly trajectoryExecutionId: TrajectoryExecutionId;
  readonly segment: "started" | "resumed";
  readonly cohort: Cohort;
  readonly region: StateRegionRef;
  readonly rootCheckpoint: StateCheckpointRef | null;
  readonly expectedNodeIds: readonly TrajectoryNodeId[];
  readonly expectedSlots: readonly ExpectedTrajectorySlot[];
  readonly comparability:
    | { readonly kind: "comparable" }
    | {
        readonly kind: "debug";
        readonly reasons: NonEmptyReadonlyArray<TrajectoryDebugReason>;
      };
  readonly nodes: readonly TrajectoryNodeReceipt[];
  readonly frontier: TrajectoryFrontier;
  readonly handoff: TrajectoryHandoff | null;
  readonly terminal: "completed" | "paused" | "interrupted" | "blocked";
}

type TrajectoryHandoff =
  | {
      readonly cause: "planned-breakpoint";
      readonly comparability: "comparable";
      readonly debugReasons: readonly [];
      readonly resumeLocator: ComparableResumeLocator;
    }
  | {
      readonly cause: "controlled-interruption";
      readonly comparability: "comparable";
      readonly debugReasons: readonly [];
      readonly resumeLocator: ComparableResumeLocator;
    }
  | {
      readonly cause: "planned-breakpoint";
      readonly comparability: "debug";
      readonly debugReasons: NonEmptyReadonlyArray<TrajectoryDebugReason>;
      readonly resumeLocator: DebugResumeLocator;
    }
  | {
      readonly cause: "controlled-interruption";
      readonly comparability: "debug";
      readonly debugReasons: NonEmptyReadonlyArray<TrajectoryDebugReason>;
      readonly resumeLocator: DebugResumeLocator;
    };

type TrajectoryNodeReceipt =
  | {
      readonly provenance: "executed";
      readonly nodeId: TrajectoryNodeId;
      readonly verdict: "passed" | "failed";
      readonly advance: "allowed";
      readonly state: Extract<StateCommitReceipt, { readonly fencing: "accepted" }> | null;
    }
  | {
      readonly provenance: "executed";
      readonly nodeId: TrajectoryNodeId;
      readonly verdict: "errored" | null;
      readonly advance: "stopped";
      readonly reason:
        | "errored"
        | "dirty"
        | "cleanup-failed"
        | "isolation-failed"
        | "commit-indeterminate";
    }
  | {
      readonly provenance: "resumed-prefix";
      readonly nodeId: TrajectoryNodeId;
      readonly sourceRunId: RunId;
      readonly sourceExecutionId: TrajectoryExecutionId;
      readonly resumeLocator: ResumeLocator;
    };
```

`expectedNodeIds` 在 receipt 中持久化整条 definition 的 exact node set。`expectedSlots` 持久化每个 node 的 exact
execution slot、checkpoint edge 与 persistence role。它们不由 `nodes` 或 frontier 反推，因而 receipt 可以审计
未开始、暂停及 resumed-prefix 的完整边界。

`resumed-prefix` 是专用 provenance。它不使用 `carried`，不运行 reuse planning，也不声称旧 node 再次执行。

## DAG 与 state predecessor

`dependsOn` 表达业务依赖。`checkpointFrom` 表达一个 node 要 restore 的 exact `StateCheckpointRef`；两者都是作者
显式写出的边。一个 node 可以依赖多条业务边，但它只有一条 checkpoint edge，因此没有隐式 merge。

commit node 的 accepted receipt 提供 child 的 exact checkpoint ref。read node 不产生 checkpoint。相同 predecessor
不能有两个 commit child；一份 trajectory execution 只有一条可写状态线。需要两条可写状态线时，定义两个 trajectory
execution；Runner 不自动 merge 它们。

## Comparability 与 debug handoff

Trajectory execution 从 State root 的 comparability 开始。任一 acquire、restore、commit 或 receipt 进入 debug 后，
segment 和所有后续 segment 都保持 debug，绝不恢复为 comparable。

普通 start / resume 见到 debug root、debug locator 或运行中 State downgrade 时 fail closed。只有命令显式带
`--debug` 时，Runner 才能从 locator 绑定的 exact debug `StateCheckpointRef` restore，并把封闭
`TrajectoryDebugReason` 写入 Run receipt 和 handoff。`--debug` 不会把 comparable execution 人为降级；它只授权
接受已经发生的 debug state。

built-in comparison 必须拒绝 debug Run，也拒绝把它与 comparable Run 混入同一比较集合。`niceeval view --run <RunId>`
仍可显式读取任意 sealed debug receipt；查看不是比较，也不改变 comparability。

## Resume

Runner 只在 `paused` 或受控 `interrupted` segment 的已开始 node 都允许前进时生成 `ResumeLocator`。locator 同时校验
exact trajectory ID、旧 `RunId`、execution ID、frontier、Cohort、`StateRegionRef`、exact checkpoint 及其
comparability / debug reasons。任一字段不同都拒绝 resume，零 State restore、零 Run 写入。

resume 建立一个 `segment: "resumed"` Run。旧 Run 已完成的 node 以 `resumed-prefix` 放入新 Run，只有 frontier
后的 node 才可执行。这个专用 provenance 让读取者区分路径交接和普通历史结果沿用。

## 不变量

- trajectory 和 node identity 都来自路径或 key，不来自数组位置。
- 每条 dependency 与 checkpoint edge 都显式且无环。
- 每段发布新 immutable Run，receipt 保留 complete expected node IDs 和 expected slots。
- `passed` 与 `failed` 可以满足依赖；其余列出的阻断终态不能满足依赖。
- handoff 必须绑定 exact trajectory ID、Run ID、Cohort、Region 与 exact checkpoint。
- debug 可由显式 `--debug` handoff，但永不进入 built-in comparison。
- Eval Group 不参与 DAG、frontier、checkpoint 或 provenance。
- receipt 是审计单源；显示层不能向外部状态系统补查。

## 迁移边界

旧有“下一条 Eval”“组内后继”“恢复一条 Run”语法没有兼容分支。迁入路径必须声明 node key、DAG 边和
checkpoint edge；历史完整前缀只能通过一个已验证 ResumeLocator 进入 `resumed-prefix`。隐式接受 debug 状态的
恢复路径被移除，必须由显式 `--debug` 授权。
