# Ori Eval：Skill、评估框架与 NiceEval 的关系

> 观察日期：2026-08-06
>
> 观察对象：`spawn-ori-eval` Skill、Ori Eval、Ori Harness、NiceEval `INIT.md` 与 NiceEval-Eval 安装评估
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 结论

`https://openrouter.ai/skills/spawn-ori-eval` 指向的是一个标准 Agent Skill。
它不是评估框架本身，而是安装、启动和编排 Ori 的外层工作流。

Ori Eval 才是实际的评估框架，Ori Harness 是它调用本地 coding agent 的运行层。
因此，“它是 Skill 还是评估框架”的准确答案是：入口是 Skill，背后调用的是评估框架和 Agent Harness。

Ori Eval 与 NiceEval 属于同一竞品类别，但产品切面不同。
Ori 把“从仓库发现评估面、询问成功标准、挑候选模型、生成临时评估、跑完后排名”做成一条很强的短路径。
NiceEval 的边界更宽，重点是 Eval、Experiment、Adapter、Sandbox、Record、Sample 与报告之间的长期契约。

最值得 NiceEval 学的不是 Ori 的 TypeScript API，而是它把“我该用哪个模型”这种结果导向意图包装成了可安装 Skill。
NiceEval 应优先考虑一个 `create-niceeval-eval` Skill，复用现有 `INIT.md` 和随包 `INDEX.md`，而不是把另一套 API 教程复制进 Skill。

## 一手来源

本研究只把以下官方材料当作 Ori 事实来源：

- [spawn-ori-eval 产品页](https://openrouter.ai/skills/spawn-ori-eval)
- [spawn-ori-eval Skill 源码](https://github.com/OpenRouterTeam/skills/blob/main/skills/spawn-ori-eval/SKILL.md)
- [Ori Eval 指南](https://openrouter.ai/docs/guides/ori/eval)
- [Ori Harness 指南](https://openrouter.ai/docs/guides/ori/harness)
- [Ori release 仓库](https://github.com/OpenRouterLabs/ori-releases)

观察日的 release manifest 为 `0.4.0+063b32e`，构建时间是 2026-08-03。
Ori release 仓库声明 Apache-2.0 覆盖发布资产与构建二进制所用源码。

NiceEval 对照材料来自仓库根部 `INIT.md`、随包 `INDEX.md` 和相邻 NiceEval-Eval 仓库中的安装评估源码。
原问题所说的 `INSTALL.md` 在仓库中并不存在；当前承担自动安装与接入引导职责的是 `INIT.md`。

## Ori 的产品分层

| 层 | 责任 | 不是它的责任 |
|---|---|---|
| `spawn-ori-eval` Skill | 预检 Ori、鉴权和 Bun；管理临时目录；启动无头 Ori；转交问题；汇总排名、成本与耗时 | 不直接编写评估，不直接逐个启动候选模型 |
| `create-eval` Skill | 扫描仓库，询问评估面、数据、判据、限制和候选，生成一次性评估 | 不取代 Ori Eval runner |
| Ori Eval | 发现并执行 `*.eval.ts`，运行候选模型和 Judge，输出断言、排名、报告与参照结果比较 | 不负责 coding agent 的具体本地工具循环 |
| Ori Harness | 启动 Claude Code、Codex、Hermes、OpenCode 等本地 Agent CLI | 临时工作目录不等于隔离 Sandbox |
| OpenRouter | 提供模型目录、路由、价格和鉴权 | 不是通用的评估记录模型 |

### `spawn-ori-eval` 实际做了什么

Skill 固定在仓库外创建 `/tmp/spawn-ori-eval-<hash>`，保存步骤、完整 prompt、每次回答和错误日志。
它检查或安装 `ori`，运行 `ori auth`，检查 Bun，并在每次启动前重新读取当前 CLI 帮助和 Eval Skill。

Skill 用固定 authoring model 启动 `ori code --prompt-file`。
观察日的 Skill 同时把运行模型和 Judge 模型钉为 `openai/gpt-5.6-terra`。
固定模型的目的，是让不同宿主 Agent 触发 Skill 时，评估作者和 Judge 环境保持一致。

Ori 的访谈最少有五个问题，最多六个问题。
问题覆盖被测表面或工作区材料、真实数据、判据优先级、成本或运行限制、候选模型，以及结果出来后的下一步。
外层 Skill 不代用户回答，每得到一个答案就把完整 prompt 重新交给一次新的 Ori 进程。

生成的 Eval 位于用户仓库外的临时工作区。
Skill 明确禁止把它直接写进用户仓库，结果出来后才告诉用户可以选择迁入项目。

Ori Eval 使用 Bun test 作为执行外壳。
评估文件可以配置候选模型、Agent 和 Judge，并断言完成文本、工具调用、成本和耗时。
CLI 负责运行整个候选矩阵，也能输出 Markdown、JUnit 和相对历史参照结果的报告。

## 与 NiceEval 的概念映射

| 问题 | Ori | NiceEval | 关键差异 |
|---|---|---|---|
| 定义测什么 | `*.eval.ts` 中的 test 与断言 | Eval | 两者都把任务和判定放在评估定义中 |
| 定义怎么跑 | `setupAgent`、候选模型与 Eval 配置 | Experiment | NiceEval 强制把运行配置与 Eval 分离 |
| 驱动被测 Agent | Ori Harness 或自定义 harness | Adapter | NiceEval 用标准事件、会话与证据覆盖声明约束 Adapter |
| 隔离执行 | 本地 Agent CLI 与临时工作区 | Sandbox Provider | Ori 的临时目录提供可丢弃性，不自动提供容器或 micro-VM 隔离 |
| 语义评分 | `setupJudge` 与 LLM Judge | Judge Assertion | 两者都要求 Judge 与候选角色可区分 |
| 重复与比较 | 候选模型、排名、baseline | Experiment、Attempt、Sample、Report | NiceEval 的记录、携带和可比较性契约更细 |
| 自动选候选 | OpenRouter live model catalog | 用户或 Experiment 作者声明 | Ori 的 OpenRouter 垂直整合更顺滑，NiceEval 更中立 |
| 自动接入 | 可安装 Skill 完成访谈、生成与运行 | `INIT.md` 安装后路由随包文档 | NiceEval 已有引导内容，但缺少结果导向的可安装工作流 |
| 临时转长期 | 结果后由用户决定是否迁入 | 通常直接在项目中形成三件套 | Ori 优化一次性选型，NiceEval 优化持续评估资产 |

Ori 是 NiceEval 在“模型或 Agent 选择”场景中的直接竞品。
它不是 NiceEval 全部能力的一一替代品：Sandbox 生命周期、标准事件证据、物理记录、Sample 口径和报告消费都不应被压成一个候选模型排名表。

## NiceEval 的自动安装入口

NiceEval 的 `INIT.md` 已经具备 Skill 的一部分特征，但它仍是一份通过 URL 读取的安装与接入说明。
它的现有路径是：

1. 判断 NiceEval 应装在 JavaScript 宿主根部，还是非 JavaScript 项目的独立 ESM 子目录。
2. 安装精确候选版本并运行 `niceeval init`，由 CLI 写入配置、Eval 目录和受管 Agent 指引。
3. 进入安装包内的 `INDEX.md`，只读取与当前版本匹配的任务页。
4. 先探索真实项目，再确认传输、OTel、变体配置与接入等级。
5. 分别写 Adapter、Experiment 和 Eval，用真实核心用例、实质断言和负例完成第一条绿色运行。
6. 用 `niceeval show` 检查结果，再向用户说明更深接入的选择。

这条路径比普通安装脚本多做了两件重要的事：版本对齐的文档路由，以及把“装上依赖”提升为“跑通真实 Eval”。
它与 Ori Skill 的差距不在知识量，而在触发方式、会话状态、成本计划、临时试验和结果汇总这些编排能力。

## NiceEval-Eval 如何评这个入口

### 候选与题目

安装实验对 `v0.11.0`、`v0.12.0` 和运行时解析为精确版本的 `canary` 使用同一 Agent、模型、Sandbox 与题目。
每个候选只改变被安装的 NiceEval 版本，目的是把结果差异尽量归因到对应版本的 `INIT.md` 与随包文档。

当前安装题目只有两个真实 Python 项目：

| 题目 | 协议难点 | 质量风险 |
|---|---|---|
| DB-GPT `v0.8.1` | OpenAI 兼容 HTTP，但必须进入真实数据库对话模式 | 误接普通聊天旁路，或编造不存在的表和字段 |
| GPT Researcher `v3.6.0` | 自定义 WebSocket 帧，需要把来源和进度映射成事件 | 只检查任务提交回执，或输出无来源的研究结论 |

`advance/` 还覆盖 Letta、OpenHands、Skyvern 和 Express coding agent Sandbox。
它们用于评更复杂的多轮、轮询、协议映射和预制环境，不与两条安装题的分数直接横比。

### 评估项

| 维度 | 取证方式 | 判定性质 |
|---|---|---|
| 动手前的交互 | 第一轮是否等待输入；四条独立 Judge 判据检查接口、OTel、变体和三档 Tier | 加分，不是 gate |
| 安装可用性 | 精确版本、配置存在、受管指引、`niceeval list`、`exp --dry --json`、必要时 TypeScript 检查 | gate |
| 真实执行过程 | Agent 是否真的调用 `niceeval init`、真实 `niceeval exp` 和 `niceeval show` | 加分 |
| 安装最佳实践 | devDependency、受管区块、非 JS 项目独立目录、ESM | 加分 |
| Experiment 设计 | 至少两个配置、模型字面量不同、描述存在、Agent 在 Experiment 中配置、`attempts: 1` | 加分 |
| Adapter 执行证据 | `show --execution` 能否读到标准 `ASSISTANT` 事件 | 机械取证 |
| Adapter 源码实践 | 真实传输、取消信号、模型和会话透传、工厂配置、反馈通道、完整事件映射 | 加分 |
| Eval 作者实践 | 使用正式断言 API、宽容的语义或结构判定、不在 Eval 内管理被测进程 | 加分 |
| 评估内容质量 | 核心用例、具体结果断言、真实负例、Experiment 与 Eval 指向同一系统 | 四条独立 Judge 加分 |
| 文档路由 | 从 Agent 的命令输入确认是否读取随包 `INDEX.md`、任务页，以及是否绕去在线文档 | 加分 |
| Sandbox 成熟度 | Provider、配套 SDK、预构建环境引用、官方公共 image 或 template、不可变版本引用 | `advance/` 专属 gate 与加分 |

这套评估最大的优点是把“装没装成”“是否真的执行”“源码实践”“用例设计品味”分开。
机械事实用 gate 或 matcher，开放式质量才交给 Judge，避免一条主观总分掩盖具体失败点。

另一个优点是因果边界清晰。
任务 prompt 只要求读取某个版本的 `INIT.md` 并安装对应版本，项目事实和评分标准留在隐藏 Eval 中。
候选文档来自精确 Git tag，随包页面也先验证存在，能减少候选版本和说明文档错配。

### 当前可见证据

2026-08-06 使用当前 NiceEval CLI 执行三个候选的 `--dry --json`，每个计划都是两条 Eval、一个 Experiment 配置、每格一次 Attempt，总派发数为 2。
dry plan 只能证明矩阵可解析，不能证明安装引导有效。

当前 CLI 查不到这三个安装 Experiment 的可读结果。
CLI 只报告工作区里有四个由 NiceEval `0.4.6` 写入的旧 schema 记录，并提示使用旧版本 CLI 读取。
本研究遵守 NiceEval-Eval 的结果读取约束，没有直接读取 `.niceeval/`，也没有触发付费重跑。

因此，现在只能评价评估设计和覆盖范围，不能声称 `v0.12.0`、`v0.11.0` 或 `canary` 的效果更好。

### 评估设计的缺口

1. 安装矩阵只有两题且每格一次 Attempt，难以区分稳定行为和单次 Agent 随机性。
2. 被测宿主固定为 Codex，模型固定为 `gpt-5.6-luna`，尚未证明同一入口对其它 Skill 宿主同样有效。
3. 加分式评分不声明统一满分，不同题型启用的评分项也不同；它适合在同一路径内比较版本，不适合跨 install 与 advance 排名。
4. 四条内容质量与四条澄清质量依赖 LLM Judge，正式结论需要同时固定 Judge 配置并观察重复运行方差。
5. 交互评分奖励固定的四类提问，但随包 onboarding 同时要求“先读代码，仓库能回答的不要问”。现有判据主要检查问没问，尚未单独奖励减少可由仓库回答的问题。
6. 较重的 advance 项目为了成本和稳定性，不都执行真实在线 Adapter gate。它们可以证明源码和执行证据形状，却不能替代完整服务链路的持续回归。
7. 当前结果不可由现行 CLI 直接比较，所有效果结论都应等待一批按当前 schema 产生、可由 `niceeval show` 读取的运行。

这些缺口不否定现有矩阵。
它们说明 NiceEval-Eval 现在更适合回答“版本化 onboarding 是否让同一 Codex 在同一题上做对更多事”，还不能单独证明一个跨 Agent、跨项目的通用 Skill 已经成立。

## NiceEval 应学成什么 Skill

### 优先方案：`create-niceeval-eval`

这个 Skill 的触发意图应是结果导向的：

- “这个 Agent 应该用哪个模型？”
- “比较两个 Agent、模型、prompt 或 feature flag。”
- “给当前 Agent 加一条能抓回归的 Eval。”
- “先做一次小规模试验，再决定是否把评估资产放进仓库。”

纯单元测试不触发它；仓库里已经有目标 Eval 时，直接运行现有 Experiment，不重新生成。

Skill 的核心不是替用户写一份巨大教程，而是把以下状态机可靠地跑完：

1. **定位模式**：用户要一次性选型时进入临时试验；用户要持续回归时进入仓库接入。
2. **版本化启动**：未安装时走 `INIT.md`；已安装时从随包 `INDEX.md` 读取对应任务页，不复制 API 细节。
3. **先探索后决策**：扫描被测表面、真实数据与已有变体，只向用户询问会改变协议、判据、成本或候选集的未知项。
4. **保持三件套边界**：Eval 只描述任务与判定；每个 Agent、模型或 flag 组合进入独立 Experiment；Adapter 只负责驱动和事件映射。
5. **先展示运行计划**：先执行 `niceeval exp --dry --json`，把题数、配置数、Attempt 数、复用量、预计成本与 Sandbox 选择讲清楚。
6. **成本门**：计划会产生明显费用或云资源时，取得用户确认后才开始真实运行。
7. **统一运行矩阵**：由 NiceEval runner 派发候选，不为每个候选再启动一个外层 Agent。
8. **证据化汇报**：用 `niceeval show` 和 locator 切片报告 verdict、失败正文、执行证据、时间与成本；没有生产参照模型或不可比时不宣布赢家。
9. **临时转长期**：临时模式的资产默认在仓库外；结果出来后，由用户决定丢弃、保留临时工作区，还是把 Eval、Experiment 和 Adapter 提升进仓库。

### Skill 应借鉴 Ori 的地方

- 用自然语言意图触发完整评估，而不是要求用户先知道 CLI 和文件结构。
- 每次读取当前 CLI 帮助和随包文档，避免 Skill 内复制会过期的 API。
- 明确区分评估作者、被测候选和 Judge，记录三者的模型与版本来源。
- 把候选发现、真实数据、成功判据、成本上限和生产参照模型当成不同决策。
- 临时评估默认不污染用户仓库，结果出现后再决定是否晋升为长期资产。
- 最终同时报告质量、失败样本、耗时和成本，不只给一行胜负。
- 中断后保留用户已经付费得到的状态，恢复或归档都由用户决定。

### 不应照抄的地方

- 不把 OpenRouter 模型目录写进 NiceEval 核心契约。候选发现应是 Provider 能力，用户也可以显式声明本地模型或 Agent。
- 不把 authoring model 和 Judge 永久绑成同一个固定模型。可复现性应来自明确 provenance、固定 Judge 配置和版本化评估资产。
- 不用五到六次完整进程重启作为正常访谈协议。先扫描再问一个真正阻塞的决策，能减少重复读仓库的时间和费用。
- 不把 `/tmp` 里的步骤文件当成评估结果真相。外层恢复状态可以很薄，运行事实仍应由 NiceEval Record 和 `show` 提供。
- 不把临时目录叫 Sandbox。需要隔离、资源限制和可复现环境时，必须声明真实 Sandbox Provider。
- 不把 Eval 和候选模型矩阵揉成一个长期文件。NiceEval 的 Eval、Experiment 分离是可复用和可比较的基础。
- 不默认开始一个可能超额消费的运行。dry plan 与成本确认应发生在付费派发之前。

### `setup-niceeval` 的定位

也可以把现有 `INIT.md` 包成一个很薄的 `setup-niceeval` Skill，用于提高 Agent Skill 生态中的可发现性。
但它不应成为另一份安装规范，只负责触发 `INIT.md`、维护恢复状态和把用户路由到随包 `INDEX.md`。

这个薄 Skill 的优先级低于 `create-niceeval-eval`。
NiceEval 已经能完成自动安装，真正缺少的是从“我要判断哪个候选更好”到“得到可复查结果”的结果导向编排。

## 建议的验证顺序

如果决定继续设计 Skill，先不要直接发布。
建议按以下证据顺序验证：

1. 在 NiceEval-Eval 新增 Skill 宿主维度，至少覆盖两种支持 Agent Skill 的 coding agent。
2. 保留 DB-GPT 与 GPT Researcher 作为持久接入题，再新增一条临时模型选择题，分别验证两种模式。
3. 每格提高到至少两次 Attempt，并固定 Judge 配置，观察澄清、产物质量和最终 verdict 的方差。
4. 单独记录首次接入的提问轮数、墙钟时间、authoring 成本、Eval 运行成本和用户需要做的决策数。
5. 对比三组入口：只给 `INIT.md`、薄 `setup-niceeval` Skill、完整 `create-niceeval-eval` Skill。
6. 只有在完整 Skill 稳定减少人工提示、没有降低 Eval 有效性，并且成本可接受时，才把工作流写成目标契约。

这组实验能回答最关键的问题：Skill 带来的提升究竟来自更好的发现和编排，还是只是用了更多 Agent 轮次与更多 token。
