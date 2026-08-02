# State —— 架构

本篇定义 State 从作者输入到运行状态机的边界。
公开用法见 [Library](library.md),在完整 Attempt 中的位置见 [Sandbox 三方准备时序](../sandbox/lifecycle.md)。

## Input → Definition → 内部 ADT

作者面与运行器面分三阶段,不让一个宽对象同时表示「没有 State」「未校验声明」与「可执行状态」:

```text
ExperimentStateInput
  -> defineExperimentState() 校验、冻结、加私有品牌
ExperimentStateDefinition
  -> Experiment 规划:校验 Agent / reuse / concurrency 组合
PlannedExperimentState = Stateless | Pinned | Rolling
```

内部联合是穷尽的:

```typescript
type PlannedExperimentState =
  | { readonly _tag: "Stateless" }
  | {
      readonly _tag: "Pinned";
      readonly definition: ExperimentStateDefinition;
      readonly revision: string;
      readonly cadence: "attempt" | "window";
    }
  | {
      readonly _tag: "Rolling";
      readonly definition: ExperimentStateDefinition;
      readonly cadence: "attempt" | "window";
      readonly cohortKey: string;
    };
```

作者面可以省略 `ExperimentDefinition.state`;进入规划器前,discovery 已把它投影为显式的 `Absent | Declared` ADT。

同样地,复用模式与并发上限分别先投影为 `Fresh | Reuse`、`Unbounded | Limited`。

规划器输入不再用 `undefined`、`null` 或 boolean 组合表示这些状态,`Absent` 只会得到 `Stateless`。
Runner 不合成空 `load` / `save`,因此无状态 Attempt 不产生 `state.load`、`state.save` timing 或 checkpoint 记录。
`Pinned` / `Rolling` 的构造器是内部纯函数,接收已经品牌化的 Definition 和解析后 Experiment 配置;非法组合不能进入 attempt 执行器。

## 生命周期与 cadence

State transfer 的固定位置是:

```text
Sandbox create / reset
  -> 两层作者 prepare command
  -> agent.ensure
  -> state.load
  -> workspace.baseline
  -> agent.setup / eval.run / agent.run / assertions.evaluate
  -> agent.teardown
  -> state.save
  -> 作者 command cleanup
  -> Sandbox stop / suspend / 窗口归还
```

`state.load` 成功才允许建立 baseline 和启动 Agent runtime。
`state.save` 看到的是 Agent teardown 之后、作者 cleanup 之前的 Sandbox。
这两个位置使载入内容不算 Agent diff,并使 Agent runtime 写入的记忆能被 checkpoint 捕获。

| 模式 | load | save | 临界区 |
|---|---|---|---|
| Stateless | 不执行 | 不执行 | 无 |
| fresh + pinned / rolling | 每 Attempt 一次 | 每 Attempt 至多一次,服从 `saveOn` | 当前 Attempt 的 load → save / skip |
| reuse + pinned / rolling | 每 Sandbox window 一次 | 窗口关闭或退休时一次 | 整个 window 的 load → save |

reuse window 的中间 Attempt 不伪造 load/save 活动,它们引用同一份 window state provenance。
窗口 reset 只恢复 workdir,不得擦除 State 拥有的路径;Provider 若不能保证这条边界,该组合在规划期拒绝。

Pinned 每次 fresh Attempt 或新窗口都从声明 revision 起步。
save 产物只作审计输出,不会替换下一次 load 的 revision。
Rolling 首次读取 store 当前 head;每笔成功 save 成为唯一后继。
save 失败、unavailable 或 load 失败后没有合法后继,Runner 关闭该状态序列的派发闸。

声明 State 且开启 `sandboxReuse` 时必须同时声明 `maxConcurrency: 1`。State window
是一条线性的 load → save 序列。若同一 Experiment 并行开多个 physical window，
early-exit、budget 或 halt 可能在空闲 window 上取消“下一次使用”，从而无法在上一条
Attempt 的 author cleanup 前确定它已是末次。规划器因此在 Provider I/O 前拒绝该组合，
而不是静默把每条 Attempt 降级成全新 Sandbox。不需要 State 的 `sandboxReuse`
仍可以在多个实际 Sandbox 间并行。

## Fingerprint、configHash 与 carry

State 的静态投影进入 Experiment `configHash`:

```text
state = {
  identity,
  consistency,
  saveOn
}
```

Pinned 的 `revision` 位于 `consistency` 中,因此 revision 变化必然改变 configHash。
`load` / `save` 函数对象和函数体不进哈希;作者改变 transfer 语义时必须更新 identity 的 schema / revision。
`windowId`、实际 checkpoint digest、事实与动态 store head 都是运行事实,不能反向进入当前 Attempt 的指纹。

携带规则是:

- Stateless 沿用普通 carry 判据。
- Pinned 在 State 静态投影与其它 fingerprint 输入都匹配时可以携带。
- Rolling 的 Experiment 一律 `carryEligible = false`;旧结果属于旧 head 上的序列位置,不能插入当前 head 的中间。
- 任一 reuse Attempt 沿用 Sandbox reuse 自己的出身门,不成为跨 Run 携带来源。

Run 投影保存 State 静态声明;Attempt 或 window 活动保存实际 load/save checkpoint。
携带 pinned 条目时,checkpoint provenance 与其它 facts 一样原样携带,不改写成本轮 store 状态。

## Typed failure 与 Effect Scope

作者 callback 保持 Promise API。
Promise 抛出、返回非法 checkpoint 或 Sandbox transfer 不可用时,Runner 在 Promise / Effect 边界归一成内部 tagged failure:

```typescript
type StateFailure =
  | {
      readonly _tag: "StateLoadFailure";
      readonly phase: "state.load";
      readonly kind: "callback" | "invalid-checkpoint" | "revision-mismatch" | "unavailable";
      readonly code: string;
      readonly evidence:
        | { readonly _tag: "External"; readonly cause: ExternalCause }
        | { readonly _tag: "ContractViolation"; readonly expected: string; readonly actual: string }
        | { readonly _tag: "TransferUnavailable"; readonly reason: TransferUnavailableReason };
    }
  | {
      readonly _tag: "StateSaveFailure";
      readonly phase: "state.save";
      readonly kind: "callback" | "invalid-checkpoint" | "unavailable";
      readonly code: string;
      readonly evidence:
        | { readonly _tag: "External"; readonly cause: ExternalCause }
        | { readonly _tag: "ContractViolation"; readonly expected: string; readonly actual: string }
        | { readonly _tag: "TransferUnavailable"; readonly reason: TransferUnavailableReason };
    };

type ExternalCause = import("niceeval").ExternalCause;
```

`ExternalCause` 不在 State 域重复定义；它直接复用[执行失败分类](../error-classification/architecture.md#失败数据形状)的闭合 ADT。
`Error`、`Object` 与 `ThrownValue` 分支，以及 code / stack / cause 的显式缺席分支，都以该单一契约为准。

这两个 tagged failure 是 runner 内部错误通道,不从 `niceeval` 导出。
识别依赖 `_tag` 与数据字段,不依赖跨包可能失效的 `instanceof`。
Attempt 对外仍产出合法 `EvalResult`:load/save 失败折成 `errored`,不是调度 fiber 的未处理失败。

三条 Effect 路径保持分离:

- **typed failure**:State transfer 已知失败,归对应 state phase,保留结构化 code 与原因。
- **defect**:Runner 自身违反 ADT 不变量,按 unexpected error 封口,不能冒充 callback 失败。
- **interrupt**:Attempt deadline、用户中断或派发闸中止;已经进入 save 的收尾不复用前向中断 signal。

Promise throwable 只在 `Effect.tryPromise` 的 `catch` 边界以 `unknown` 读取一次,随后立即成为完整 `ExternalCause`。
内部错误与记录不保存 `unknown`,也不靠 `cause?: unknown` 或空字符串表达缺席。
checkpoint revision 使用 `Option`,digest 使用 `Unavailable | Sha256`;二者都不使用 `undefined` / `null` 哨兵。

`state.load` 活在 Attempt 的 verdict-producing fiber 和前向 deadline 内。
load 成功后,Runner 在外层 Effect Scope 登记 State finalizer。

finalizer 接收显式 `Succeeded | VerdictNotPassed | AgentTeardownFailed` completion ADT,不以两个 boolean 猜测 verdict 与 teardown 状态。

`after-load` 的 save 由这个 finalizer 触发,所以 body 失败或超时仍能进入有界 save;`attempt-succeeded` 的 finalizer先读取已定稿 completion,不满足就记录 skipped。

save 在独立有界 Effect fiber 中运行,由 `Effect.tryPromise` 创建全新的 `AbortSignal`;它不复用已经超时或取消的 load / Attempt signal,超时会中止该 signal 并形成 typed `deadline-exceeded` unavailable。

State finalizer 完成后才执行作者 command cleanup 和 Sandbox finalizer;result 在 Scope release 完成后封口。

State 序列的连续性错误携带 `scope: "experiment"` 关闭剩余派发,但不抢占已经在飞的其它无关 Experiment。
它不改写 `AttemptError.code`,空间轴只决定后续调度。

## Checkpoint 记录

每次真实 transfer 形成一条活动:

```typescript
type StateTransferActivity =
  | { readonly outcome: "succeeded"; readonly checkpoint: StateCheckpoint; readonly durationMs: number }
  | { readonly outcome: "failed"; readonly code: string; readonly message: string; readonly durationMs: number }
  | { readonly outcome: "skipped"; readonly reason: "save-policy" | "load-failed"; readonly durationMs: 0 }
  | { readonly outcome: "unavailable"; readonly reason: "sandbox-lost" | "provider-unreachable" | "deadline-exceeded" | "interrupted"; readonly durationMs: number };

interface StateWindowRecord {
  readonly windowId: string;
  readonly experimentId: string;
  readonly consistency: StateConsistency;
  readonly load: StateTransferActivity;
  readonly save: StateTransferActivity;
}
```

Fresh 把活动归到 Attempt;reuse 把一次 window 活动保存为 Run 级 window provenance,中间 Attempt 只引用 window id。
事实只解释这次 transfer,不会成为下一次跳过 load 的依据。
记录字段的挂载点见 [Record Format](../record/architecture.md#runjson):fresh 写 `AttemptRecord.state`,reuse 写 `RunMeta.stateWindows`。
