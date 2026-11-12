# Reuse planning：从历史事实得到复用与缺口

Run 保存已发布 Attempt 与 Planned attempt binding。当前目标先逐位置判断是否有可用结果，再由本次运行选项决定哪些位置执行。
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
| 绑定 State 的位置 | `gap: stateful-input` | 历史分数只在固定 Run 中显示 | 真实执行，仍受预算与取消约束 |
| 最近位置仍在运行 | `gap`，显示 pending | 不计零分 | 按 Coordination 的占用等待 |
| 历史执行出错、证据不完整或时长不合格 | `gap`，显示实际原因 | 不以旧分数补齐 | 执行 |

`show`、本机 View 的当前 Results 与 `project.get` 消费该适用性判断。它们不受 `--rerun`、`--keep-sandbox` 影响。
`exp --dry` 在同一判断上应用运行选项；例如一个已有可用结果的位置可以因 `--rerun all` 而执行，但其当前结果可用性仍然存在。
执行选择不得反向把一个可用结果标成当前缺口。

适用性求值不分配 Invocation、Run 或 Planned attempt ID，不写 Record、不获取执行占用，不启动 Agent、Sandbox、before 或 after。
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

当前目标先使用逻辑位置形成只读计划。只有正式执行或采用时，Invocation builder 才为每个目标 Run 和 Planned attempt
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
  readonly explanation?: IdentityExplanation; // execution-identity 不相等或经身份域变更相等时存在，见「差异说明」
}
```

`attachment` 保存稳定的 fixed family（固定附件族）名称。numeric revision 只在对应的 envelope（信封）
`{ family, revision }` 中表达，不能拼进 family 名称。

当前 input/config/timeout 只在本次 target builder 内计算，最终以 Core expected Planned attempt 的组合
`executionIdentityDigest` 表达。历史 Attempt 不把同一 digest 伪装成两份 input/config identity。source outcome
由 Core Attempt 唯一拥有。Verdict 是 Core outcome 加 `niceeval.assertions` 的读时折叠；duration 只从
`niceeval.runner-activities` 的 reader-side timing projection 得到。

target Planned attempt identity 不从历史 Attempt、fingerprint 或目录名派生。reuse planning 不分配 identity；writer 必须原样写入 target 的 `runId`、`slotId`、`startedAt` 与 expected membership。
当前 target builder 将其 zero-based attempt number 直接写入该 expected Planned attempt 的 durable `attemptOrdinal`；它不从
历史 Planned attempt、Member、Attempt 或数组位置恢复。

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

`slots` 与 target Planned attempts 一一对应，并保持 target 顺序。`reuse` 与 `execute` 是互斥、保序子序列。
`availability` 解释当前结果可用性，`state` 解释本次动作。`rerun-requested` 或 `sandbox-retention-requested`
可以使 `availability: reuse` 的位置进入 `state: execute`，不能改写它的当前适用性。

`effectiveOptions` 是 policy 实际使用的安全归一化值。它可以包含 rerun、keepSandbox 和 timeout 口径，不得包含 secret、进程变量值、`RecordReader`、文件路径、句柄或任意业务 Attachment 集合。

`comparisons` 逐项说明 Core 或固定 Attachment、被比较的真实 claim、结果和具名原因。它用于 dry-run 与诊断，只解释当前 plan；Planned attempt binding 只持久 Core Member action/reference，不能另建 comparison provenance 事实。

## project-target/v2 的 source barrier

对每个目标 `(experimentId, evalId, attemptOrdinal)`，只选择 cutoff 内包含该位置且未标记删除的最新 Run。
按 Run create 的 publication revision 排序，同一 publication 内以规范 `runId` bytes 打破并列；不按宿主时钟排序。
选择依据是 expected Planned attempt，
不要求已经有 Member，也不要求 Run 已终止。

通过 `niceeval run delete` 标记删除的 Run 不进入 source barrier 候选范围。
当某次试跑因中断、取消或配置错误被回收删除后，该位置的 source barrier 自动退回至更早未被删除的最新 Run，恢复历史合格 Attempt 的沿用资格（见 [RUN-11](../../../user-story.md#周芷宁修复后只重跑真正需要复验的部分)）。

该位置没有 Member、引用失效、Attempt 无 origin 锚，或核心及所需事实损坏，都会形成具名 gap；不得回扫同一位置的更旧 Run。
active 空位置显示 pending，终态空位置保留 absence reason。其它 ordinal 独立选择自己的最近位置，
因此只采用一个 ordinal 不会让未被这次采用选择的兄弟位置失去可用结果。

这个 barrier 是当前 policy，不是 Record 格式。A→B 后即使 B 失败，下一次也不会静默复用 A；
需要采用 A 时使用显式 locator。查询采用见证只验证候选 Member 的依据，不重新选择 source Attempt。

实际创建新 Run 后，即使输入相同，其 pending Planned attempt 也会成为该位置的新屏障，使旧结果不再计为当前可用结果。
仅运行 `--dry --rerun all` 不发布新 Run，所以不会产生这个变化。两种情况必须区分。

## 复用资格

一条 Attempt 必须同时通过以下条件，才能形成 `reuse/carried`：

| 条件 | 判断对象 | 不通过时的 gap reason |
|---|---|---|
| Core identity | source expected Planned attempt 与当前目标的逻辑位置及 `executionIdentityDigest` 相同，或经 `encoding-only` [身份域变更](#niceeval-身份域变更) 重建后逐字相等；origin 与 source 不同 identity 时按下文重验采用见证 | `identity-mismatch` |
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

fingerprint/config identity 由上游已求值 ProjectTarget 用来生成组合 execution identity；reuse planning 只比较 Core digest，不重新发现配置，也不把 digest 回填成两份 identity。凭据不进入 identity 或 manifest；Judge Provider 的 `apiKeyEnv` 只表示读取凭据的位置。`sharedState` 未声明时不在配置身份对象或 manifest 写键，因而保持既有 base config hash；声明、删除或变更 key 分别产生具名 `config:sharedState.key` added、removed、changed 差异。

自动 `carried` 只沿用同一逻辑位置最新 source barrier 中、通过全部资格条件的 Attempt。
Eval sourceClosure、已登记的 Judge 数据或该配对的有效 Judge 配置变化，都会改变 execution identity 并形成 `identity-mismatch`。
Judge 的运行时 version/config 摘要只解释已完成的评价，不能证明尚未执行的定义未变。
未捕获的宿主条件改变时，必须用 `--rerun all` 重验选中范围；不带范围的 `--rerun` 不足以替代它。

## 外部 Eval 的身份与携带

[挂载](../../eval/library/sharing.md) 不增加专用 cache。ProjectTarget 按每条 Eval 的运行输入形成 identity，再交给既有组合 execution identity 与 source barrier 比较。
输入包括已求值配置、项目内 Eval id、源码闭包、可达 bare dependency、NiceEval runtime revision、loader 数据、Sandbox 身份、可重验 transfer 输入与 Eval 的运行字段。

package 的 name、version、repository、安装 commit 与 lockDigest 是审计事实，不是整套题的失效键。
root 用于定位输入，挂载前缀则通过最终 Eval id 影响逻辑身份；改变前缀形成新的项目内结果身份。
不能因为 package version 未变而忽略实际 dependency 变化，也不能因 package commit 改变而作废所有未受影响的题。

| 变化 | 身份影响 |
| --- | --- |
| 单题源码、Fixture、判据或 Sandbox 输入 | 只影响引用这些输入的 Eval |
| 项目内共享模块或其登记数据 | 影响模块 DAG 中可达它的 Eval |
| bare dependency | 影响实际可达该 locator/content identity 的 Eval |
| workspace/file/link 内容但 lockfile 未改 | 按实际内容摘要影响可达 Eval |
| NiceEval runtime contract revision | 进入 Eval 身份，不能只保存消费 package 的展示版本 |
| 无关说明、上游配置、Experiment 或未引用文件 | 不改变 Eval 指纹 |

模块 DAG 与数据投影由 [Eval 装载](../../eval/architecture.md#模块与数据投影) 拥有。
无法完备查明的动态 import、非字面量 CJS require 或运行期依赖使对应 Eval 失去自动携带资格，不能只提醒用户手工重跑。
随机 Sandbox 输入仍进入身份；框架不能猜测某个 env value 只是命名而将它排除。
这类 Eval 可以原样运行，但跨进程保守重跑。

### transfer 输入

发现期从真实模块图与语法树建立 transfer plan。
可静态求值的 folder-local string 或 `new URL(..., import.meta.url)` 在计划期展开并计算内容摘要。
非字面量路径或依赖运行期分支的传输，使对应 Eval 不可自动携带。

普通 `uploadFile` / `uploadDirectory` 无需改写为共享 API。
执行时通用 Sandbox wrapper 保存 owner-relative 文件集合、内容摘要、Sandbox 目标与 send 区间，形成 [transfer manifest](../../../concepts.md#transfer-manifest)，并核对实际 transfer 与静态 plan。

后续计划必须同时证明定义输入未变、transfer plan 能在 owner 内完整重算且实际清单与 plan 一致。
内容、文件增删或匹配集变化都产生重跑；历史执行清单只提供审计与一致性证据，不能单独把任意动态路径变成安全 cache key。
源码闭包变化后，旧依赖集合不证明完整性，须执行并产生新的清单。

### definition 与 execution origin

Record 对已知外部 Eval 保存本轮 `definitionOrigin`，包含 [ExternalEvalOrigin](../../eval/library/sharing.md#安装身份) 的精确安装身份。
fresh Attempt 的 `executionOrigin` 来自实际执行它的定义；携带时仍引用原 Attempt，不改写其 origin 或复制结果事实。

新 Run 的 definition origin 可以指向新 commit，而 execution origin 沿原 Attempt 的精确引用保持旧 commit。
读取面必须能区分这两者，并保留原 locator 与携带链；不能把“本轮定义来自新 package”显示成“旧结果由新 package 执行”。
provenance 可去重保存，但去重不改变 owner 与不可变性，也不在每个 artifact 重复整份身份。
所有公开投影去除凭据、宿主绝对路径与本地 cache 路径。

项目 package lock 负责安装选择；逐 Eval manifest 只读投影文件、可达 dependency、runtime revision 与 transfer 输入。
它不能重新安装 package 或反向改写 lockfile，也不成为第二份资格事实。

## 差异说明

digest 回答“是否相同”，identity manifest 回答“哪里不同”。
同一次指纹计算为每个 `Eval × Experiment` 产出一份 identity manifest：身份各部分的 domain 版本，
以及已求值配置、physical plan、Plugin、源码闭包与受管数据的条目。源码与数据只记内容哈希，凭据不进入 manifest。

Run 创建时把本 Run 全部 Eval 的 identity manifest 写入 Run 级固定 attachment `niceeval.identity-manifests`，
写入后不可变。accept 与 rename 建立的 reference Run 同样写入当前目标的 manifest。
它只解释差异与识别 domain，不参与 digest 相等判断，也不成为第二份资格事实。

```ts
// family niceeval.identity-manifests，owner Run，revision 1
interface IdentityManifestsAttachment {
  readonly entries: readonly IdentityManifestEntry[]; // 按 evalId 排序且唯一
}

interface IdentityManifestEntry {
  readonly evalId: string;
  readonly domains: IdentityDomains;
  readonly config: Readonly<Record<string, JsonValue>>; // config identity 的展开路径与值
  readonly plan?: JsonValue;                            // pair link 与 Provider physical plan
  readonly plugins?: Readonly<Record<string, JsonValue>>;
  readonly source: Readonly<Record<string, string>>;    // owner 相对逻辑路径 → sha256，不含宿主绝对路径
  readonly data: Readonly<Record<string, string>>;      // 受管数据路径 → sha256
}

interface IdentityDomains {
  readonly fingerprintAlgorithm: number;
  readonly fingerprintCoverage: number;
  readonly inputIdentity: number;  // niceeval.input/fingerprint-v<n>
  readonly configIdentity: number; // niceeval.config/identity-v<n>
  readonly slotInput: number;      // 组合 slot 输入的 version
}
```

没有该 attachment 的历史 Run 只能部分解释。比较只使用已持久化的事实：Run context 的 adapter、model、reasoningEffort、
flags 与 Plugin identity，以及 Sources 中与当前源码闭包同路径文件的 sha256。结果为 `unexplained`，code `identity-manifest-missing`，
`observedDeltas` 列出这些可比较差异，`limitations` 写明 plan、受管数据、其余配置与 domain 无法比较。
这类结果不能经身份域变更沿用，因为 origin 的 domain 不可知。

`recordedClaim` 为 `execution-identity` 且 `result` 为 `mismatch` 的 `ExecutionComparison` 必须带 `explanation`。
`identity-mismatch` 与 `adoption-unproven` 因此总能说明差在哪里，不只给出 reason code。
普通缺口比较当前目标与 source expected Planned attempt。source 已与当前一致而 exact origin 不同时，比较当前目标与 origin Run；
多跳 carried 链同样直达 exact origin，不比较中间的 reference Run。

```ts
type IdentityExplanation =
  | { readonly kind: "match"; readonly via: readonly [string, ...string[]] } // 经身份域变更重建相等，via 为变更名
  | { readonly kind: "changed"; readonly deltas: readonly [IdentityDelta, ...IdentityDelta[]] }
  | { readonly kind: "unexplained"; readonly diagnostic: IdentityDiagnostic };

interface IdentityDelta {
  // config:<path> | plan:physical | plugins:<id> | source:<path> | data:<path> | opaque:no-manifest
  readonly selector: string;
  readonly kind: "added" | "removed" | "changed" | "unknown";
  readonly from?: string; // 配置值或内容哈希的有界摘要
  readonly to?: string;
}

interface IdentityDiagnostic {
  readonly code: string;     // producer 命名空间内的开放 code
  readonly summary: string;  // 不依赖 code 即可读懂的单句
  readonly facts?: readonly ({ label: string; value: JsonValue } | { label: string; from: JsonValue; to: JsonValue })[];
  readonly observedDeltas?: readonly IdentityDelta[]; // 省略=不可比较，[]=无差异，非空=观察到的差异
  readonly limitations?: readonly string[];
  readonly causes?: readonly IdentityDiagnostic[];
}
```

- `match` 只用于经[身份域变更](#niceeval-身份域变更)重建后相等的沿用；digest 直接相等时不带 explanation。
- `changed` 只在两端 manifest 版本相同且至少有一条具名差异时成立。
- 历史缺少 manifest、两端版本不同，或无法比较时为 `unexplained`；空差异不能读成“已证明等价”。
- 两端版本相同、digest 不同而可比字段没有差异时，code 为 `unversioned-identity-change`。
  这表示 NiceEval 改变了身份计算却没有更换版本，属于 NiceEval 缺陷，不归因于用户输入。

Human `--dry` 在原因后列出 selector 与有界值，例如 `will run — configuration changed: config:judge.model (gpt-5.6 → gpt-5.6-sol)`；
`unexplained` 显示诊断摘要与 facts。`--dry --json`、`project.get` 与 `accept --dry` 输出同一结构，不各自相减或降级成没有语义的文案。

结构化值的有界摘要不是完整 JSON 时，Human 用两侧摘要的短 SHA-256 区分可观察内容，明确标为摘要哈希，不称为执行身份 digest。
若两份不完整摘要相同，Human 只说明一次无法比较及原因，不在箭头两侧重复相同占位文本。
摘要缺口不改变沿用资格，也不要求改写历史 manifest。

## NiceEval 身份域变更

身份由 NiceEval 计算的部分和 owner 声明的部分组成，两者各有自己的 domain。origin 的 domain 一律从它的 identity manifest 读取：

| 部分 | domain 的载体 |
|---|---|
| Eval input 的指纹算法、纳入的输入集合与外层编码 | `domains.fingerprintAlgorithm`、`fingerprintCoverage` 与 `inputIdentity` |
| config identity 的配方与组合 slot 输入 | `domains.configIdentity` 与 `slotInput` |
| Provider、Agent installer 等 owner 声明的 identity | owner 写入已求值配置的 domain 值，即 manifest 的某条 `config:` 条目，见 [Agent ensure](../../adapters/architecture/agent-ensure.md) |

NiceEval 对身份稳定性作以下承诺：

1. 同一 domain 内，相同用户输入总得到相同 digest。改变任一部分的计算方式、纳入哪些输入或规范化，都必须更换该部分的 domain。
2. 新增身份字段取默认值且行为与旧版本相同时不写键，保持既有 digest；`sharedState` 是这条规则的实例。
   只有用户显式选择了新行为，才产生具名 `config:` 差异。
3. 每次更换 domain，都在随包发布的第一方 registry 中登记一条具名变更：

```ts
type IdentityDomainChange =
  | {
      readonly kind: "core";
      readonly name: string; // 例如 "fingerprint-algorithm/3-to-4"
      readonly revision: keyof IdentityDomains;
      readonly from: number;
      readonly to: number;
      readonly effect: IdentityChangeEffect;
      readonly summary: string;
    }
  | {
      readonly kind: "owner";
      readonly name: string; // 例如 "opensandbox-prepare/1-to-2"
      readonly configPath: string; // owner domain 值在 manifest 中的 config 路径
      readonly from: string;
      readonly to: string;
      readonly effect: IdentityChangeEffect;
      readonly summary: string;
    };

type IdentityChangeEffect = "encoding-only" | "behavior-changing";
```

`encoding-only` 表示新旧 domain 描述同一次执行，只是身份的编码方式不同。新包保留 `from` 域的计算作为纯函数。
变更同时声明一个对当前冻结输入的纯谓词：只有新增输入都取旧行为等价值时，当前输入才能在旧域中表示。
`behavior-changing` 表示新旧 domain 描述的执行不同，例如 Provider 改变了准备内容；它不提供重建。

### 规划语义

`identity-domain-change/v1` 用当前冻结输入按 origin 所在的旧域纯计算受影响部分，再重算组合 digest。
重建可以沿 registry 跨多条 `encoding-only` 变更，结果必须逐字等于 origin 的 `executionIdentityDigest`。
重建不再次 import、执行定义函数、调用 Provider planner、读取进程变量或访问网络。

| origin 的 domain | explanation | 当前适用性 |
|---|---|---|
| 与当前相同 | 普通比较 | 按其余资格 |
| 有登记，链上全部 `encoding-only`，谓词成立且重建相等 | `match`，`via` 列出所用变更名 | `reuse/carried` |
| 有登记，链上有 `behavior-changing` | `unexplained`，code `identity-domain-changed` | `gap: identity-mismatch` |
| 谓词不成立，或重建不相等 | `unexplained`，code `identity-domain-changed`，并列出可比的 `observedDeltas` | `gap: identity-mismatch` |
| 未登记 | `unexplained`，code `identity-domain-unregistered` | `gap: identity-mismatch` |
| 旧域已退役 | `unexplained`，code `identity-domain-retired` | `gap: identity-mismatch` |

`identity-domain-changed` 的 facts 列出变更名、`kind`、`from`、`to` 与 effect。
dry 不为这类缺口生成采用建议，因为 `accept` 同样拒绝它们。

`encoding-only` 重建证明的是“用户输入未变，只有 NiceEval 的编码方式变了”，与 digest 相等同等强度，因此直接形成 carried，不要求操作者采用。
它不写入任何新的资格事实；后续每次沿用都重新重建，不以 carried action 自证等价。
有限采用规则（`experiment-rename/v1`、`sandbox-image-reference/v1`）重建 origin digest 时，同样可以经过 `encoding-only` 链到达 origin 的旧域。

旧域的计算可以退役。退役在 registry 中显式登记，并在发布说明中列出；之后受影响结果显示 `identity-domain-retired`。

### 发布校验

当前 domain 集、registry 与固定样例 digest 一起签入仓库，作为上一个发布版本的快照。
仓库校验按当前实现重算并对比快照，以下任一情况都失败：

- 当前 domain 与快照不同，且 registry 中没有对应登记；
- 同一 domain 下，固定样例输入的 digest 发生漂移；
- `encoding-only` 登记缺少旧域计算，或旧域计算不能从样例重建出快照 digest。

固定样例包括 Eval input、config identity 与组合 slot 输入；Provider 与 installer owner 为各自 domain 提供样例。
登记一次变更时同时更新快照；发布从已通过校验的提交构建，因此快照总等于上一个已发布版本。

## 错误与缺口作用域

`ExecutionGapReason` 是稳定的 reason code。它区分缺少 source Run、Planned attempt、Member 或 Core，以及不能读取固定事实。
固定事实的原因包括需要迁移、没有可用迁移、unsupported 或 invalid；其余类别包括实际 outcome、Verdict、duration、rerun 与 sandbox 条件。CLI 与 SDK 保留具体 code 和原始 issue。

作用域按可证明的最小范围确定：

- 单个 Member、Attempt、origin 或所需 Attachment 问题只让对应 Planned attempt gap；
- source Run 的 expected membership 或排序事实损坏，但仍能归到一个 Experiment 时，该 Experiment 的全部 target Planned attempts gap；
- 历史 Run 连 Experiment 归属都无法读取时，为避免误复用，全部 target Planned attempts gap。

历史损坏必须保留真实 reason 与 issues，不能改写成 `no-source-run`。三个作用域都禁止回扫更旧 Run。

Record root 无法打开，或 malformed candidate 连 Experiment 归属都无法安全取得时，结果是整个 reuse planning 失败。ExecutionTarget 无法验证、target identity 重复、当前 ProjectTarget 缺少已求值输入，或 policy name/version 不受支持时也一样。maintenance 正在排他操作时，read / append 也无法开始；这不是 writer-to-writer 冲突。失败时不产生 ExecutionReusePlan。

## 读取范围与 reader 生命周期

reuse planning、dry assessment 与显式采用都只读请求范围内的事实，不预载项目全部历史。
请求范围是当前目标的 `(experimentId, evalId, attemptOrdinal)` 集合，或显式采用的 exact locator 与 Run 集合。

一次规划只开一个短 read transaction，在同一 PublicationCutoff 内依次完成：

1. 经 [读取索引](../../run/architecture/README.md#读取索引) 为每个逻辑位置选出 source barrier 规定的最近 Run，或按 exact locator 选出 origin 候选。
2. 读取所选 Run 的 Core、必要 origin，以及资格判断需要的 Assertions 与 Runner Activities；附件只读 policy 用到的 family。
3. 完成资格判断，形成只含安全值与精确引用的 detached plan，然后关闭 transaction。

dispatch、Provider 调用与 binding 写事务都不持有这个 reader。binding transaction 只复核 Run、source、Planned attempt 与 CAS，不重新做资格判断。
plan 不保留任何引用已关闭连接的惰性 getter；需要的字节在 transaction 关闭前读完。

plan 里的每个 reuse 或采用位置携带一个 Host 私有的 exact reference：project Record、`originRunId`、`attemptId` 与 `publicationIdentity`。
它不持有 reader，可以在 transaction 关闭后传给 binding。
binding transaction 凭它在自己的写事务中复核 origin publication 仍然存在且 identity 未变，不再打开第二个 read transaction。
dry assessment 与 receipt 需要的 readback 同样在 read transaction 关闭前读成安全值。

规划成本随请求位置数、匹配的 expected 历史与必需证据增长。同一 Experiment 的历史 Run 越多，source barrier 需要比较的 expected 行越多；无关 Experiment 的 Run 不参与。

## coordinator、planner 与 writer

invocation coordinator 持有完整、不可变的 `ExecutionReusePlan`。planner/scheduler 只收到
`ExecutionReusePlan.execute`，并为实际开始的位置返回 executed outcome。Coordination 在派发前处理
execution claim（执行占用）、同一 Experiment 的 dispatch claim 和并发名额；这些 reserved / inflight
（已预留 / 正在运行）状态不成为持久事实。

coordinator 最后把 target、reuse intents 与 executed outcomes 交给各自的 Planned attempt publication：

- reuse 以 reference binding 引用已发布 Attempt，并保存 `carried` action；
- executed 位置以独立 transaction 发布新 Attempt closure、publication identity 与 origin binding；
- 未派发 Planned attempt 不伪造 Member。active Run 显示 `pending`；Run close 从闭集 absence reason 中选择并冻结对应原因。

coordinator 对每个 origin 或 reference Planned attempt 执行原子 binding transaction。它不能重新读取
Assertions 或 Runner Activities、改写 reason 或作第二次资格判断。收到 `SIGINT` 时保留已发布
Attempt，Run close 为其余 Planned attempt 写 `interrupted-before-publication`；不创建虚构 Member。

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

Run 授权还要求 source expected membership 与当前 target 在 Experiment、Eval 和 ordinal 上双向闭合。每个 source Planned attempt 必须有唯一 Member 与 exact Attempt。每个 current Planned attempt 必须恰好命中一次。source-only、target-only、missing、duplicate、
dangling 或 ineligible 都阻断整批。`--dry` 与正式执行共用该 plan，区别只在前者不进入 commit scope。

accepted 的唯一含义是“操作者当时明确采用这个 immutable Attempt identity”。它不是审批、签名或真实性声明。

## 显式采用的资格

显式采用仍要求当前目标存在、逻辑位置唯一、source Core 完整、质量结果合格且真实时长符合当前 timeout。
同 identity 的旧 locator 可以越过 source barrier 被明确选中；这不授权任何其它位置。
不同 identity 只有通过第一方有限规则才能采用，操作者确认不能替代规则所需证据。
实验改名使用 [`experiment-rename/v1`](../cli/rename.md#纯改名的有限等价)，从冻结计算原料重建 exact origin identity；镜像引用差异使用下面的 `sandbox-image-reference/v1`。

NiceEval 自身的 `encoding-only` [身份域变更](#niceeval-身份域变更) 在规划中直接沿用，不经过采用；behavior-changing、未登记或已退役的域不能采用。

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

source expected Planned attempt 与当前目标 identity 相同后，还要验证它引用的 exact origin。
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

- [Experiments Architecture](README.md) —— coordinator、planner 与 writer 的关系。
- [实验改名](../cli/rename.md) —— explicit adoption 怎样表达 Experiment 身份变化。
- [Run](../../run/README.md) —— Attempt publication、Planned attempt binding 与持久引用。
- [Inspection](../../inspection/README.md) —— 已发布 Attempt 怎样进入固定读取与比较。

## State 的结果适用性

绑定 State 时不能证明下一次起点相同，因此不自动 carry，也不接受 accept 或 rename 对该位置的显式采用。
请求以 `state-adoption-unsupported` 拒绝；普通文件改名建立新 lineage，不迁移 checkpoint。
固定 Run 历史读取保留原结果与状态起点；没有 State 的位置继续遵守本文其它规则。细则见 [State](../../state/architecture.md#结果携带)。
