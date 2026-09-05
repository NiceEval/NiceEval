# Repository Tools

`@niceeval/repo-tools` 是 NiceEval 私有 workspace 的维护 CLI。文档维护从唯一的字面入口 `pnpm run repo docs` 进入；pnpm 的内建命令会截获相近的缩写，因此所有文档、Skill、workflow 与 help 检查都使用这一完整形式。

## 组合边界

```text
pnpm run repo
  → repository root：进程、argv 交付、Layer 组装与退出码
  → docs contribution：只组合文档领域 contribution
  → explicit domain contribution：命令、options、help、JSON、receipt、errors、renderer
```

Repository root 只负责进程机制。它用 `effect/unstable/cli` 解码顶层 selector，组装 `Context.Service` 所需的 Layer，并把唯一根 Effect 交给 `@effect/platform-node` 的 `NodeRuntime.runMain`。
它把最终 renderer 的输出交给终端，不拥有文档 verb、option、help、JSON shape、receipt、错误或文本 renderer。

Docs contribution 只把显式领域挂到 `pnpm run repo docs` 下，也不解释领域输入或归一化领域结果。每个领域自行定义自己的 verbs、options、`--help`、机器结果、receipt、错误和人读 renderer；不同领域可以有不同的输入与输出形状。

没有 generic CRUD、中央 command registry、统一 receipt 或 `DocsTransaction`。需要同一份关系事实的领域复用有名字的 Trace ref/checker；需要文件、时钟、Git 或终端的领域各自在自己的 Effect 边界取得 `Context.Service`。共享机械代码进入 `internal/`，不能反过来夺走领域 owner。

## 当前 Docs contribution

所有可运行命令与精确参数以相应的 `--help` 为准：

| 领域 | 入口 | 当前职责 |
|---|---|---|
| Feature | `pnpm run repo docs feature --help` | 发现、显示，并通过 `create`、`page add`、`page set` 维护首期 Feature 结构 |
| Test | `pnpm run repo docs test --help` | 发现与显示 E2E owner 的 Trace 投影，并通过 `owner`、`regression`、`issue` 子命令维护受管关系；不是 Unit test runner |
| Trace | `pnpm run repo docs trace recover --help` | 显式恢复中断的 relation publication |
| Design | `pnpm run repo docs design --help` | `create`、`check`、`decide` 的候选到裁决闭环 |
| Research | `pnpm run repo docs research --help` | `page`、`package`、`add-page` 与对精确 ref 的 `check` |
| Terms | `pnpm run repo docs terms --help` | 维护文档用词裁决 |
| Work | `pnpm run repo docs work --help` | 准备、核对和收尾互斥的文档工作项 |
| Reference | `pnpm run repo docs reference --help` | 核对或重生成公开 API reference 区块 |
| Diff code | `pnpm run repo docs diff-code --help` | 核对或重生成接入示例前后对照页 |
| Site | `pnpm run repo docs site dev --help` | `dev`、`prepare`、`validate` 与 `links` 的 Mint owner 操作；其余 verbs 从父级 `--help` 发现 |

`pnpm test` 仍是代码测试入口，包括 Unit 验证；它不承担 Test Trace 的发现和显示。

Test inventory 的单 Repo 入口是 `pnpm run repo docs test inventory --repo <id>`。它与全仓 `audit` 共用 E2E registry、隔离复制、candidate/Testkit 注入、安装和原生 collection，只返回当前 CLI 可消费的 Git-private `neinv_...` ID。`case attach`、`case move`、formal evidence 与 regression 关系只接收该 ID，不接收任意 receipt 路径。

inventory 文件没有公开 format 或兼容期，也不是可编辑输入；CLI 实现变化、完整性检查失败或 ID 丢失时重新 collection。底层 runner adapter 不作为独立 CLI 暴露 `--cwd` collection。

Formal case evidence 使用同一边界：root runner 的 red 和 takeover 命令分别返回 `nered_...` 与 `netake_...`，Git-private bundle 持有 candidate bytes、formal receipts 和 certificate。`regression add` 只消费这些 ID 与 `neinv_...`，不接受任意 evidence 文件路径。实现变化或 bundle 完整性失败时重新运行 root runner，不修补 JSON 或 digest。

Feedback、Memory、PR、Examples、下游开发链接、Preview 与 Repository setup 保持各自的非 Docs 入口。准确入口是 `pnpm feedback`、`pnpm memory`、`pnpm pr:body`、`pnpm examples:sync`、`pnpm dev:link`、`pnpm preview:build`、`pnpm preview:accept` 与 `pnpm repo:setup`。`pnpm link` 是 pnpm 自带的反向链接命令，不能作为仓库脚本；构建并链接当前 candidate 使用 `pnpm dev:link <directory>`。

PR 正文入口拥有受模板约束的 Git-private 编辑状态。`init` 只创建紧凑的受管草稿。`edit problem` 维护问题，`edit use-case` 按 Added / Changed / Removed 维护完整 NiceEval 用户工作流。`edit case` 维护具名 Before / After 产品面。仓库维护工具变化不伪造 NiceEval 产品 Use Case。

`edit test` 以 canonical `path#caseId` 逐 case 录入可读叙述与源码选择。渲染器从 sidecar 查找 current owner，再从 owner authority 读取最终 Feature 或 leaf Use Case。selector 不存在、owner 失效、canonical contract 缺失或声明的 Problem regression 非 current 时返回具名 typed failure。正文不显示内部 Owner，也不接受 Owner:/Covers:/Purpose:/Protects:/Regression:/Runs:/Asserts: 字段表。

同一多-case 文件逐 case 说明，默认只展开一次完整源码；显式 `source=link` 在已有 PR 时改为目标 PR head repository 中固定 `H` 的完整源码和实际目标 base merge-base `B→H` diff 链接。首次 PR 的本地 render/check 不读取 GitHub，明确呈现无链接的 pending publication；发布前所有实际读取输入都从同一 `H` blob 读取并核对，工作树漂移或目标 repo/base/head 漂移拒绝发布。

`edit verification` 维护模板要求的共享验证收据：candidate、可选 red、green、重复运行、固定条件与 Unit 数量。它在 Tests 的源码之后呈现一次，也支持只有实际验证而没有测试源码变化的任务；收据描述已取得的结果，不签发或替代正式 E2E evidence。

`render`、`check`、`apply` 与 `create` 只消费受管状态，按模板顺序渲染并省略空方向与章节，不要求 agent 直接裁剪或编辑 Markdown。本地 `status` 与 `discard` 分别检查和删除受管草稿。remote close 仍是另一个需要当次授权的远端 mutation，三者互不暗示。正文不接受手写导入。

Roadmap、Engineering、Use Case 的结构创建，以及通用 Trace `check` / `move`，仍是未来目标。Feature 的首期结构写入只包括 `create`、`page add` 与 `page set`；不隐式创建 package，也不包括 retire、物理删除、move 或 adoption。它们不能以手抄模板、手动 relation 改写或假 receipt 代替。

追溯关系与各领域 mutation 的语义见[仓库文档追溯](../docs-traceability/README.md)。Design 与 Research 的闭环分别见[Design](../../design/README.md)和[Research](../../research/README.md)。

## 动态发现

维护者按任务意图逐层进入：

```text
任务意图
  → 最近的 AGENTS.md 路由
  → 对应 Skill 的触发条件与工作流
  → pnpm run repo docs <domain> --help
  → pnpm lint 验证文档与接线
```

AGENTS 只说明从哪里开始，不复制参数。Skill 保存判断顺序、安全边界和验收方式；完整参数只由领域自己的 `--help` 定义。设计页说明语义和边界，不能替代可运行 CLI 的帮助。

任何 guidance preflight 都绑定运行时读取的 AGENTS、相关 Skills 与 authority；HEAD 或这些规则在读取后变化时，下一项受影响动作之前必须重新动态发现。preflight receipt 只证明规则被呈现，不能证明理解或遵守，且不能授权绕过受管入口。

统一 lint 从当前事实检查接线，而不维护另一份 command registry：

1. 从根 package script 读取并确认 `pnpm run repo docs` 入口；
2. 从 `.agents/skills/*/SKILL.md` 的 `command` 与 `design` frontmatter 读取多步工作流 owner；
3. 验证每个 Skill command 可运行 `--help`，且离线、只读并成功退出；
4. 验证 design path 与 anchor 存在，且其中声明的当前入口能回到所属 domain；
5. 验证 workflow、hook 和 lint 提示只调用正式入口，不绕过到源码或退役脚本；
6. 删除或移动入口时，一并报告失效的 AGENTS 路由、Skill、design 和 workflow 调用。

单步 `pnpm lint`、`pnpm typecheck` 与 `pnpm e2e` 不需要各自建立 Skill。需要选择、会写入或包含远端副作用的工作流必须有 Skill。

## Effect 与错误边界

每个 domain handler 返回自己的结构化结果；handler 不读取 `process.argv`、写 stdout/stderr 或设置 `process.exitCode`。不可信 JSON、YAML、frontmatter、package metadata 与外部命令输出在所属 domain 边界立即用 Schema 解码。

领域错误必须具名。文件缺失、内容非法、引用冲突、锁冲突与外部命令失败不能压成一个通用字符串。写命令由各自领域提供 `--dry-run` 或 `check`，其 receipt 只描述该领域的计划或结果；`--help` 与离线 check 不访问网络、不写仓库。会 push、创建 PR、发布或修改远端状态的操作仍需要当次用户授权。

文件系统、时钟、Git、GitHub、子进程和终端输出由所需 domain 的 `Context.Service` 提供。临时目录、锁与子进程以 `Effect.acquireRelease` 或 `Effect.addFinalizer` 登记进 `Effect.scoped`；Scope 在成功、typed failure、defect 或 interruption 后都会运行 finalizer。根入口只调用一次 `@effect/platform-node` 的 `NodeRuntime.runMain`。

## 脚本与平台边界

根 `scripts/` 是迁移输入，不是长期 owner。正式 Docs 命令全部从 `pnpm run repo docs` 进入；不保留旧别名。`e2e/scripts/` 仍是 host-side E2E runner，入口为 `pnpm e2e`；产品 runtime 留在 `packages/niceeval`；lint adapter 留在 `lint/**`。

YAML、Netlify 配置和 hooks 只决定平台何时调用正式命令、传入哪些可信参数，以及如何保存 artifact。选择、校验、生成、重试、领域 receipt 与错误呈现都属于 domain contribution。平台文件不得复制文件列表、状态机或成功判定。

官方 Preview 的平台入口是 `pnpm preview:build`。Preview contribution 固定下游编排器，并构建当前 exact package artifact。

同一 contribution 关闭 Netlify context identity，形成发布 closure 与 build receipt。`netlify.toml` 只调用入口并声明 publish directory 与 response headers。部署后的只读验收从 `pnpm preview:accept -- --input <file>` 进入，不把 Netlify token 或 GitHub token 交给领域命令。

## 验收

Repository Tools 不建立独立测试 project，也不签入用于复述实现的 fake。行为验收直接运行正式入口：只读命令核对退出码与该领域 receipt；写命令在临时目录或获准隔离消费仓库核对精确 Git diff、锁释放和子进程终止。

`pnpm lint` 只守 AGENTS、Skill、design、script、owner 与 workflow 接线，不复制领域状态机。每个写领域都要证明 `--help` 可运行、check / dry-run 与写入复用同一领域实现、旧调用方已经迁移、失败给出具名下一步，且取消后没有锁、临时目录或子进程残留。涉及 TypeScript、下游或平台时，再运行相应 owner 的定点验收。
