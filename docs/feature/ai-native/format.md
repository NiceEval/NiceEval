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
- 长度不超过 16 KiB，保证 agent 一次读完。

## 项目指引 {#项目指引}

### 托管区块

`niceeval init` 把托管区块写进用户仓库的一个文件：

| 仓库里已有 | 写入 |
|---|---|
| `AGENTS.md` | `AGENTS.md` |
| 只有 `CLAUDE.md` | `CLAUDE.md` |
| 两者都没有 | 新建 `AGENTS.md` |

区块以固定标记包围，`init` 只替换两个标记之间的内容：

```markdown
<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data
……
<!-- END:niceeval-agent-rules -->
```

区块是英文的，只写四件事，每件不超过三行：

1. NiceEval 不在训练数据里，写任何配置或评估前先读 `node_modules/niceeval/INDEX.md`。
2. 那份索引与随包中文页面是当前安装版本的权威文档，不去官网或 GitHub 找另一版。
3. 读结果只用仓库包管理器调用的 `niceeval show`、`query` 与 `view`，不读 `.niceeval/` 下的文件。
4. 公开命令给不出需要的证据时，报告这是产品缺口，不改读实现源码。

区块不写版本号、API 名称或页面路径；除 `INDEX.md` 外不指向任何具体文件，所以文档重组不需要用户刷新区块。

### skill {#skill}

部分 agent 运行时按任务描述加载 skill，而不是每次都读完整的 `AGENTS.md`。`init` 为检测到的运行时各写一份内容相同的 skill：

| 仓库里已有 | 写入 |
|---|---|
| `.claude/` 目录 | `.claude/skills/niceeval/SKILL.md` |
| `.agents/` 或 `.codex/` 目录 | `.agents/skills/niceeval/SKILL.md` |
| 都没有 | 不写 skill，只写托管区块 |

```markdown
---
name: niceeval
description: Use when writing, running, or diagnosing NiceEval evals, experiments, adapters, or config in this repository, or when reading NiceEval results.
---

<!-- managed by `niceeval init`; edits are overwritten -->

Read `node_modules/niceeval/INDEX.md` first and follow the bundled page it routes to.
……
```

skill 的正文与托管区块的四件事相同。整个文件归 `init` 所有，刷新时整体重写。
skill 不复制随包页面的内容；它和托管区块一样只有一跳，终点都是 `INDEX.md`。

## INDEX.md

`node_modules/niceeval/INDEX.md` 这个路径是契约，托管区块、skill 与 `INIT.md` 引用的都是它。文件由两部分组成：

| 部分 | 内容 |
|---|---|
| 导语 | 阅读契约、按任务路由、跑通实验的方法、发现并解决问题的方法 |
| 页面树 | 每个随包页面一行：`路径 — 标题:一句话自述`，按目录分组 |

“按任务路由”固定给出四个入口：已有项目要运行或复验、只读诊断、编写或修正评估、首次接入。
每个入口点名先读的页面，其余页面由 agent 从页面树里按自述挑选。

## 随包页面与类型声明

- 页面是中文 MDX 原文，路径相对包根。页面之间用包内相对路径互相引用。
- 页面不含指向本仓库 `main` 的链接；仓库示例固定到与包版本相同的 tag。
- 每个从公开入口导出的函数与类型，在类型声明里带一句用法说明。函数的说明写它判断什么或做什么，以及最容易写错的一点。
  agent 用编辑器或 `grep` 查到声明时，不必再读实现就能正确调用。

## 校验

| 情形 | 结果 |
|---|---|
| `init` 找到开始标记却找不到结束标记，或标记顺序颠倒 | 以 `agent-rules-markers-invalid` 失败，写出文件与行号，不修改该文件 |
| `init` 发现文件里有多组标记 | 同上；用户保留一组后重试 |
| skill 目标路径已存在且不含托管注释 | 以 `agent-skill-not-managed` 失败，不改写用户自己的 skill |
| 打包时某个页面缺标题或自述 | 打包失败并指出页面 |
| 打包时随包页面含指向 `main` 的链接 | 打包失败并指出页面与链接 |
| `INIT.md` 含线上文档链接或超过长度上限 | 仓库检查失败 |

`init` 可以重复运行：内容没有变化时不改写文件，退出码为 0。
