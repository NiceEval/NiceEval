# Repository Guidelines

`niceeval` 是 TypeScript evals 库。直接在 `main` 上协作；仓库可能同时有用户或其它 agent 的未提交工作。
使用用户当前提问的语言回复与讨论；用户切换语言时跟随最新一条提问的语言。
## 动态发现

不要从本文件学习整个项目。先按任务进入对应目录，读取该目录最近的 `README.md`、`AGENTS.md` 或索引，再沿链接只加载相关正文：

- 产品、架构或内部设计：[`docs/README.md`](docs/README.md)
- 文档用词审查：先把裁决写进 `docs/writing-rules.json`，再运行 `pnpm test:docs`，按守护输出逐项修改；不手工搜索并维护另一份命中清单
- 设计到源码的定位：[`docs/source-map.md`](docs/source-map.md)
- 写、改或评审测试：先读 [`docs/engineering/testing/README.md`](docs/engineering/testing/README.md)（两层体系、变更预算、改了什么跑什么）；写单元测试前再读 [`docs/engineering/testing/unit/README.md`](docs/engineering/testing/unit/README.md) 与对应 Feature 的 `docs/engineering/testing/unit/<feature>.md` 测试文档；造或改 fixture 前读 [`docs/engineering/testing/unit/harness.md`](docs/engineering/testing/unit/harness.md) 与该文档的 Fixture 规范
- 历史踩坑与设计裁决：[`memory/INDEX.md`](memory/INDEX.md)，命中索引项后才读正文
- 公开文档站：[`docs-site/AGENTS.md`](docs-site/AGENTS.md)
- 可运行示例：[`examples/README.md`](examples/README.md)
- 产品站：[`site/README.md`](site/README.md)
- 具体功能：从 `docs/README.md` 进入对应 `docs/feature/<name>/README.md`

目录入口负责说明本作用域的目标、组织方式、写作规则和验证命令。信息已有唯一入口时，不在本文件复制；目录结构变化时更新入口索引，让后续工作按路径动态发现。

## 全仓约束

- niceeval 是 beta。API、CLI 与契约按理想形态设计，不以兼容旧习惯为默认约束。
- `docs/` 是已定稿的目标契约，不是当前代码说明书。代码尚未实现目标时，修代码或记录实现任务，不把文档降格成当前实现。
- 保持 core 中立。具体边界以 [`docs/architecture.md`](docs/architecture.md) 为准。
- 公共 API、可观察行为或文档变更时，沿对应目录入口完成同步与验证；测试命令以 `package.json` 和局部入口文档为准。
- `src/report/**` 是仓库里唯一的预编译运行时面。修改后，在用 CLI 或 workspace/link 下游验收前先运行 `pnpm run build:report`；下游已经开着 `niceeval view` 时还要重启进程。`view` 的 watch/rebuild 面向真实用户的记录、报告、主题与项目配置，不监听或代编译 `niceeval` 依赖自身；pnpm 的 `Already up to date` 只表示依赖安装状态，不表示 `dist/report/**` 已与源码同步。
- 需要新增仓库级机器守护时，优先写进 `test/` 下的 Vitest 测试，按验证对象放进 `test/unit/`、`test/docs/` 或 `test/docs-site/`（分别复用 `pnpm test`、`pnpm test:docs`、`pnpm test:docs-site`），不另造脚本、命令或 hook。
- 设计只落 `docs/`，不另写执行计划。定稿的契约本身就是实现输入：要做什么写进 `docs/` 正文，为什么这么定写进正文的理由句或 `reference/`，翻案与弯路写进 `memory/`。单独维护一份任务分解会把契约复述一遍，并且落后于 `docs/` 的下一次迭代；多 agent 并行按 `docs/` 的目录边界切工作，不按计划文件里的节点切。
- 测试求质不求量：先声明后写测——测试只实现对应 Feature 测试文档「覆盖规范」已声明的类别，新类别先补文档条目再动手（[`docs/engineering/testing/unit/registry.md`](docs/engineering/testing/unit/registry.md)）；答不出「证明哪条契约、删了会放走哪类错误」的测试不写，同一场景的第二条测试是维护负担。

## 摩擦随手记（frog）

本仓库用 [frog](https://github.com/wevm/frog) 记录工作摩擦，条目落在 `.agents/friction-log/` 下、随代码提交。本仓库作为上游已开启 inbound（config.json），接受下游仓库上报的摩擦。

- **遇到摩擦当场记**：`pnpx frog log`（工具、文档、API、测试、约定等 papercut）。只记「可复现、该修」的摩擦，不加全局、系统或内部摩擦（那是 memory 的活）。
- **先查重**：`pnpx frog list` 看是否已知，别堆重复条目。
- 可复现素材放进该条目的 `artifacts/` 并在写记里引用；下一任跑复现，不重新搭现场。
- **收尾的 DX 反思环节必须对账**：跑一遍 `pnpx frog list`，把过程中「绕过去了但没记」的摩擦补 `pnpx frog log`。这条是兜底——即时记录会漏，收尾对账不漏。
- 条目上报成 GitHub issue 靠 `frog publish`；issue 关闭后 `frog sync` 删条目，日志只留未解决的。未配 workflow 时手动跑即可。

## Git 与协作安全

- 多 agent 直接在当前工作目录的 `main` 上并行开发；不建 feature branch，也不创建或使用额外的 git worktree。
- PR 标题、PR 正文与 commit message 一律使用英语。
- PR 正文不写泛化 Summary 或验证流水账。固定按 Public API、CLI commands、Report components、Observable behavior and data contracts、Package scripts、Tests 分类；未变化的分类写 `None`，每个变化条目都给出 before/after example 与 user impact。测试条目用代表场景说明旧测试会放走什么、新测试守住什么。
- 每个 agent 只修改自己任务范围内的文件；遇到并行改动时继续协作，不通过切分支、换 worktree 或回退他人改动来隔离工作。
- 未知改动属于用户或其它 agent。不要覆盖、顺手格式化或提交它们；提交前检查 `git status`、未暂存 diff 与暂存 diff。
- 不使用 `git reset --hard`、`git clean`、`git checkout -- <path>`、`git restore` 丢弃工作，除非用户明确要求。
- 完成任务后提交自己的工作，commit message 要说明行为与原因；用 `git commit <paths>` 或等价的显式路径限定本次提交，避免把用户或其它 agent 的并发改动带入 commit。

## Release 安全

发布只走 `.github/workflows/release.yml`：创建并推送 `vX.Y.Z` tag，由 CI 写版本、校验、发布 npm 并创建 GitHub Release。不要在本地运行 `npm publish`，也不要为了发布预先修改 main 上的 `package.json` 版本。
