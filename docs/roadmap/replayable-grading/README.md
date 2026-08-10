# 可重评分 Eval

## 用户需要

Agent 执行通常比确定性检查更贵。
Eval 作者需要保留一次多轮执行的完整证据，并在修改断言、rubric 或评分投影后只重新评分。

可重评分 Eval 把一个定义拆成两个 owner：

- `execution` 驱动 Agent、HITL 与 Sandbox，并产出 sealed Execution graph；
- `grading` 只读取这份 graph，建立 Fact、Claim 与 `GradingResult`。

Grading 的只读输入是完整 Execution graph，不是某一轮 reply、diff 或作者手工拼出的快照。
一份 Execution 可以包含多条 Agent Session、任意多 Turn、HITL 往返、usage、事件与逐 Turn diff window。

## 两种 Eval 形状

`defineEval` 与 `defineScoreEval` 各自接受一个互斥联合：

```ts
defineEval({ test: async (t) => { /* execution 与判定交错 */ } });

defineEval({
  execution,
  grading,
});
```

`test` 是 inline 形状。
它保留普通 TypeScript 顺序、`require` 与现场控制流，但它的判定永远和这次 execution 绑定，不能独立 regrade。

`execution + grading` 是 replayable 形状。
两项必须同时存在，且不能和 `test` 共存。
`defineScoreEval` 使用同一个联合；它的 grading 负责 `score()`，正常返回时自动收尾。

## 多轮心智

Execution 在定义期声明一组具名 Ref，再把实际 Session 与 Turn 绑定进去。
Grading 使用这些名字读取 sealed Record，不按“第几轮”、消息文本或展示标签猜节点。

```ts
const draft = await t.send("先拟稿，发送前询问我");
const request = t.requireInputRequest({ action: "send_email" });
const sent = await t.respond({ request, optionId: "approve" });

const audit = t.newSession();
const auditTurn = await audit.send("独立核对是否真的发送");

return { draft, sent, audit, auditTurn };
```

Grading 随后可以分别检查：

- 单个 Turn 的 reply、事件、状态与 usage；
- 一条完整 sealed Session；
- `session.through(turn)` 指定的会话前缀；
- 整个 Attempt 的跨 Session 聚合；
- `g.sandbox.during(turn)` 对应的逐 Turn diff window；
- 任意多个 Ref 之间的值关系。

完整语法见 [Library](library.md) 与 [多轮 HITL 用例](use-case/multi-turn-hitl.md)。

## 不可变结果

一次 replayable execution 产生一个不可变 Execution graph。
一次 grading 产生另一个不可变 Grading graph，并以跨 graph 强边引用它使用的 Observation。

修改 grader 不会改写旧 Claim，也不会给旧 Attempt 追加一个“最新判定”。
每次批量评分形成独立 `GradingRun`；报告只有在显式选择它时才显示历史 regrade。

默认实验 Run 在规划时预留自己的 default GradingRun。
普通 `show` / `view` 只跟随这条持久化关系，不按时间寻找最新 grader。

## 身份边界

replayable Eval 有两份独立身份：

- `executionFingerprint` 只包含会改变 Agent、Sandbox 或 Observation 的输入；
- `gradingFingerprint` 只包含会改变 Fact、Claim 或评分投影的输入。

为了真的分开源码闭包，Execution、Grading 与 Ref contract 使用独立模块。
同一模块也能安全运行，但模块内任意改动会保守地同时改变两份 fingerprint。

## 研究取舍

- [smevals](../../research/assertion-api-dx/smevals.md) 证明了不可变 Run 与可替换 Grader 的价值；NiceEval 把输入从单个 output 扩成完整多轮 Execution graph。
- [Braintrust](../../research/assertion-api-dx/braintrust-autoevals.md) 与 [LangSmith](../../research/assertion-api-dx/langsmith.md) 都能只用既有 task / application output 重算 scorer；NiceEval 再补上不可变 GradingRun、强证据边与显式读面选择。
- [Inspect AI](../../research/assertion-api-dx/inspect-ai.md) 的 log rescore 说明旧 scorer 不可导入时必须明确失败；NiceEval 因而只执行当前 checkout 的 declarative link，不运行 Record 中归档的源码。
- 具名 Session / Turn Ref、`session.through(turn)` 与逐 Turn Sandbox diff 是 NiceEval 针对 Agent Eval 的扩展，不是对某家单轮 scorer API 的照搬。

## 范围

本 Roadmap 原子定义：

- inline 与 replayable 的互斥 Eval 联合；
- 多 Session、多 Turn、HITL 与具名 Ref；
- live scope 与 replay scope 的精确关系；
- Execution、Grading、GradingRun、SampleManifest 与 GradedSample；
- execution、inline 与 grading 三类身份；
- grading reuse、强制重判与错误归属；
- Record graph、current 选择、CLI 与报告选择。

以下方向各有独立 Roadmap：

- [实验 Pilot 抽样](../experiment-pilot-sampling/README.md)；
- [具名实验族](../experiment-families/README.md)；
- [Fixture 内容命令](../sandbox-fixture-content/README.md)。

Assertion 的 Fact、Match、用途与结果语义仍以 [Assertion 作者面](../assertion-authoring/README.md)为唯一契约入口。
本 Roadmap 只要求 replay grading 的用途拥有稳定 key，并复用同一套 evaluator。

## Judge / LLM 边界

本轮 replayable grading 不公开 `g.judge`、`ReplayJudge` 或其它新的 Judge / LLM API，也不改变现有 inline Judge。
Grading context 只消费确定性 Fact producer；所有示例和 fingerprint 都以这个边界为准。
离线 Judge、费用预估、懒预检、重新调用与 Observation 身份必须在后续独立 Roadmap 中设计和验收。

## 入口

- [Library](library.md) —— 四文件写法、Ref、Execution 与 Grading context。
- [Architecture](architecture.md) —— 状态机、图、身份、选择、复用与错误矩阵。
- [CLI](cli.md) —— `grade --run`、typed selector、dry plan 与报告选择。
- [多轮 HITL](use-case/multi-turn-hitl.md) —— 两条 Session、三次交互与跨轮评分。
- [历史重评分](use-case/historical-regrade.md) —— 修改 grading 后只创建新的 GradingRun。
