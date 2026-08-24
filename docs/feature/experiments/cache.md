# Reuse planning：从历史事实得到复用与缺口

Record 只保存已经发生的事实。是否复用、是否执行，以及局部执行哪些 slot，都由本次 reuse planning 根据当前目标和 policy 决定。

```text
ProjectTarget + ExecutionTarget + weak published-Run selection + policy
                              ↓ project-target/v1
                       ExecutionReusePlan
                         ├─ reuse ───────────────┐
                         └─ gaps → planner → outcomes
                                                  ↓
                              coordinator → sealed Run → publish
```

planner/scheduler 只接收 gaps。它不读取 Record、不重新计算 fingerprint，也不改变 reuse。writer 只验证并写入事实，不重新判断资格。

## ExecutionTarget 的形成

Invocation builder 为每个目标 Run 和 slot 分配一次 opaque identity，绑定 `startedAt`，并形成不可变
`ExecutionTarget`。它以 `RecordReadSession` 对已发布 Run 做 weak scan（弱扫描）；这不是全局 frozen
snapshot（冻结快照），并发创建 `complete` 的 Run 可以整体进入或整体不进入本次 plan。

随后每个目标 Run 由独立 `RunWriteSession` 写入自己的唯一 `RunId` directory。不存在全局 writer lock；
尚未发布的目录永远不是 reuse candidate。

```ts
interface ExecutionTarget {
  readonly invocationId: string;
  readonly runs: readonly TargetRun[];
}

interface TargetRun {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
  readonly slots: readonly TargetSlot[];
}

interface TargetSlot {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  /** Zero-based current attempt; copied to Core SlotIdentity.attemptOrdinal. */
  readonly attempt: number;
  readonly executionIdentityDigest: string;
  readonly timeout?: DurationLimit;
}

interface DurationLimit {
  readonly domain: string;
  readonly milliseconds: number;
}

type RecordedAttemptClaim =
  | "execution-identity"
  | "attempt-outcome"
  | "assertion-verdict"
  | "execution-duration";

interface ExecutionComparison {
  readonly attachment:
    | "core"
    | "niceeval.assertions"
    | "niceeval.runner-activities";
  readonly recordedClaim: RecordedAttemptClaim;
  readonly sourceState: string; // exact state returned by the relevant Core or fixed-Attachment reader
  readonly result: "match" | "mismatch" | "ineligible" | "not-comparable";
  readonly reason: string;
}
```

`attachment` 保存稳定的 fixed family（固定附件族）名称。numeric revision 只在对应的 envelope（信封）
`{ family, revision }` 中表达，不能拼进 family 名称。

当前 input/config/timeout 只在本次 target builder 内计算，最终以 Core expected slot 的组合
`executionIdentityDigest` 表达；历史 Attempt 不把同一 digest 伪装成两份 input/config identity。source outcome
由 Core Attempt 唯一拥有。Verdict 是 Core outcome 加 `niceeval.assertions` 的读时折叠；duration 只从
`niceeval.runner-activities` 的 reader-side timing projection 得到。

target slot identity 不从历史 Attempt、fingerprint 或目录名派生。reuse planning 不分配 identity；writer 必须原样写入 target 的 runId、slotId、startedAt 与 expected membership。
当前 target builder 将其 zero-based attempt number 直接写入该 expected Slot 的 durable `attemptOrdinal`；它不从
历史 Slot、Member、Attempt 或数组位置恢复。

目标 Run 在 reuse planning 完成前不得发布，所以不会成为自己的 source barrier。无法形成完整 target、出现重复 identity，或当前 ProjectTarget 缺少已求值 identity/policy 输入时，reuse planning 整体失败。

## 公开形状

```ts
interface ExecutionPolicyIdentity {
  readonly name: "project-target";
  readonly version: 1;
}

interface ProjectTargetPolicy {
  readonly identity: ExecutionPolicyIdentity;
  readonly rerun: "none" | "failed" | "all";
  readonly keepSandbox: boolean;
}

interface ExecutionReusePlan {
  readonly target: ExecutionTarget;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: Readonly<JsonValue>;
  readonly slots: readonly ExecutionReusePlanSlot[];
  readonly reuse: readonly ReusePlanSlot[];
  readonly gaps: readonly ExecutionGapSlot[];
}

interface ExecutionReusePlanSlotBase extends TargetSlot {
  readonly comparisons: readonly ComparisonProvenance[];
}

interface ReusePlanSlot extends ExecutionReusePlanSlotBase {
  readonly state: "reuse";
  readonly adoption: "carried";
  readonly attemptId: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly sourceBarrier: { readonly runId: string; readonly startedAt: UtcMillis };
}

interface ExecutionGapSlot extends ExecutionReusePlanSlotBase {
  readonly state: "gap";
  readonly reason: ExecutionGapReason;
  readonly scope: "slot" | "experiment" | "target";
  readonly issues: readonly RecordIssue[];
  readonly sourceBarrier?: { readonly runId: string; readonly startedAt?: UtcMillis };
}

type ExecutionReusePlanSlot = ReusePlanSlot | ExecutionGapSlot;
```

`slots` 与 target slots 一一对应，并保持 target 顺序。`reuse` 与 `gaps` 是互斥、保序子序列。所有 gap 都可执行；`invalid` 只属于 `Sample`，不进入 reuse planning。

`effectiveOptions` 是 policy 实际使用的安全归一化值。它可以包含 rerun、keepSandbox 和 timeout 口径，不得包含 secret、进程变量值、`RecordReader`、文件路径、句柄或任意业务 Attachment 集合。

`comparisons` 逐项说明 Core 或固定 Attachment、被比较的真实 claim、结果和具名原因。它用于 dry-run 与诊断，只解释当前 plan；Run seal 只持久 Core Member action/reference，不能另建 comparison provenance 的持久事实。

## project-target/v1 的 source barrier

对每个目标 `(experimentId, evalId)`，reuse planning 只从本次 weak scan 得到的 candidateSet 选择一个 source
Run。candidateSet 只固定这次计划的判断，不承诺同一时刻的全局 Record snapshot：

1. 候选 Run 的 `experimentId` 相同，且 expected slots 中包含目标 `evalId`；Record 中只有完整发布且带 `completedAt` 的 Run。
2. 按 `(startedAt, runId)` 升序排列，时间相同以规范 `runId` bytes 打破并列，取最后一项。
3. source Run 一经选择，就是这个 Eval 全部 ordinal 的历史屏障。每个 ordinal 只检查该 Run 中相同
   `(evalId, attemptOrdinal)` 的 Slot；不会按 SlotId、digest 或数组位置回扫。
4. source Run 没有该 ordinal、没有 Member、引用失效、Attempt 无 origin 锚、核心或所需事实损坏，都会形成 gap。reuse planning 禁止回扫更旧 Run。

这个 barrier 是 `project-target/v1` policy，不是 Record 格式。它让 A→B 后即使 B 失败，下一次也不会静默复用 A；需要采用 A 时使用显式 locator adoption。

## 复用资格

一条 Attempt 必须同时通过以下条件，才能形成 `reuse/carried`：

| 条件 | 判断对象 | 不通过时的 gap reason |
|---|---|---|
| Core identity | source expected Slot、origin Attempt 的 origin Slot 与当前 target Slot 的 slotId、evalId、attemptOrdinal、`executionIdentityDigest` 全等 | `identity-mismatch` |
| Attempt outcome | Core Attempt outcome 是 `completed` | `attempt-outcome-ineligible` |
| Verdict | Core outcome 与 sealed `niceeval.assertions` 折叠为 `passed` 或 `failed` | `verdict-ineligible` |
| timeout | `niceeval.runner-activities` 是 complete，且 timing projection 可证明连续 root window 与真实 duration 不超过当前 timeout | `source-attachment-*`、`duration-domain-mismatch` 或 `timeout-exceeded` |
| rerun | 本次档位允许采用该 Verdict | `rerun-requested` |
| keep sandbox | 本次没有要求保留新现场 | `sandbox-retention-requested` |

Assertions 必须以 `RecordAttachmentRead.available` 取得 exact decoded payload，Runner Activities source 必须是
`complete`，才进入领域比较。其余读取状态都形成 gap，并保留原始 `RecordIssue` 或读状态。activity source
为 `partial`、`not-recorded` 或 `invalid`，缺少 root activity，或不能组成连续 root window 时同样 fail closed；
不会把 duration 伪造为 `0`。

随后 Verdict 只能是 `passed` 或 `failed`。`errored`、`cancelled`、`interrupted`、`skipped`、不存在和无法读取的 Attempt 都不能 reuse。

fingerprint/config identity 由上游已求值 ProjectTarget 用来生成组合 execution identity；reuse planning 只比较 Core digest，不重新发现配置，也不把 digest 回填成两份 identity。凭据不进入 identity 或 manifest；`judge.apiKeyEnv` 只表示读取凭据的位置。`sharedState` 未声明时不在配置身份对象或 manifest 写键，因而保持既有 base config hash；声明、删除或变更 key 分别产生具名 `config:sharedState.key` added、removed、changed 差异。

## 错误与缺口作用域

`ExecutionGapReason` 是稳定的 reason code。它区分缺少 source Run、slot、Member 或 Core，以及不能读取固定事实。
固定事实的原因包括需要迁移、没有可用迁移、unsupported 或 invalid；其余类别包括实际 outcome、Verdict、duration、rerun 与 sandbox 条件。CLI 与 SDK 保留具体 code 和原始 issue。

作用域按可证明的最小范围确定：

- 单个 Member、Attempt、origin 或所需 Attachment 问题只让对应 slot gap；
- source Run 的 expected membership 或排序事实损坏，但仍能归到一个 Experiment 时，该 Experiment 的全部 target slots gap；
- 历史 Run 连 Experiment 归属都无法读取时，为避免误复用，全部 target slots gap。

历史损坏必须保留真实 reason 与 issues，不能改写成 `no-source-run`。三个作用域都禁止回扫更旧 Run。

Record root 无法打开，或 malformed candidate 连 Experiment 归属都无法安全取得时，结果是整个 reuse planning 失败。ExecutionTarget 无法验证、target identity 重复、当前 ProjectTarget 缺少已求值输入，或 policy name/version 不受支持时也一样。maintenance 正在排他操作时，read / append 也无法开始；这不是 writer-to-writer 冲突。失败时不产生 ExecutionReusePlan。

## coordinator、planner 与 writer

invocation coordinator 持有完整、不可变的 `ExecutionReusePlan`。planner/scheduler 只收到
`ExecutionReusePlan.gaps`，并为实际开始的 gap 返回 executed outcome。Coordination 在派发前处理
execution claim（执行占用）、同一 Experiment 的 dispatch claim 和并发名额；这些 reserved / inflight
（已预留 / 正在运行）状态不进入 Record。

coordinator 最后把 target、reuse intents 与 executed outcomes 一起交给 write session，形成一个完整 Run aggregate：

- `project-target/v1` 的 reuse 写 Core reference Member，并以 Core `carried` action 封口；
- 有 executed outcome 的 gap 写 Core origin Member 与新 Attempt，并以 Core `executed` action 封口；
- 正常停止派发且从未 reserved 的 gap 以 Core `not-dispatched` action 封口，之后的 `Sample` 将它呈现为事实性的 `not-recorded`。

write session 只验证 Core 形状、引用、target 关联和 action 关联，再 seal 并以本 Run 的 `complete` 一次发布整个 Run。它不能重新读取 Assertions 或 Runner Activities、改写 reason 或作第二次资格判断。

收到 `SIGINT` 时，含 reserved / inflight Attempt 的 Run 不得 seal；它保留为 incomplete directory（未发布不完整目录）。已经闭合的其它 Run 仍独立发布。正常、非中断收尾若发现 reserved / pending Attempt（已预留 / 待结算 Attempt），必须严格失败，不能写成 terminal Member 或发布该 Run。

Core Member/reference 是 accepted 与 reused 的唯一持久复核路径：reference 给出 exact origin Attempt，action 给出 `carried` 或 `accepted`；执行或未派发也由 Core action 表达。executed outcome 关联新 attemptId。Record 不把当前 comparison 或 policy 另存为未来资格。

## ExplicitAdoptionPlan

`niceeval accept` 与 rename 使用独立的 explicit adoption planning。locator 列表是唯一授权范围；普通 `project-target/v1` reuse planning 不能猜出 `accepted`。

```ts
interface ExplicitAdoptionPlan {
  readonly intent: "accept" | "rename";
  readonly target: ExecutionTarget;
  readonly members: readonly ExplicitAdoptionMember[];
}

interface ExplicitAdoptionMember extends TargetSlot {
  readonly adoption: "accepted";
  readonly attemptId: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly locator: string;
  readonly comparisons: readonly ComparisonProvenance[];
}
```

explicit adoption planning 在写入前对全部 locator、Attempt、当前 Experiment/Eval、Core combined execution identity、timeout、Sandbox pair 和 target uniqueness 完成预检。它从 Core outcome 与 Assertions 折叠 Verdict，并要求 Runner Activities 能形成完整真实 timing；任一项失败都让整个 plan 失败并零业务写入，不能降级成 gap。成功后 writer 写 Core reference Member 和 `accepted` action；它不复制 Attempt 数据，也不改变 origin。

accepted 的唯一含义是“操作者当时明确采用这个 immutable Attempt identity”。它不是审批、签名或真实性声明。

## policy 演进

policy 可以改变当前 planner 的 source barrier、rerun 与 sandbox 行为，但不能靠额外 eligibility descriptor 认证旧 Attempt。新增 required gate 时，必须由已有 Core 或 Record catalog 中具名的 fixed Attachment owner 提供可审计事实；缺失、partial、unsupported 或 invalid 一律形成 gap。新 writer 不保留能让旧 policy 错误通过的 compatibility eligibility payload。

`--dry` 不建立 Invocation、不写 Record，也不取得 append lease。它用 shared read lease（共享读取租约）做 weak scan，运行同一份 reuse planning，并在 CLI 输出中显示相同的当前 options、reuse、gap 与真实 comparison。它只看已发布 Run，不保证全局 snapshot。

## `--rerun`

| 写法 | 可形成 reuse | 形成 gap |
|---|---|---|
| 不带 | `passed` 与 `failed` | `errored`、`skipped` 与缺失 ordinal |
| `--rerun` / `--rerun failed` | `passed` | 上述成员与所有 `failed` |
| `--rerun all` | 无 | 选中矩阵中的全部成员 |

`--rerun` 只作用于本次 policy options，不改 fingerprint，也不修改已有 Run。

## 并发 Invocation

同一 Record root 支持多条写 Invocation 并发追加。每个 writer 只写自己唯一的 `RunId` directory；其它 writer
的未封口目录不参与 candidate selection。`complete` 是每个 Run 独立的原子发布点，而不是 Invocation 级提交。

执行去重、同一 Experiment 的 dispatch claim、`maxConcurrency` 和 build / lease 都属于 Coordination 的
`.niceeval/` 本地状态，不属于 Record。`show`、`view` 与 `exp --dry` 只惰性读取已发布 Run，weak scan 不保证全局快照。只有 `clean` / `migrate` 的 maintenance lease 仍排他。

## 相关阅读

- [Experiments Architecture](architecture.md) —— coordinator、planner 与 writer 的关系。
- [实验改名](rename.md) —— explicit adoption 怎样表达 Experiment 身份变化。
- [Record](../record/README.md) —— 持久事实、write session 与持久引用。
- [Sample](../sample/README.md) —— 已落盘 Run 怎样形成 `Sample`。
