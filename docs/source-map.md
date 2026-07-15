# Source Map —— 文档行为 → 实现文件

文档是设计依据。这一页把每条文档行为映射回具体源码文件(参考 crabbox 的做法),
方便对照「设计 vs 实现」;如果代码实现与文档设计不一致,应进一步讨论并决定是修代码、修设计,还是记录为明确的阶段性差异。niceeval 以 TS 源码经 `tsx` 运行,无编译步骤(`bin/niceeval.mjs` 注册
`tsx/esm/api` 后加载 `src/cli.ts`)。

## 总览:模块 → 文件

| 设计文档里的概念 | 实现文件 |
|---|---|
| 核心类型契约(聚合 facade;类型按域住各自目录) | `src/types.ts`(re-export)← `src/shared/types.ts`(原子)、`src/o11y/types.ts`、`src/sandbox/types.ts`、`src/agents/types.ts`、`src/scoring/types.ts`、`src/context/types.ts`、`src/runner/types.ts` |
| 公开导出(`niceeval`,eval 作者用的核心面) | `src/index.ts` |
| 公开导出(`niceeval/adapter`,Agent/Adapter) | `src/agents/index.ts` |
| 公开导出(`niceeval/sandbox`,Sandbox) | `src/sandbox/index.ts` |
| `defineEval` / `defineConfig` / `defineExperiment` / `defineAgent` / `defineSandboxAgent` / `defineSandbox` | `src/define.ts` |
| `requireEnv` / 工具 | `src/util.ts` |

## Agents 与 Adapters([入口](feature/adapters/README.md) / [库用法](feature/adapters/library.md) / [架构](feature/adapters/architecture.md))

公共调用与组合按任务位于 `feature/adapters/library/`；数据结构、状态机与完整性不变量位于 `feature/adapters/architecture/`。

| 行为 | 文件 |
|---|---|
| Agent 契约(`kind: "sandbox" | "remote"`,无能力位字段)/ 三类配置归属 | `src/agents/types.ts`(`Agent` / `AgentContext` / `AgentSession` / `SpanMapper`) |
| `AgentContext.experimentId`(路径推导的实验 id,与结果归属同源;沙箱生命周期钩子按它隔离跨 attempt 状态) | `src/agents/types.ts`(`AgentContext.experimentId`) |
| 能力调用守卫(缺声明的动作第一次调用即报清晰错误;conversation gate 第二轮起) | `src/context/context.ts`(`capabilityGuard`) |
| 逐 API 适配义务(send / newSession / respond 的运行器侧翻译) | `src/context/session.ts`(`SessionManager` / `RunSession`)、`src/context/context.ts` |
| `defineSandboxAgent` / `defineAgent`(`kind: "sandbox" | "remote"`,无能力位字段) | `src/define.ts` |
| `shared` 工具袋(ensureInstalled / captureLatestJsonl(可按 sessionId 精确定位)/ writeFile / extractJsonlFromStdout / codexThreadId / firstJsonField / shellQuote / diagnoseFailure / parseCodex·parseClaudeCode·parseBub) | `src/agents/shared.ts` |
| 采集矩阵(collection.md:每 agent 的通道 / 字段来源) | `src/agents/{claude-code,codex,bub}.ts`(采集)+ `src/o11y/parsers/*.ts`(字段提取) |
| `fromAiSdk`(AI SDK 结果 → 标准事件流,v4/v5/v7 字段漂移兜底;v7 tool approval → `input.requested` + `status: "waiting"`) | `src/agents/ai-sdk.ts`(+ 同目录 `.test.ts`) |
| 内置 adapter(claude-code / codex / bub) | **由被测项目自带**(`agents/*.ts`),niceeval 提供 `shared` + 解析器 |
| `uiMessageStreamAgent`(AI SDK UI Message Stream 协议的内置无侵入 adapter) | `src/agents/ui-message-stream.ts` |
| SDK 原生事件流转换器(`fromClaudeSdkMessages` / `fromPiAgentEvents` / `fromCodexThreadEvents`) | `src/agents/sdk-streams.ts`(+ 同目录 `.test.ts`);逐 SDK 契约见 `docs/feature/adapters/sdk/` |
| LangGraph 官方事件流转换器(`fromLangGraphEvents`) | `src/agents/langgraph.ts`;契约见 `docs/feature/adapters/sdk/langgraph/README.md` |
| OpenClaw sandbox Agent(`openClawAgent`) | `src/agents/openclaw.ts` + `src/o11y/parsers/openclaw.ts`;契约见 `docs/feature/adapters/sdk/openclaw/README.md` |
| OpenAI 兼容结果转换器(`fromChatCompletion` / `fromResponses`) | `src/agents/openai-compat.ts`;契约见 `docs/feature/adapters/sdk/openai-compat/README.md` |
| 原生配置文件替换(`settingsFile` / `configFile`:项目根内路径校验、上传替换、保留键冲突检测、SHA-256 进 checkpoint key) | `src/agents/native-config.ts`(共享层)+ `src/agents/{claude-code,codex}.ts`(各自保留键表) |
| Marketplace 注册名回读校验(`marketplace add` 后回读列表,配置名对不上立刻报错) | `src/agents/marketplace.ts`(claude-code / codex 共用,回读命令由 adapter 传入) |

## Coding Agent Skills / Plugins DX([用法](feature/adapters/library/coding-agent-extensions.md) / [架构](feature/adapters/architecture/coding-agent-extensions.md))

| 行为 | 文件 |
|---|---|
| `SkillSpec` / `AgentSetupManifest` 类型 | `src/agents/types.ts` |
| Skill 安装(本地形状、repo clone + ref、选择规则、发现指引) | `src/agents/skills.ts`(经 `shared.installSkills` 也给自定义 adapter 用) |
| Claude Code skill / native plugin / MCP setup | `src/agents/claude-code.ts`(`ClaudeCodeConfig.skills` / `plugins` / `mcpServers`、`ClaudeCodePluginSpec`) |
| Codex skill / native plugin / MCP setup | `src/agents/codex.ts`(`CodexConfig.skills` / `plugins` / `mcpServers`、`CodexPluginSpec`) |
| bub skill / Python plugin setup | `src/agents/bub.ts`(`BubConfig.skills` / `pythonPlugins`、`PythonPluginSpec`;package 集合进安装 checkpoint key) |
| 安装 manifest 的写(adapter)与读(运行器) | `src/agents/manifest.ts`、`src/runner/attempt.ts`(抬成 attempt artifact `agent-setup.json`) |
| 本地 skill A/B 示例 | [coding-agent-skill](https://github.com/CorrectRoadH/coding-agent-skill)(独立仓库) |

## 标准事件流与可观测性([observability.md](observability.md))

| 行为 | 文件 |
|---|---|
| 原始 transcript → 标准 `StreamEvent[]` + 用量 + 压缩计数 | `src/o11y/parsers/{codex,claude-code,bub}.ts`、`parsers/index.ts`(`ParsedTranscript`;无按名字分派的入口,adapter 直连具体 parser) |
| 规范工具名归一(共享基表 + per-agent 差异叠加) | `src/o11y/tool-names.ts` |
| 原生 OTLP span → canonical GenAI semconv(mapper 由 Agent 经 `spanMapper` 声明,core 不按名字分支;缺省走通用 heuristic) | `src/o11y/otlp/mappers/{codex,bub}.ts`、`src/o11y/otlp/canonical.ts`(`heuristicTag` / `mapGenericSpans`) |
| run 级共享 OTLP 接收 + 逐轮归属(traceparent → `ctx.telemetry.headers`;窗口兜底 + 未确认时该 agent 轮次串行) | `src/o11y/otlp/turn-otel.ts`(`AgentOtelChannel` / `OtelReceiverPool`);接线在 `src/runner/attempt.ts`(池取通道)与 `src/context/session.ts`(`sendWithOtel`:归属 / 派生 / 合并) |
| 固定端口 / 自定义接收 host 模式(`defineConfig({ telemetry: { host, port } })`,niceeval 项目内唯一入口,不读环境变量) | `src/runner/run.ts`(`OtelReceiverPool` 取 `config.telemetry.port`)、`src/runner/attempt.ts`(`config.telemetry.host`)、`src/o11y/otlp/receiver.ts`(`makeTraceReceiver(port)`,端口被占用时报 `otel.portInUse`) |
| `deriveRunFacts`(toolCalls / subagents / parked / compactions) | `src/o11y/derive.ts` |
| o11y 摘要(注入 `__niceeval__/results.json` 的字段) | `src/o11y/derive.ts`(`buildO11ySummary`) |
| codex 用量从 `turn.completed.usage` 抠出 | `src/o11y/parsers/codex.ts` |
| 用量 → 成本(实测优先 → 用户覆盖 → 内置快照) | `src/o11y/cost.ts` |

## Sandbox([feature/sandbox/](feature/sandbox/README.md))

| 行为 | 文件 |
|---|---|
| `Sandbox` 统一接口 | `src/sandbox/types.ts`(`Sandbox`) |
| Docker provider(dockerode,node:24-slim,非 root,tar 上传) | `src/sandbox/docker.ts`(编排)+ `src/sandbox/docker-stream.ts`(exec 流解复用 / tar 工具) |
| 三 provider 共享工具(shellQuote / find 脚本构造 / 宿主文件遍历) | `src/sandbox/shell.ts`、`src/sandbox/local-files.ts` |
| NiceEval 公共 E2B baseline 的具名 release-pinned ref、官方起点派生 factory | `src/sandbox/e2b-agent-template.ts`(`NICEEVAL_*_E2B_TEMPLATE` / `e2bCodingAgentTemplate`) |
| 显式 `SandboxSpec` 解析与 provider 实例创建(无默认值、无环境探测) | `src/sandbox/resolve.ts` |
| Provisioning 瞬时错误分类 + 退避重试(各 provider 的 `classifyProvisionError` 认原生限流,兜底走与文件 IO 共用的瞬时分类器 → `createProvider()` 统一重试) | `src/sandbox/errors.ts`、`src/sandbox/retry.ts`;各 provider 文件的 `classifyProvisionError` |
| `defineSandbox`(自定义 provider 逃生舱:`create()` 直接产出 `Sandbox` 实例,`resolve.ts` 里 `r.create` 优先于内置 backend switch) | `src/define.ts`、`src/sandbox/resolve.ts`(`createBackend`) |
| 沙箱编排固定段(变更分类账锚点 / 折叠 agent diff;起始文件上传是 `test()` 里的手工调用,不属于固定段) | `src/runner/sandbox-prep.ts` |
| 沙箱生命周期钩子(`SandboxSpec.setup()` / `.teardown()` 链式方法、多钩子顺序、失败语义；`SandboxHook` / `SandboxHookContext` 从 `niceeval/sandbox` 公开导出) | `src/sandbox/types.ts`(`SandboxHooks<Self>`,类型定义);`src/sandbox/index.ts`(公开类型出口);`src/runner/attempt.ts`(按序调用 `sandboxSetupHooks` / 逆序调用 `sandboxTeardownHooks`) |
| 留存(`--keep-sandbox`):suspend 路由、detached 生命周期(inspect / wake / suspend / destroy)、provider 原生 enter 命令 | `src/sandbox/keep.ts`(provider 名分支只在 sandbox/ 域内)+ 各 provider 的 `suspend()`(`src/sandbox/{docker,e2b,vercel}.ts`) |
| 留存注册表(`.niceeval/sandboxes/` 逐条目原子文件、entry id 散列、向上发现 `.niceeval/`、条目级 lease) | `src/sandbox/keep-registry.ts`(+ 同目录 `.test.ts`) |
| `niceeval sandbox list/enter/history/diff/stop` 命令组 | `src/sandbox/cli-commands.ts`(`runSandboxCommand`;dispatch 在 `src/cli.ts`) |

## Scoring([feature/scoring/](feature/scoring/README.md))

| 行为 | 文件 |
|---|---|
| 值断言匹配器(includes / equals / matches / similarity / satisfies / makeAssertion) | `src/expect/index.ts` |
| 作用域断言(succeeded / calledTool / event / fileChanged / notInDiff …) | `src/scoring/scoped.ts` |
| 断言收集器(延迟评估 + 链式 gate/soft/atLeast) | `src/scoring/collector.ts` |
| LLM-as-judge(OpenAI 兼容 /chat/completions;model/key 解析不到时记 `unavailable` 断言而非静默) | `src/scoring/judge.ts` |
| 判定规则(passed / failed / errored / skipped;非 optional 的 `unavailable` 断言 → errored) | `src/scoring/verdict.ts` |
| 证据完整性(六通道 `EvidenceCoverage`、`completeCoverage`、轮级降档、worst 聚合、三值折叠) | `src/scoring/coverage.ts`(算法)+ `src/agents/types.ts`(声明类型)+ `src/scoring/scoped.ts`(`coverageGap` 折叠接线) |
| diff 数据派生(`DiffArtifact = DiffWindow[]` → 文件汇总 / 匹配谓词) | `src/scoring/diff.ts` |

## `t` 上下文与会话([feature/eval/](feature/eval/README.md))

| 行为 | 文件 |
|---|---|
| 构造 `t`(send / reply / newSession / check / 作用域断言 / judge / sandbox) | `src/context/context.ts` |
| 会话驱动(多轮 send → agent.send,事件 / 用量累加,newSession) | `src/context/session.ts` |
| 控制流信号(skip / require 失败 / turn 失败) | `src/context/control-flow.ts` |
| `t.sandbox.file(path)` 延迟引用(到 finalize 才读沙箱文件) | `src/context/context.ts`(`FileRef`) |

## Runner / CLI / Experiments([runner.md](runner.md) / [cli.md](cli.md) 架构 / [feature/experiments/](feature/experiments/README.md))

| 行为 | 文件 |
|---|---|
| 发现(evals/ 的 *.eval.ts / *.eval.tsx,experiments/ 的实验,路径推导 id) | `src/runner/discover.ts` |
| 有界并发调度 + 首过即停 + budget 已花费护栏(不做预测性预扣) | `src/runner/run.ts` |
| 单 attempt 生命周期(沙箱 / OTLP 接收器 Scope、超时硬边界、沙箱编排固定段、LifecyclePhase 转换) | `src/runner/attempt.ts` |
| 阶段计时树(`PhaseTiming` / `TimingNode`:enter / 失败标记 / 收尾段测量 / hook 与命令子节点) | `src/runner/timing.ts`(`TimingRecorder`;接线在 `src/runner/attempt.ts`) |
| 变更分类账(workdir 外私有 git dir、锚点冻结排除清单、eval/agent 归因 commit、逐 send 窗口导出) | `src/runner/ledger.ts`(+ 同目录 `.test.ts`) |
| 指纹缓存((eval 源码 + 运行配置) 哈希,跨 run 结果携入) | `src/runner/fingerprint.ts` |
| reporter 编排 + 运行级汇总 + eval 级 reporter 作用域(scopeReporter / filterSummary)+ required/best-effort 兜错(runReporter) | `src/runner/report.ts` |
| remote 占位 Sandbox / eval 级本地路径视图(Proxy) | `src/runner/remote-sandbox.ts` |
| 反馈 coordinator(profile 解析、纯 reducer、human/agent/ci renderer、终端 sink、可注入 FeedbackIO) | `src/runner/feedback/{profile,reducer,renderer,human,agent,ci,sink,coordinator,io,testing,index}.ts` |
| 机器 / 平台 reporter(Artifacts / Json / JUnit(同目录 temp→rename 原子写)/ Braintrust) | `src/runner/reporters/{artifacts,json,braintrust,index}.ts` |
| eval 级折叠 / 计票口径(CLI 退出码与 view 共用) | `src/shared/verdict.ts` |
| 本地结果保存格式(快照目录 `.niceeval/<experiment>/<snapshot>/snapshot.json` + attempt 级 `result.json` / JSON artifact;fresh attempt 调度前即生成最终 `locator`,与 Artifacts writer 共用同一个 `snapshotStartedAt`) | `src/runner/reporters/artifacts.ts`(reporter 薄壳,按 experimentId 路由到快照 writer)、`src/results/writer.ts`(`createResultsWriter`)、`src/results/types.ts`(`SnapshotMeta` / `AttemptRecord`)、`src/runner/run.ts`(locator 生成点) |
| CLI(exp / show / list / view / clean / init,--help,parseArgs 表驱动,.env 加载,NICEEVAL_* 环境变量层,`--output` profile 解析) | `src/cli.ts` |
| `niceeval show` 终端宿主(Selection 合成「现刻水位」、--history 复印件不占行、--report 装载 + 组合语义矩阵、证据切面 transcript/trace/diff) | `src/show/{index,compose,render}.ts` |
| 数据集加载器(loadJson / loadYaml) | `src/loaders/index.ts` |

## Results Lib 与 Reports

设计文档:[feature/results/](feature/results/README.md) / [feature/reports/](feature/reports/README.md) 合流一节。实现落点(show 与 view 两个宿主共用同一套 `--report` 装载;裸 show / view 都选择 `ExperimentComparison` 的对应渲染面;两个宿主的 Selection 都由中性的 `selectCurrentResults` 无条件产出):

| 行为 | 文件 |
|---|---|
| `openResults`:实验/结果快照/eval 分层、版本分流(skipped 三种原因)、懒加载(attempt 目录→artifactBase 携带条目回退) | `src/results/open.ts` |
| 布局与版本知识(attempt 目录规则、快照分类、完整 producer) | `src/results/format.ts` |
| `results.latest()`(= `selectLatest`,每实验取最新一次快照 + 四种挑选警告)/ `selectCurrentResults`(现刻水位合成器:对每个 experiment × eval 跨该实验全部历史快照取最新判定,合成一份报告用 Snapshot,警告随范围重算;show 与 view 共用的报告槽 Selection 就出自这里)/ `Selection.filter` / `dedupeAttempts`(身份键去重)/ `ResultScope`(`{ experiment?, patterns? }` 范围输入) | `src/results/select.ts` |
| `createResultsWriter`(快照目录独占创建、快照级元数据落盘、attempt 记录与 artifact 增量落盘、`finish()` 补 `completedAt`) | `src/results/writer.ts` |
| `copySnapshots`(发布原语:计划 → 预检 → 复制,`redact` 必选消毒、publish 标记补记、knownEvalIds 补记) | `src/results/copy.ts` |
| 发布消毒(50 MiB 预检、结构键保留、events / spans / result 的值级 redact) | `src/results/publish.ts` |
| 落盘截断(单值 256 KiB 上限,events / spans 写入前截断并标记) | `src/results/truncate.ts` |
| 分层契约(Experiment / Snapshot / Eval / AttemptHandle / AttemptRef / Selection / 警告类型) | `src/results/types.ts` |
| `defineMetric` 与内置指标(verdict 逐项表态) | `src/report/metrics.ts` |
| `flag()`(experiment flags 当维度 / 轴) | `src/report/flag.ts` |
| 两级聚合引擎 / 维度 / MetricCell 计算 / 聚合前去重接线 | `src/report/aggregate.ts` |
| 十一个计算函数(挂组件上的 `.data`:RunOverview / GroupSummary / ExperimentList / EvalList / AttemptList / MetricTable / MetricMatrix(=MetricBars)/ Scoreboard / MetricScatter / MetricLine / DeltaTable) | `src/report/compute.ts`(装配在 `src/report/components.tsx`) |
| 数据契约(Metric 字面量键泛型、TableData\<K\> … ExperimentListItem / EvalListItem / AttemptListItem;`MetricCell.refs: AttemptLocator[]` 必填) | `src/report/types.ts` |
| 元素树 / `defineComponent`(双面)/ 渲染前树校验 / text 遍历渲染 | `src/report/tree.ts` |
| 组件数据解析 pass(`resolveReportTree`:report `build()` 之后、render 之前递归遍历树;遇到 selection-form 组件就调它自己的 `.data` 计算并换成 data-form props,同层 sibling 并行、保持节点顺序;两个渲染入口都先跑它,报告作者因此不用手写 `.data()`) | `src/report/tree.ts`(`resolveReportTree`;被 `src/report/report.ts` 与 `src/report/web.ts` 调用) |
| 排版原语 Row / Col / Section / Text / Style / Table(六个内置双面组件;Table 的 text 面在 `src/report/text/table.ts`,官方表状组件共用) | `src/report/primitives.tsx` |
| 官方组件 text 面(终端形态、字符坐标图、分栏排版);文本排版工具箱(`stringWidth` / `padEnd` / `padStart` / `wrapText` / `indent` / `bar` / `columns`,从 `niceeval/report` 导出) | `src/report/text/{faces,layout,table,plot}.ts` |
| `defineReport` / `ReportContext` / text 宿主装载入口 `renderReportToText`(`build` → `resolveReportTree` → 校验 → text 渲染;渲染前按 `ctx.selection.warnings` 预置一段警告横幅,对任何报告都生效——不依赖报告树里有没有 RunOverview) | `src/report/report.ts` |
| `--report` 装载(两宿主共用:存在性/默认导出判别、dev server 的 mtime cache-busting) | `src/report/load.ts` |
| show 宿主接线(无条件调 `selectCurrentResults` 产出 Selection、裸跑选择 `ExperimentComparison` 的 text 面、`--report` 装载自定义 text 报告、attempt locator 下钻) | `src/show/index.ts`(现刻水位选择器在中性的 `src/results/select.ts`;单 Eval、Attempt 详情与证据切面渲染在 `src/show/render.ts`;`src/show/compose.ts` 只留 `--history` 时间轴口径;测试 `src/show/show.test.ts`) |
| web 宿主装载入口 `renderReportToStaticHtml`(唯一 import react-dom 的一侧;同样 `build` → `resolveReportTree` → 校验 → web 渲染,渲染前按 `ctx.selection.warnings` 预置同一段警告横幅) | `src/report/web.ts` |
| view 内置默认报告 `ExperimentComparison`(普通 `ReportDefinition`,正文只摆 `MetricScatter`(selection-form)+ `ExperimentList`(build() 里直接 `await .data(selection)`),与包外用户报告逐节点同构、无渲染器特权;`niceeval/report` 公开导出,也可显式传给 `show --report`) | `src/report/built-ins/experiment-comparison.tsx`(目录 barrel `src/report/built-ins/index.ts` 只显式导出值,不建字符串 registry) |
| 实验组推导(experimentId 的 `/` 前缀 → 组名,`niceeval/report` 公开导出,供用户报告用 `GroupSummary` / `Section` 自行分节;内置默认报告不按目录前缀分节,此 helper 住中性共享层) | `src/shared/aggregate.ts`(`experimentGroupOf`) |
| 报告 chrome 文案的 locale 字典(`ReportLocale = "en" \| "zh-CN"`,渲染入口 options 收 `locale`,经 `WebContext` / `TextContext` 携带) | `src/report/locale.ts` |
| 十一个组件的 web 面 + 稳定散列配色 + styles.css(令牌与 view 同源,`.nre` 作用域自带;三个实体列表见 `react/{ExperimentList,EvalList,AttemptList}.tsx`,locator 与判定符的共用渲染在 `AttemptList.tsx` 的 `AttemptLocatorBadge`/`AttemptRow`) | `src/report/react/`(零件复用入口 `index.tsx`;演示 `scripts/report-react-demo.tsx`) |
| 渐进增强 runtime(表头排序 / 行过滤 / hover tooltip,只作用于 `.nre` 与 `data-nre-*`;宿主内联) | `src/report/react/enhance.js` |
| 双面验收(renderToStaticMarkup + text 快照,两面同口径) | `src/report/dual-render.test.tsx` |
| view attempt 深链(`#/attempt/@<locator>`,路由参数是不透明的 `AttemptLocator`,与报告槽 `ctx.attemptHref` 同一格式) | `src/view/app/lib/attempt-route.ts`、`src/view/app/App.tsx`、`src/view/data.ts`(`annotateResult` 注入,locator 直接用 `niceeval/results` 的 `attempt.locator`)、`src/view/shared/types.ts`(`ViewEvalResult.locator` 类型来自 `src/results/locator.ts`) |
| view 数据层(openResults;`__NICEEVAL_VIEW_DATA__` 只携带证据室数据:快照明细 + skipped + 壳元信息,统计住报告槽)。`results.latest()` 结果(命名为 `latestPerExperiment`)只用于给证据室快照打「latest」标记,与报告槽 Selection 是两条独立通道,不参与报告计算 | `src/view/data.ts`(数据契约在 `src/view/shared/types.ts`) |
| view 报告槽(裸跑填充内置 `ExperimentComparison`、`--report` 整槽替换;报告槽 Selection 由 view 直接调 `selectCurrentResults` 产出——不 import `src/show/*`;`renderReportSlot` 静态渲染、en/zh-CN 两遍烘成两个 `<template>` 静态块、增强 runtime 与官方样式内联、位置参数判定 `resolveViewInput`) | `src/view/data.ts`、`src/view/server.ts`、`src/view/index.ts`、前端摆放 `src/view/app/{main.tsx,App.tsx}`(测试 `src/view/view-report.test.ts`) |
| **Roadmap(未定落点)** | memory-evals 静态导出流水线(reports.md 场景三)、view 的 Compare([roadmap/view-enhancements](roadmap/view-enhancements.md)) |

## 与设计文档的已知差异(实现取舍)

- **judge 走 OpenAI 兼容 `/chat/completions`**,base/key 解析顺序:`judge.baseUrl/apiKeyEnv` → `NICEEVAL_JUDGE_BASE`/`CODEX_BASE_URL` → OpenAI 官方。这样在只有 OpenAI 兼容代理(无 Anthropic key)的环境里 judge 自动复用代理。model 解析:eval/config 的 `judge.model` → `NICEEVAL_JUDGE_MODEL`;**没有内置默认模型**,解析不到而用到 judge 断言时报清晰错误。
- **能力归属**:`niceeval view` 是本地 web 查看器。运行器支持 remote `defineAgent` 的会话型 eval；文件写入、diff、验证命令只属于沙箱型 agent。
- **TestContext 类型**:用一个宽接口承载全部动作(运行时按 capability 守卫),而非文档设想的 TS 条件类型 —— 因为被测项目经 `tsx` 运行(不做类型检查),宽接口更省心且不影响运行时正确性。
- **接收者与评分 API**:作用域断言对齐 eve 的接收者模型(`t` = run 级聚合视图、`session` = 单 session snapshot、`turn` = 单 Turn snapshot,同一套作用域断言词汇);会话驱动 API 为 eve 形状(`t.send(input)` / `t.sendFile(path, text?)` / `t.requireInputRequest` / `t.respond` / `t.respondAll` / `t.newSession()`);结果读取字段按接收者分开;judge 按接收者决定默认材料;判定类型是单一 `Verdict`;链式断言是 `.atLeast(x)` / `.gate(x?)`;没有 `defineEval.workspace`;`t.sandbox` 是 eval 内唯一的沙箱操作接口且不暴露 `stop()`;验证命令写成 `t.sandbox.runCommand` + `t.check(result, commandSucceeded())`;judge 是固定的 `autoevals.{closedQA,factuality,summarizes}`;没有 `t.transcript` 命名空间。
- **agent/ci 尚无 eval 级聚合行**:`RunCompletion.earlyExitUnstarted` 已从反馈状态派生(`earlyExitSkipped` 减去 fail-fast 份额,见 `src/cli.ts` `assembleRunCompletion()`),但 docs/feature/experiments/cli.md「runs 与首过即停怎样展示」里的逐 eval 结论行(`NICEEVAL eval … attempts= planned= unstarted= reason=early_exit` / 跑满时的 `rate=`)在 `src/runner/feedback/{agent,ci}.ts` 还没有对应 renderer,当前只有 run 级 handoff 汇总。
