# Execution projection：从历史事实得到复用与缺口

Record 只保存已经发生的事实。是否复用、是否执行，以及局部执行哪些 slot，都由本次 execution projector 根据当前目标和 policy 决定。

```text
ProjectTarget + ExecutionTarget + RecordWriteSession.view + policy
                         ↓ project-target/v1
                  ExecutionProjection
                    ├─ reuse ───────────────┐
                    └─ gaps → planner → outcomes
                                             ↓
                         coordinator → sealed Run → publish
```

planner/scheduler 只接收 gaps。它不读取 Record、不重新计算 fingerprint，也不改变 reuse。writer 只验证并写入事实，不重新判断资格。

## ExecutionTarget 的形成

Invocation builder 先取得 `RecordWriteSession` 的 writer lock。它在 frozen `session.view` 读取历史前，为每个目标 Run 和 slot 分配一次 opaque identity，绑定 `startedAt`，并形成不可变 `ExecutionTarget`。

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
  readonly attempt: number;
  readonly inputIdentity: EqualityToken;
  readonly configIdentity: EqualityToken;
  readonly timeout?: DurationLimit;
}

interface DurationLimit {
  readonly domain: string;
  readonly milliseconds: number;
}

interface ComparisonProvenance {
  readonly fact: string;
  readonly sourceState: "read" | "missing" | "unavailable" | "unsupported" | "invalid";
  readonly result: "match" | "mismatch" | "ineligible" | "not-comparable";
  readonly reason: string;
}
```

target slot identity 不从历史 Attempt、fingerprint 或目录名派生。projector 不分配 identity；writer 必须原样写入 target 的 runId、slotId、startedAt 与 expected membership。

目标 Run 在 projection 完成前不得发布，所以不会成为自己的 source barrier。无法形成完整 target、出现重复 identity，或当前 ProjectTarget 缺少已求值 identity/policy 输入时，projection 整体失败。

## 公开执行投影

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

interface ExecutionProjection {
  readonly target: ExecutionTarget;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: Readonly<JsonValue>;
  readonly slots: readonly ExecutionProjectionSlot[];
  readonly reuse: readonly ReuseProjectionSlot[];
  readonly gaps: readonly GapProjectionSlot[];
}

interface ExecutionProjectionSlotBase extends TargetSlot {
  readonly comparisons: readonly ComparisonProvenance[];
}

interface ReuseProjectionSlot extends ExecutionProjectionSlotBase {
  readonly state: "reuse";
  readonly adoption: "carried";
  readonly attemptId: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly sourceBarrier: { readonly runId: string; readonly startedAt: UtcMillis };
}

interface GapProjectionSlot extends ExecutionProjectionSlotBase {
  readonly state: "gap";
  readonly reason: ExecutionGapReason;
  readonly scope: "slot" | "experiment" | "target";
  readonly issues: readonly RecordIssue[];
  readonly sourceBarrier?: { readonly runId: string; readonly startedAt?: UtcMillis };
}

type ExecutionProjectionSlot = ReuseProjectionSlot | GapProjectionSlot;
```

`slots` 与 target slots 一一对应，并保持 target 顺序。`reuse` 与 `gaps` 是互斥、保序子序列。所有 gap 都可执行；`invalid` 只属于 `AnalysisSample`，不进入 execution projection。

`effectiveOptions` 是 policy 实际使用的安全归一化值。它可以包含 rerun、keepSandbox 和 timeout 口径，不得包含 secret、进程变量值、`RecordReader`、文件路径、句柄或任意业务通道集合。

`comparisons` 逐项说明比较的事实名、domain、结果和具名原因。它用于 dry-run、actions 与诊断，只解释当时的 projection，不持续认证未来新发布的 Run 或 policy。

## project-target/v1 的 source barrier

对每个目标 `(experimentId, evalId)`，projector 只从 frozen candidateSet 选择一个 source Run：

1. 候选 Run 的 `experimentId` 相同，且 expected slots 中包含目标 `evalId`；Record 中只有完整发布且带 `completedAt` 的 Run。
2. 按 `(startedAt, runId)` 升序排列，时间相同以规范 `runId` bytes 打破并列，取最后一项。
3. source Run 一经选择，就是这个 Eval 全部 ordinal 的历史屏障。每个 ordinal 只检查该 Run 中相同 `(evalId, attempt)` 的 slot。
4. source Run 没有该 ordinal、没有 Member、引用失效、Attempt 无 origin 锚、核心或所需事实损坏，都会形成 gap。projector 禁止回扫更旧 Run。

这个 barrier 是 `project-target/v1` policy，不是 Record 格式。它让 A→B 后即使 B 失败，下一次也不会静默复用 A；需要采用 A 时使用显式 locator adoption。

## 复用资格

一条 Attempt 必须同时通过以下条件，才能形成 `reuse/carried`：

| 条件 | 判断对象 | 不通过时的 gap reason |
|---|---|---|
| forward fence | eligibility schema 受支持，`reuseContract` domain 被 policy 接受且 token 相等 | `source-fact-unsupported`、`reuse-contract-domain-mismatch` 或 `reuse-contract-mismatch` |
| 终态 | Verdict 是 `passed` 或 `failed` | `verdict-ineligible` |
| fingerprint | input/config identity 与当前 target 同 domain 且 value 相等 | `identity-mismatch` 或 `identity-domain-mismatch` |
| timeout | execution duration domain 可比且不超过当前 timeout | `duration-domain-mismatch` 或 `timeout-exceeded` |
| rerun | 本次档位允许采用该 Verdict | `rerun-requested` |
| keep sandbox | 本次没有要求保留新现场 | `sandbox-retention-requested` |

Verdict 与 eligibility 任一不是 read、durable complete、decoding complete，或 payload 不符合精确形状，也形成 gap，并保留原始 `RecordIssue` 或 `ChannelRead` 原因。`errored`、`skipped`、不存在和无法读取的 Attempt 都不能 reuse。

fingerprint/config identity 由上游已求值 ProjectTarget 提供。projector 只比较，不重新发现配置，也不计算另一份 identity。凭据不进入 identity 或 manifest；`judge.apiKeyEnv` 只表示读取凭据的位置。

## 错误与缺口作用域

`ExecutionGapReason` 是稳定、可穷尽的 reason code：

```ts
type ExecutionGapReason =
  | "no-source-run"
  | "source-slot-missing"
  | "source-member-missing"
  | "source-core-invalid"
  | "source-fact-unavailable"
  | "source-fact-unsupported"
  | "source-fact-invalid"
  | "reuse-contract-domain-mismatch"
  | "reuse-contract-mismatch"
  | "verdict-ineligible"
  | "identity-mismatch"
  | "identity-domain-mismatch"
  | "duration-domain-mismatch"
  | "timeout-exceeded"
  | "rerun-requested"
  | "sandbox-retention-requested";
```

作用域按可证明的最小范围确定：

- 单个 Member、Attempt、origin 或所需 channel 问题只让对应 slot gap；
- source Run 的 expected membership 或排序事实损坏，但仍能归到一个 Experiment 时，该 Experiment 的全部 target slots gap；
- 历史 Run 连 Experiment 归属都无法读取时，为避免误复用，全部 target slots gap。

历史损坏必须保留真实 reason 与 issues，不能改写成 `no-source-run`。三个作用域都禁止回扫更旧 Run。

Record root 无法打开，或 malformed candidate 连 Experiment 归属都无法安全取得时，结果是 projection-global failure。ExecutionTarget 无法验证、target identity 重复、当前 ProjectTarget 缺少已求值输入，或 policy name/version 不受支持时也一样。writer lock 与遗留 session 检查发生在 projector 之前；失败时不产生 projection 或可执行计划。

## coordinator、planner 与 writer

invocation coordinator 持有完整、不可变的 `ExecutionProjection`。planner/scheduler 只收到 `projection.gaps`，并为实际开始的 gap 返回 executed outcome。budget、early exit 或 interruption 后没有 outcome 的 gap 不写 Member。

coordinator 最后把 target、reuse intents 与 executed outcomes 一起交给 write session，形成一个完整 Run aggregate：

- `project-target/v1` 的 reuse 固定写 `carried` Member；
- 有 executed outcome 的 gap 固定写 `executed` Member 与新 Attempt；
- 没有 outcome 的 gap 不写 Member，之后的 `AnalysisSample` 将它呈现为事实性的 `not-recorded`。

write session 只验证核心形状、引用、target 关联和 action 关联，再 seal 并一次发布整个 Run。它不能重新读取 eligibility、改写 reason 或作第二次资格判断。

`niceeval.actions` 对每个 target slot 写一项最终 action。reuse 写 source barrier、attemptId、policy 与 comparisons；gap 写 reason、scope、issues，以及 `executed | not-dispatched | interrupted` outcome。

executed outcome 关联新 attemptId。这样未执行 slot 仍能解释当时计划，但 Record 不把 action 当成未来资格。

## ExplicitAdoptionProjection

`niceeval accept` 与 rename 使用独立的 explicit adoption projector。locator 列表是唯一授权范围；普通 project-target projector 不能猜出 `accepted`。

```ts
interface ExplicitAdoptionProjection {
  readonly intent: "accept" | "rename";
  readonly target: ExecutionTarget;
  readonly policy: { readonly name: "explicit-adoption"; readonly version: 1 };
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

projector 在写入前对全部 locator、Attempt、当前 Experiment/Eval、配置、timeout、Sandbox pair 和 target uniqueness 完成预检。任一项失败都让整个 projection 失败并零业务写入，不能降级成 gap。成功后 writer 固定写 accepted Member 和对应 action，不复制 Attempt 数据，也不改变 origin。

accepted 的唯一含义是“操作者当时明确采用这个 immutable Attempt identity”。它不是审批、签名或真实性声明。

## policy 演进

policy identity 由稳定 `name + version` 组成。policy schema、source barrier 语义或持久 gate 改变时升级 version；`effectiveOptions` 只表达同一版本的本次参数。它只解释当时 action，不能单独阻止旧 projector 采用未来 Attempt。

每个 projector 必须列出接受的 eligibility schema 与 `reuseContract.domain`。新增、删除或改变 gate 时至少切换 reuse domain；持久形状变化时再发布新的 eligibility schema。新 writer 不得同时留下一个旧 projector 能通过的 legacy eligibility descriptor。

例如 v1 projector 接受 `niceeval.eligibility/v1 + niceeval.reuse/base-v1`。未来新增 required human-review gate 后，writer 至少改用 `niceeval.reuse/human-review-v1`。旧 CLI 读取新 Attempt 时，在 required eligibility 上得到 schema unsupported 或 domain mismatch，结果必须是 gap；它不能因自己没有请求 human-review fact 而错误 carried。

policy identity、effective options、comparison provenance 与最终 slot action 写入目标 Run 的 `niceeval.actions`。这些值只解释当时为何 carried、accepted、executed 或未派发，不持续认证源 Attempt。

`--dry` 不建立 Invocation、不写 Record，也不取得 writer lock。它用 lock-free frozen reader 运行同一个 projector，并在 CLI 输出中显示相同的 policy identity、effective options、reuse、gap 与 provenance。

## `--rerun`

| 写法 | 可形成 reuse | 形成 gap |
|---|---|---|
| 不带 | `passed` 与 `failed` | `errored`、`skipped` 与缺失 ordinal |
| `--rerun` / `--rerun failed` | `passed` | 上述成员与所有 `failed` |
| `--rerun all` | 无 | 选中矩阵中的全部成员 |

`--rerun` 只作用于本次 policy options，不改 fingerprint，也不修改已有 Run。

## 并发 Invocation

同一 Record root 只允许一条写 Invocation。另一个 `exp` 立即得到 `record-writer-busy`，不能协作领取 Eval 或读取对方 local build；`show`、`view` 与 `exp --dry` 仍可并发读取已经发布的完整 Run。

需要并行两条写 Invocation 时必须指定不同 Record root。它们各自投影、执行和写入事实，不自动合并；完成后的分析范围由 analysis projector 另行形成。

## 相关阅读

- [Experiments Architecture](architecture.md) —— coordinator、planner 与 writer 的关系。
- [实验改名](rename.md) —— explicit adoption 怎样表达 Experiment 身份变化。
- [Record](../record/README.md) —— durable facts、local session 与持久引用。
- [Sample](../sample/README.md) —— 已落盘 Run 怎样形成 `AnalysisSample`。
