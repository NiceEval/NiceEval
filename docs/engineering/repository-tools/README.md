# Repository Tools

`@niceeval/repo-tools` 是一个私有 workspace package，保存 NiceEval 仓库自己的多步维护命令。它只有一棵 Effect CLI 命令树和一个 Node runtime，源码按七个领域分目录；领域不是 npm 包，也不各自启动 runtime。

```text
packages/repo-tools/src/
├── cli.ts
├── feedback/
├── memory/
├── pr/
├── docs/
├── examples/
├── consumer/
└── repository/
```

`utils` 不能表达 owner，因而不作为目录或包名。两个领域共享的机械函数进入 `internal/`，调用方仍由领域命令拥有。

## 七个领域

| 领域 | 正式入口 | 唯一职责 |
|---|---|---|
| Feedback | `pnpm feedback --help` | 保存 issue / dogfood / dev 原始观察，导入、分类、去重、关闭与重开 |
| Memory | `pnpm memory --help` | 保存开发问题、根因、思考和裁决，连接 E2E，并提升到 Roadmap / Feature / Engineering |
| PR | `pnpm pr:body --help` | 初始化、渲染、检查、创建和更新 PR 正文 |
| Docs | `pnpm docs:*` | 文档关系、模板创建、禁词、参考文档、diff 示例、文档检查和并行文档任务切片 |
| Examples | `pnpm examples:sync --help` | 示例 tier 同步、冲突检查和同步收据 |
| Consumer | `pnpm consumer:link --help` | 构建当前候选并安装到真实下游仓库 |
| Repository | `pnpm repo:setup --help` | Git hooks、本地宿主前置条件初始化和仓库级一致性检查 |

Docs 领域当前可运行的查询入口是 `pnpm feature` 与 `pnpm test`。目标结构创建入口是 `pnpm feature`、`pnpm roadmap`、
`pnpm design`、`pnpm engineering` 与 `pnpm use-case`；跨对象检查和恢复的目标入口是 `pnpm docs:trace`。
其它正式入口是 `pnpm docs:terms`、`pnpm docs:work`、`pnpm docs:diff-code`、`pnpm docs:reference` 与 `pnpm docs:dev`。
这些入口共用同一棵 Effect CLI 命令树和 Node runtime；追溯关系与 mutation 契约见[仓库文档追溯](../docs-traceability/README.md)。

以下能力保留在自己的 owner，不进入 Repository Tools：

- `e2e/scripts/` 是 host-side E2E runner，入口为 `pnpm e2e`。
- 产品 runtime 留在 `packages/niceeval`。
- IndexNow 等部署能力留在 `apps/site`。
- GitHub Actions、Netlify 与 hooks 只保存平台接线，业务判断由正式 pnpm 入口拥有。
- lint adapter 留在 `lint/**`。需要被正式 Docs 命令复用的领域 Schema 与 pure checker 留在 Docs domain，不为 lint 复制 parser 或启动 CLI 子进程。

## 动态发现

仓库不提供 `repo:capabilities`，也不维护中央 command registry。维护者按任务意图逐层进入：

```text
任务意图
  → 最近的 AGENTS.md 路由
  → 对应 Skill 的触发条件与工作流
  → 正式 pnpm 入口和 CLI --help
  → pnpm lint 验证整条关系
```

AGENTS 只说明从哪里开始，不复制参数。Skill 保存需要判断的顺序、安全边界和验收方式；完整参数只由 `--help` 定义。设计页解释长期语义；package script 提供人和 Agent 共用的稳定入口。

统一 lint 从现有事实推导关系，不读取另一份命令清单或中央 Trace Registry：

1. 从 root `package.json` 读取正式 pnpm script。
2. 从 `.agents/skills/*/SKILL.md` 的 `command` 与 `design` frontmatter 读取多步工作流 owner。
3. 验证 Skill 中的命令真实存在，且 `--help` 离线、只读并成功退出。
4. 验证 design 路径与 anchor 存在，design 声明的正式入口能反查到 script 或所属 package script。
5. 验证 workflow 与 hook 只调用正式 pnpm 入口，不直接运行 Repository Tools 的源码或退役脚本。
6. 删除入口时，同时报告失效的 AGENTS 路由、Skill、design 与 workflow 调用。

单步 `pnpm lint`、`pnpm typecheck` 和 `pnpm e2e` 不需要各自建立 Skill。需要选择、会写入或包含远端副作用的工作流必须有 Skill。

## CLI 与 Effect 边界

`cli.ts` 只完成 argv decode、命令路由、Layer 组装、统一渲染与 exit code 交付。领域 handler 返回结构化结果，不直接读取 `process.argv`、写 stdout/stderr 或设置 `process.exitCode`。

```text
argv
  → @effect/cli Options / Args
  → 领域输入 Schema
  → 领域 Effect<Receipt, DomainError, Services>
  → 根 renderer
  → stdout / stderr / exit code
```

不可信 JSON、YAML、frontmatter、package metadata 与外部命令输出在所属边界立即用 Schema 解码。每个领域定义具名错误；文件缺失、内容非法、引用冲突、锁冲突与外部命令失败不能压成一个 `RepoToolError` 字符串。

文件系统、时钟、Git、GitHub、子进程和终端输出由 service 提供。临时目录、锁与子进程进入 Scope；finalizer 无论成功、typed failure 或 interruption 都执行。只有根入口调用一次 `NodeRuntime.runMain`。

会修改文件的命令提供 `--dry-run` 或独立 `check`，并输出与实际写入同形的 receipt。会 push、创建 PR、发布或修改远端状态的命令仍要求当次用户授权；`--help` 和 `check` 不访问网络、不写仓库。

## 脚本退役

根 `scripts/` 是迁移输入，不是长期 owner。每个文件按职责进入七个领域、app owner 或 lint owner；正式入口切换并通过验收后删除原脚本，不保留兼容 wrapper。

| 现有脚本 | 最终 owner | 正式入口 |
|---|---|---|
| `configure-husky.mjs` | Repository | `pnpm repo:setup` |
| `docs-dev.mjs` | Docs | `pnpm docs:dev` |
| `gen-diff-code.ts` | Docs | `pnpm docs:diff-code` |
| `generate-reference.ts` | Docs | `pnpm docs:reference` |
| `link-consumer.mjs` | Consumer | `pnpm consumer:link` |
| `sync-tiers.mjs` | Examples | `pnpm examples:sync` |
| `docs-api-example-lint.ts` | `lint/docs/**` | `pnpm lint` |
| `netlify-report-preview.sh` | Report / Netlify owner | Netlify 只调用对应正式 pnpm 入口 |
| `submit-indexnow.ts` | `apps/site` | `pnpm site:build` 调用 app-owned 命令 |

迁移不保留旧命令别名。仓库仍处于 beta，内部 command 与 workflow 只有本仓库消费；调用方与实现同批切换到理想形态。

## Workflow 规则

YAML、Netlify 配置和 hooks 只决定平台何时调用命令、传入哪些可信参数，以及如何保存 artifact。选择、校验、生成、重试和 receipt 都属于领域实现。

同一工作流在本地和 CI 调用同一个 pnpm 入口。平台文件不得复制文件列表、状态机或成功判定；需要 matrix 的命令先输出已解码的 JSON receipt，再由平台按 receipt 分发。

## 验收

Repository Tools 不建立独立测试 project，也不签入一次性 fixture、snapshot 或用于复述实现的 fake。它只有本仓库一个消费者，行为验收直接运行正式 pnpm 入口：只读命令核对退出码与 receipt，写命令在临时目录或获准的隔离下游核对精确 Git diff、锁释放与子进程终止。

`pnpm lint` 只守 AGENTS、Skill、design、script、owner 与 workflow 接线，不重复领域状态机。每个领域的 `check` / `--dry-run` 与写命令共享 Schema 和领域实现；本轮实际命令、输入与结果写进 PR。只有具名算法已经重复回归，且真实入口的一次操作无法稳定识别时，才重新评估窄自动化检查。

每个领域迁移至少证明：

- 根正式入口和 `--help` 可由人和 Agent 直接运行；
- check / dry-run 与写入共享同一 Schema 和领域实现；
- 原脚本已无调用方，workflow / hook 不绕过正式入口；
- typed failure 给出具名原因与下一步，取消后没有锁、临时目录或子进程残留；
- `pnpm typecheck` 与 `pnpm lint` 通过；涉及下游或平台时再运行该 owner 的真实入口验收。

整个迁移完成时，根 `scripts/` 不存在，`e2e/scripts/` 保持独立。
