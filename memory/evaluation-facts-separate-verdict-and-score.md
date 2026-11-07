# 裁决：评估事实与判定、控制流、计分分离

**日期**：2026-08-09

**裁决**（目标契约落 `docs/roadmap/assertion-authoring/`）：

1. matcher、作用域方法与 Sandbox 方法只创建受管 Evaluation Fact。Fact 不携带 severity、optional、points 或停止策略，同一节点只求值一次。
2. `t.assert(fact)` 表达必须通过并继续收集独立检查；`await t.require(fact)` 表达必须通过且后续代码依赖它。控制流不再藏在 `.stopOnFailure()`。
3. `t.score(label, fact, { max })` 按 Fact 计分，`t.score(label, { earned })` 记录作者已算好的分数。`.points()` 不作为链式糖保留，避免 producer 与两个消费面重新粘回一个 handle。
4. 同一个 Fact 最多有一个判定用途和一个计分用途，两者可同时存在。Record 分开保存 FactResult 与 FactUseResult，不再从 severity、optional 与 points 的组合反推角色。
5. `defineScoreEval` 允许同一 Agent Attempt 既有硬约束又有计分。只要已经确定约束失败，终态就是 `invalid`，随后发生的证据不足或错误只作为 issue 保留，不能把 creditedScore 从 0 改成 null；尚无确定失败时，证据不足才是 `unavailable`。
6. `defineScoreEval.test` 正常返回私有品牌 `ScoreCompletion`。`finishScore()` 保证正常路径至少登记一个 Fact 计分用途；Judge-only Eval 由 legacy sidecar 证明不为空。`require`、legacy Judge stop 与 `t.skip()` 是合法的不可达例外。
7. 通用 `.optional()` 退出作者面。唯一窄例外是 core 品牌的 usage Fact 可用 `assertIfCovered()`；它先求值，只把“Agent 创建时声明 usage 不可用”导致的 unavailable 变成 notApplicable。
8. `.gate()`、`.soft()`、`.optional()`、`.stopOnFailure()` 与 `.points()` 都不属于新的 Fact API，`--strict` 退出 CLI。源码中的 `assert` / `require` / `score` 是 Fact 的唯一判定与计分声明。
9. 旧 AssertionResult / ScoreEntry 与新 Fact Record 使用不同 schema。Record schema 与 evaluation algorithm 必须升版，不做字段组合的启发式迁移。
10. 本轮不改公开 LLM / Judge API。现有 Judge handle 在 `buildJudge().deps.record` 注入点进入私有 legacy adapter，作为隔离的 `legacyJudgeAssertions` sidecar 保留现有链式语义；它不是普通 Fact，也不扩张 Fact 作者面。
11. inline `FactUseOptions.key` 可选；replayable grading 的 `assert`、`assertIfCovered` 与 `score` 必须提供 definition 内唯一的 key。key 只对齐 Fact use，不替代 `factId`、Claim identity 或 evidence locator，`show` 与 JSON 必须原样保留。
12. replayable grading 本轮不公开 `g.judge` 或 `ReplayJudge`。离线 Judge、费用与重新调用语义留到后续独立 Roadmap，不能从 legacy inline Judge bridge 隐式继承。

**保留的既有裁决**：

- `defineEval` 与 `defineScoreEval` 仍是发现期可知的两种题型；
- 计分制仍逐项累加，不声明 Eval 级满分；
- 通过率与分数分别聚合，不相加；
- 确定领域失败与基础设施或证据不足继续分开。

**推翻的方案**：

- `points × severity × stopOnFailure` 作为可组合轴：调用顺序和默认值继续产生隐藏角色。
- 计分制中“一条断言只选一个角色”：真实下游需要同一次随机 Agent Attempt 上的一份证据既约束有效性又贡献分数。
- 把通过检查与计分拆成两次 Eval：两次 Agent 执行不是同一个样本，会破坏昂贵、随机任务的测量。
- 保留 `.points()` 作为 `t.score()` 糖：它仍让一条 producer 链同时修改判定与计分，无法从代码直接看出消费者。
- 用 `--strict` 在 CI 提级：同一源码因运行参数产生不同判定，缓存身份和本地复现都要额外解释。

**实现验收条件**：

- invalid 在聚合中计 0，不能过滤或按诊断 earnedScore 计入；
- `totalScore` 的 Attempt 值只读 creditedScore，同题非 null 值取平均、跨题求和，null 不进分母；
- dangling Fact 从 FactUse 根沿 `dependencyFactIds` 正向检查，浮空或未 settle 的 requirement 单独报 author error；
- 全部终态保留已经取得的 Fact、用途与分数；
- CLI、JUnit、首过即停、缓存、携带和报告使用同一张终态映射；
- legacy Judge 的 gate、soft、optional、stopOnFailure 与 points 只在 sidecar adapter 折叠，公开 Judge 调用与模型传输不变；
- 旧 schema 不与新 schema 启发式合并。

**教训**：正交不是把每个策略都做成开关，而是让一个动作只回答一个问题。producer 只回答事实，`assert` / `require` 只回答是否必须通过，`score` 只回答怎样计分。
