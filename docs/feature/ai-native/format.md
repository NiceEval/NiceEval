# AI-native：文件格式

本页定义这条路径上 agent 会读到、`niceeval init` 会写入的文件。教程页面的正文不在这里定义。

## 文件一览

| 文件 | 位置 | 谁写 | 谁读 |
|---|---|---|---|
| `INIT.md` | `https://niceeval.com/INIT.md` | NiceEval 发布流程 | 安装前的 agent |
| 托管区块 | 用户仓库的 `AGENTS.md` 或 `CLAUDE.md` | `niceeval init` | 每个新对话里的 agent |
| skill | 用户仓库的 skill 目录 | `niceeval init` | 支持 skill 的 agent 运行时 |
| `INDEX.md` | `node_modules/niceeval/INDEX.md` | 打包时生成 | 安装后的 agent |
| 随包页面 | `node_modules/niceeval/docs-site/zh/**` | 随包发布 | 安装后的 agent |

托管区块与 skill 合称项目指引。

## 那一句话

```text
READ https://niceeval.com/INIT.md and install niceeval for this repo.
```

句子是英文的固定文本，官网各语言页面展示同一句。URL 固定，不带版本号、语言或查询参数。
用户想装指定版本时在句子后面补一句版本要求；`INIT.md` 规定明确指定的版本优先。

## INIT.md

`https://niceeval.com/INIT.md` 返回最新稳定版 tag 下的 `INIT.md` 原文，内容类型是纯文本 Markdown。
“最新稳定版”按完整 SemVer 比较，不含预发布与 canary；它怎样更新见 [Architecture](architecture.md#稳定版-init-的发布)。
某个版本的原文可以从该版本的 tag 读取：`https://raw.githubusercontent.com/NiceEval/NiceEval/v<version>/INIT.md`。

`INIT.md` 是英文的，按下面的顺序组织，每一节只写安装前就能定稿的内容：

| 节 | 内容 |
|---|---|
| 开头 | 任务对象是当前打开的仓库；用用户的语言交流；不凭记忆写 API |
| 待办清单 | 完成标准是跑通一条真实评估并经公开命令确认；逐项可勾选 |
| 核心想法 | 五条决定安装与接入方式的想法 |
| 前置条件 | 只要求能安装并运行 Node；怎样判断依赖归属与安装位置 |
| 安装 | 安装命令、`init` 写入什么、怎样从仓库根目录验证 |
| 交接 | 确认 `node_modules/niceeval/INDEX.md` 存在，此后只读随包文档 |

约束：

- 不含任何线上文档链接。接入流程的正文只在随包页面里。
- 不含会随版本变化的 API 示例；需要代码的内容交给随包页面。
- UTF-8 编码后不超过 16384 bytes，由仓库检查与稳定版发布检查守护；此上限不保证模型会一次读取全文。

## 项目指引 {#项目指引}

### 托管区块

`niceeval init` 把托管区块写进仓库根目录里每一个已有的指引文件：

| 仓库根已有 | 写入 |
|---|---|
| `AGENTS.md` 与 `CLAUDE.md` | 两个文件各写一份相同的区块 |
| 只有其中一个 | 写进那一个 |
| 两者都没有 | 新建 `AGENTS.md` |

仓库根是包含 `init` 运行目录的 Git 工作树的根；不在 Git 工作树里时是运行目录本身。

区块以固定标记包围，`init` 只替换两个标记之间的内容：

```markdown
<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data
……
<!-- END:niceeval-agent-rules -->
```

区块是英文的，只写四件事，每件不超过三行：

1. NiceEval 不在训练数据里，写任何配置或评估前先读随包索引，路径按下文[索引路径](#索引路径)写入。
2. 那份索引与随包中文页面是当前安装版本的权威文档，不去官网或 GitHub 找另一版。
3. 读结果只用仓库包管理器调用的 `niceeval show`、`query` 与 `view`，不读 `.niceeval/` 下的文件。
4. 公开命令给不出需要的证据时，报告这是产品缺口，不改读实现源码。

区块不写版本号、API 名称或页面路径；除 `INDEX.md` 外不指向任何具体文件，所以文档重组不需要用户刷新区块。

### 索引路径 {#索引路径}

`init` 在拥有 `niceeval` 依赖的那个包目录里运行。它把该目录相对仓库根的位置写进项目指引，agent 从仓库根照着读就能找到索引：

| `init` 的运行目录 | 项目指引里的索引路径 | 项目指引里的命令 |
|---|---|---|
| 仓库根 | `node_modules/niceeval/INDEX.md` | `pnpm exec niceeval` |
| 子目录 `tools/evals` | `tools/evals/node_modules/niceeval/INDEX.md` | `pnpm --dir tools/evals exec niceeval` |

命令按该目录实际使用的包管理器写出。`init` 写入前确认这个路径上的文件存在；不存在时以 `bundled-docs-not-on-disk` 失败，不写任何指引。
依赖不落盘到 `node_modules` 的安装方式（例如 Yarn Plug'n'Play）不受支持，失败信息写明这一点。
移动依赖归属目录后重新运行 `init`，路径随之更新。

### skill {#skill}

部分 agent 运行时按任务描述加载 skill，而不是每次都读完整的指引文件。`init` 总是写两份内容相同的 skill，不检测仓库里有哪些目录：

| 路径（相对仓库根） | 读它的运行时 |
|---|---|
| `.agents/skills/niceeval/SKILL.md` | Codex 及遵循同一约定的运行时 |
| `.claude/skills/niceeval/SKILL.md` | Claude Code |

已有的目录只能说明仓库里曾经用过某个工具，不能证明这次对话用的是哪一个；一个全新的仓库更是什么目录都没有。
两份都写，任何一种运行时的新对话都有入口；代价是两个很小的受管文件。

```markdown
---
name: niceeval
description: Use when writing, running, or diagnosing NiceEval evals, experiments, adapters, or config in this repository, or when reading NiceEval results.
---

<!-- managed by `niceeval init`; edits are overwritten -->

Read `<index path>` first and follow the bundled page it routes to.
……
```

skill 的正文与托管区块的四件事相同。整个文件归 `init` 所有，刷新时整体重写。
skill 不复制随包页面的内容；它和托管区块一样只有一跳，终点都是 `INDEX.md`。

Codex 的项目入口是 `.agents/skills/<name>/SKILL.md`，从 cwd 向上到仓库根发现；`.codex/` 不是发现前提。
Claude Code 的项目入口是 `.claude/skills/<name>/SKILL.md`。两者都先读取 name、description 等元数据，再按任务加载正文，不能保证每个对话都隐式触发。
发现规则以 [Codex skills](https://learn.chatgpt.com/docs/build-skills) 与 [Claude Code skills](https://code.claude.com/docs/en/skills) 为准；CLI 的默认发现不等同于所有 SDK 的默认配置。

## INDEX.md

包根下的 `INDEX.md` 这个位置是契约，托管区块、skill 与 `INIT.md` 引用的都是它。文件由两部分组成：

| 部分 | 内容 |
|---|---|
| 导语 | 阅读契约与按任务路由 |
| 页面树 | 每个随包页面一行：`路径 — 标题:一句话自述`，按目录分组 |

“按任务路由”说明怎样从页面自述选取一至三页，服务运行与复验、只读诊断、编写评估与首次接入等意图，不维护手写的任务到页面映射表。
页面路径由随包文件枚举，标题与自述由 frontmatter 生成，遵守[随包 AI 文档的单源裁决](../../engineering/agent-docs/README.md)。

导语不写运行、诊断或编写评估的步骤。这些方法各有一个随包页面作单源，导语只把 agent 送到那一页（[T-32](../../taste.md#t-32)）。
导语不超过 4 KiB，使索引的大部分篇幅留给页面树。

## 随包页面与类型声明

- 页面是中文 MDX 原文，路径相对包根。页面之间用包内相对路径互相引用。
- 页面不含指向本仓库 `main` 的链接；仓库示例固定到与包版本相同的 tag。
- 每个从公开入口导出的函数与类型，在类型声明里带一句用法说明。函数的说明写它判断什么或做什么，以及最容易写错的一点。
  说明写在声明处；从多个入口重导出的同一声明只算一次。
  验收检查实际发布的声明文件是否保留说明；agent 能否据此正确调用，由效果评估测量，不作为对模型行为的绝对保证。

## 指定版本与缺少索引

用户指定了版本时，agent 读那个版本 tag 下的 `INIT.md`，而不是官网那一份；预发布与 canary 同样按 tag 读取。
安装后包根下没有 `INDEX.md` 的版本不支持这条路径。agent 重新安装一次仍然没有，就报告该版本不支持并停止，不改读官网或 `main` 的文档。

## 校验

| 情形 | 结果 |
|---|---|
| `init` 缺少任一成对标记，或标记顺序颠倒 | 以 `agent-rules-markers-invalid` 失败，写出文件与行号，不修改该文件 |
| `init` 发现文件里有多组标记 | 同上；用户保留一组后重试 |
| skill 目标路径已存在且不含托管注释 | 以 `agent-skill-not-managed` 失败，不改写用户自己的 skill |
| 打包时某个页面缺标题或自述 | 打包失败并指出页面 |
| 打包时随包页面含指向 `main` 的链接 | 打包失败并指出页面与链接 |
| `INIT.md` 含线上文档链接或超过长度上限 | 仓库检查失败 |

首次写入时没有任何标记是合法情形。写入前检查所有指引目标的标记与托管所有权；校验失败时不写入任何指引目标。
多文件写入不承诺文件系统事务；I/O 中途失败时返回非零退出码，列出已更新与未更新的路径。只重试 `init`，不要求重装依赖。
`init` 可以重复运行：内容没有变化时不改写文件，退出码为 0。
