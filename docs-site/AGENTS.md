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
- **Sandbox**：沙箱，回答“在哪里隔离运行”。不要和 Adapter 混成一层。
- **Provider**：某个 Sandbox 的具体实现选择（docker / vercel / e2b）。不要写「沙箱后端」——「后端」留给用户自己的应用服务。
- **Verdict**：一个 eval 的四态评分判定（passed / failed / errored / skipped）。中文写“判定”，不写“判决”。
- **Judge**：LLM-as-judge 的裁判模型。中文直接写 `Judge`，需要解释时写“裁判模型”，不写“评判模型”。
- **Attempt**：同一个 eval 的第 i 次重复运行。中文直接写 `Attempt`，不写“尝试”。
- **EarlyExit（`earlyExit`）**：取通过率时先过一次即中止其余 attempt 的策略。中文写“首过即停”，不写“早停”。
- **接入等级（Integration tier）**：接入方式的三级（Tier 1 / 2 / 3）。中文写“接入等级”，档位照写 Tier 1 / Tier 2 / Tier 3。
- **Turn**：一次 `t.send()` / `t.respond()` 的结果。中文直接写 `Turn`；“多轮对话”这类形容词性用法不受限。
- **StreamEvent / events**：标准事件流，是断言和报告读取的事实来源。
- **HITL**：human-in-the-loop，人工介入。第一次出现时写全称或中文解释。
- **OTel 接入**：Tier 2 的接入方式。只在讲 `send + OTel` 时使用，不要把 OTel 写进 Tier 1。
- **Flags**：experiment 传入的 feature flags，经 `ctx.flags` 到 Adapter，经 `t.flags` 到 eval。不要写成 CLI flags，除非指命令行参数。
- **Runner**：运行器。面向用户文档里避免写 “NiceEval core”；需要表达执行主体时写 NiceEval 或 runner。
- **默认报告（`DefaultReport`）**：不传 `--report` 时 `niceeval show` / `niceeval view` 渲染的那份内置报告（运行总览 + 逐实验指标表 + 失败清单）。不要写「官方榜单」「默认榜单」——没有独立于报告之外的「榜单」实体；「榜单」只用作默认报告里那张逐实验指标表的口语叫法。

## 写作规则
- **口语测试**：正文每句话要能原样对着同事说出口、对方第一次听就懂。内部设计代号与比喻（「报告槽」「证据室」「出厂填充」「接线」「水位」「前门」「收编」这类）不出现在公开站；要么把这个词提进上面的术语表并在页面首次出现处解释，要么用日常语言把条件和结果直说——写「不传 `--report` 时首页是默认报告」，不写「报告槽默认装官方榜单」。
- **不写内部演进**：读者不知道旧设计，也不需要知道。「不再」「改成」「新版」这类相对旧稿的叙述不出现；设计迭代的来龙去脉住在仓库根 `docs/` 与 `memory/`。
- 英语单词应该以大写开头
- 只在 @docs-site/zh 下面更新中文版本，英语版本由其它 AI 翻译
- 新增或重命名页面时同时更新 `docs.json`，必要时加 redirect，避免旧链接断掉。
- 链接示例必须指向真实存在的 `examples/` 目录；当前完整示例主要在 `examples/zh/`。
- 工作流写成 guide，字段全集写成 reference，概念边界写成 concepts。不要把一个页面同时写成教程、设计文档和 API 字典。
- 命令、路径、flag、文件名、包名、代码标识用反引号。
- `zh/reference/` 页里 `{/* GENERATED:BEGIN … */}` 到 `{/* GENERATED:END … */}` 之间的内容不要手改：它由 `pnpm docs:reference` 从源码紧邻注释生成（接口/函数取 TSDoc，CLI flag 取 `src/cli.ts` 里 `FLAG_OPTIONS` 各项的 JSDoc；region 与源码的映射见 `scripts/generate-reference.ts`）。要改这些文案，改源码注释后从仓库根跑 `pnpm docs:reference`；手改会被 `pnpm test` 的漂移守护拦下。
- 文案使用主动语态和短句。错误信息、限制和前置条件要直接说清楚下一步。
- 写作指南: docs-site/docs-ref/00-index.md

## 校验

改 `docs-site/` 后，从仓库根目录运行：

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```