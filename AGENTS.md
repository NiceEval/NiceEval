# Repository Guidelines

`niceeval` 是 TypeScript evals 库。直接在 `main` 上协作；仓库可能同时有用户或其它 agent 的未提交工作。
使用用户当前提问的语言回复与讨论；用户切换语言时跟随最新一条提问的语言。
## 动态发现

不要从本文件学习整个项目。先按任务进入对应目录，读取该目录最近的 `README.md`、`AGENTS.md` 或索引，再沿链接只加载相关正文：

- 产品、架构或内部设计：[`docs/README.md`](docs/README.md)
- issue / dogfood / dev 原始反馈：先读 [`.agents/skills/feedback/SKILL.md`](.agents/skills/feedback/SKILL.md)，再用 `pnpm feedback --help` 进入正式命令
- 开发问题、根因、裁决与 know-how：先读 [`.agents/skills/memory/SKILL.md`](.agents/skills/memory/SKILL.md)，再用 `pnpm memory --help` 进入正式命令
- PR、文档、示例、下游安装与仓库初始化：分别从 [Pull Request](.agents/skills/pull-request/SKILL.md)、[Docs Terminology](.agents/skills/docs-terminology/SKILL.md)、[Docs Work](.agents/skills/docs-work/SKILL.md)、[Docs Reference](.agents/skills/docs-reference/SKILL.md)、[Docs Diff Code](.agents/skills/docs-diff-code/SKILL.md)、[Docs Development](.agents/skills/docs-development/SKILL.md)、[Examples Sync](.agents/skills/examples-sync/SKILL.md)、[Consumer Link](.agents/skills/consumer-link/SKILL.md) 与 [Repository Setup](.agents/skills/repository-setup/SKILL.md) 继续；完整参数只看对应 pnpm 入口的 `--help`
- 文档用词审查：先读 `.agents/skills/docs-terminology/SKILL.md`，用 `pnpm docs:terms` 维护裁决并运行 `pnpm lint`；不手工搜索并维护另一份命中清单
- 设计到源码的定位：[`docs/source-map.md`](docs/source-map.md)
- 修 Bug、写改或评审测试：先读产品 Feature 契约，再读 [`docs/engineering/testing/README.md`](docs/engineering/testing/README.md) 的「Bug 修复的 E2E TDD」与「稳定性：变更预算」；随后依次读 [`portfolio.md`](docs/engineering/testing/portfolio.md) 找 owner、[`e2e/README.md`](docs/engineering/testing/e2e/README.md) 选体裁、[`scenario-repos.md`](docs/engineering/testing/e2e/scenario-repos.md) 确认布局及对应领域页，真正写和运行时再读 [`authoring.md`](docs/engineering/testing/e2e/authoring.md) 与 [`execution.md`](docs/engineering/testing/e2e/execution.md)；写 Unit 前再读 [`unit/README.md`](docs/engineering/testing/unit/README.md) 与对应 Feature 例外登记
- 历史踩坑与设计裁决：[`memory/INDEX.md`](memory/INDEX.md)，命中索引项后才读正文
- 公开文档站：[`apps/docs-site/AGENTS.md`](apps/docs-site/AGENTS.md)
- 可运行示例：[`examples/README.md`](examples/README.md)
- 产品站：[`apps/site/README.md`](apps/site/README.md)
- 具体功能：从 `docs/README.md` 进入对应 `docs/feature/<name>/README.md`

目录入口负责说明本作用域的目标、组织方式、写作规则和验证命令。信息已有唯一入口时，不在本文件复制；目录结构变化时更新入口索引，让后续工作按路径动态发现。

## Bug 修复与测试路径

- 先从安装后的 Library、CLI、HTTP、浏览器或真实 adapter 等公开入口复现和定位，再修生产根因；不要先钻进私有落盘或为实现细节写测试。
- Bug 修复统一采用公开入口的 E2E TDD：先让安装后候选经真实 Library、CLI、HTTP、浏览器或 adapter 复现，并取得旧实现或最小逆补丁的红灯收据，再修改生产代码。不得用源码调用、私有产物、mock 核心实现或 Unit 代替这条红灯。
- 先加强拥有同一长期结果的既有 E2E owner；没有合格 owner 时新增一个最小 Journey 或单边界 E2E。测试标题仍描述长期用户结果，Bug 历史只作为 regression 凭据，不另建按 Bug 命名的目录或第二套 owner。
- 无法稳定自动化的外部条件、安全限制或不可固定 Provider 才可暂停 E2E TDD；必须在开工前写明具体阻塞，并把当前候选安装到隔离消费环境做公开入口 AI 真实验收。测试重置、工期或“只是内部实现”不构成跳过理由。
- E2E 按产品域放在 `e2e/{eval,cli,runner,record,report,package,lifecycle}`，adapter 放在 `e2e/adapter/<id>`；测试文件留在所属 Repo 的原生 `test/`，机械共享能力才进入 Testkit，host-side 编排进入 `packages/e2e-runner/`。不按 Bug 编号、日期或实现模块另建目录。
- 完整 E2E 只承担开工红灯、候选转绿与最终接管，不作为反复猜测 DOM、时序或 fixture 的交互式调试循环。首次完整运行需要继续定位时，使用 `--keep-workdir` 保留已安装的隔离副本，并在同一 candidate、fixture 与原生 runner 上收窄重跑；先用最小浏览器动作或进程实验确定稳定观察，再改长期 owner。不得反复 pack / install 来试探测试写法，也不得把临时 `only`、短 timeout、日志或诊断断言留进 owner。
- 复杂 E2E 定位确有多条独立证据线时，可通过 Herdr 并行启动只读检索 worker，分别检查生产根因、trace / DOM 与稳定公开观察；主 agent 独占长期 owner 和生产修复。不得让多个 worker 同时修改同一测试文件，不得并行重复完整候选准备，也不得把 reviewer 安排在尚未停稳的实现上。

## 全仓约束

- niceeval 是 beta。API、CLI 与契约按理想形态设计，不以兼容旧习惯为默认约束。
- `docs/` 是已定稿的目标契约，不是当前代码说明书。代码尚未实现目标时，修代码或记录实现任务，不把文档降格成当前实现。
- 保持 core 中立。具体边界以 [`docs/architecture.md`](docs/architecture.md) 为准。
- CLI 与 Node runtime 保留 `t(key, vars)` 与 message keys，当前只提供英语 catalog。不要加回 CLI 中文 catalog、`Config.locale`、系统 locale 探测，或 CLI 为读 locale 而预加载配置。浏览器 `view` 保留中英 catalog 与语言切换，不要删、不要和 CLI catalog 混用。
- 公共 API、可观察行为或文档变更时，沿对应目录入口完成同步与验证；测试命令以 `package.json` 和局部入口文档为准。
- `src/report/**` 是仓库里唯一的预编译运行时面。修改后，在用 CLI 或 workspace/link 下游验收前先运行 `pnpm run build:report`；下游已经开着 `niceeval view` 时还要重启进程。`view` 不监听或代编译 `niceeval` 依赖自身；pnpm 的 `Already up to date` 只表示依赖安装状态，不表示 `dist/report/**` 已与源码同步。
- 代码验证放进 `src/**/*.test.ts(x)` 或 `test/unit/`，统一复用 `pnpm test`。文档与文档站规则分别放进 `lint/docs/**/*.lint.ts`、`lint/docs-site/**/*.lint.ts`，统一复用 `pnpm lint`；不把文档 lint 命名成测试。pre-push 只调用这个统一 lint 入口，不维护第二份检查清单。
- 设计只落 `docs/`，不另写执行计划。定稿的契约本身就是实现输入：要做什么写进 `docs/` 正文，为什么这么定写进正文的理由句或 `reference/`，翻案与弯路写进 `memory/`。单独维护一份任务分解会把契约复述一遍，并且落后于 `docs/` 的下一次迭代；多 agent 并行按 `docs/` 的目录边界切工作，不按计划文件里的节点切。
- 测试求质不求量：Bug 修复先找既有 E2E owner，没有时新增最小 Journey 或单边界 E2E，并先取得红灯。非 Bug 变更仍按 Journey、单边界 E2E 与有证据的 Unit 例外选择 owner；新增或实质修改 Unit 前，先在对应 Feature 例外登记中写明 E2E 不足、具名错误算法、最小矩阵与稳定 seam。答不出「证明哪条契约、删了会放走哪类错误」的测试不写。

## 下游项目与 dogfooding

本仓库位于 NiceEval 多仓库工作区的 `NiceEval/` 子目录。上级目录不是 monorepo；其下的兄弟仓库是 NiceEval 的真实下游与 dogfooding 验收面：

| 目录 | dogfooding 职责 |
| --- | --- |
| `../terminal-bench/` | 用真实 Terminal-Bench 题目验证 NiceEval 的运行、查看、诊断与实验工作流 |
| `../MemoryBench/` | 验证 memory 条件、agent/model 对比实验与报告能力 |
| `../NiceEval-Eval/` | 评估 NiceEval 的 INIT、随包索引、安装/分享场景及文档对 coding agent 的实际效果 |

- 当任务要求下游实验，或 NiceEval 的 API、CLI、报告、provider、INIT、随包文档等变更需要真实消费验证时，进入相应兄弟仓库工作；这不是单纯切换到上级目录，而是把下游项目作为产品验收环境。
- 进入下游前先读取该仓库最近的 `AGENTS.md`、`README.md` 或实验入口，并在每个涉及的仓库分别检查 Git 状态。父目录没有统一依赖或测试入口，不在父目录运行仓库级安装、测试、格式化或批量改写。
- 先确认下游实际消费的 NiceEval 来源是已发布包、本地 link 还是本工作树源码，不因目录相邻就假定它已经使用当前改动。修改 `src/report/**` 后，遵守本文件的预编译运行时约束再做下游验收。
- 用最小、能证明契约的实验切片 dogfood；付费模型调用、全量 benchmark、整批作废或全量重跑必须先取得用户明确批准。默认保留既有结果，只补跑受影响的题目或场景。
- 在下游看运行结果或诊断失败时，只使用该仓库规定的 `pnpm exec niceeval show` 切片；禁止直接读取 `.niceeval/` 产物或通过相邻源码反推某次运行。CLI 无法呈现所需信息时，将其识别为 NiceEval 呈现缺口，而不是用私有产物绕过。
- 通用契约或核心行为的根因在本仓库修复；题目、benchmark、实验和报告的特定策略留在对应下游。跨仓库任务按仓库分别修改、验证和提交，不把多个仓库的改动混成一个提交。

## Feedback 与 Memory

仓库用自己的 Feedback 保存来自 issue、dogfood 与 dev 的原始观察，用 Memory 保存调查后形成的问题、根因、裁决与 know-how。两者都随 Git 提交，不依赖外部摩擦工具；完整状态与关系见 [Feedback 与 Memory](docs/engineering/feedback-memory/README.md)。

- 遇到可复现的工具、文档、API、测试或约定摩擦时，先运行 `pnpm feedback list [pattern]` 查重，再按 `pnpm feedback add --help` 准备一份包含 source、subject、claim、observation 与 impact 的 JSON 文档。
- 下游 dogfood 只生成 `niceeval.feedback-envelope/v1`，本仓库用 `pnpm feedback import` 解码；下游不能直接改本仓库。
- 调查得到 root cause、设计取舍或长期 know-how 时，用 `pnpm memory` 创建或关联 Problem、Decision 或 Insight；不要把推断改写成原始 Feedback。
- 修产品 Bug 时，E2E 测试头的 `regression:` 指向 Problem Memory。只有公开入口红灯、候选转绿与可靠性接管通过后，才能把该 Problem 设为 `resolved(fixed)`。
- 收尾时运行 `pnpm feedback list`，把过程中绕过但仍未保存的仓库摩擦补进 Feedback。已经在本轮修好且没有长期价值的瞬时操作不另建条目。
- 创建、关闭或修改远端 issue 仍需用户当次明确授权；本地 Feedback 状态不自动同步远端。

## Git 与协作安全

- 多 agent 直接在当前工作目录的 `main` 上并行开发；不建 feature branch，也不创建或使用额外的 git worktree。
- PR 标题与正文使用用户当前提问的语言；用户切换语言时跟随最新一条提问。commit message 仍使用英语。PR 标题描述用户可见的最终能力或行为，不拿 registry、protocol、storage model 等内部机制代替 feature 名。
- 创建或更新 PR 前先读 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)，并以它作为 PR 标题与正文写法的唯一入口。只保留真实变化的产品面；每项变化以具名 case 展示 before / after example 与 user impact，不用“契约”、实现机制或变化分类代替例子。Record 与 Tests 严格使用模板中的 case / 完整测试源码格式；不在本文件维护第二份 PR 清单。
- PR 正文包含多个 case、测试源码或可能接近 GitHub 字节上限时，使用 `pnpm pr:body --help`，不要再写一次性 generator。创建 PR 前用 `pnpm pr:body init --source <draft.md>` 建草稿，编辑后运行 `check --source <draft.md>`，完成 commit 与 push，再用 `create --source <draft.md> --title <title> --base main` 创建 PR、apply 正文并校验远端 HEAD；已有 PR 用 `apply --pr <number> --source <draft.md>` 更新，随后用同一 source 运行 `check --pr <number> --remote`。已有 PR 也可直接用 `init --pr <number>`，草稿默认保存在当前 worktree 的 Git 私有目录。具体字段、测试源码 directive、fragment anchor 和字节预算以 `pnpm pr:body --help` 为准。
- 自动化产品测试仍禁止新增或恢复 `src/**/*.test.*` 与 `test/unit/**`。Bug 修复优先修改既有 E2E owner；没有合格 owner 时允许新增一个最小 `e2e/**` owner，以公开入口红灯作为开工门。新增或实质修改的 owner 仍须满足 testing 契约并通过可靠性接管门；收据完成前不得宣称成熟或完成接管，当前 suite 不得宣称已成熟。
- 每个 agent 只修改自己任务范围内的文件；遇到并行改动时继续协作，不通过切分支、换 worktree 或回退他人改动来隔离工作。
- 未知改动属于用户或其它 agent。不要覆盖、顺手格式化或提交它们；提交前检查 `git status`、未暂存 diff 与暂存 diff。
- 不使用 `git reset --hard`、`git clean`、`git checkout -- <path>`、`git restore` 丢弃工作，除非用户明确要求。
- 完成任务后提交自己的工作，commit message 要说明行为与原因；用 `git commit <paths>` 或等价的显式路径限定本次提交，避免把用户或其它 agent 的并发改动带入 commit。

## Release 安全

NiceEval 产品发布只走 `.github/workflows/release.yml`：创建并推送 `vX.Y.Z` tag，由 CI 写版本、校验、发布 npm 并创建 GitHub Release。
`@niceeval/testkit` 是当前 checkout 的 private workspace harness，不发布 npm、不打 release tag，也不建立独立 tarball 信任链。
不要在本地运行 `npm publish`，也不要为了发布预先修改 main 上任一 `package.json` 版本。
