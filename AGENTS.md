# Repository Guidelines

`niceeval` 是 TypeScript evals 库。直接在 `main` 上协作；仓库可能同时有用户或其它 agent 的未提交工作。
使用用户当前提问的语言回复与讨论；用户切换语言时跟随最新一条提问的语言。
## 动态发现

不要从本文件学习整个项目。先按任务进入对应目录，读取该目录最近的 `README.md`、`AGENTS.md` 或索引，再沿链接只加载相关正文：

- 产品、架构或内部设计：[`docs/README.md`](docs/README.md)
- 实现、调试或评审依赖 Effect API / 语义的代码：先读 [`.agents/skills/effect-ts/SKILL.md`](.agents/skills/effect-ts/SKILL.md)，并按它的入口完整读取当前 workspace 安装的 `effect/AGENTS.md`；跨 v3 / v4 迁移再同时读取 [`.agents/skills/effect-v3-to-v4/SKILL.md`](.agents/skills/effect-v3-to-v4/SKILL.md)
- 新建、查询或修改 Feature / Use Case：先读 [`.agents/skills/feature/SKILL.md`](.agents/skills/feature/SKILL.md)，再用 `pnpm run repo docs feature --help` 进入当前可运行命令
- 设计、修改或采用 Roadmap：先读 [`.agents/skills/roadmap/SKILL.md`](.agents/skills/roadmap/SKILL.md)，再进入 Roadmap 与 Trace 正式契约；缺失的结构写命令不得用手抄模板代替
- 查询、编写、修正或评审测试：先读 [`.agents/skills/testing/SKILL.md`](.agents/skills/testing/SKILL.md)，再按测试入口选择对应 E2E 或 Unit 例外路径
- 公开、脱敏且需 maintainer 跟进的 Observation：先读 [`.agents/skills/issue/SKILL.md`](.agents/skills/issue/SKILL.md)，再按 [Issue 工程契约](docs/engineering/issues/README.md) 准备或处理 GitHub Issue
- 存量 Feedback 迁移或审计：先读 [`.agents/skills/feedback/SKILL.md`](.agents/skills/feedback/SKILL.md)；不再把 Feedback 作为新 Observation 的长期 owner
- 开发问题、根因、裁决与 know-how：先读 [`.agents/skills/memory/SKILL.md`](.agents/skills/memory/SKILL.md)，再用 `pnpm memory --help` 进入正式命令
- PR、文档、示例、下游安装与仓库初始化：分别从 [Pull Request](.agents/skills/pull-request/SKILL.md)、[Docs Terminology](.agents/skills/docs-terminology/SKILL.md)、[Docs Work](.agents/skills/docs-work/SKILL.md)、[Docs Reference](.agents/skills/docs-reference/SKILL.md)、[Docs Diff Code](.agents/skills/docs-diff-code/SKILL.md)、[Docs Development](.agents/skills/docs-development/SKILL.md)、[Examples Sync](.agents/skills/examples-sync/SKILL.md)、[Downstream Link](.agents/skills/downstream-link/SKILL.md) 与 [Repository Setup](.agents/skills/repository-setup/SKILL.md) 继续；下游链接入口为 `pnpm dev:link`，完整参数只看对应 pnpm 入口的 `--help`
- 文档用词审查：先读 `.agents/skills/docs-terminology/SKILL.md`，用 `pnpm run repo docs terms` 维护裁决并运行 `pnpm lint`；不手工搜索并维护另一份命中清单
- 设计到源码的定位：[`docs/source-map.md`](docs/source-map.md)
- 历史踩坑与设计裁决：[`memory/INDEX.md`](memory/INDEX.md)，命中索引项后才读正文
- 公开文档站：[`apps/docs-site/AGENTS.md`](apps/docs-site/AGENTS.md)
- 可运行示例：[`examples/README.md`](examples/README.md)
- 产品站：[`apps/site/README.md`](apps/site/README.md)
- 具体功能：从 `docs/README.md` 进入对应 `docs/feature/<name>/README.md`

目录入口负责说明本作用域的目标、组织方式、写作规则和验证命令。信息已有唯一入口时，不在本文件复制；目录结构变化时更新入口索引，让后续工作按路径动态发现。

动态发现不是一次性的启动仪式。发生 `pull`、`merge`、`rebase`、HEAD 变化，或本文件、`.agents/skills/**` 变化后，必须在**下一项受影响动作之前**重新从最近的 `AGENTS.md`、对应 Skill 与 authority 入口发现规则。preflight 只能证明当时把规则呈现给调用者，不能证明调用者已经理解或遵守；不得用旧快照、源码直读或手工文件编辑绕过受管入口。

## Bug 修复与测试路径

- 测试 owner 选择、允许路径、E2E TDD、Unit 例外、诊断与验收完全服从 [Testing skill](.agents/skills/testing/SKILL.md) 和它指向的正式测试契约。
- Bug 修复必须从安装后候选的公开 Library、CLI、HTTP、浏览器或真实 adapter 入口取得 E2E 红灯，再修生产根因；不得用源码调用、私有产物、核心实现 mock 或 Unit 替代。
- 正式 NiceEval E2E 是当前共享工作区的独占重量级资源。同一时刻只能由父 agent 或一个明确指定的执行 worker 运行；其他 worker 可并行做不启动正式 E2E 的独立实现或只读定位，不得各自 pack、安装或执行 E2E。开始新运行前必须确认本轮没有仍在运行或待回收的 E2E 进程树；完整矩阵交给 CI。

## 全仓约束

- niceeval 是 beta。API、CLI 与契约按理想形态设计，不以兼容旧习惯为默认约束。
- `docs/` 是已定稿的目标契约，不是当前代码说明书。代码尚未实现目标时，修代码或记录实现任务，不把文档降格成当前实现。
- 保持 core 中立。具体边界以 [`docs/architecture.md`](docs/architecture.md) 为准。
- CLI 与 Node runtime 的人读文案由各自 contribution、feedback renderer 或错误 owner 直接拥有，只提供英语文本；不要建立 message-key catalog、通用翻译函数、`Config.locale`、系统 locale 探测，或为读 locale 而预加载配置。列表、缩进、面板和截断继续复用 CLI 呈现能力，数量文案不按单复数分支。浏览器 `view` 保留中英 catalog 与语言切换，不要删、不要和 CLI 文案混用。
- 公共 API、可观察行为或文档变更时，沿对应目录入口完成同步与验证；测试命令以 `package.json` 和局部入口文档为准。
- NiceEval 的发布运行时由 `pnpm run build:package` 固定构建。修改会影响打包入口或 `niceeval view` 时，在用 CLI 或 workspace/link 下游验收前先运行该命令；已经开着的 `niceeval view` 进程需要重启。pnpm 的 `Already up to date` 只表示依赖安装状态，不表示当前 `dist/**` 已与源码同步。
- 文档与文档站规则分别放进 `lint/docs/**/*.lint.ts`、`lint/docs-site/**/*.lint.ts`，统一复用 `pnpm lint`；不把文档 lint 命名成测试。pre-push 只调用这个统一 lint 入口，不维护第二份检查清单。
- 设计只落 `docs/`，不另写执行计划。定稿的契约本身就是实现输入：要做什么写进 `docs/` 正文，为什么这么定写进正文的理由句或 `reference/`，翻案与弯路写进 `memory/`。单独维护一份任务分解会把契约复述一遍，并且落后于 `docs/` 的下一次迭代；多 agent 并行按 `docs/` 的目录边界切工作，不按计划文件里的节点切。

## 下游项目与 dogfooding

本仓库位于 NiceEval 多仓库工作区的 `NiceEval/` 子目录。上级目录不是 monorepo；其下的兄弟仓库是 NiceEval 的真实下游与 dogfooding 验收面：

| 目录 | dogfooding 职责 |
| --- | --- |
| `../terminal-bench/` | 用真实 Terminal-Bench 题目验证 NiceEval 的运行、查看、诊断与实验工作流 |
| `../MemoryBench/` | 验证 memory 条件、agent/model 对比实验与报告能力 |
| `../NiceEval-Eval/` | 评估 NiceEval 的 INIT、随包索引、安装/分享场景及文档对 coding agent 的实际效果 |
| `../NiceEval-Preview/` | 用确定性的全功能 Eval 与已封存 SQLite Record 对真实第一方 View 做 dogfood 验收 |

- 当任务要求下游实验，或 NiceEval 的 API、CLI、报告、provider、INIT、随包文档等变更需要真实消费验证时，进入相应兄弟仓库工作；这不是单纯切换到上级目录，而是把下游项目作为产品验收环境。
- 进入下游前先读取该仓库最近的 `AGENTS.md`、`README.md` 或实验入口，并在每个涉及的仓库分别检查 Git 状态。父目录没有统一依赖或测试入口，不在父目录运行仓库级安装、测试、格式化或批量改写。
- 先确认下游实际消费的 NiceEval 来源是已发布包、本地 link 还是本工作树源码，不因目录相邻就假定它已经使用当前改动。修改打包运行时后，遵守本文件的 `build:package` 约束再做下游验收。
- 用最小、能证明契约的实验切片 dogfood；付费模型调用、全量 benchmark、整批作废或全量重跑必须先取得用户明确批准。默认保留既有结果，只补跑受影响的题目或场景。
- 在下游看运行结果或诊断失败时，只使用该仓库规定的 `pnpm exec niceeval query` 或 `pnpm exec niceeval view` 公开入口；禁止直接读取 `.niceeval/` 产物或通过相邻源码反推某次运行。固定 Query operation 无法呈现所需信息时，将其识别为 NiceEval 呈现缺口，而不是用私有产物绕过。
- 通用契约或核心行为的根因在本仓库修复；题目、benchmark、实验和报告的特定策略留在对应下游。跨仓库任务按仓库分别修改、验证和提交，不把多个仓库的改动混成一个提交。

## Issue 与 Memory

GitHub Issue 跟踪公开、已脱敏且需要 maintainer 跟进的工作项；Memory 保存调查后形成的 Problem、Decision 与可复用 know-how。完整边界、分诊和关系见 [GitHub Issue 与 Memory](docs/engineering/issues/README.md)。

- 遇到来自 issue、dogfood 或开发现场的 Observation，先检查 open 与 closed Issue，再决定复用既有 Issue、准备新 draft 或不建立长期 owner。
- 下游和 Agent 可以准备保留 provenance 的脱敏 draft；创建、编辑、评论、加减标签、关闭或重开远端 Issue 都需要用户对当次动作的明确授权。
- 公开 Issue 不接收秘密、私有资料或漏洞细节；安全问题走 GitHub Private Vulnerability Reporting。
- 调查得到 root cause、设计取舍或可复用 know-how 时，用 `pnpm memory` 创建或关联 Memory；不要把推断改写成原始 Observation。
- 修产品 Bug 时，E2E 测试头的 `regression:` 指向 Problem Memory。只有公开入口红灯、候选转绿与可靠性接管通过后，才能把该 Problem 设为 `resolved(fixed)`。
- Issue 只保存指向 Memory 的正向关系。Issue 的 open 或 closed 是协作状态，Memory 是工程事实，两者不做双向自动同步。
- 收尾时检查本轮尚未持久化的 Observation。已当场修好且没有长期价值的瞬时操作不创建 Issue；仍需跟进但未获远端授权时交付 draft。

## Git 与协作安全

- 多 agent 直接在当前工作目录的 `main` 上并行开发；不建 feature branch，也不创建或使用额外的 git worktree。
- PR 标题与正文使用用户当前提问的语言；用户切换语言时跟随最新一条提问。commit message 仍使用英语。PR 标题描述用户可见的最终能力或行为，不拿 registry、protocol、storage model 等内部机制代替 feature 名。
- 创建或更新 PR 前先读 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)，并以它作为 PR 标题与正文写法的唯一入口。只保留真实变化的产品面；每项变化以具名 case 展示 before / after example 与 user impact，不用“契约”、实现机制或变化分类代替例子。Record 与 Tests 严格使用模板中的 case / 完整测试源码格式；不在本文件维护第二份 PR 清单。
- PR 正文使用 `pnpm pr:body --help` 的受管模板编辑器，不直接编辑草稿 Markdown，也不再写一次性 generator。先只读确认当前 branch 是否已有 open PR；没有时运行 `pnpm pr:body init --base main`，再从 `pnpm pr:body edit --help` 设置 Problem、具名 case 和测试 directive，随后直接 `check`，完成 commit 与 push，再用 `create --title <title> --base main` 创建、apply 并校验远端 HEAD 与正文。已有 PR 优先复用编号草稿；编号草稿不存在时 `check --pr <number>` 与 `apply --pr <number>` 自动复用当前 branch 草稿，不要另建第二份。只有两种默认草稿都不存在、明确需要独立编号草稿时才运行 `init --pr <number>`；最后运行 `check --pr <number> --remote`。只有用户指定其它空草稿路径时才传 `--source`，不得导入手写 Markdown 正文；具体字段、测试源码 directive、fragment anchor 和字节预算以命令 help 与 [Pull Request Skill](.agents/skills/pull-request/SKILL.md) 为准。
- 每个 agent 只修改自己任务范围内的文件；遇到并行改动时继续协作，不通过切分支、换 worktree 或回退他人改动来隔离工作。
- 未知改动属于用户或其它 agent。不要覆盖、顺手格式化或提交它们；提交前检查 `git status`、未暂存 diff 与暂存 diff。
- 不使用 `git reset --hard`、`git clean`、`git checkout -- <path>`、`git restore` 丢弃工作，除非用户明确要求。
- 完成任务后提交自己的工作，commit message 要说明行为与原因；用 `git commit <paths>` 或等价的显式路径限定本次提交，避免把用户或其它 agent 的并发改动带入 commit。

## Release 安全

NiceEval 产品发布只走 `.github/workflows/release.yml`：创建并推送 `vX.Y.Z` tag，由 CI 写版本、校验、发布 npm 并创建 GitHub Release。
`@niceeval/testkit` 是当前 checkout 的 private workspace harness，不发布 npm、不打 release tag，也不建立独立 tarball 信任链。
不要在本地运行 `npm publish`，也不要为了发布预先修改 main 上任一 `package.json` 版本。
