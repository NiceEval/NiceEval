# Repository Guidelines

`niceeval` 是 TypeScript evals 库。直接在 `main` 上协作；仓库可能同时有用户或其它 agent 的未提交工作。
使用用户当前提问的语言回复与讨论；用户切换语言时跟随最新一条提问的语言。
## 动态发现

不要从本文件学习整个项目。先按任务进入对应目录，读取该目录最近的 `README.md`、`AGENTS.md` 或索引，再沿链接只加载相关正文：

- 产品、架构或内部设计：[`docs/README.md`](docs/README.md)
- 文档用词审查：先把裁决写进 `docs/writing-rules.json`，再运行 `pnpm test:docs`，按守护输出逐项修改；不手工搜索并维护另一份命中清单
- 设计到源码的定位：[`docs/source-map.md`](docs/source-map.md)
- 写、改或评审测试：先读 [`docs/engineering/testing/README.md`](docs/engineering/testing/README.md)（两层体系、变更预算、改了什么跑什么）；写单元测试前再读 [`docs/engineering/testing/unit/README.md`](docs/engineering/testing/unit/README.md) 与对应 Feature 的 `docs/engineering/testing/unit/<feature>.md` 测试文档；造或改 Fixture 时遵守 Unit 总纲的「Fixture 与 Harness」及该 Feature 文档的 Fixture 特例
- 历史踩坑与设计裁决：[`memory/INDEX.md`](memory/INDEX.md)，命中索引项后才读正文
- 公开文档站：[`docs-site/AGENTS.md`](docs-site/AGENTS.md)
- 可运行示例：[`examples/README.md`](examples/README.md)
- 产品站：[`site/README.md`](site/README.md)
- 具体功能：从 `docs/README.md` 进入对应 `docs/feature/<name>/README.md`

目录入口负责说明本作用域的目标、组织方式、写作规则和验证命令。信息已有唯一入口时，不在本文件复制；目录结构变化时更新入口索引，让后续工作按路径动态发现。

## Pullfrog PR review

运行在 Pullfrog 的 `Review` 或 `IncrementalReview` 模式时，
`.github/pullfrog-review-prompt.md` 是仓库级 review instructions 的唯一真源。
先从 `checkout_pr` 返回值取得 PR 的 base SHA，再通过 Pullfrog `git` 工具读取该 commit 上的文件，
等价的 Git 读取是 `git show <base_sha>:.github/pullfrog-review-prompt.md`。仅将其
`## Prompt` 下的正文作为本次审查规则。不从 PR head 读取或覆盖这份规则；
无法按 base SHA 读取时不得降级为 head 版本，应提交失败说明并停止 review。

## 全仓约束

- niceeval 是 beta。API、CLI 与契约按理想形态设计，不以兼容旧习惯为默认约束。
- `docs/` 是已定稿的目标契约，不是当前代码说明书。代码尚未实现目标时，修代码或记录实现任务，不把文档降格成当前实现。
- 保持 core 中立。具体边界以 [`docs/architecture.md`](docs/architecture.md) 为准。
- 公共 API、可观察行为或文档变更时，沿对应目录入口完成同步与验证；测试命令以 `package.json` 和局部入口文档为准。
- `src/report/**` 是仓库里唯一的预编译运行时面。修改后，在用 CLI 或 workspace/link 下游验收前先运行 `pnpm run build:report`；下游已经开着 `niceeval view` 时还要重启进程。`view` 的 watch/rebuild 面向真实用户的记录、报告、主题与项目配置，不监听或代编译 `niceeval` 依赖自身；pnpm 的 `Already up to date` 只表示依赖安装状态，不表示 `dist/report/**` 已与源码同步。
- 需要新增仓库级机器守护时，优先写进 `test/` 下的 Vitest 测试，按验证对象放进 `test/unit/`、`test/docs/` 或 `test/docs-site/`（分别复用 `pnpm test`、`pnpm test:docs`、`pnpm test:docs-site`），不另造脚本、命令或 hook。
- 设计只落 `docs/`，不另写执行计划。定稿的契约本身就是实现输入：要做什么写进 `docs/` 正文，为什么这么定写进正文的理由句或 `reference/`，翻案与弯路写进 `memory/`。单独维护一份任务分解会把契约复述一遍，并且落后于 `docs/` 的下一次迭代；多 agent 并行按 `docs/` 的目录边界切工作，不按计划文件里的节点切。
- 测试求质不求量：先声明后写测——测试只实现对应 Feature 测试文档「覆盖规范」已声明的类别，新类别先补文档条目再动手（[`Unit · 矩阵与覆盖登记`](docs/engineering/testing/unit/README.md#矩阵与覆盖登记)）；答不出「证明哪条契约、删了会放走哪类错误」的测试不写，同一场景的第二条测试是维护负担。

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

## 摩擦随手记（frog）

本仓库用 [frog](https://github.com/wevm/frog) 记录工作摩擦，条目落在 `.agents/friction-log/` 下、随代码提交。本仓库作为上游已开启 inbound（config.json），接受下游仓库上报的摩擦。

- **遇到摩擦当场记**：`pnpx frog log`（工具、文档、API、测试、约定等 papercut）。只记「可复现、该修」的摩擦，不加全局、系统或内部摩擦（那是 memory 的活）。
- **先查重**：`pnpx frog list` 看是否已知，别堆重复条目。
- 可复现素材放进该条目的 `artifacts/` 并在写记里引用；下一任跑复现，不重新搭现场。
- **收尾的 DX 反思环节必须对账**：跑一遍 `pnpx frog list`，把过程中「绕过去了但没记」的摩擦补 `pnpx frog log`。这条是兜底——即时记录会漏，收尾对账不漏。
- 条目上报成 GitHub issue 靠 `frog publish`；issue 关闭后 `frog sync` 删条目，日志只留未解决的。未配 workflow 时手动跑即可。

## Git 与协作安全

- 多 agent 直接在当前工作目录的 `main` 上并行开发；不建 feature branch，也不创建或使用额外的 git worktree。
- PR 标题与正文使用用户当前提问的语言；用户切换语言时跟随最新一条提问。commit message 仍使用英语。PR 标题描述用户可见的最终能力或行为，不拿 registry、protocol、storage model 等内部机制代替 feature 名。
- 创建或更新 PR 前先读 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)，并以它作为 PR 标题与正文写法的唯一入口。保留模板中的全部分类；未变化的分类写 `None`，每个变化条目都按模板给出 before/after example 与 user impact。
- 每个 agent 只修改自己任务范围内的文件；遇到并行改动时继续协作，不通过切分支、换 worktree 或回退他人改动来隔离工作。
- 未知改动属于用户或其它 agent。不要覆盖、顺手格式化或提交它们；提交前检查 `git status`、未暂存 diff 与暂存 diff。
- 不使用 `git reset --hard`、`git clean`、`git checkout -- <path>`、`git restore` 丢弃工作，除非用户明确要求。
- 完成任务后提交自己的工作，commit message 要说明行为与原因；用 `git commit <paths>` 或等价的显式路径限定本次提交，避免把用户或其它 agent 的并发改动带入 commit。

## Release 安全

NiceEval 产品发布只走 `.github/workflows/release.yml`：创建并推送 `vX.Y.Z` tag，由 CI 写版本、校验、发布 npm 并创建 GitHub Release。
`@niceeval/testkit` 是当前 checkout 的 private workspace harness，不发布 npm、不打 release tag，也不建立独立 tarball 信任链。
不要在本地运行 `npm publish`，也不要为了发布预先修改 main 上任一 `package.json` 版本。
