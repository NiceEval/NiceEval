# Repository Tools

中立治理命令直接由全局 `concord` 提供。NiceEval 的 Feature、Test、Memory 与 Issue 直接使用全局 `concord` 命令，工作流按 `concord --skill <topic>`。

`@niceeval/repo-tools` 拥有 Preview、Examples、下游链接、Repository setup、PR，以及文档 generators/site/reference/diff-code/work 等 NiceEval 产品流程。NiceEval CLI 只组合这些自有流程，不转发 Concord 自身的领域命令。

NiceEval 自有文档生成与站点流程从 `pnpm run repo docs` 进入。治理命令直接调用全局 `concord`，不安装或导入 Concord 库，也不保留领域转发包装。

## 安装与升级

Concord CLI 的发行版本和 SHA-256 由 CI 安装步骤唯一固定。升级先校验发行摘要，再在仓库外安装；不以修改 JavaScript shebang 或放松实现身份绕过检查。NiceEval manifests 和 lock 不含 Concord 库依赖。

使用 `concord --skill <topic>` 及各命令 `--help` 发现精确参数。

升级验收包含完整类型/lint/Unit。静态扫描无内部 imports 不能代替真实执行。

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

## 当前命令入口

所有可运行命令与精确参数以相应的 `--help` 为准：

| 领域 | 入口 | 当前职责 |
|---|---|---|
| Feature | `concord new --help`、`concord list feature`、`concord show <id>` | 发现、显示，并通过 `new feature` 创建 Feature；既有页面直接编辑 |
| Test | `concord test --help` | 生成测试标记，发现、执行测试并核验缺陷修复；见 `concord --skill test` |
| Use Case | `concord new --help`、`concord use-case --help` | 在既有 Feature 下创建叶子 Use Case，维护步骤标记 |
| Trace | `concord recover --help` | 显式恢复中断的文档写入 |
| Design | `concord new --help` | `concord new design <name>` 创建取舍页；裁决按 `concord --skill document` |
| Concepts / Writing | `concord concepts --help`、`concord writing --help` | 维护目录术语与写作政策；`concord docs check --json` 检查正文 |
| Work | `pnpm run repo docs work --help` | 准备、核对和收尾互斥的文档工作项 |
| Reference | `pnpm run repo docs reference --help` | 核对或重生成公开 API reference 区块 |
| Diff code | `pnpm run repo docs diff-code --help` | 核对或重生成接入示例前后对照页 |
| Site | `pnpm run repo docs site dev --help` | `dev`、`prepare`、`validate` 与 `links` 的 Mint owner 操作；其余 verbs 从父级 `--help` 发现 |

`pnpm test` 仍是代码测试入口，包括 Unit 验证。

Site 的四个操作共用 Node 24 选择逻辑。当前进程为 Node 24 时直接使用；否则依次检查
`NICEEVAL_DOCS_NODE_BIN`、Homebrew 的 Node 24、`PATH` 和 `mise where node@24`。
候选必须通过实际版本检查，选中目录只加入 Mint 子进程的 `PATH`，不修改用户 shell 或安装全局工具。
找不到 Node 24 时命令失败，并提示安装或设置显式目录。

Issue、Memory、PR、Examples、下游开发链接、Preview 与 Repository setup 保持各自的非 Docs 入口。准确入口是 `concord issue`、`concord feedback`、`concord memory`、`pnpm pr:body`、`pnpm examples:sync`、`pnpm dev:link`、`pnpm preview:build`、`pnpm preview:accept` 与 `pnpm repo:setup`。`pnpm link` 是 pnpm 自带的反向链接命令，不能作为仓库脚本；构建并链接当前 candidate 使用 `pnpm dev:link <directory>`。

PR 正文入口 `pnpm pr:body` 拥有受模板约束的 Git-private 编辑状态；子命令、字段语义与发布边界见 [Pull Request skill](../../../.agents/skills/pull-request/SKILL.md) 与 `pnpm pr:body --help`。

`concord new use-case <name> --feature <feature>` 在显式指定的既有 Feature 下创建一个叶子 Use Case。

术语与写作政策由 Concord 基础 CLI 拥有：`concepts index/show` 读取 `docs/concepts.md`，
`writing index/show/check` 读取与检查 `docs/writing.md` 及各目录的 `writing.md`；两者直接编辑，参数从各自 `--help` 发现。
Markdown 只解释关系与案例；正文 API 示例与 SVG 用词靠评审核对，没有本仓库的机器守护。

Roadmap 与 Engineering 的结构写入也使用 Concord 基础 CLI 的受管入口：

- `concord new roadmap|engineering <name>`、`concord list roadmap|engineering` 与 `concord show <id>`，参数见 `concord new --help`；
- `concord roadmap start <id>` 采用 Roadmap，参数见 `concord roadmap --help`。

不以手抄模板代替 `concord new`。

追溯关系与各领域 mutation 的语义见[仓库文档追溯](../docs-traceability/README.md)。Research 见[Research](../../research/README.md)。

## 双语 Reference 生成

`pnpm run repo docs reference` 同时生成中英文 reference 的 `GENERATED` 区块。标题、签名代码块、类型、默认值和条目顺序来自同一份源码声明。中文说明来自紧邻 TSDoc 或 CLI option help。

英文说明由 `apps/docs-site/reference/.generated-en.json` 拥有。它是条目键到英文说明的 JSON 对象，不保存签名或字段顺序：

- 普通成员使用 `region/member`；具名分组使用 `region/group/member`，防止不同接口的同名字段共用译文。
- CLI 行使用 `cli-flags/sorted,commands/--flag`；适用命令按字典序排序后用逗号连接，根命令为空串。
- 同名联合类型变体共用说明。每个条目都必须有键；源码没有说明时可以用空字符串，源码有说明时译文不能为空。

生成器在写入任何输出前校验完整译文表。缺少键、非字符串值、有源码说明却缺少有效译文或已不存在于源码的键都使命令失败，并指出需要修正的输入。`--dry-run` 使用同一校验和生成路径，只返回会变化的路径。

增删或重命名源码条目时同步维护译文键；说明变化时更新对应英文译文，再生成两种语言的页面。生成区不能手工修改。`pnpm lint` 逐字节比对两种语言的生成结果，同时检查译文表完整性。

验收从正式命令进入：先运行 `--dry-run`，生成后再次 dry-run 应返回空路径列表。在隔离副本中删除译文、增加失效键或写入非法值，dry-run 与写命令都应零写入失败。修改英文生成区应使 reference 漂移 lint 失败，重新生成后通过。

## 动态发现

维护者按任务意图逐层进入：

```text
任务意图
  → 最近的 AGENTS.md 路由
  → 对应 Skill 的触发条件与工作流
  → concord <domain> --help 或 pnpm run repo docs <NiceEval domain> --help
  → pnpm lint 验证文档与接线
```

AGENTS 只说明从哪里开始，不复制参数。Skill 保存判断顺序、安全边界和验收方式；完整参数只由领域自己的 `--help` 定义。设计页说明语义和边界，不能替代可运行 CLI 的帮助。

任何 guidance preflight 都绑定运行时读取的 AGENTS、相关 Skills 与 authority；HEAD 或这些规则在读取后变化时，下一项受影响动作之前必须重新动态发现。preflight receipt 只证明规则被呈现，不能证明理解或遵守，且不能授权绕过受管入口。

统一 lint 从当前事实检查接线，而不维护另一份 command registry：

1. 从根 package script 确认 NiceEval 自有入口；Concord 领域直接调用 `concord`；
2. 从 `.agents/skills/*/SKILL.md` 的 `command` 与 `design` frontmatter 读取多步工作流 owner；
3. 验证每个 Skill command 可运行 `--help`，且离线、只读并成功退出。只读在隔离副本中证明：lint 把当前 HEAD 的
   受跟踪文件导出到临时目录，链接现有依赖，在副本里运行全部 `--help`，再比较副本运行前后的完整内容摘要；
   共享 checkout 中其它 Agent 的并发改动不影响这项检查，副本在检查后删除；
4. 验证 design path 与 anchor 存在，且其中声明的当前入口能回到所属 domain；
5. 验证 workflow、hook 和 lint 提示只调用正式入口，不绕过到源码或退役脚本；
6. 删除或移动入口时，一并报告失效的 AGENTS 路由、Skill、design 和 workflow 调用。

单步 `pnpm lint`、`pnpm typecheck` 与 `pnpm e2e` 不需要各自建立 Skill。需要选择、会写入或包含远端副作用的工作流必须有 Skill。

## Effect 与错误边界

每个 domain handler 返回自己的结构化结果；handler 不读取 `process.argv`、写 stdout/stderr 或设置 `process.exitCode`。不可信 JSON、YAML、frontmatter、package metadata 与外部命令输出在所属 domain 边界立即用 Schema 解码。

领域错误必须具名。文件缺失、内容非法、引用冲突、锁冲突与外部命令失败不能压成一个通用字符串。写命令由各自领域提供 `--dry-run` 或 `check`，其 receipt 只描述该领域的计划或结果；`--help` 与离线 check 不访问网络、不写仓库。会 push、创建 PR、发布或修改远端状态的操作仍需要当次用户授权。

文件系统、时钟、Git、GitHub、子进程和终端输出由所需 domain 的 `Context.Service` 提供。临时目录、锁与子进程以 `Effect.acquireRelease` 或 `Effect.addFinalizer` 登记进 `Effect.scoped`；Scope 在成功、typed failure、defect 或 interruption 后都会运行 finalizer。根入口只调用一次 `@effect/platform-node` 的 `NodeRuntime.runMain`。

## 脚本与平台边界

根 `scripts/` 是迁移输入，不是长期 owner。NiceEval Docs 命令从 `pnpm run repo docs` 进入，中立文档治理使用 `concord`；不保留旧别名。`e2e/scripts/` 仍是 host-side E2E runner，入口为 `pnpm e2e`；产品 runtime 留在 `packages/niceeval`；lint adapter 留在 `lint/**`。

YAML、Netlify 配置和 hooks 只决定平台何时调用正式命令、传入哪些可信参数，以及如何保存 artifact。选择、校验、生成、重试、领域 receipt 与错误呈现都属于 domain contribution。平台文件不得复制文件列表、状态机或成功判定。

官方 Preview 的平台入口是 `pnpm preview:build`。Preview contribution 固定下游编排器，并构建当前 exact package artifact。
它通过候选包的同一 Record 导入入口验证当前格式的 portable 数据，不改写下游原件。
旧格式明确拒绝；下游保留原存储并重新运行后，再提供新的 portable 数据。
Function 的 Record、cutoff 和摘要来自同一已验证私有 generation；staging 完成前持有该 generation，并核对实际打包字节。

同一 contribution 关闭 Netlify context identity，形成发布 closure 与 build receipt。`netlify.toml` 只调用入口并声明 publish directory 与 response headers。部署后的只读验收从 `pnpm preview:accept --input <file>` 进入，不把 Netlify token 或 GitHub token 交给领域命令。

Preview 的 build receipt 保留一个完整 artifact 的格式标记。静态闭包只允许经过 Concord 正式验证的
`concord/changes.json`，其它 JSON 一律拒绝；不保留旧 `view-page` 子格式的读取分支。

PR 的文档与源码审阅由 [Concord 变更预览](architecture.md)提供。Preview contribution 取得实际目标分支与提交身份，将只读页面纳入同一发布目录；产品页读取 Record，差异页读取 Git 提交。

## 验收

Repository Tools 不建立独立测试 project，也不签入用于复述实现的 fake。行为验收直接运行正式入口：只读命令核对退出码与该领域 receipt；写命令在临时目录或获准隔离消费仓库核对精确 Git diff、锁释放和子进程终止。

`pnpm lint` 只守 AGENTS、Skill、design、script、owner 与 workflow 接线，不复制领域状态机。每个写领域都要证明 `--help` 可运行、check / dry-run 与写入复用同一领域实现、旧调用方已经迁移、失败给出具名下一步，且取消后没有锁、临时目录或子进程残留。涉及 TypeScript、下游或平台时，再运行相应 owner 的定点验收。
