# Reuse planning：从历史事实得到复用与缺口

Run 保存已发布 Attempt 与 slot binding。当前目标先逐位置判断是否有可用结果，再由本次运行选项决定哪些位置执行。
`gap` 属于当前目标与历史结果的关系，不是 Attempt 的状态；历史 Attempt 的 outcome、评分与证据不会随源码变化。

## 当前结果可用性与执行选择

当前目标由已发现的 Experiment、所选 Eval 与 Attempt ordinal 定义。新增位置立即进入分母；删除的 Experiment、Eval 或 ordinal
只留在历史读取范围。当前目标求值失败时返回具名错误，不把历史集合当作当前分母，也不返回伪造的 `0/0`。

当前适用性判断由 Experiment Host 拥有，使用同一份已求值输入与一个固定 `PublicationCutoff`：

| 当前位置 | 适用性 | 当前质量指标 | 默认执行选择 |
| --- | --- | --- | --- |
| 有符合输入与证据条件的 Attempt | `reuse` | 按 Pass 或 Score 规则计入 | 沿用 |
| 没有历史位置或 Member | `gap`，保留具体缺失原因 | 不计零分 | 执行 |
| 只有输入不同的旧 Attempt | `gap: identity-mismatch`，附旧 locator | 旧分数只在历史中显示 | 执行，或先审阅允许的采用 |
| 最近位置仍在运行 | `gap`，显示 pending | 不计零分 | 按 Coordination 的占用等待 |
| 历史执行出错、证据不完整或时长不合格 | `gap`，显示实际原因 | 不以旧分数补齐 | 执行 |

`show`、本机 View 的当前 Results 与 `project.get` 消费该适用性判断。它们不受 `--rerun`、`--keep-sandbox` 影响。
`exp --dry` 在同一判断上应用运行选项；例如一个已有可用结果的位置可以因 `--rerun all` 而执行，但其当前结果可用性仍然存在。
执行选择不得反向把一个可用结果标成当前缺口。

适用性求值不分配 Invocation、Run 或 Slot ID，不写 Record、不获取执行占用，不启动 Agent、Sandbox、setup 或 teardown。
Host 只求值项目声明；需要下载候选、准备资源或构建 image才能完成时，返回 `current-target-unavailable` 并提供固定历史读取入口。
项目模块的顶层代码属于用户代码，Host 不声称它是受隔离的纯函数；生命周期工作应留在正式运行阶段。

```text
ProjectTarget + published facts at cutoff
              ↓ current assessment
        reuse / gap per logical slot
              ↓ invocation options
        ExecutionReusePlan
          ├─ reuse ───────────────────┐
          └─ execute → scheduler → outcomes
                                      ↓
                  coordinator → slot publications → Run close
```

planner/scheduler 只接收计划的 `execute` 集合，其中既有当前缺口，也可能有明确要求重跑的已有可用结果的位置。
它不读取 Record、不重新计算 fingerprint，也不改变适用性判断。writer 只验证并写入事实，不重新判断资格。

## ExecutionTarget 的形成

当前目标先使用逻辑位置形成只读计划。只有正式执行或采用时，Invocation builder 才为每个目标 Run 和 slot
分配一次 opaque identity，绑定 `startedAt`，并形成不可变 `ExecutionTarget`。只读预览不需要这些持久身份。
source 选择固定在目标 Run 创建前的 cutoff；origin Run 仍为 `active` 不阻止已发布 Attempt 被读取。

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
  readonly version: 2;
}

interface CurrentTarget {
  readonly identity: string;
  readonly slots: readonly CurrentTargetSlot[];
}

type CurrentTargetSlot = Pick<TargetSlot,
  "experimentId" | "evalId" | "attempt" | "executionIdentityDigest" | "timeout">;

interface ProjectTargetPolicy {
  readonly identity: ExecutionPolicyIdentity;
  readonly rerun: "none" | "failed" | "all";
  readonly keepSandbox: boolean;
}

interface ExecutionReusePlan {
  readonly target: CurrentTarget;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: Readonly<JsonValue>;
  readonly slots: readonly ExecutionReusePlanSlot[];
  readonly reuse: readonly ReusePlanSlot[];
  readonly execute: readonly ExecutePlanSlot[];
}

interface ExecutionReusePlanSlotBase extends CurrentTargetSlot {
  readonly availability: "reuse" | "gap";
  readonly comparisons: readonly ExecutionComparison[];
}

interface ReusePlanSlot extends ExecutionReusePlanSlotBase {
  readonly state: "reuse";
  readonly availability: "reuse";
  readonly adoption: "carried";
  readonly attemptId: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly sourceBarrier: { readonly runId: string; readonly startedAt: UtcMillis };
}

interface ExecutePlanSlot extends ExecutionReusePlanSlotBase {
  readonly state: "execute";
  readonly reason: ExecutionGapReason;
  readonly scope: "slot" | "experiment" | "target";
  readonly issues: readonly RecordIssue[];
  readonly sourceBarrier?: { readonly runId: string; readonly startedAt?: UtcMillis };
}

type ExecutionReusePlanSlot = ReusePlanSlot | ExecutePlanSlot;
```

`slots` 与 target slots 一一对应，并保持 target 顺序。`reuse` 与 `execute` 是互斥、保序子序列。
`availability` 解释当前结果可用性，`state` 解释本次动作。`rerun-requested` 或 `sandbox-retention-requested`
可以使 `availability: reuse` 的位置进入 `state: execute`，不能改写它的当前适用性。

`effectiveOptions` 是 policy 实际使用的安全归一化值。它可以包含 rerun、keepSandbox 和 timeout 口径，不得包含 secret、进程变量值、`RecordReader`、文件路径、句柄或任意业务 Attachment 集合。

`comparisons` 逐项说明 Core 或固定 Attachment、被比较的真实 claim、结果和具名原因。它用于 dry-run 与诊断，只解释当前 plan；slot binding 只持久 Core Member action/reference，不能另建 comparison provenance 事实。

## project-target/v2 的 source barrier

对每个目标 `(experimentId, evalId, attemptOrdinal)`，只选择 cutoff 内包含该位置的最新 Run。
按 Run create 的 publication revision 排序，同一 publication 内以规范 `runId` bytes 打破并列；不按宿主时钟排序。
选择依据是 expected slot，
不要求已经有 Member，也不要求 Run 已终止。

该位置没有 Member、引用失效、Attempt 无 origin 锚，或核心及所需事实损坏，都会形成具名 gap；不得回扫同一位置的更旧 Run。
active 空位置显示 pending，终态空位置保留 absence reason。其它 ordinal 独立选择自己的最近位置，
因此只采用一个 ordinal 不会让未被这次采用选择的兄弟位置失去可用结果。

这个 barrier 是当前 policy，不是 Record 格式。A→B 后即使 B 失败，下一次也不会静默复用 A；
需要采用 A 时使用显式 locator。查询采用见证只验证候选 Member 的依据，不重新选择 source Attempt。

实际创建新 Run 后，即使输入相同，其 pending slot 也会成为该位置的新屏障，使旧结果不再计为当前可用结果。
仅运行 `--dry --rerun all` 不发布新 Run，所以不会产生这个变化。两种情况必须区分。

## 复用资格

一条 Attempt 必须同时通过以下条件，才能形成 `reuse/carried`：

| 条件 | 判断对象 | 不通过时的 gap reason |
|---|---|---|
| Core identity | source expected Slot 与当前目标的逻辑位置及 `executionIdentityDigest` 相同；origin 与 source 不同 identity 时按下文重验采用见证 | `identity-mismatch` |
| Attempt outcome | Core Attempt outcome 是 `completed` | `attempt-outcome-ineligible` |
| 质量结果 | Pass Eval 折叠为 `passed` 或 `failed`；Score Eval 有 complete 的 scored 结果，合法零分同样合格 | `verdict-ineligible` |
| timeout | `niceeval.runner-activities` 是 complete，且 timing projection 可证明连续 root window 与真实 duration 不超过当前 timeout | `source-attachment-*`、`duration-domain-mismatch` 或 `timeout-exceeded` |

Assertions 必须以 `RecordAttachmentRead.available` 取得 exact decoded payload，Runner Activities source 必须是
`complete`，才进入领域比较。其余读取状态都形成 gap，并保留原始 `RecordIssue` 或读状态。activity source
为 `partial`、`not-recorded` 或 `invalid`，缺少 root activity，或不能组成连续 root window 时同样 fail closed；
不会把 duration 伪造为 `0`。

`errored`、`cancelled`、`interrupted`、`skipped`、不存在和无法读取的 Attempt 都不能 reuse。
Score 的 partial 或 unavailable 不能作为完整结果沿用；`scored` 不转换成 Pass Verdict。
`runId` 是全局 Run identity，`slotId` 是 Run 内位置身份；两者都不要求与另一 Run 的目标相等。
跨 Run 的适用性比较使用逻辑位置与输入 identity。

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
`ExecutionReusePlan.execute`，并为实际开始的位置返回 executed outcome。Coordination 在派发前处理
execution claim（执行占用）、同一 Experiment 的 dispatch claim 和并发名额；这些 reserved / inflight
（已预留 / 正在运行）状态不成为持久事实。

coordinator 最后把 target、reuse intents 与 executed outcomes 交给各自的 slot publication：

- reuse 以 reference binding 引用已发布 Attempt，并保存 `carried` action；
- executed 位置以独立 transaction 发布新 Attempt closure、publication identity 与 origin binding；
- 未派发 slot 不伪造 Member。active Run 显示 `pending`；Run close 从闭集 absence reason 中选择并冻结对应原因。

coordinator 对每个 origin 或 reference slot 执行原子 binding transaction。它不能重新读取
Assertions 或 Runner Activities、改写 reason 或作第二次资格判断。收到 `SIGINT` 时保留已发布
Attempt，Run close 为其余 slot 写 `interrupted-before-publication`；不创建虚构 Member。

Core Member/reference 是 accepted 与 reused 的唯一持久复核路径：reference 给出 exact origin Attempt，action 给出 `carried` 或 `accepted`；执行或未派发也由 Core action 表达。executed outcome 关联新 attemptId。Record 不把当前 comparison 或 policy 另存为未来资格。

## ExplicitAdoptionPlan

`niceeval accept` 与 rename 使用独立的 explicit adoption planning。显式 locator 列表或一个 exact source Run
是 accept 的两种授权范围；普通 `project-target/v2` reuse planning 不能猜出 `accepted`。Run 授权先在同一 frozen reader
中展开为 immutable locator 集，再进入下方同一 Member planning，不把 Run selector 写成第二种 durable adoption 关系。

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
  readonly comparisons: readonly ExecutionComparison[];
}
```

explicit adoption planning 在写入前对全部 locator、Attempt、当前 Experiment/Eval、Core combined execution identity、timeout、Sandbox pair 和 target uniqueness 完成预检。它从 Core outcome 与 Assertions 折叠 Verdict，并要求 Runner Activities 能形成完整真实 timing；任一项失败都让整个 plan 失败并零业务写入，不能降级成 gap。成功后 writer 写 Core reference Member 和 `accepted` action；它不复制 Attempt 数据，也不改变 origin。

Run 授权还要求 source expected membership 与当前 target 在 Experiment、Eval 和 ordinal 上双向闭合。每个 source slot
必须有唯一 Member 与 exact Attempt，每个 current slot 必须恰好命中一次；source-only、target-only、missing、duplicate、
dangling 或 ineligible 都阻断整批。`--dry` 与正式执行共用该 plan，区别只在前者不进入 commit scope。

accepted 的唯一含义是“操作者当时明确采用这个 immutable Attempt identity”。它不是审批、签名或真实性声明。

## 显式采用的资格

显式采用仍要求当前目标存在、逻辑位置唯一、source Core 完整、质量结果合格且真实时长符合当前 timeout。
同 identity 的旧 locator 可以越过 source barrier 被明确选中；这不授权任何其它位置。
不同 identity 只有通过第一方有限规则才能采用，操作者确认不能替代规则所需证据。
实验改名使用 [`experiment-rename/v1`](rename.md#纯改名的有限等价)，从冻结计算原料重建 exact origin identity；镜像引用差异使用下面的 `sandbox-image-reference/v1`。

`sandbox-image-reference/v1` 只允许官方 Docker 单容器镜像引用发生以下变化：

1. 两端均是直接绑定官方 `dockerSandbox` 的静态调用，`source.type` 为 `image`；只有一个 image 字符串字面量不同。
   两个引用都显式固定相同 SHA-256 digest 与完整 platform。mutable tag、未声明 platform、包装调用或无法排除别名逃逸均不合格。
2. 该引用只用于这个 Experiment 的 Sandbox 配置。相关配置源码不能同时进入任务上传树、Eval 闭包或其它可观察输入。
   Eval、任务、判据、loader、transfer、Agent、Hook 与配置依赖的闭包必须由同一第一方 discovery 与捕获规则证明完整。
3. origin Run 的 Sources 与当前捕获除该字面量外完全一致；只列出相同文件名不证明闭包完整。
   必须能识别 origin 的 identity 算法域，并证明它与当前纯计算规则相同。
4. 在一次求值后冻结的输入图中还原旧 image 值与对应源码字节，纯计算所有受影响的派生 identity。
   完整重建值必须逐字等于 origin Core 的 execution digest。不得再次 import、执行定义函数、调用 Provider planner、读取进程变量或访问网络。

任一步缺失、不可解释或无法纯计算都返回 `accept-ineligible`。规则不扩展到任意 flags、模型、Judge、任务或分值变化，
也不宣称识别未纳入声明的外部服务暗变。新的差异种类必须由具名规则及其公开反例另行定义，不能按字段名称猜测。

预检展示实际 source locator、当前目标、完整安全差异、所用规则与阻断原因；不给被拒绝的候选输出成功采用建议。
`accept --dry` 与正式采用使用同一预检，只有后者发布 reference Member。Sources 仍保存源码事实，
不新增 eligibility family、不复制分数、不向历史 Record 补写判定输入。

## 采用后持续沿用

source expected slot 与当前目标 identity 相同后，还要验证它引用的 exact origin。
origin identity 相同时直接按普通资格检查；不同时必须有该 origin 与当前目标之间的有效 adopted Member：

- 见证 Member 的 action 为 `accepted`，其逻辑位置、target execution digest 与 exact origin ref 都匹配；
- 见证在当前 cutoff 内可读，其 Member publication 不晚于 source Member；source 自身为 accepted 时允许两者相同；
- 每次均从 exact origin 与当前冻结输入重新验证上面的有限规则，不能只信历史 action；
- Core、质量结果、timing 与当前 policy 的其它 gate 仍全部通过。

随后新 Run 可写 carried reference，仍引用同一 origin Attempt。下一次 carry 继续验证同一类见证，
不以 carried action 自证等价。查找见证不允许改选更旧 source；唯一见证被删除、不可读或规则不再成立时保留具名 gap。

当前目标再次改变时，旧见证不匹配新 digest，必须重新判断。部分采用只发布显式选择的位置；
未被选择的兄弟 ordinal 使用自己的 source barrier，既不被自动采用，也不被这次采用遮蔽。

这些规则属于 `project-target/v2`，不改变 Core reference/action 或 Sources 的持久形状。
已有宽松 accepted 仍可按原样读取；跨 identity 沿用须重新通过当前规则。无法证明的历史 Record保持可读，
不自动迁移、不改写或删除，也不因 policy 升级要求重建整个 Record。

## policy 演进

policy 可以改变当前 planner 的 source barrier、rerun 与 sandbox 行为，但不能靠额外 eligibility descriptor 认证旧 Attempt。新增 required gate 时，必须由已有 Core 或 Record catalog 中具名的 fixed Attachment owner 提供可审计事实；缺失、partial、unsupported 或 invalid 一律形成 gap。新 writer 不保留能让旧 policy 错误通过的 compatibility eligibility payload。

`--dry` 不建立 Invocation 或 Run。它在一个固定 `PublicationCutoff` 下运行同一份 reuse planning，
输出当前结果可用性、缺口、本次 reuse / execute 动作与真实 comparison。

## `--rerun`

| 写法 | 沿用动作 | 执行动作 |
|---|---|---|
| 不带 | 当前合格的 `passed`、`failed` 与完整 `scored` | 当前缺口 |
| `--rerun` / `--rerun failed` | 当前合格的 `passed` 与完整 `scored` | 当前缺口与所有 `failed` |
| `--rerun all` | 无 | 选中矩阵中的全部成员 |

`--rerun` 只作用于本次 policy options，不改 fingerprint，也不修改已有 Run。

当前结果可用性与 Invocation 完成度分别读取。early exit 或预算可以让本次目标按其规则完成而仍有缺口；
可用结果不足不构成绕过 early exit、预算或用户运行范围的授权。

## 并发 Invocation

多条 Invocation 可并发创建 Run。Run create 后立即可见，每个 origin/reference binding 各自取得 publication revision；已发布 Attempt 不等待 origin Run 收口就可成为 candidate。

执行去重、同一 Experiment 的 dispatch claim、`maxConcurrency` 和 build / lease 都属于 Coordination 的 ProjectDatabase rows，
不使用 `.niceeval/` 的 Record 外本地状态。`query`、`view` 与 `exp --dry` 在固定 cutoff 下读取；Run close 只冻结终态和 absence reasons。

## 相关阅读

- [Experiments Architecture](architecture.md) —— coordinator、planner 与 writer 的关系。
- [实验改名](rename.md) —— explicit adoption 怎样表达 Experiment 身份变化。
- [Run](../run/README.md) —— Attempt publication、slot binding 与持久引用。
- [Inspection](../inspection/README.md) —— 已发布 Attempt 怎样进入固定读取与比较。
