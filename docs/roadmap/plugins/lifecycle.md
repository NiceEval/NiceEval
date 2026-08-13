# Plugins —— Lifecycle

## 三层生命周期

Plugin 不建立自己的运行时。它只把声明接到三个既有 owner：

| Scope | 典型状态 | setup 次数 | teardown 次数 |
|---|---|---:|---:|
| Experiment / Run | 一个 Experiment Plugin occurrence | 每 Run 至多一次 | 到达 setup 后至多一次 |
| physical Sandbox | cohort resource 与 Sandbox instance | 每实例一次 | 实例退休前一次 |
| Attempt / Agent | `LinkedAgentPlan`、Hosted Hook 与 Agent lifetime | 每 Attempt 一次 | 对已进入节点各一次 |

并发 Attempt 各有独立 Effect Scope，不存在跨 Attempt 的全局 LIFO。成对节点在调用 setup／before 前先登记自己的 teardown／after；setup 中途失败也不豁免已经取得的资源，未到达节点不产生虚假收尾。

## Experiment host lifecycle

Experiment host lifecycle 仍是独立 Run scope：

```text
Run owner open / reserve mounted adapter obligations
  → Run adapter bindings open
  → Experiment author setup
  → Experiment plugins[] 的 experiment.setup
  → all selected Eval pairs
  → Experiment plugins[] 的 experiment.teardown（reverse）
  → Experiment author teardown
  → Run bindings seal / release（reverse）
  → sealed domain values adapt / canonical commands accepted
```

每个 Plugin occurrence 每 Run 至多执行一次。它与每 Attempt 的 `hostedAgentHooks` 次数不同：Experiment Plugin 同时声明两者时，`setup`／`teardown` 仍只包住整份 Run，Hosted Hook 则包住每条真实派发的 Attempt。reuse plan 若不创建新 Run owner，就不打开 binding；一旦创建 mounted owner，即使领域上没有可观测数据，也必须封口 explicit state。

## 从 link 到 Agent dispose

资源创建前先完成所有可纯判定工作与 selected asset snapshot：

```text
selection / pair link
  → protocol token / oneOf static support
  → receiver pure resolve + slot conflict
  → selected local asset snapshot / digest
  → RunAgentProjection + PairAgentDelta
  → fingerprint / manifest / carry planning
```

factory activation 与 pure link 不读取 asset、不求值 credential；本地 asset I/O 只发生在显式 selected planning snapshot。floating remote identity、unsupported protocol、choice ambiguity、slot conflict、reuse requirement 与 path／digest failure 都在创建 Sandbox 前结束。

真实派发的 Attempt 使用修正后的嵌套关系：

```text
Attempt owner open / reserve mounted adapter obligations
  → Sandbox create / existing sandbox.setup
  → template-owner SandboxLayer prepare chain
  → LinkedAgentPlan provision / ensure
  → receiver.configure(full desired state)
      acquire outer managed overlay; register overlay dispose
  → Agent setup
      acquire Agent lifetime; register Agent teardown before setup
  → receiver.afterConfigure
      register beforeAgentTeardown before entering the node
  → Attempt adapter bindings open
  → Hosted Attempt before
  → Eval body / logical sends
  → Hosted Attempt after
  → Attempt bindings seal / release（reverse）
  → sealed domain values adapt / canonical commands accepted
  → receiver.beforeAgentTeardown
  → Agent teardown
  → receiver-private managed overlay dispose
  → SandboxLayer cleanup / Sandbox teardown / Provider finalizer
```

Effect v3 Scope 的获取顺序必须是 `managed overlay → Agent lifetime → beforeAgentTeardown node`，释放顺序才会是 `beforeAgentTeardown → Agent teardown → overlay dispose`。实现可以使用嵌套子 Scope，但必须保留这一可观察顺序，不能依赖平铺 finalizer 的偶然登记顺序。

- `provision / ensure` 允许 Bub Python extension 等改变 CLI 安装计划，不被错误推迟成 post-ensure 配置。
- `configure` 在第一次 extension 写入前一次性求值 selected credential binding，并把 Agent home 收敛到本次完整 desired state。
- `afterConfigure` 执行时，完整配置与 Agent runtime 都已 ready；它只执行 receiver plan 中有稳定 identity 的命令。
- `beforeAgentTeardown` 承载 drain、flush、verify 等仍需 Agent 配置存在的命令。
- `dispose` 只由 receiver 实现，撤销 NiceEval-managed overlay，不开放任意 Plugin callback。

configure 开始前就登记 overlay dispose；Agent setup 开始前就登记 Agent teardown；进入 afterConfigure node 前就登记对应 beforeAgentTeardown。因此：

- configure 中途失败仍 dispose 已取得的 overlay；
- Agent setup 失败不进入 afterConfigure，但 Agent teardown 与 overlay dispose 都运行；
- afterConfigure、Hosted Hook、Eval 或 send 失败时，三层已登记收尾仍按上述顺序运行；
- cleanup failure 收进既有 teardown aggregation，不替换 primary failure，也不发明任意字符串 phase。

## Sandbox reuse 的收敛门

复用 Sandbox 带着上一 Attempt 的 `$HOME` 残留进场。`LinkedAgentPlan` 的语义是“收敛到完整 desired state”，不是“把本次 extension 加上去”：

1. receiver 用 isolated Agent home 或 receiver-owned ledger／overlay 标记 NiceEval 管理的文件、注册项与 credential materialization；
2. 每个 Attempt 同时删除上一次存在、本次不存在的受管项；空 extension 列表也会删除旧项；
3. 未知用户文件、Agent 自有状态与 Plugin 运行数据不因 overlay cleanup 被删除；
4. extension 无法证明隔离或可撤销时，声明 reuse unsupported，由 requirement 在创建资源前拒绝；
5. replacement Sandbox 总是重新 materialize，不沿用旧实例的“已安装”判断。

Skill、MCP、native Plugin、native Hook 与 credential 文件都受这条门约束。Plugin 需要跨 Attempt 保存的运行数据必须写到 receiver-managed 安装 overlay 之外，并由对应 Experiment／Sandbox reuse 契约明确允许。

## Hosted Attempt Hook

Eval 与 Experiment author／Plugin 都可贡献 `hostedAgentHooks`。组合顺序是：

```text
Experiment author
  → Experiment plugins[]
  → Eval author
  → Eval plugins[]
```

Experiment 是外层，Eval 是内层。`beforeAttempt` 正序执行；进入每个 occurrence 时先登记它的 `afterAttempt`，关闭 Scope 时按实际登记逆序运行。只声明 after 的 occurrence 也会在自己的进入点登记。

`beforeAttempt` 失败时不进入后续 before 或 Eval body；已经登记的 after 仍收到 immutable `before-hook-failed` primary exit。Eval body 成功、Verdict 为 failed、基础设施失败与中断是不同事实：`AttemptHookExit.completed` 只表示 Attempt 基础设施路径正常收束，不取代 Verdict。

某个 after 自己失败时，其错误加入 teardown aggregation；后续 after 仍看到同一份原始 primary exit，不会看到被前一个 after 改写的结果。

## Hosted Send Hook

`beforeSend`／`afterSend` 包住一次逻辑 `t.send()`：

```text
hosted beforeSend（一次）
  → logical send
      → physical agent.send retry 1..N
      → accepted Turn 或 terminal SendFailure
  → hosted afterSend（一次）
```

after 在调用 before 前登记。`SendHookExit` 穷尽区分：

- `accepted`：存在可信 Turn；
- `send-failed`：重试耗尽后的终局 `SendFailure`，不存在 Turn；
- `before-hook-failed`：Agent send 未开始；
- `interrupted`：逻辑 send 被中断。

Hook 只读输入、Attempt／Session identity、session ordinal、send ordinal 与最终 exit；不能替换 prompt、Session 或 Turn。它不暴露逐 token／逐物理 retry 回调，避免一个逻辑动作因 Adapter retry 重复产生副作用。需要这些观测时读取标准 StreamEvent 与 retry diagnostics。

公共 callback 保持 `void | Promise<void>`；Runner 在边界只适配一次进 Effect，并由 Attempt-owned Scope 管理。Effect requirement 只描述内部依赖与资源纪律，不把 Effect 类型泄漏到普通 Eval／Plugin 作者面。

## Agent 原生 Hook

Agent 原生 Hook 只能由 receiver-specific extension 声明，例如 `codexNativeExtension({ hooks })`。receiver 把它写入 Codex／Claude 的官方配置并由对应 Agent runtime 执行；NiceEval 不把其 payload 解释成 Hosted Hook，也不承诺相同的 context 或重试次数。

原生 Hook 的文件、credential 与注册项属于 managed overlay，必须参与完整 desired-state 收敛。原生 Hook 失败按 Adapter 已有的 Agent 执行／setup failure 语义报告，不创建 `plugin.native-hook.*` 平行 phase。

## RecordAdapter producer 时点

普通 Plugin callback 与 Hosted Hook context 没有 Record 方法。领域 SDK 通过 Plugin fragment 静态挂载
[owner-specific RecordAdapter binding](../record-attachment-authoring/library.md#owner-specific-binding)：

| fragment | binding owner | 封口边界 |
|---|---|---|
| Eval `recordAdapters.attempt` | 当前 pair／Attempt | hooks／body 结束后 seal／release，再 adapt。 |
| Experiment `recordAdapters.attempt` | 当前 pair／Attempt | 每个 pair 独立 occurrence；不复用 Run session。 |
| Experiment `recordAdapters.run` | 当前 Run | Experiment setup 前 acquire，teardown 后 seal／release。 |
| Group | 无 | Group 没有 Record owner，不接受 binding。 |

每个 mounted binding 在 owner open 时原子 reserve family 并登记 pending producer。它对每个 actual owner 必须形成恰好一个
sealed domain value；正常 empty、partial 与 unavailable 都是领域值。missing、duplicate、open／seal／release 或 adaptation
failure 都加入 owner failure，不能靠“不写”继续发布。

owner seal 依次完成三步：

1. seal／release external bindings，将 sealed values 交给 adapter，再 drain canonical commands；
2. framework 根据成功 accepted events 通过 built-in provenance binding 产值并 adapt；
3. 原子停止 owner-wide admission，再 drain 到静止。

Effect v3 finalizer 自身的 error 为 `never`；host 必须把 release 的完整 `Exit`／`Cause` 收进 owner lifecycle aggregation，
不能只 log。adapter、schema、closure、blob 或 durable write failure 同样不降级为 diagnostic，更不会改写已有 Attachment。
完整并发、封口与中断语义见 [RecordAttachment Lifecycle](../record-attachment-authoring/lifecycle.md)。

## Sandbox resource 时序

需要跨 pair 聚合的 physical resource 仍先于 create 完成纯规划：

```text
selection / pair link / group compatibility
  → selected demand cohort
  → resource receiver aggregate + validate
  → aggregate projection 写入每个 pair fingerprint / manifest
  → carry planning
  → 若存在真实派发：
      physical Sandbox create
      → existing sandbox.setup
      → official resource materialize / verify
      → reset anchor
      → 每条 Attempt 执行完整 LinkedAgentPlan
      → resource teardown（reverse）
      → existing sandbox.teardown
      → Provider finalizer
```

Agent extension receiver 与 cohort resource receiver 都以 nominal protocol 保持 core 中立，但作用域不同。前者每 Attempt 收敛 Agent desired state；后者聚合 selected cohort，并绑定 physical Sandbox instance。二者不能共用一个含糊的 setup handle。

## 失败与中断

- `protocol-token-collision`、unsupported protocol、oneOf zero／ambiguity、duplicate identity、slot conflict：pure link failure。
- local asset 不存在、含 symlink／special file、逃逸或无法 snapshot：selected planning failure，零资源。
- remote identity floating：link failure；下载后 commit／digest 不符：materialization infrastructure failure。
- credential env 缺失：configure infrastructure failure；错误可点名 env selector，不能打印 value。
- extension 不支持 reuse：planning requirement failure，不创建资源。
- Agent extension provision／configure／lifecycle 失败：归入对应既有 `agent.ensure`、`agent.setup` 或 teardown 语义，不创建通用 `plugin.*` phase。
- Hosted Hook 失败：形成 typed infrastructure／teardown failure；不会变成 Agent 解题失败或 Verdict token。
- 用户中断与强清：复用现有 Effect Scope／teardown registry；Plugin 不启动 detached cleanup runtime。
- resource `demand-invalid`／`demand-unsatisfied`／`instance-unavailable`／`attempt-consume-failed`：沿用既有 cohort 与 Sandbox replacement policy。

## Dry plan

`niceeval exp ... --dry --commands` 展示 Plugin identity、owner、requirements、SandboxCommand，以及 `Plugin → AgentExtension → selected receiver → redacted manifest`。它显示 protocol／receiver revision、choice 选择、asset kind／digest、合并顺序、同值 provenance、冲突与不支持原因；不求值 credential、不显示 env selector／宿主绝对路径、不下载远程内容，也不创建资源。
