# 结果携带与 Sandbox 复用反馈 —— Library

## Frozen plan 是唯一决定值

`ExecutionReusePlan` 是从公开 `niceeval` 导出的只读输出值。
应用代码不能构造、修改或持久化它；只有取得 frozen Record view 的 `project-target/v1` planner 可以形成它。
`RecordReader`、writer lock、路径和 Record handle 不进入公开形状。

`reuse` 与 `gaps` 不再作为独立数组存进计划。
调用方只从 `slots` 读取一次穷尽 union，并用纯筛选取得要执行的 Slot。
这样 action、历史 locator 和解释不会有平行决定点。

`AttemptLocator` 始终是完整 Attempt ID 的规范 `@` 形式。
planner 在读取 source Attempt 时生成它；CLI、writer 和 Report 不从 Run、slot 或短 ID 再次拼接。

```ts
interface ExecutionReusePlan {
  readonly target: ExecutionTarget;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: Readonly<JsonValue>;
  readonly slots: readonly ExecutionReusePlanSlot[];
}

interface ExecutionReusePlanSlotBase extends TargetSlot {
  readonly comparisons: readonly ComparisonProvenance[];
}

interface CarriedPlanSlot extends ExecutionReusePlanSlotBase {
  readonly action: "carried";
  readonly priorLocator: AttemptLocator;
  readonly origin: {
    readonly runId: RunId;
    readonly slotId: SlotId;
    readonly attemptId: AttemptId;
  };
  readonly sourceBarrier: {
    readonly runId: RunId;
    readonly startedAt: UtcMillis;
  };
  readonly explanation: {
    readonly kind: "eligible";
  };
}

interface ExecutePlanSlot extends ExecutionReusePlanSlotBase {
  readonly action: "execute";
  readonly priorLocator: AttemptLocator | null;
  readonly explanation: {
    readonly kind: "gap";
    readonly reason: ExecutionGapReason;
    readonly scope: "slot" | "experiment" | "target";
    readonly issues: readonly RecordIssue[];
    readonly sourceBarrier: {
      readonly runId: RunId;
      readonly startedAt?: UtcMillis;
    } | null;
  };
}

type ExecutionReusePlanSlot = CarriedPlanSlot | ExecutePlanSlot;

declare const executionGaps: (
  plan: ExecutionReusePlan,
) => readonly ExecutePlanSlot[];
```

`executionGaps()` 返回按 `plan.slots` 原顺序过滤出的只读 view。
它不打开 Record、不比较 identity，也不创建新的 gap explanation。

`priorLocator` 表示本次 source barrier 中实际找到并审查的 Attempt。
没有 source Run、source Slot、Member 或完整 Attempt 时值为 `null`。
`carried` 必定有 locator；`execute` 可以带被拒绝的历史 locator。

## writer 的唯一衔接

writer 接收 frozen plan 与执行 outcome。
它不会重算 action，也不会把 `execute` 改写为新的 planner 决定。
outcome 只说明一个已计划执行的 Slot 最后发生了什么。

```ts
type PlannedExecutionOutcome =
  | {
      readonly action: "carried";
      readonly planSlot: CarriedPlanSlot;
    }
  | {
      readonly action: "executed";
      readonly planSlot: ExecutePlanSlot;
      readonly attemptId: AttemptId;
    }
  | {
      readonly action: "not-dispatched" | "interrupted";
      readonly planSlot: ExecutePlanSlot;
    };

interface MembershipReuseProvenanceV2 {
  readonly slotId: SlotId;
  readonly plannedAction: "carried" | "execute";
  readonly priorLocator: AttemptLocator | null;
  readonly comparisons: readonly ComparisonProvenance[];
  readonly explanation:
    | CarriedPlanSlot["explanation"]
    | ExecutePlanSlot["explanation"];
  readonly outcome: PlannedExecutionOutcome["action"];
}
```

`MembershipReuseProvenanceV2` 是 plan slot 的冻结副本和一次 outcome 的连接。
它不是将来 reuse 的资格凭证。
新 Invocation 必须在新的 frozen view 上重新运行 planner。

`accepted` 继续由 `ExplicitAdoptionPlan` 拥有。
它不能伪装成 `carried`，也不能写进 `ExecutionReusePlan`。

## Sandbox 运行级汇总

`sandboxReuse` 是本次 Invocation 的进度值，不属于 frozen reuse plan。
每项固定关联一个 Experiment 和一个物理复用范围。

```ts
type SandboxReuseGroup =
  | { readonly kind: "experiment" }
  | { readonly kind: "eval-group"; readonly evalGroupId: string };

interface SandboxReuseSummary {
  readonly experimentId: ExperimentId;
  readonly group: SandboxReuseGroup;
  readonly active: number;
  readonly created: number;
  readonly assignments: number;
  readonly replacements: number;
}
```

`active` 是仍可承接 Attempt 的 Sandbox 数。
`created` 只计已进入复用池并承接首条 Attempt 的实例。
`assignments` 计已租借 Sandbox 的 Attempt，即使租借后的 prepare 失败或超时。
`replacements` 计实例退出后，为下一未开始 Slot 成功建立的替代实例。

carried、excluded 和 early-exit 未开始 Slot 不租借 Sandbox。
替代实例不会重新派发已经开始的 Attempt。

## 删除与迁移边界

采用本方向时删除以下平行路径：

- plan 上独立存储的 `reuse` 与 `gaps` 数组；
- 从 CLI reducer、writer 或 Report 重新读取 Record 来组织 reuse 理由的路径；
- 机器输出中的 `reused` 字段及其别名；
- 没有完整 `AttemptLocator` 的 prior Attempt 表示。

`niceeval.membership-provenance/v1` 通过相邻 migration 形成 v2。
converter 只转换自身已有的 action 与 source reference。
无法得到完整 locator、comparison 或 explanation 的旧 payload 保持 migration-unavailable，不能从当前 Record 或工作树补值。

## 生产入口验收

验收由真实项目的下列切片完成：

1. 先发布一个带可携带 Attempt 的 Run。
2. 执行 `niceeval exp <selector> --dry --json`，核对每个 Slot 的 union 与完整 locator。
3. 执行同一 `niceeval exp`，核对 sealed provenance 只复制 dry 的计划决定。
4. 用 `niceeval show --run <run-id>` 与 `niceeval view --run <run-id>` 查看同一说明。
5. 在同一 Record root 发起第二条写 Invocation，核对它得到 `record-writer-busy` 而没有混入局部计划。

这组验收不新增 Eval Assertion，也不以内部对象快照替代公开 CLI 行为。
