# Mintlify 文档站指南

`docs-site/` 是 NiceEval 的公开 Mintlify 文档站，面向正在学习和使用 NiceEval 的用户。这里的文档要回答“用户怎么完成任务”，不是记录内部设计讨论；内部设计、取舍和源码地图放在仓库根目录的 `docs/`。

## 目录结构

- `docs.json`：Mintlify 导航、主题、logo、navbar、redirects。
- 顶层 `*.mdx`：英文入口页，例如 introduction、quickstart、installation。
- `concepts/`：英文核心概念页，解释心智模型。
- `guides/`：英文任务指南，按工作流组织。
- `reference/`：英文 API / CLI 参考，列完整字段和选项。
- `zh/`：中文文档。中文定位、概念命名和场景示例是公开叙事的准绳；英文页或 README 与中文冲突时，先按中文和当前代码核对，再同步其它入口。

## 术语表

- **NiceEval**：产品名。中文正文表达产品时用 `NiceEval`；命令、包名、配置文件、代码标识里用 `niceeval`。
- **Eval**：一个评测用例。中文可以写“Eval”或“评估用例”
- **Experiment**：可签入的运行配置。中文写“实验”或保留 `Experiment`，用于说明 agent、model、flags、runs、budget、sandbox 等运行维度。
- **Adapter**：适配器，负责连接被测系统、鉴权、调用接口、把返回翻译成标准事件流。页面标题和导航可用 `Adapter`。
- **Agent**：NiceEval 看到的被测对象连接。不要把 Agent 写成某个固定协议；具体协议属于 Adapter。
- **Sandbox**：沙箱后端，回答“在哪里隔离运行”。不要和 Adapter 混成一层。
- **Turn**：一次 `t.send()` / `t.respond()` 的结果。中文可写“一轮”或保留 `Turn`。
- **StreamEvent / events**：标准事件流，是断言和报告读取的事实来源。
- **HITL**：human-in-the-loop，人工介入。第一次出现时写全称或中文解释。
- **OTel 接入**：Tier 2 的接入方式。只在讲 `send + OTel` 时使用，不要把 OTel 写进 Tier 1。
- **flags**：experiment 传入的 feature flags，经 `ctx.flags` 到 Adapter，经 `t.flags` 到 eval。不要写成 CLI flags，除非指命令行参数。
- **Runner**：运行器。面向用户文档里避免写 “NiceEval core”；需要表达执行主体时写 NiceEval 或 runner。

## 写作规则

- 先确认当前代码或 `docs/`，再声明某个命令、Adapter、sandbox 后端、reporter、CLI flag 已支持。
- 用户文档优先写“怎么用”和“为什么这样组织”，少写内部实现名。必要的源码设计背景链接到 `docs/`，不要搬运长篇设计讨论。
- 中文页要先把概念讲顺，再同步英文页；不要为了英文入口临时发明能力、路径或产品定位。
- 新增或重命名页面时同时更新 `docs.json`，必要时加 redirect，避免旧链接断掉。
- 链接示例必须指向真实存在的 `examples/` 目录；当前完整示例主要在 `examples/zh/`。
- MDX frontmatter 至少包含 `title` 和 `description`；`sidebarTitle` 用于缩短侧边栏显示。
- 工作流写成 guide，字段全集写成 reference，概念边界写成 concepts。不要把一个页面同时写成教程、设计文档和 API 字典。
- 命令、路径、flag、文件名、包名、代码标识用反引号。
- 文案使用主动语态和短句。错误信息、限制和前置条件要直接说清楚下一步。

## 怎么写好文档

- **从用户任务开头**：先说用户想完成什么，再给最小可运行路径，最后补充变体和边界。
- **保持一个页面一个主问题**：例如 Adapter 页讲“怎么接被测系统”，写实验页讲 `defineExperiment` 怎么配置，不要互相吞并。
- **示例要可迁移**：代码片段使用真实 API、真实导入路径、真实文件结构；不要出现代码当前不支持的字段。
- **先给默认做法，再给例外**：例如先说 Tier 1 只接 `send`，再说已埋点应用可升级到 Tier 2 的 OTel 接入。
- **把配置归属说清楚**：Adapter 工厂接 URL / 鉴权 / 协议细节；experiment 传 `model`、`flags`、`runs`、`budget`；eval 只写交互和断言。
- **避免空泛定位**：不要只说“强大、灵活、无缝”。说明它具体少写了什么代码、解锁了什么断言、产出了什么报告。
- **避免混用层次**：NiceEval 负责发现、调度、评分和报告；Adapter 负责连接被测对象；Sandbox 负责隔离环境。
- **维护术语一致性**：同一概念在标题、导航、正文和相关阅读里用同一个名字，例如 `OTel 接入`、`Adapter`、`写实验`。

## 校验

改 `docs-site/` 后，从仓库根目录运行：

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

Mintlify CLI 目前需要 LTS Node，例如 Node 22。两个命令要串行跑，避免 `npx` 缓存冲突。
