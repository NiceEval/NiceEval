# 仓库能力入口

仓库能力是维护者反复执行并需要稳定验收的一项操作。每项能力只有一个根 `pnpm` 命令作为人和 AI 共用的正式入口，命令再调用所属目录的实现。内部函数可以被多个实现复用，不为每个文件制造一个 package script。

一项需要设计理由的维护能力按下列关系闭合：

```text
Engineering design → root pnpm command → implementation → lint guard
                                  ↘ Skill（多步、需选择或有副作用时）
```

`packages/repo-tools/` 保存需要共享命令树、Schema 解码或 typed error 的仓库维护 CLI，根 `scripts/` 保留单一 owner 的生成器和构建命令。`e2e/scripts/` 保存 E2E 编排机械能力。三处不合并；入口统一不等于 owner 合并。

## 发现与守护

`docs/engineering/repository-capabilities/registry.json` 是根 package scripts 的发现目录。运行 `pnpm repo:capabilities list [pattern]` 查看命令、类型、设计入口与可选 Skill，运行 `pnpm repo:capabilities check` 只读核对目录中的路径和 `package.json`。

`pnpm lint:docs` 还会执行同一份核对。新增或删除根 package script 时必须同批更新 registry；多步工作流还要登记实现、guard 与 Skill。由此，新增命令不会只躺在 `package.json`，设计也不会只有一页无人调用的说明。

带子命令、参数或写入行为的正式入口必须提供只读、离线且退出码为零的 `--help`。写文件的命令提供 `--dry-run` 或独立 `check`；会 push、发布或修改远端状态的步骤仍需当次用户授权。

## 基础验证

| 入口 | 验证对象 |
|---|---|
| `pnpm typecheck` | TypeScript 源码与公开参考类型示例 |
| `pnpm lint` | 文档、文档站结构、Mint 构建与链接 |
| `pnpm lint:vitest` | 两个目录归属的 lint project |
| `pnpm lint:docs` | `docs/`、`memory/` 与仓库维护规则 |
| `pnpm lint:docs-site` | 文档站生成区块、Mint 构建与链接 |
| `pnpm niceeval` | 从当前工作树运行 CLI |
| `pnpm e2e` | 从公开入口准备、执行与接管 E2E owner |

这些单步检查不另建 Skill。命令名已经说明动作，失败输出负责给出下一步。

## 多步维护工作流

| 能力 | 正式入口 | Skill | 守护 |
|---|---|---|---|
| 文档禁词维护 | `pnpm docs:terms --help` | `.agents/skills/docs-terminology/SKILL.md` | 写作 lint 与能力目录 lint |
| 摩擦条目维护 | `pnpm frog --help` | `.agents/skills/frog/SKILL.md` | 能力目录 lint；条目格式由 Frog 校验 |
| PR 正文 | `pnpm pr:body --help` | `.agents/skills/pull-request/SKILL.md` | 命令自身的 `check` 与能力目录 lint |
| 能力发现 | `pnpm repo:capabilities --help` | 不需要 | 能力目录 lint |

Skill 只保存触发条件、选择规则和安全边界。完整参数由命令 `--help` 拥有，设计理由由本页或对应工程主题拥有，AGENTS 只负责路由。

`@niceeval/repo-tools` 是私有 workspace package，不发布 npm。它只拥有仓库维护命令，不叫 `utils`，也不接收产品 runtime、E2E host 或 Testkit 的职责。命令树使用 Effect v3 的 `@effect/cli`；JSON 在入口用 Schema 解码，文件失败进入 typed error，唯一 runtime 由 package 根 CLI 启动。

Frog 是独立上游 CLI，仓库只在 `@niceeval/repo-tools` 固定版本并通过 `pnpm frog` 原样调用，不复制其命令树。其余仓库自有的多步维护命令进入 Effect CLI；例如 `pr:body` 不再保留根 `scripts/` 下的手写 argv 扫描循环。

文档禁词的唯一数据源仍是 `docs/writing-rules.json`。`docs:terms add`、`remove` 与 `list` 维护这份数据，`check` 复用写作 lint 的规则自检和正文扫描。首选领域术语仍在 `docs/concepts.md` 裁决；由概念表推导的同义词禁用不重复写入禁词库。

## 构建与生成

| 入口 | 设计归属 |
|---|---|
| `pnpm gen:diff-code` | [Origin 接入](../../origin-integration.md) |
| `pnpm docs:reference` | [文档同步义务](../../README.md#同步义务) |
| `pnpm tiers:sync` | [示例分层同步](../example-tier-sync/README.md) |
| `pnpm view:build`、`pnpm build:report` | [Report](../../feature/reports/README.md) |
| `pnpm build:package`、`pnpm build:index`、`pnpm dev:link` | [随包 AI 文档](../agent-docs/README.md) |
| `pnpm prepare` | Git hook 初始化；包构建由 workspace package 自己拥有 |

## 站点命令

`pnpm site:dev` 与 `pnpm site:build` 由 [`apps/site/README.md`](../../../apps/site/README.md) 拥有。`pnpm docs:dev`、`pnpm docs:mint`、`pnpm docs:validate` 与 `pnpm docs:links` 由 [`apps/docs-site/AGENTS.md`](../../../apps/docs-site/AGENTS.md) 拥有。

`site:build` 的生产部署分支会提交 IndexNow 请求，不作为无副作用检查。只验证产品站时按站点入口选择本地 build 条件，不设置触发 IndexNow 的部署变量。
