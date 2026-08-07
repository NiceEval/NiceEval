# Agent-as-Judge —— Lifecycle

## 共同起点

Runner 在 link 阶段为每个实际 Eval × Experiment 配对选择一份完整 `judge.agent` 配置。
这一阶段只校验静态配置，不创建 Sandbox，也不调用 Agent。

静态校验包含：

- Direct Agent Judge 没有 `sandbox`，Sandbox Agent Judge 有一个 template-bearing `sandbox`。
- timeout、model、reasoning effort 与 flags 形状合法。

`test(t)` 运行到 `t.judge.agent()` 时，Assertion collector 校验 rubric 锚点与 `workspace` 的形态组合。
这些输入可以位于普通代码分支中，Runner 不通过源码文本猜一条断言是否会执行。

同一次 Invocation 中，没有执行 Agent Judge Assertion 的 Eval 不调用裁判。
全部结果都能携带时，也不创建裁判资源。

## Direct Agent Judge

```text
assertions.evaluate
  → freeze rubric + material
  → create judge Agent Session
  → agent.setup
  → agent.send(judge task)
  → validate decision
  → optional correction send
  → agent.teardown
  → finalize execution
  → emit AssertionResult
```

Direct 形态不创建 Sandbox。
setup 失败后仍执行配对 teardown；teardown 失败会保留已经取得的 decision，但 execution 记 unavailable，避免把无法确认静止的 evaluator 当成完整证据。

## Sandbox Agent Judge

```text
assertions.evaluate
  → freeze rubric + material
  → capture subject workdir snapshot, when requested
  → build / create fresh judge Sandbox
  → judge sandbox prepare
  → import workdir snapshot, when requested
  → judge agent.ensure
  → judge agent.setup
  → agent.send(judge task)
  → validate decision
  → optional correction send
  → judge agent.teardown
  → judge sandbox teardown
  → resolve judge Sandbox physical release
  → finalize execution
  → emit AssertionResult
```

快照在裁判 Sandbox 的 prepare 之后导入，只替换 workdir。
Agent Ensure 与 setup 随后运行，使裁判 CLI 和鉴权不被快照覆盖；它们不得把被测 Agent 的进程配置当作裁判配置复用。

每条 Assertion 使用一个全新的裁判 Sandbox。
同一 Attempt 的多条 Agent Judge Assertion 不共享文件修改、Agent Session 或上下文；Provider build artifact 可以按既有 BuildKey 复用，但运行实例不能复用。

## 失败与清理

生命周期一旦创建资源，就按创建顺序逆序执行全部已登记 finalizer。
send、decision 校验或协议修正失败都不跳过 Agent teardown、Sandbox teardown 与 physical release。

被测 Sandbox 在快照捕获后仍由原 Attempt 生命周期所有。
裁判失败不能销毁、退休或修改被测 Sandbox，也不能改变原 owner 的 retention policy。

裁判 Sandbox 是独立 fresh 物理资源。
它按 [Sandbox 默认停驻与回收](../sandbox-retention/README.md)求值 release；provenance 标出 `purpose: "judge"` 与父 locator。
裁判执行 unavailable 或 cleanup incomplete 时进入失败类候选，不能借父 Attempt Verdict 猜选中结果。

用户中断同时取消在飞的裁判 Agent 与裁判 Sandbox 命令树。
无法证明裁判 driver 与命令树已经静止时，必须销毁裁判 Sandbox；Direct Agent 则把 execution 记 unavailable，并完成 Adapter 能提供的 teardown。

## 次数

| 动作 | 每条 Agent Judge Assertion |
|---|---:|
| 冻结 rubric 与材料 | 1 |
| 捕获被测 workdir | `workspace: "snapshot"` 时 1 |
| 创建裁判 Agent Session | 1 |
| 创建裁判 Sandbox | Sandbox Agent Judge 时 1 |
| 首次 `send` | 1 |
| 协议修正 `send` | 0 或 1 |
| Agent setup / teardown | 各 1 |
| 裁判 Sandbox physical release | 创建后 1 |

一次协议修正不重新调查，也不新建 Session。
Agent 若自行在首次任务中多轮调用模型或工具，那些物理动作属于 Adapter 内部行为，全部记录在同一个裁判 execution。
