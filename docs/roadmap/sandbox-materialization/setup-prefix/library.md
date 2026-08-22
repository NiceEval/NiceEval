# Library

## 所有 owner 使用同一 API

Experiment、Eval Group、Eval 与 Agent 都向同一个 `SandboxLayer` 贡献 before/after 包裹。作者不选择 sandbox 或 attempt scope，也不需要理解 prepare/setup 的区别：

```ts
const changeFrequency = {
  rare: 10,
  normal: 100,
  frequent: 1_000,
} as const;

interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  before(action: SandboxAction): SandboxLayer<Kind>;
  after(action: SandboxAction): SandboxLayer<Kind>;
  around(pair: SandboxActionPair): SandboxLayer<Kind>;
}

interface SandboxActionPair {
  readonly before: SandboxAction;
  readonly after: SandboxAction;
}

declare function shell(input: ShellActionInput): SandboxAction;
declare function write(input: WriteActionInput): SandboxAction;
declare function copy(input: CopyActionInput): SandboxAction;
```

```ts
dockerSandbox({
  source: { type: "dockerfile", context: HARNESS_CONTEXT },
})
  .before(shell({
    id: "runtimes",
    command: "./import-runtimes.sh",
    inputs: [runtimeV09, runtimeV012],
    changeFrequency: changeFrequency.rare,
  }))
  .before(shell({
    id: "fixture",
    command: "./install-fixture.sh",
    inputs: [fixtureArchive],
    changeFrequency: 40,
  }))
  .before(write({
    id: "adapter-env",
    path: ".env",
    input: publicAdapterConfig,
    inputs: [publicAdapterConfig],
    changeFrequency: changeFrequency.frequent,
  }))
  .around({
    before: injectCredentialOverlay,
    after: removeCredentialOverlay,
  });
```

`before(action)` 是不需要配对 after 的前置动作。`after(action)` 是 owner occurrence 的 finally；进入该 owner occurrence 时就登记，即使后续 before 部分失败也会执行。`around({ before, after })` 用于资源取得与释放；调用其 before 前登记配对 after。API 不把 fluent after 隐式绑定到最近 before，避免书写重排改变配对。

## Owner 包裹顺序

同一种 occurrence 内，before 固定正序进入：

```text
Experiment → Eval Group → Eval → Agent
```

退出时按实际登记栈全局逆序：

```text
Agent → Eval → Eval Group → Experiment
```

每个 owner 内按作者声明顺序执行 before 与 around.before；after 和 around.after 按登记栈逆序。`changeFrequency` 绝不重排程序。旧的 template-owner-first command precedence 不再存在；template 只决定 Provider 起点，不决定 owner 顺序。

Attempt 内 Agent body 固定为：

```text
Agent before / around.before
  → Adapter runtime setup
  → Agent run
  → Eval test
  → Adapter runtime teardown
  → Agent after / around.after
  → Eval / Group / Experiment after
```

Eval test 因而始终发生在 Adapter runtime 存活期间。runtime teardown 即使 run 或 test 失败也真实执行；随后继续全局 LIFO cleanup。

## Occurrence 由 planning 编译

公开 API 不暴露 scope。link 与 physical planning 把每个 attachment 编译为 `physical-instance | attempt` occurrence：

- 消费 attempt-bound typed input 的 action 必为 attempt；
- 只消费 immutable input 的 action，只有当其 owner identity 对整个 physical sharing cohort 稳定时才是 physical-instance；
- 不能证明 cohort 稳定时使用 attempt；
- Agent action 默认 attempt；未来只有完整 Agent owner 对 cohort 稳定时才能成为 physical-instance。

Experiment action 跨多个 Eval 或 template 时，会在每个对应物理实例或 Attempt 展开，不是整个 Run 一次。Group action 只有在 lane 实例对完整 Group identity 稳定时才能成为 physical-instance。Group 共享实例中的 Eval action 通常是 attempt。

SandboxLayer 不提供 invocation occurrence。没有具体 Sandbox 的 Experiment once hook 继续属于 Experiment/Plugin host lifecycle。Direct Agent 配对中，任何显式 SandboxLayer——即使为空或只有 after——都在 pure link 报 `sandbox.unexpected-for-direct-agent`，且不触发 Provider I/O。

跨 occurrence 的规范顺序是：

```text
Provider start
  → physical before / around.before
  → verified reset baseline
  → 每个 Attempt:
      reset
      → attempt before / around.before
      → Agent body
      → attempt after / around.after
  → physical after / around.after
  → Provider finalizer
```

Provider replacement 或 retirement 开启新的 physical occurrence，重新经历 start、physical before、baseline、physical after 与 finalizer。Provider 无法恢复 physical baseline 时，只能创建新实例或让 reuse planning 失败；不能把 physical action 偷换成 attempt replay。

## 缓存资格

声明式 `before(shell/write/copy)` 是确定性承诺，只允许改变 Sandbox 内状态。它在每个 occurrence 都得到满足：

```text
hit         → restore verified private state
miss        → replay action and optionally capture
unsupported → execute action without capture
```

callback before 始终真实执行、显示 opaque，并关闭后续共享 capture lineage。secret、租约、外部会话、当前时间、随机数、外部写入和无法原子捕获的 DinD 状态也关闭 lineage。后续 action 可以在私有实例继续执行，但不能被其它 owner、lane、Eval 或 Agent 当作共享 prefix 命中。

after 和 around.after 永不缓存。owner after 在进入 owner occurrence 时登记；around.after 在调用配对 before 前登记。cache restore 也算到达 before。全部已登记 after 使用独立 cleanup signal，失败只产生 diagnostic，不能阻止后续收尾和 Provider finalizer。

## 频率

`changeFrequency` 接受任意有限非负数。作者可以写任意数值；`rare = 10`、`normal = 100` 与 `frequent = 1000` 只是可读常量。

该值只影响 promotion、retention、GC 与缓存工作排队。它不进入 PrefixKey，也不改变 owner、声明或执行顺序。debug 显示作者原始数值；只有数值恰好等于预设时才附加预设标签。作者未声明时显示 `not-configured`，after 不适用时显示 `not-applicable`，不能虚构作者输入。

## Provider 中立

before/after/around 属于 `SandboxLayer`，不属于 Docker。Docker、E2B、Vercel 与自定义 Provider 使用相同 API。Provider 对每个 eligible prefix 报告：

- `persistent`：可以跨 Invocation 命中；
- `invocation-local`：只在本次 Invocation build once 并私有 clone；
- `unsupported`：每个 occurrence 真实执行。

三档能力不改变 occurrenceKind 或执行顺序。每个消费者始终取得私有 writable state；Provider 不得忽略 action、伪造 hit 或共享 writable 实例。
