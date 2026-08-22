# Mintlify 文档站指南

`docs-site/` 是 NiceEval 的公开 Mintlify 文档站，面向正在学习和使用 NiceEval 的用户。这里的文档要回答“用户怎么完成任务”，不是记录内部设计讨论；内部设计、取舍和源码地图放在仓库根目录的 `docs/`。

## 目录结构

- `docs.json`：Mintlify 导航、主题、logo、navbar、redirects。
- 顶层 `*.mdx`：英文入口页，例如 `index`、`introduction`。
- `tutorials/`：英文 Tutorial 与 How-to 页，按工作流组织，镜像 `zh/tutorials/`；`troubleshooting/` 在导航里合并进这一标签页。
- `troubleshooting/`：英文按症状组织的排障页，镜像 `zh/troubleshooting/`。
- `explanation/`：英文核心概念页，解释心智模型和执行原理，镜像 `zh/explanation/`。
- `reference/`：英文 API / CLI 参考，列完整字段和选项，镜像 `zh/reference/`。
- `examples/`：英文可运行示例入口，镜像 `zh/examples/`。
- `snippets/`：页面里的 React 组件，分两类。**交互件**在 `widgets.jsx`（`Picker` / `Verdict` / `Lifecycle` / `Schedule`），页面用 props 传数据——同一个交互形态被多页复用，数据当然归页面。**结构图**一图一个组件、一图一个文件（`diagram-sandbox-mode.jsx`、`diagram-turn-roundtrip.jsx`、`diagram-hitl-handshake.jsx` 这样命名），内容写死在组件里：图讲的是哪件事本身就是这张图的一部分，抽成通用件只会让页面上多出一份看不出画面的数据。观感按仓库根 `DESIGN.md`。
- `styles/`：组件样式，**一个组件一份，文件名与 `snippets/` 里的组件文件对应**（`diagram-turn-roundtrip.jsx` ↔ `diagram-turn-roundtrip.css`）。只有真正被两个以上组件用到的规则才进共用文件：`base.css`（令牌、外框、页眉页脚、语义色、逐段点亮引擎）与 `tabs.css`（单选组切面板，`Picker` 和 `ConfigLayers` 共用）；两张接入形状图画的是同一种形状，共用 `diagram-access-modes.css`。Mintlify 会加载仓库里的 `.css` 并对全站生效，子目录也算，所以拆文件只是写法组织，不影响加载。
- 新增或改这两类组件前先读文件开头那段写法约束：只写箭头函数、不写 `import`、模块作用域不放未导出的辅助变量，交互与动画一律走 CSS（`:checked` / `:has()` / `animation-delay`）。Mintlify 把 JSX snippet 的导出内联进 MDX，不当模块打包：**snippet 之间不能互相 import**（共用的小工具函数只能同文件，这也是交互四件挤在一个文件里的原因），也**只认 `.mdx` / `.md` / `.jsx`**——没有 `.tsx`，组件里写不了类型标注。
- `zh/`：中文文档，是英文各目录的翻译源头。Tutorial 与 How-to 页面统一放在 `tutorials/`，其余按 Explanation、Reference 和 Troubleshooting 分区，具体边界见 `zh/README.md`。中文定位、概念命名和场景示例是公开叙事的准绳；英文页只在 `zh/` 对应页更新后同步翻译，英文版本由其它 AI 翻译，不在英文侧单独定稿内容或结构。

## 术语表

- **NiceEval**：产品名。中文正文表达产品时用 `NiceEval`；命令、包名、配置文件、代码标识里用 `niceeval`。
- **Eval**：一个评测用例。中文正文写“评估”或“评估用例”，不写未译的英文 `Eval`；`defineEval`、`EvalDef`、`.eval.ts`、`evalId` 等代码标识符不受影响。
- **Harness**：把 Eval 跑起来的执行链路——Runner 调度、经 Adapter 连被测对象、按需在 Sandbox 隔离运行、最终产出报告与 Artifact。中文正文直接写 `Harness`，不译；用于强调 NiceEval 不只是定义 Eval 的框架，也提供跑 Eval、看结果的完整链路。不要和 `docs/engineering/` 里“测试 Harness”（niceeval 自身单元测试的共享构造器）混用，那是仓库内部工程概念，不进公开站。
- **Experiment**：可签入的运行配置。中文写“实验”或保留 `Experiment`，用于说明 agent、model、flags、runs、budget、sandbox 等运行维度。
- **Adapter**：适配器，负责连接被测系统、鉴权、调用接口、把返回翻译成标准事件流。页面标题和导航可用 `Adapter`。
- **Agent**：NiceEval 看到的被测对象连接。不要把 Agent 写成某个固定协议；具体协议属于 Adapter。
- **Sandbox**：回答“在哪里隔离运行”的对象。中文正文写未译的 `Sandbox`，不写“沙箱”；不要和 Adapter 混成一层。
- **Fixture**：`test(t)` 里写入 Sandbox 的起始文件，加上 `EvalDef.setup` 准备的任务素材。中文正文写未译的 `Fixture`，不写“任务夹具”或“夹具”。
- **Provider**：某个 Sandbox 的具体实现选择（docker / vercel / e2b）。不要写「沙箱后端」——「后端」留给用户自己的应用服务。
- **Verdict**：一个 eval 的四态评分判定（passed / failed / errored / skipped）。中文写“判定”，不写“判决”。
- **Judge**：LLM-as-judge 的裁判模型。中文直接写 `Judge`，需要解释时写“裁判模型”，不写“评判模型”。
- **Attempt**：同一个 eval 的第 i 次重复运行。中文直接写 `Attempt`，不写“尝试”。
- **EarlyExit（`earlyExit`）**：取通过率时先过一次即中止其余 attempt 的策略。中文写“首过即停”，不写“早停”。
- **接入等级（Integration tier）**：接入方式的三级（Tier 1 / 2 / 3）。中文写“接入等级”，档位照写 Tier 1 / Tier 2 / Tier 3。
- **Record**：`.niceeval/record/` 中的持久事实集，只包含完整发布的 Run，发布后不可修改。Run 保存 expected slots，Member 保存占位并沿 Attempt 推导 origin/reference；业务事实属于 owner-local 的具名 `RecordAttachment`。Record 不保存 revision、hash 或防伪证明，也不判断是否复用或执行。
- **RecordAttachment**：挂在一个 Run 或 Attempt 上的具名、版本化事实。它有明确 owner、schema identity 与 owner-local blob closure；它不是通信通道。
- **Report artifact**：报告导出的自包含目录，带精确 runtime、全部页面和资源。它可删除、可重新生成，不是 Record，也不由未来 NiceEval 重新打开。
- **Turn**：一次 `t.send()` / `t.respond()` 的结果。中文直接写 `Turn`；“多轮对话”这类形容词性用法不受限。
- **StreamEvent / events**：标准事件流，是断言和报告读取的事实来源。
- **HITL**：human-in-the-loop，人工介入。第一次出现时写全称或中文解释。
- **OTel 接入**：Tier 2 的接入方式。只在讲 `send + OTel` 时使用，不要把 OTel 写进 Tier 1。
- **Flags**：experiment 传入的 feature flags，经 `ctx.flags` 到 Adapter，经 `t.flags` 到 eval。不要写成 CLI flags，除非指命令行参数。
- **Runner**：运行器。面向用户文档里避免写 “NiceEval core”；需要表达执行主体时写 NiceEval 或 runner。
- **生命周期 Hook**：四层（实验级 / Sandbox 级 / eval 级 / agent 级）共用同一形态的成对 `setup` / `teardown` 回调。中文写”生命周期”（泛指机制）或”生命周期 Hook”（指具体回调），不写”钩子”。
- **默认报告（内建报告）**：`niceeval show` / `view` 在没有 `--report`、配置里也没写 `report` 时装载的官方 Report。它和自定义 Report 一样经由 Sample、Projection 与一次固定的 `ReportExecution` 呈现，不读取 Record 路径或磁盘字段。
- **Analysis selection**：`AnalysisSelectionRequest` 从 frozen `RecordReader` 选择 Run，并形成 scope-bound `AnalysisSampleHandle`。它的 `.sample` 是关闭 reader 后仍可显示的纯 `AnalysisSample`。
- **Sample**：从明确 Run 或具名 latest policy 形成的内存选择。中文正文写 `Sample`，不写 `Scope`；它保留 expected-slot 分母，以及 included / not-recorded / core-invalid / excluded 状态。
- **RecordAttachment projector**：把一个明确 owner 的一个 Attachment payload 解释成 typed view。它不选择 Run、不计算通过率，也不决定沿用。
- **ProjectedSample**：Sample 与一次 Attachment projection 对齐后的穷尽结果。它不保存 reader、路径或 callback。
- **ReportExecution**：一次 Report 执行形成的不可变、自包含内存值。它保存 Sample、投影摘要、计算、页面、下载项与 problems；`show`、`view` 和静态导出只消费它。
- **Severity**：断言的 gate / soft 两档。中文写“严重度”，不写“严重级”；能直接写 gate / soft 的句子不要提“严重度”这个上位词。
- **报告模型**：Report 声明 RecordProjection、Calculation、Page、PageFamily 与 Download。host 在读取前闭合投影依赖，再形成一次 `ReportExecution`；静态 export 写出精确 runtime、页面、资源与 manifest。
- **值断言**：`expect` 匹配器经 `t.check` / `t.require` 的即时断言。不写“值级断言”。

## 写作规则
- **口语测试**：正文每句话要能原样对着同事说出口、对方第一次听就懂。内部设计代号与比喻（「报告槽」「证据室」「出厂填充」「接线」「前门」「收编」这类）不出现在公开站；要么把这个词提进上面的术语表并在页面首次出现处解释，要么用日常语言把条件和结果直说——写「不传 `--report` 时首页是默认报告」，不写「报告槽默认装官方榜单」。
- **不写内部演进**：读者不知道旧设计，也不需要知道。「不再」「改成」「新版」这类相对旧稿的叙述不出现；设计迭代的来龙去脉住在仓库根 `docs/` 与 `memory/`。
- 英语单词应该以大写开头
- 只在 @docs-site/zh 下面更新中文版本，英语版本由其它 AI 翻译
- 新增或重命名页面时同时更新 `docs.json`，必要时加 redirect，避免旧链接断掉。
- 链接示例必须指向真实存在的 `examples/` 目录；当前完整示例主要在 `examples/zh/`。
- 第一次成功路径和现实任务都写进 `zh/tutorials/`；前者按 Tutorial 写，后者按 How-to 写。概念边界写进 `zh/explanation/`，字段全集写进 `zh/reference/`，按症状修复写进 `zh/troubleshooting/`。不要把一个页面同时写成教程、设计文档和 API 字典。
- 命令、路径、flag、文件名、包名、代码标识用反引号。
- `zh/reference/` 页里 `{/* GENERATED:BEGIN … */}` 到 `{/* GENERATED:END … */}` 之间的内容不要手改：它由 `pnpm docs:reference` 从源码紧邻注释生成（接口/函数取 TSDoc，CLI flag 取各 Feature/Host contribution 自有 option schema 的 help metadata；region 与源码的映射见 `scripts/generate-reference.ts`）。要改这些文案，改 owner 源码后从仓库根跑 `pnpm docs:reference`；手改会被 `pnpm lint` 的漂移 lint 拦下。
- 文案使用主动语态和短句。错误信息、限制和前置条件要直接说清楚下一步。
- 机器规则只是最低门槛，通过 lint 不等于文案已经好读。提交前逐段朗读；遇到「传输粘合」「停轮判定」这类内部名词串，改写成明确的主语、动作和结果，例如「Adapter 请求应用接口」「当前 Turn 等待用户选择」。
- `docs-site/zh/` 与 `docs/` 共用 `docs/writing-rules.json` 的可读性上限：单句最多 140 字，一段最多 320 字。超长句拆成两句或列表，长段落按想法拆开。
- 公开站禁词也从同一份 JSON 的 `siteBannedTerms` 与 `siteOnlyBannedTerms` 取值，不在这里另护一份清单。frontmatter 元数据、代码、JSX 实现与明确的生成区块不按正文计数。
- 教程正文和标题使用陈述句或祈使句，不用设问带出内容。Eval 输入、Judge 标准、终端输出等需要展示真实问句的示例不受此限制。
- 写作指南: docs-site/docs-ref/00-index.md

## 校验

改 `docs-site/` 后，从仓库根目录运行：

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm lint
```

这一条统一执行 `lint/docs/` 与 `lint/docs-site/` 下的规则、Mintlify 构建校验和 Mintlify 断链检查。后两步调 Mint CLI，需要 LTS Node，所以要带
`PATH` 前缀。只想单独验其中一项时用 `pnpm run docs:validate` 或 `pnpm run docs:links`。
