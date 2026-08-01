# 用户故事地图

本文用具体人物的工作现场说明 NiceEval 要解决的问题。
每条故事都写明人物遇到的困难、需要的产品能力，以及可以观察的验收结果。

人物姓名、公司与业务产品是具名的代表性设定，不表示这些公司是 NiceEval 客户。
MemoryBench 与 TerminalBench 的工作场景来自真实下游项目；两者需要的能力不同，不能合并成一个抽象的“Eval 作者”。

本文不定义 API、CLI 或数据形状。
已定稿能力以每组故事链接的 Feature 与 Design 为准；尚未定稿的方向单独放在 Roadmap 故事中。
文末的 Feature 覆盖表以 `docs/feature/` 的一级目录为清单，确保每组已定稿能力都有真实故事承接。

## 人物

| 人物 | 公司与产品 | 职位与日常工作 | 最难解决的问题 |
|---|---|---|---|
| 林书雅 | 忆舟科技，开发 coding agent memory 产品 RecallKit | 评测工程师；用 MemoryBench 比较无 memory、RecallKit 与其它 memory 条件 | 让 Experiment 承担 memory 条件与状态，让同一批轻量 Eval 保持不变 |
| 陈砚舟 | 格物智能，开发终端 coding agent PatchPilot | Benchmark 工程师；维护 TerminalBench 的 NiceEval 运行版本 | 让每道 Eval 拥有原题环境，同时让不同 Agent 跑同一批题 |
| 唐诗涵 | 知芽教育，开发 AI 学习导师小问 | 对话质量负责人；评估讲解、追问、工具使用与安全拒答 | 把开放式质量、硬性安全要求和证据缺失表达成不同结果 |
| 周芷宁 | 北辰软件，开发企业 coding agent CodeMate | Agent 产品负责人；决定哪个模型与 Agent 配置可以发布 | 在预算内得到可复验的质量、成本与可靠性对比，而不是一张无法解释的平均分 |
| 孟启航 | 云栈科技，开发托管评估服务 EvalCloud | 评估基础设施工程师；运行客户的 CI 评估与长批次 Experiment | 隔离不可信 Agent，处理瞬时故障，并避免同一基础设施错误耗尽整批预算 |
| 苏曼青 | 海岳金融，开发内部开发助手 Harbor | 模型风险负责人；复核评估范围、证据与发布结论 | 确认每个汇总数字来自哪些 Attempt，并识别未覆盖、未完成和执行错误 |
| 顾云川 | 澄路开源，维护 NiceEval | 开源维护者；修改公开行为并审查贡献 | 用用户可观察结果证明改动没有破坏产品契约 |
| 方以宁 | 知达服务，开发多 Agent 客服产品 Relay | 评测负责人；评估协调 Agent 与专业 Agent 的分工 | 判断谁完成了动作、何时交接控制权，以及各 Agent 分别花了多少成本 |

## 两种相反的配置重心

“重 Experiment”与“重 Eval 环境”描述配置所有权，不描述哪一边运行得更慢。
MemoryBench 的变量主要随对比条件变化；TerminalBench 的环境主要随题目变化。

| 配置问题 | MemoryBench | TerminalBench |
|---|---|---|
| 主要变化轴 | memory 条件、Agent、模型、状态策略与并发策略 | 每道题的 Compose、Dockerfile、服务、Fixture、隐藏测试与超时 |
| 配置重心 | Experiment 重；Eval 相对轻 | Eval Environment 重；Experiment 相对薄 |
| Eval 拥有什么 | 开发任务、固定仓库版本、项目依赖与判分；多数 Eval 不声明 Environment | 数据集 adapter 从 task package 派生 EvalDef、EnvironmentSource 与隐藏 Verifier |
| Experiment 拥有什么 | E2B defaultEnvironment、memory 工具、Sandbox setup / teardown、状态复用与并发限制 | Agent、运行范围，以及选择 Environment Provider 的 SandboxConfig |
| 更换对比条件时 | 复用同一批 Eval，只替换 Experiment | 复用每题 Environment，只替换 Agent 或其它 Experiment 条件 |
| 不支持的组合 | 单条 Eval 有独立 Environment 时，为该 profile 提供完整 case，或明确跳过 | Provider 不能承载题目 Environment 时，提供等价完整 case，或在计划期明确跳过 |

两条路径仍遵守同一条边界：一次 Attempt 只有一个完整 Sandbox Case。
Runner 不把两个起点在运行时自动合并；Experiment 变化的准备放 SandboxConfig setup，Eval 变化的题目准备放 EvalDef setup，Agent 安装由 Adapter 管理。

配置责任来源：[Environment Model 决策](design/environment-model/DECISION.md)。

## 已定稿产品故事

### M1 林书雅：回答 memory 是否真的改善 coding agent

林书雅需要向 RecallKit 团队回答一个因果问题：加入 memory 后，真实开发任务是否完成得更多、更快、更省 token，并且少走已经验证失败的路径。
只要模型、Agent、任务、判分或起始环境同时变化，她就不能把差异归因给 memory。

MemoryBench 还包含跨任务累积状态。
有的 memory 条件必须顺序运行并在 Attempt 之间载入和回存状态；外部 memory 服务不可用时，失败也不应算成 Agent 能力不足。

这里的 Eval 相对轻，并不表示任务简单。
它只负责准备固定仓库版本、项目依赖、任务说明和判分；默认 Sandbox 起点、memory 工具与状态策略由 Experiment 配置。

- **MB-1 用 Experiment 定义对比格。** 林书雅要用同一批 Eval、同一个模型、同一个 Agent 和同一判分口径，只切换 memory 条件。NiceEval 需要把无 memory、RecallKit 与其它条件分别保存成可复现的 Experiment。验收时，两组结果只有预定变量不同；配置不同的 Run 不会被当成同一对照组。
- **MB-2 让 Eval 保持轻且稳定。** 林书雅要让每条 Eval 只描述开发任务、固定仓库版本、依赖准备与判分，不能引用 RecallKit 或某个 E2B template。验收时，同一条 Eval 原样进入所有 memory Experiment；切换 memory 条件不复制任务，也不改变题目准备。
- **MB-3 由 Experiment 选择默认环境。** 林书雅要让 baseline 使用公共 Agent template，让 RecallKit 条件使用预装工具的派生 template。NiceEval 需要让无 Environment 的 Eval 从 SandboxConfig defaultEnvironment 启动。验收时，template、memory skill 与工具版本随 Experiment 变化，Eval 身份不变。
- **MB-4 管理有状态生命周期。** 林书雅要在 Agent 开始前检查 memory 工具并载入状态，在 Sandbox 收尾时回存 checkpoint。NiceEval 需要让 SandboxConfig setup / teardown 作用于最终 Sandbox，并用 Experiment 并发限制保护累积状态。验收时，声明串行的条件按固定顺序载入、运行和回存；其它独立条件仍可并行。
- **MB-5 支持少数重环境 Eval。** 某条 MemoryBench Eval 自己需要 Compose 时，林书雅要让这条题声明 Environment，其它 Eval 仍使用 defaultEnvironment。NiceEval 需要为该 Environment profile 选择完整 Sandbox Case，不能把两个起点自动合并。验收时，能提供完整 case 的组合照常运行；不能提供的组合在计划期说明原因并跳过。
- **MB-6 公平判分。** 林书雅要让 Agent 看到任务材料，但不能让它提前看到隐藏判据。NiceEval 需要把任务交互与判分分开，并让不同 memory 条件复用同一个 Eval。验收时，无 memory 与有 memory 的 Attempt 接收相同任务，最后由相同检查产生 Verdict。
- **MB-7 区分任务失败与基建失败。** 林书雅遇到 memory 服务连接失败时，需要有限重试；共享服务确定不可用时，需要停止该 Experiment 的后续派发。验收时，报告把任务未通过与执行错误分开，并保留恢复、耗尽或停止派发的原因。
- **MB-8 看见收益与代价。** 林书雅需要同时比较任务完成率、耗时、turn、工具调用、token、成本和重复试错。NiceEval 需要让报告按 memory 条件聚合这些读数，并从异常点下钻到 Attempt 的交互、命令、文件变化和判定证据。
- **MB-9 只重跑变化部分。** 林书雅调整一条 Eval 或一个 memory 配置后，不想重跑其它未受影响的昂贵任务。NiceEval 需要用 Eval 源码与运行配置的指纹判断历史结果能否沿用。验收时，变化项重新执行，未变化且结论确定的 Attempt 保留来源并进入新的 Sample。

来源：[Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md)、[Environment Model 决策](design/environment-model/DECISION.md)、[执行失败分类](feature/error-classification/README.md)、[缓存与结果沿用](feature/experiments/cache.md)、[Sandbox](feature/sandbox/README.md)、[Reports](feature/reports/README.md)。

### T1 陈砚舟：忠实运行 TerminalBench，而不是重写一套相似题

陈砚舟要用 TerminalBench 检查 PatchPilot 能否完成真实终端任务。
题库里的任务有不同的镜像、依赖服务、Fixture、测试命令和超时；把它们统一裁剪成一个环境，会改变题目本身。

官方测试必须在 Agent 完成任务后才出现，最终结果由官方 `run-tests.sh` 决定。
Agent 进程正常退出不代表答案正确，环境没有就绪也不代表 Agent 解题失败。

这里的环境重心在 Eval。
每个 TerminalBench task package 是环境事实的 owner；Experiment 选择怎样承载这些环境，但不能用自己的 defaultEnvironment 替换题目的 Compose 或镜像。

- **TB-1 从 task package 派生 Eval。** 陈砚舟要让数据集 adapter 读取每道题的 instruction、标签、超时、Compose、Dockerfile、测试与私有参考，不为数百道题手写重复 wrapper。验收时，每个上游 task id 产生稳定 Eval id，结果能追溯到锁定的数据集版本。
- **TB-2 让 Eval 拥有 EnvironmentSource。** 陈砚舟要让每道题的 Compose、公开 build inputs、主服务和就绪条件随 Eval 一起进入计划。NiceEval 需要让 adapter 产出 Provider-neutral EnvironmentSource。验收时，更换 Experiment 不改变题目环境身份，更换数据集内容会使受影响环境重新构建。
- **TB-3 由 Experiment 选择环境承载方式。** 陈砚舟要用 Docker、E2B 或其它 Provider 运行同一批题。NiceEval 需要让 SandboxConfig 选择的 Provider 把每题 Environment 解析成一个完整 Sandbox Case。验收时，Provider 不支持某个环境时只能提供等价完整 Case 或明确跳过，不能回退到丢失题目要求的 defaultEnvironment。
- **TB-4 把 Agent 安装与题目环境分开。** 陈砚舟要把 PatchPilot、Codex 或 Claude Code 安装到最终主 Sandbox，不能为每个 Agent 复制 task package。NiceEval 需要让 Adapter 检查、必要时安装并复检 Agent。验收时，Agent 身份进入可比性记录，安装事实不会改变题目 Environment 身份。
- **TB-5 隔离隐藏测试与私有参考。** 陈砚舟要先启动题目环境并让 Agent 工作，最后才挂载 `run-tests.sh` 与 `tests/**`；`solution.sh` 永远不能进入 build context 或 Sandbox。验收时，即使 Dockerfile 使用宽泛的 `COPY`，隐藏测试和私有参考也不会被 Agent 或镜像构建读取。
- **TB-6 保留官方判分。** 陈砚舟要让 Verifier 的退出结果决定 Verdict，不能用 Agent 进程退出码代替。验收时，Agent 正常退出但官方测试失败仍判任务未通过；环境启动失败记录为执行问题，不计入 Agent 解题能力。
- **TB-7 起跑前发现不支持项。** 陈砚舟不想在第 73 道题才发现某个 Environment profile 没有可用 Case。NiceEval 需要在执行前解析全部 Environment、SandboxConfig 与 Agent 组合，并提供只查看计划的路径。验收时，计划列出会运行、会跳过和无法运行的题目及原因，不创建 Sandbox 也不消耗模型额度。
- **TB-8 尊重每题预算。** 陈砚舟要保留每道题自己的 Agent 与测试超时，并在临时排查时统一设置更小的上限。NiceEval 需要让 Eval 超时作为题目语义，同时允许 Invocation 显式覆盖。验收时，普通运行使用题目预算；统一覆盖只影响这次调用并记录在 Run 中。
- **TB-9 用 Oracle 验证评测链。** 陈砚舟要先运行官方 `solution.sh`，确认环境、Fixture、挂载和 Verifier 没有损坏，再花钱测 PatchPilot。NiceEval 需要让 Oracle 与真实 Agent 经过同一环境和判分路径。验收时，Oracle 失败指向评测链问题，不会被包装成 PatchPilot 的能力结论。
- **TB-10 公平比较 Agent。** 陈砚舟要让 PatchPilot、Codex 和 Claude Code 跑相同题目，并用一致事件、成本与 Verdict 口径查看结果。NiceEval 需要用 Adapter 保留各 Agent 的正式交互方式，再归一化共同观察面。验收时，换 Agent 不改 Eval，报告可以按 Agent 比较并下钻到各自的真实执行记录。

来源：[Eval](feature/eval/README.md)、[Experiments](feature/experiments/README.md)、[Agents 与 Adapters](feature/adapters/README.md)、[Assertions](feature/assertions/README.md)、[Sandbox](feature/sandbox/README.md)、[Environment Model 决策](design/environment-model/DECISION.md)、[Agent 安装配方决策](design/agent-install-recipe/DECISION.md)、[多容器环境决策](design/multi-container-environments/DECISION.md)。

### Q1 唐诗涵：评价开放式对话，而不是强行写成字符串匹配

唐诗涵要确认小问能在多轮辅导中给出正确、适龄且不直接泄露答案的解释。
其中既有“计算结果必须正确”这样的硬要求，也有“讲解是否适合十岁孩子”这样的开放式质量，还可能发生裁判模型不可用。

- **TUT-1 驱动真实会话。** 唐诗涵要测试单轮问答、多轮追问、并行会话和等待教师批准后继续的流程。NiceEval 需要让 Eval 驱动正式 Agent 会话，并让检查绑定到具体 Turn、Session 或整次 Attempt。验收时，每轮输入、回复、人工介入与会话身份完整保存，后续检查不会混用别的会话。
- **TUT-2 用证据合适的检查。** 唐诗涵要用确定性 matcher 检查答案和 schema，用作用域检查验证工具顺序与禁止行为，用 Sandbox 命令验证产物，再给成本设置上限。NiceEval 需要让这些检查产生统一 AssertionResult，并保存实际值、期望、作用域与证据。验收时，报告能说明哪一条检查失败以及依据是什么。
- **TUT-3 表达部分完成。** 一道五步教学任务完成三步时，唐诗涵需要得到 3 分，而不是把它伪装成整题通过或完全失败。NiceEval 需要区分通过制 Eval 与计分制 Eval。验收时，独立可运行的学生问题拆成多条 Eval；同一任务内有意义的检查点按分值累积，通过率与总分在报告中分列。
- **TUT-4 用 Judge 评价开放式质量。** 唐诗涵无法用固定规则判断讲解是否适龄，需要由独立裁判模型评价指定回复、对话或 diff。NiceEval 需要让 Judge 使用独立模型、端点与凭据，并在派发昂贵 Agent 前检查端点连通与鉴权。验收时，裁判调用有超时且不暗中重试；模型、凭据或响应不可用时留下 unavailable 原因，不伪造零分或通过。
- **TUT-5 分开质量线与发布门禁。** 唐诗涵把“不得给出危险操作”设为 gate，把“语言亲切”保留为 soft 质量分，并允许一个探索性风格 Judge 缺席。NiceEval 需要用 Severity、optional 与 `--strict` 控制这些结果怎样折叠。验收时，gate 未通过得到 failed，执行或必要证据不可用得到 errored，显式跳过得到 skipped，其余才是 passed；`--strict` 只把 soft 质量线收紧为门禁。
- **TUT-6 预检只影响需要 Judge 的题。** 小问的一批 Eval 同时包含确定性数学题和开放式讲解题。判分端点不可用时，唐诗涵仍要保留不依赖 Judge 的数学结果。验收时，需要 Judge 的计划项在 Agent 派发前记录预检错误；其它 Eval 照常运行，不因共享配置问题整批作废。

来源：[Eval](feature/eval/README.md)、[Assertions](feature/assertions/README.md)、[Judge](feature/judge/README.md)、[Verdict](feature/verdict/README.md)、[Agents 与 Adapters](feature/adapters/README.md)。

### R1 周芷宁：在发布前选出更合适的 Agent 配置

周芷宁每周要决定 CodeMate 使用哪个 Agent、模型和推理强度。
一次发布不能只看通过率：更好的配置可能成本翻倍、尾部耗时过长，或只在少数重复 Attempt 中偶然成功。

- **REL-1 固定发布门槛。** 周芷宁要把内部回归任务、关键客户场景和外部 benchmark 组成可签入的 Experiment。NiceEval 需要保存选择范围、Agent、模型、推理强度、运行次数与预算。验收时，同一配置可以在本地和 CI 重现相同计划。
- **REL-2 执行前确认花费。** 周芷宁要在运行前看到题目数量、Attempt 数、并发和预算上限，并能收窄到一个回归切片。验收时，确认计划不会产生模型费用；正式运行不会超过每个 Experiment 的预算上限。
- **REL-3 用重复运行表达可靠性。** 周芷宁要知道一次成功是稳定能力还是偶然结果。NiceEval 需要支持同一 Eval 的多次 Attempt，并保留每次真实结果。验收时，报告按题目公平聚合通过率，同时呈现覆盖数与未完成项。
- **REL-4 同时比较质量、成本与速度。** 周芷宁需要看到每个配置的通过率、估算成本和耗时分布，而不是把它们折成一个不透明分数。验收时，报告使用同一 Sample 计算多个读数，并能定位造成取舍的具体 Eval 和 Attempt。
- **REL-5 自动进入修复循环。** 周芷宁要让 CI 稳定读取计划、进度、结果和失败证据，再把回归交给 coding agent 修复并复验。NiceEval 需要提供稳定的机器输出和可寻址的证据。验收时，自动化无需解析终端排版，也不会因为输出管道关闭而丢失结果。

来源：[Experiments](feature/experiments/README.md)、[提高评估速度](feature/use-case/提高评估速度/README.md)、[机器输出](feature/experiments/use-case/机器输出/README.md)、[Reports](feature/reports/README.md)。

### R2 周芷宁：修复后只重跑真正需要复验的部分

CodeMate 的一次完整回归需要数小时和真实模型费用。
周芷宁既不能每次从零开始，也不能因为旧结果更便宜就把已受变化影响的结果带进发布结论。

- **RUN-1 默认沿用未受影响的确定结果。** 周芷宁只修改报告标题或 Experiment label 时，不想重新执行 Agent。NiceEval 需要用 Eval 源码闭包、运行配置、Agent 身份和 Sandbox 身份计算指纹。验收时，指纹未变的 passed 与 failed Attempt 可以沿用；errored、skipped 和缺失序号仍要执行，沿用项保留原始来源。
- **RUN-2 变化项自动失效。** 周芷宁修改 Eval、公共 helper、模型、Judge、运行 flags、Agent 身份或 Sandbox 环境时，需要只作废真正受影响的结果。验收时，变化进入对应指纹层；只供报告归类的 label 和运行时才知道的实例地址不会误触发整批重跑。
- **RUN-3 修复产品后只复验旧失败。** CodeMate 发布了修复，但外部部署地址和 Experiment 源码没有变化。周芷宁要主动重新执行历史 failed 项，同时保留历史 passed 项。NiceEval 需要提供一次性的失败项重跑口径。验收时，旧失败产生新的 Attempt，旧通过以结果沿用进入 Sample，errored 与缺失项按默认恢复规则执行。
- **RUN-4 外部事实变化时全量重验。** 模型供应商静默更新了服务，或一项外部依赖行为改变但本地指纹无法观察。周芷宁需要忽略全部历史结果。NiceEval 需要提供一次性的全量重跑口径。验收时，所有计划 Attempt 真实执行；这次选择不篡改后续运行使用的指纹定义。
- **RUN-5 区分结果沿用与 Sandbox 复用。** 周芷宁做本地冒烟时，希望十条 Eval 共用一个已经装好依赖的 Sandbox，但每条题仍要真实运行。NiceEval 需要让 `sandboxReuse` 只分摊创建与 SandboxSpec setup。验收时，每条 Attempt 都有新的执行证据和 Verdict，报告不会把它们标成结果沿用。
- **RUN-6 复用前恢复可接受起点。** 共用 Sandbox 的前一道题可能修改代码、启动进程或写入缓存。NiceEval 需要在 Attempt 之间回到声明的重置点，并按 Environment Case 分开复用。验收时，题目变化不会泄漏到下一条 Attempt；异构环境不会进入同一个复用池，寿命不足的 Sandbox 会在派发前更换。
- **RUN-7 按问题选择提速方式。** 周芷宁只想确认“至少成功一次”时使用首过即停；要测稳定通过率时跑满所有 Attempt；独立任务才提高并发。验收时，首过即停不伪装成完整通过率，共享状态的 Experiment 可以保持串行，全局容量限制不会改变题目与判分。

来源：[缓存与结果沿用](feature/experiments/cache.md)、[`--rerun` 用例](feature/experiments/use-case/重新运行/README.md)、[Sandbox 复用](feature/sandbox/reuse.md)、[提高评估速度](feature/use-case/提高评估速度/README.md)、[Experiments](feature/experiments/README.md)。

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

- **AUD-1 保存完整运行事实。** 苏曼青要复核每个 Attempt 的配置、交互、文件变化、判定、诊断、耗时与用量。NiceEval 需要把这些事实保存为 Record，并为 Attempt 提供稳定定位符。验收时，第三方 harness 可以写入同一格式；读取者能按定位符加载大文件，而不从终端文案反推事实。
- **AUD-2 先审范围再看指标。** 苏曼青要区分真实执行、结果沿用、跳过、未完成、执行错误和证据不足。NiceEval 需要让 Sample 同时携带选择模式、时效、覆盖事实和结构化 Issue。验收时，配置不可比的 Run 不会被缝成同一 Sample，缺失数据也不会被静默当作失败、零值或成功。
- **AUD-3 明确选择最新、当前或本次新执行。** 苏曼青复核发布水位时要看每道题的当前结论，调查一次事故时只看最新 Run，检查本次成本时只看 fresh Attempt。NiceEval 需要提供不同 Sample 选择器和只删减的 scope / filter。验收时，选择口径写在返回值里，覆盖与 Issue 跟着删减后的 Sample 一起变化。
- **AUD-4 从汇总追到 Attempt。** 苏曼青要从通过率、成本或耗时读数回到组成它的 Attempt。NiceEval 需要让聚合结果保留分母口径与 Attempt 引用。验收时，每个汇总值都能解释纳入与排除规则，并下钻到原始证据。
- **AUD-5 按调查任务读取。** 苏曼青要按 Experiment、Eval 前缀、Run 或记录根收窄结果，并在运行中观察结果逐条出现。NiceEval 需要让 show、view 和脚本读取共享 Record → Sample → Report 管线。验收时，宿主只改变入口与展示，不私自改变选择、指标或证据身份。
- **AUD-6 发布自包含的结果子集。** 苏曼青向审计委员会交付结果时，只能带选中的 Run 和它们引用的 artifact，不能留下指向内部机器的路径。NiceEval 需要把 Sample 发布成自包含 Record，或导出同一范围的静态站点。验收时，离线目录可以独立打开；删除原记录根不会使已发布证据失效。
- **AUD-7 构建有业务语义的报告。** 苏曼青要把通过率、成本、风险等级和外部业务分组放进同一份多页报告，并从异常图点下钻到 Attempt。NiceEval 需要让报告作者用普通转换、聚合与组件组织 Sample，同时为非标准算法补齐分母与 refs。验收时，报告可以加入冻结的外部数据，但不能隐藏只对某张图生效的 Sample 过滤。
- **AUD-8 面向不同受众交付同一结论。** 苏曼青要在终端、浏览器、静态站点和 Harbor 内部产品页中使用同一数据与口径。NiceEval 需要让 text / web 两面消费同一报告结果。验收时，展示形态可以不同，实体身份、数值、范围、下钻目标和警告保持一致。

来源：[Record](feature/record/README.md)、[Sample](feature/sample/README.md)、[Reading](feature/reading/README.md)、[Reports](feature/reports/README.md)、[Report Authoring 决策](design/report-authoring/DECISION.md)。

## Feature 覆盖表

这张表以 `docs/feature/` 的一级功能目录为清单。
Story 一栏只引用上文已经写清人物、困难、能力与验收的故事，不用抽象角色代替遗漏。

| Feature | 它在真实工作中解决什么 | Story |
|---|---|---|
| [Adapters](feature/adapters/README.md) | 用 Agent 正式支持的会话方式评估，并把不同 Agent 安装到最终任务环境 | TB-4、TB-10、TUT-1 |
| [Eval](feature/eval/README.md) | 描述单轮、多轮、HITL、数据集题目、Fixture、隐藏判据和通过制或计分制 | MB-2、TB-1、TB-5、TUT-1、TUT-3 |
| [Experiments](feature/experiments/README.md) | 选择 Agent、模型、Eval、预算、并发与生命周期，并决定哪些 Attempt 执行 | MB-1、MB-3、MB-4、REL-1、REL-2、RUN-1 至 RUN-7 |
| [Sandbox](feature/sandbox/README.md) | 隔离不可信执行，承载异构 Environment，留存现场并安全复用 Sandbox | MB-3 至 MB-5、TB-2 至 TB-5、RUN-5、RUN-6、OPS-1、OPS-4 |
| [Assertions](feature/assertions/README.md) | 用值、行为、Sandbox、资源和 Judge 证据检查结果，并记录检查依据 | MB-6、TB-6、TUT-2 |
| [Judge](feature/judge/README.md) | 评价固定规则难以表达的开放式质量，并如实处理端点或证据不可用 | TUT-4、TUT-6 |
| [Verdict](feature/verdict/README.md) | 把 gate、soft、optional、执行状态与证据缺失折叠成四种互斥终态 | TB-6、TUT-3、TUT-5 |
| [执行失败分类](feature/error-classification/README.md) | 只重试安全的瞬时故障，并按失败波及范围停止无意义的后续派发 | MB-7、OPS-2、OPS-3 |
| [Record](feature/record/README.md) | 保存可寻址的运行事实，接收第三方结果，并发布自包含证据目录 | AUD-1、AUD-6 |
| [Sample](feature/sample/README.md) | 从全部历史中选出明确口径、覆盖与时效的一批可比较 Attempt | AUD-2、AUD-3 |
| [Reading](feature/reading/README.md) | 让终端、浏览器、静态发布和脚本沿同一事实到呈现管线读取 | AUD-5、AUD-6、AUD-8 |
| [Reports](feature/reports/README.md) | 计算可追溯指标、调试失败、分析取舍并交付业务报告 | MB-8、REL-4、REL-5、AUD-4、AUD-7、AUD-8 |
| [跨 Feature 用例](feature/use-case/README.md) | 按最终目标选择结果沿用、重跑、并发、Sandbox 复用或调试现场 | RUN-1 至 RUN-7、REL-5、OPS-4 |

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
