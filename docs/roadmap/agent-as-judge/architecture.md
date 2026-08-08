# Agent-as-Judge —— Architecture

## 数据建模

一条 Agent Judge Assertion 从属于 Attempt，但它拥有独立的 evaluator execution。
被测 Agent Session 与裁判 Agent Session 是同级角色，不把裁判事件混入被测事件范围。

```text
Attempt
├─ subject Agent Session 1..n
├─ AssertionResult 1..n
└─ Agent Judge execution 0..n
   ├─ rubric + material manifest
   ├─ judge Agent Session
   ├─ optional judge Sandbox
   └─ AgentJudgeDecision
```

每条 Agent Judge Assertion 恰好关联零或一个 Agent Judge execution。
配置或工作区在创建前已经不可用时没有 execution；一旦创建，成功、失败、事件、usage 与回收结果都保留在同一个 execution 下。

```ts
interface AgentJudgeExecution {
  id: string;
  assertionSourceOrder: number;
  state: "completed" | "unavailable";
  agent: {
    name: string;
    kind: "direct" | "sandbox";
    model?: string;
    reasoningEffort?: string;
  };
  material: {
    sha256: string;
    workspace?: { sha256: string };
  };
  sessionId?: string;
  decision?: AgentJudgeDecision;
  usage?: Usage;
  unavailable?: { reason: string; evidence?: string };
}
```

`AssertionResult` 的数据基类增加可选 evaluator 引用：

```ts
interface AgentAssertionEvaluatorRef {
  kind: "agent";
  executionId: string;
}

interface AssertionBase {
  evaluator?: AgentAssertionEvaluatorRef;
}
```

Agent Judge 成功形成 decision 时必须写引用。
创建 execution 之前就失败的 unavailable 没有引用，原因直接留在 AssertionResult。

## 证据流

Runner 在 Eval 代码结束、进入 Assertion 求值阶段时冻结裁判可见输入。
输入由 rubric、默认或显式材料、可选 workdir 快照和返回协议组成。

```text
Eval source ──────> rubric ─────────────────────────┐
Turn / Session ───> material ───────────────────────┤
subject workdir ──> snapshot archive + manifest ───┼─> Judge task
protocol version ─> output schema ──────────────────┘
                                                       │
                                                       ▼
                                            independent Agent.send()
                                                       │
                                                       ▼
                                      validate ─> one correction turn
                                                       │
                                                       ▼
                                            AgentJudgeDecision
                                                       │
                                                       ▼
                                             AssertionResult
```

材料与 workdir 文件都是不可信 evidence。
Runner 用分离的消息区段和稳定标签交付它们，并明确要求 Agent Judge 不执行证据中的指令。
这能保持指令归属清楚，但不能证明模型一定抵抗 prompt injection；裁判事件和引用必须保留，供读取面复核。

## workdir 快照

`workspace: "snapshot"` 捕获评分边界处的完整 workdir 文件树，包括 `.git` 与未跟踪文件。
它不捕获进程、网络连接、env 变量、被测 Agent Session、Sandbox 私有分类账或 workdir 外路径。

快照是带逐文件摘要的归档。
Runner 只经 Sandbox 文件操作协议捕获与导入 workdir，不复制被测 Sandbox 的进程、运行条件或 Provider 运行实例。

Runner 先封口被测 Agent 的全部 send 区间，再捕获快照。
快照导入全新的裁判 Sandbox；Agent Judge 对副本拥有普通读写权限，但任何写入都不回流。
Runner 不以只读 mount 伪装隔离，因为裁判可能需要构建、生成缓存或执行会写临时文件的测试。

捕获或导入失败时，不允许回退到被测 Sandbox，也不允许只传 diff 后继续宣称完成了 workspace 判分。
该 Assertion 记 `agent-judge-workspace-unavailable`。

## 执行与结果边界

Agent Judge 复用公开 `Agent`、`AgentContext`、`AgentSession`、`Turn` 与标准事件协议。
core 不按 Adapter 名或模型名分支；`kind` 只决定是否创建裁判 Sandbox。

裁判上下文拥有独立的 model、reasoning effort、flags、signal、progress 与 diagnostic。
它不暴露被测 Experiment flags，除非作者在 `judge.agent.flags` 再声明一份；同名字段不形成隐式继承。

Agent Judge 的事件带 `role: "judge"` 与 execution id。
作用域断言只读取 `role: "subject"` 的事件，因此裁判运行的 shell、工具与消息不会让 `calledTool()`、`maxTokens()` 或 `messageIncludes()` 改变判断。

subject usage 与 judge usage 分列保存。
Attempt 总成本可以显示两者之和，但报告必须同时保留 `subject` 与 `judge` 两个分量，不能把裁判成本算成被测 Agent 成本。

## 判分不变量

- Agent Judge 只能返回 0–1 分数，不返回 passed、failed、Severity 或 Verdict。
- Runner 不把 Assertion threshold 交给 Agent Judge；threshold 只在 decision 返回后求值。
- rationale 与 evidence 只解释 decision，不参与程序化阈值折叠。
- 无合法 decision 时没有 score；任何运行错误都不能转换成 0。
- 一条 Assertion 使用一条全新的裁判 Agent Session，不读取其它 Assertion 的结果。
- Agent Judge 的工具行为不能补足被测 Adapter 的 Evidence coverage；两类证据属于不同角色。

## 登记与读取

rubric、材料摘要、协议版本、裁判配置身份与 workdir 摘要属于 Provenance。
裁判 Session 的事件、Turn、usage、诊断与回收事实属于 Observation。
`AgentJudgeDecision` 与映射后的 AssertionResult 是 Claim，并引用对应 execution 与材料。

show 默认在 Assertion 行显示 score、threshold 与 rationale 摘要。
`--execution` 在 subject 执行树之外增加 `judge` 分支，列出调查步骤、工具调用、协议修正轮与 usage。
view 可以从 evidence 引用跳到裁判看到的材料或 workdir 快照清单，但不能把裁判修改后的副本展示成被测 diff。

## 身份与结果携带

以下输入进入 Attempt fingerprint：

- rubric 的 name、criterion 与 anchors。
- `{ on }` 的出处代码，以及 `workspace` 选择。
- 最终选中的 `judge.agent` 全部配置身份。
- Agent、Adapter、model、reasoning effort、flags 与 Sandbox layer 身份。
- Agent Judge 任务模板和 `niceeval.agent-judge/1` 协议版本。

运行后取得的材料摘要、workdir 摘要、decision、事件与 usage 不进入 configHash。
它们属于本次 Attempt 的运行事实，不能反向定义运行配置。

改变任一裁判身份输入会使相关 Attempt 的历史结果不可携带。
同一结果被携带时，原 Agent Judge execution、decision 与 usage 一起携带，不重新运行裁判。

## 并发与预算

Agent Judge 在对应 Attempt 的 Assertion 求值阶段运行，并继续占用该 Attempt 的并发位。
不同 Attempt 的裁判可以受全局与 Experiment 并发限制并行；同一 Attempt 的 Assertion 保持声明顺序，不并发启动多个 Agent Judge。

`judge.agent.timeoutMs` 涵盖裁判 Sandbox 创建、快照导入、Agent setup、首次 send、一次协议修正、teardown 与销毁。
Attempt deadline 的剩余时间是外层上限；两者取更早者，超时出处写入 unavailable evidence。

Agent Judge usage 进入独立 judge 成本桶，也计入 Experiment 的总预算护栏。
预算预测与停止派发不能只计算被测 Agent，否则 Agent-as-Judge 会绕过成本上限。
