# 用户故事地图

本文用具体人物的工作现场说明 NiceEval 要解决的问题。
每条故事都写明人物遇到的困难、需要的产品能力，以及可以观察的验收结果。

人物姓名、公司与业务产品是具名的代表性设定，不表示这些公司是 NiceEval 客户。
MemoryBench 与 TerminalBench 的工作场景来自真实下游项目；两者需要的能力不同，不能合并成一个抽象的“Eval 作者”。

本文不定义 API、CLI 或数据形状。
已定稿能力以每组故事链接的 Feature 与 Design 为准；尚未定稿的方向单独放在 Roadmap 故事中。

## 人物

| 人物 | 公司与产品 | 职位与日常工作 | 最难解决的问题 |
|---|---|---|---|
| 林书雅 | 忆舟科技，开发 coding agent memory 产品 RecallKit | 评测工程师；用 MemoryBench 比较无 memory、RecallKit 与其它 memory 条件 | 证明结果差异来自 memory，而不是任务、模型、环境或运行故障 |
| 陈砚舟 | 格物智能，开发终端 coding agent PatchPilot | Benchmark 工程师；维护 TerminalBench 的 NiceEval 运行版本 | 在不改变原题、隐藏测试和环境要求的前提下，让不同 Agent 跑同一批题 |
| 周芷宁 | 北辰软件，开发企业 coding agent CodeMate | Agent 产品负责人；决定哪个模型与 Agent 配置可以发布 | 在预算内得到可复验的质量、成本与可靠性对比，而不是一张无法解释的平均分 |
| 孟启航 | 云栈科技，开发托管评估服务 EvalCloud | 评估基础设施工程师；运行客户的 CI 评估与长批次 Experiment | 隔离不可信 Agent，处理瞬时故障，并避免同一基础设施错误耗尽整批预算 |
| 苏曼青 | 海岳金融，开发内部开发助手 Harbor | 模型风险负责人；复核评估范围、证据与发布结论 | 确认每个汇总数字来自哪些 Attempt，并识别未覆盖、未完成和执行错误 |
| 顾云川 | 澄路开源，维护 NiceEval | 开源维护者；修改公开行为并审查贡献 | 用用户可观察结果证明改动没有破坏产品契约 |
| 方以宁 | 知达服务，开发多 Agent 客服产品 Relay | 评测负责人；评估协调 Agent 与专业 Agent 的分工 | 判断谁完成了动作、何时交接控制权，以及各 Agent 分别花了多少成本 |

## 已定稿产品故事

### M1 林书雅：回答 memory 是否真的改善 coding agent

林书雅需要向 RecallKit 团队回答一个因果问题：加入 memory 后，真实开发任务是否完成得更多、更快、更省 token，并且少走已经验证失败的路径。
只要模型、Agent、任务、判分或起始环境同时变化，她就不能把差异归因给 memory。

MemoryBench 还包含跨任务累积状态。
有的 memory 条件必须顺序运行并在 Attempt 之间载入和回存状态；外部 memory 服务不可用时，失败也不应算成 Agent 能力不足。

- **MB-1 控制变量。** 林书雅要用同一批 Eval、同一个模型、同一个 Agent 和同一判分口径，只切换 memory 条件。NiceEval 需要把每个条件保存成可复现的 Experiment，并记录会影响运行的配置。验收时，她能确认两组结果只有预定变量不同；配置不同的 Run 不会被当成同一对照组。
- **MB-2 公平判分。** 林书雅要让 Agent 看到任务材料，但不能让它提前看到隐藏判据。NiceEval 需要把任务交互与判分分开，并让不同 memory 条件复用同一个 Eval。验收时，无 memory 与有 memory 的 Attempt 接收相同任务，最后由相同检查产生 Verdict。
- **MB-3 有状态生命周期。** 林书雅要让累积 memory 在下一道题开始前完成回存，不能让并行 Attempt 相互覆盖。NiceEval 需要提供成对的 Sandbox 生命周期 Hook 和 Experiment 并发限制。验收时，声明串行的条件按固定顺序载入、运行和回存；其它独立条件仍可并行。
- **MB-4 区分任务失败与基建失败。** 林书雅遇到 memory 服务连接失败时，需要有限重试；共享服务确定不可用时，需要停止该 Experiment 的后续派发。验收时，报告把任务未通过与执行错误分开，并保留恢复、耗尽或停止派发的原因。
- **MB-5 看见收益与代价。** 林书雅需要同时比较任务完成率、耗时、turn、工具调用、token、成本和重复试错。NiceEval 需要让报告按 memory 条件聚合这些读数，并从异常点下钻到 Attempt 的交互、命令、文件变化和判定证据。
- **MB-6 只重跑变化部分。** 林书雅调整一条 Eval 或一个 memory 配置后，不想重跑其它未受影响的昂贵任务。NiceEval 需要用 Eval 源码与运行配置的指纹判断历史结果能否沿用。验收时，变化项重新执行，未变化且结论确定的 Attempt 保留来源并进入新的 Sample。

来源：[Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md)、[执行失败分类](feature/error-classification/README.md)、[缓存与结果沿用](feature/experiments/cache.md)、[Sandbox](feature/sandbox/README.md)、[Reports](feature/reports/README.md)。

### T1 陈砚舟：忠实运行 TerminalBench，而不是重写一套相似题

陈砚舟要用 TerminalBench 检查 PatchPilot 能否完成真实终端任务。
题库里的任务有不同的镜像、依赖服务、Fixture、测试命令和超时；把它们统一裁剪成一个环境，会改变题目本身。

官方测试必须在 Agent 完成任务后才出现，最终结果由官方 `run-tests.sh` 决定。
Agent 进程正常退出不代表答案正确，环境没有就绪也不代表 Agent 解题失败。

- **TB-1 保留原题身份。** 陈砚舟要把每道 TerminalBench 题转换成稳定可选择的 Eval，同时保留题面、标签、超时和环境要求。NiceEval 需要支持一份评估意图产生多条稳定案例。验收时，他能按单题、标签或整套题选择范围，结果仍能追溯到原始题目。
- **TB-2 隔离隐藏测试。** 陈砚舟要先播种题目 Fixture，再让 Agent 工作，最后挂载官方测试并执行 `run-tests.sh`。NiceEval 需要明确任务准备、Agent 交互和判分阶段。验收时，Agent 无法提前读取官方测试，Verifier 的退出结果决定 Verdict，Agent 自身退出码不替代判分。
- **TB-3 匹配异构环境。** 陈砚舟要让 Python、数据库、多服务等任务得到各自需要的环境，同时把同一个 PatchPilot 安装到这些环境。NiceEval 需要把题目环境要求与 Agent Provision 分开，并等待依赖服务就绪。验收时，更换 Agent 不必复制题目环境；服务未就绪不会开始计 Agent 表现。
- **TB-4 起跑前发现不支持项。** 陈砚舟不想在第 73 道题才发现某个 Environment profile 没有模板。NiceEval 需要在执行前解析全部环境与 Agent 组合，并提供只查看计划的路径。验收时，计划列出会运行、会跳过和无法运行的题目及原因，不创建 Sandbox 也不消耗模型额度。
- **TB-5 尊重每题预算。** 陈砚舟要保留每道题自己的超时，并在临时排查时统一设置更小的上限。NiceEval 需要让 Eval 超时作为题目语义，同时允许 Invocation 显式覆盖。验收时，普通运行使用题目预算；统一覆盖只影响这次调用并记录在 Run 中。
- **TB-6 用 Oracle 验证评测链。** 陈砚舟要先运行官方 `solution.sh`，确认 Fixture、挂载和 Verifier 没有损坏，再花钱测 PatchPilot。NiceEval 需要让 Oracle 与真实 Agent 经过同一环境和判分路径。验收时，Oracle 失败指向评测链问题，不会被包装成 PatchPilot 的能力结论。
- **TB-7 公平比较 Agent。** 陈砚舟要让 PatchPilot、Codex 和 Claude Code 跑相同题目，并用一致事件、成本与 Verdict 口径查看结果。NiceEval 需要用 Adapter 保留各 Agent 的正式交互方式，再归一化共同观察面。验收时，换 Agent 不改 Eval，报告可以按 Agent 比较并下钻到各自的真实执行记录。

来源：[Agents 与 Adapters](feature/adapters/README.md)、[Assertions](feature/assertions/README.md)、[Sandbox](feature/sandbox/README.md)、[Environment Model 决策](design/environment-model/DECISION.md)、[Agent 安装配方决策](design/agent-install-recipe/DECISION.md)、[多容器环境决策](design/multi-container-environments/DECISION.md)。

### R1 周芷宁：在发布前选出更合适的 Agent 配置

周芷宁每周要决定 CodeMate 使用哪个 Agent、模型和推理强度。
一次发布不能只看通过率：更好的配置可能成本翻倍、尾部耗时过长，或只在少数重复 Attempt 中偶然成功。

- **REL-1 固定发布门槛。** 周芷宁要把内部回归任务、关键客户场景和外部 benchmark 组成可签入的 Experiment。NiceEval 需要保存选择范围、Agent、模型、推理强度、运行次数与预算。验收时，同一配置可以在本地和 CI 重现相同计划。
- **REL-2 执行前确认花费。** 周芷宁要在运行前看到题目数量、Attempt 数、并发和预算上限，并能收窄到一个回归切片。验收时，确认计划不会产生模型费用；正式运行不会超过每个 Experiment 的预算上限。
- **REL-3 用重复运行表达可靠性。** 周芷宁要知道一次成功是稳定能力还是偶然结果。NiceEval 需要支持同一 Eval 的多次 Attempt，并保留每次真实结果。验收时，报告按题目公平聚合通过率，同时呈现覆盖数与未完成项。
- **REL-4 同时比较质量、成本与速度。** 周芷宁需要看到每个配置的通过率、估算成本和耗时分布，而不是把它们折成一个不透明分数。验收时，报告使用同一 Sample 计算多个读数，并能定位造成取舍的具体 Eval 和 Attempt。
- **REL-5 自动进入修复循环。** 周芷宁要让 CI 稳定读取计划、进度、结果和失败证据，再把回归交给 coding agent 修复并复验。NiceEval 需要提供稳定的机器输出和可寻址的证据。验收时，自动化无需解析终端排版，也不会因为输出管道关闭而丢失结果。

来源：[Experiments](feature/experiments/README.md)、[提高评估速度](feature/use-case/提高评估速度/README.md)、[机器输出](feature/experiments/use-case/机器输出/README.md)、[Reports](feature/reports/README.md)。

### O1 孟启航：让长批次运行可恢复、可止损

孟启航替多个团队运行 EvalCloud。
被测 Agent 会执行命令和修改文件，批次又会遇到限流、网络中断、无效凭据、损坏 Fixture 与共享服务失效。

- **OPS-1 隔离并清理。** 孟启航要让每个不可信 Agent 在受控 Sandbox 中运行，并在成功、失败或中断后释放相关资源。验收时，一次 Attempt 不能修改宿主机或其它 Attempt；运行结束后没有失控进程和遗留环境。
- **OPS-2 只重试安全的瞬时故障。** 孟启航要对明确发生在请求受理前的限流或连接失败做有限重试，不能重放已经产生工具副作用的 turn。验收时，重试次数有上限，歧义错误保持不可重试，诊断说明每次恢复与最终耗尽。
- **OPS-3 让致命错误及时止损。** 孟启航确认共享凭据或服务失效后，不想让几十道题重复撞上同一错误。NiceEval 需要让作者声明失败影响单个 Attempt、整个 Eval 或整个 Experiment。验收时，止损只停止后续派发，不伪造未执行结果，也不抢占已经在飞的 Attempt。
- **OPS-4 保护长任务。** 孟启航要避免把长任务派到即将失效的 Sandbox，并希望在 Provider 支持时保留失败现场。验收时，生命周期不足会在派发前续期或拒绝；保留的 Sandbox 与 Attempt 证据可以相互定位。
- **OPS-5 续跑而非整批重来。** 孟启航修复外部服务后，要沿用已经通过且仍可比的结果，只补跑 errored 与未开始部分。验收时，新的 Run 说明哪些 Attempt 真实执行、哪些结果沿用，以及未执行项为何恢复。

来源：[Sandbox](feature/sandbox/README.md)、[Runner](runner.md)、[执行失败分类](feature/error-classification/README.md)、[缓存与结果沿用](feature/experiments/cache.md)。

### A1 苏曼青：让发布结论经得起复核

苏曼青不能只接受“CodeMate 平均通过率提高了 4%”。
她需要知道这 4%来自哪些题、哪些 Attempt、怎样的运行条件，以及是否排除了未覆盖和基础设施错误。

- **AUD-1 保存完整运行事实。** 苏曼青要复核每个 Attempt 的配置、交互、文件变化、判定、诊断、耗时与用量。NiceEval 需要把这些事实保存为可搬运的 Record。验收时，把结果目录复制到另一台机器后，仍能在不连接原运行服务的情况下读取证据。
- **AUD-2 先审范围再看指标。** 苏曼青要区分真实执行、结果沿用、跳过、未完成、执行错误和证据不足。NiceEval 需要让 Sample 同时携带选择范围、覆盖事实和警告。验收时，缺失数据不会被静默当作失败、零值或成功。
- **AUD-3 从汇总追到 Attempt。** 苏曼青要从通过率、成本或耗时读数回到组成它的 Attempt。NiceEval 需要让聚合结果保留分母口径与 Attempt 引用。验收时，每个汇总值都能解释纳入与排除规则，并下钻到原始证据。
- **AUD-4 面向不同受众交付同一结论。** 苏曼青要在终端复核、浏览器报告、静态交付和内部产品页中使用同一数据与口径。NiceEval 需要让 text / web 两面消费同一报告结果。验收时，展示形态可以不同，实体身份、数值、范围和警告保持一致。

来源：[Record](feature/record/README.md)、[Sample](feature/sample/README.md)、[Reading](feature/reading/README.md)、[Reports](feature/reports/README.md)、[Report Authoring 决策](design/report-authoring/DECISION.md)。

## 贡献者故事

### C1 顾云川：修改 NiceEval 时证明用户行为没有回归

顾云川经常重构调度、报告和记录内部结构。
如果测试只复述实现细节，他无法判断失败代表公开契约被破坏，还是内部结构发生了无害变化。

- **CON-1 用用户任务命名证明。** 顾云川需要从测试标题看出谁执行了什么动作、观察哪个公开对象、预期什么结果。验收时，他无需先阅读生产实现就能判断该测试保护的产品行为。
- **CON-2 分开公开行为与内部机制。** 顾云川需要让一个公开行为拥有一个主证明，同时用局部机制测试覆盖调度、锁、解析和代数规则。验收时，内部重构不会迫使用户故事跟随文件结构变化。
- **CON-3 让失败指向证据。** 顾云川需要测试失败报告行为身份、观察来源和证据位置。验收时，他可以单独复验目标行为，不必重跑无关的昂贵 Agent 场景。

来源：[用户可读测试决策](design/user-readable-testing/DECISION.md)。

## Roadmap 候选故事

本节描述稳定存在但公开形状尚未定稿的问题，不是产品承诺。

### F1 方以宁：评估多 Agent 客服产品 Relay

Relay 由协调 Agent、退款 Agent 和技术支持 Agent 共同完成一次客户请求。
只看最终答复无法判断协调 Agent 是否越权退款、专业 Agent 是否收到正确上下文，或成本主要花在哪个角色上。

- **MA-1 行为归属。** 方以宁要按 Agent 检查做过和没有做过的行为。候选能力需要为交互、工具调用、文件变化与用量保留可信归属；证据不完整时不能猜测归属。
- **MA-2 区分委派与交接。** 方以宁要知道协调 Agent 是请专业 Agent 提供建议，还是把后续控制权完全交给它。候选能力需要表达两种不同关系，并保留多轮路径。
- **MA-3 隔离对手成本。** 方以宁用模拟客户或谈判对手评估主被测系统时，需要把模拟侧成本与 Relay 成本分开。候选报告需要分别聚合并标注两个角色的用量。

开放边界：模拟对手是否随 Experiment 条件变化、循环交接如何表达、嵌套 Agent 的归属范围仍待裁决。

来源：[Multi-Agent Evals](roadmap/multi-agent/README.md)。

### N1 陈砚舟：接入新的 Agent 平台并保持进程语义公平

PatchPilot 团队还会测试新的 Agent SDK 和 CLI。
接入成功不只意味着能发一条消息；会话延续、人工介入、服务进程寿命、异常退出和用量都必须保持可比较。

- **ADP-R1 保持真实交互。** 陈砚舟要通过平台稳定支持的官方接口评估新 Agent，并观察连续会话、人工介入、行为和用量。能力不足的平台应明确保持不支持，不能用脆弱接口制造看似可比的结果。
- **PROC-R1 保持后台服务。** Agent 正常结束后，它为任务启动的服务要持续到判分完成。超时、中断或保留现场前，失控进程要停止，异常退出要记录为执行问题。

来源：[Adapter Roadmap](roadmap/adapters/README.md)、[Agent 进程契约](roadmap/agent-process-contract/README.md)。

### U1 孟启航：解释结果沿用与 Sandbox 复用

EvalCloud 会同时使用结果沿用和 Sandbox 复用来缩短运行时间。
前者表示 Attempt 没有重新执行，后者表示 Attempt 执行了但与其它 Attempt 共用环境；混在一个“复用”计数里会误导风险判断。

- **REUSE-R1 分开两种事实。** 孟启航要在机器输出与人读报告中分别看到结果沿用数量、真实执行数量、复用 Sandbox 数量和 Sandbox 更换原因。
- **REUSE-R2 保持计数语义。** 自动化依赖这些计数时，术语或字段变化不能静默改变含义。候选能力需要给出明确迁移失败，而不是继续产出名称相同、口径不同的数字。

开放边界：是否单列环境准备失败，仍会影响用户能否区分容量不足、创建失败与正常更换。

来源：[结果沿用与 Sandbox 复用反馈](roadmap/reuse-feedback/README.md)。
