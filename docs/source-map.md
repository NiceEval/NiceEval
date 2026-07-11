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

## Agents 与 Adapters([adapters/contract.md](adapters/contract.md) / [adapters/authoring.md](adapters/authoring.md))

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

## Coding Agent Skills / Plugins DX([adapters/coding-agent-skills-plugins.md](adapters/coding-agent-skills-plugins.md))

| 行为 | 文件 |
|---|---|
| Claude Code skill / MCP setup | `src/agents/claude-code.ts`(`ClaudeCodeConfig.skills` / `mcpServers`) |
| Codex skill / MCP setup | `src/agents/codex.ts`(`CodexConfig.skills` / `mcpServers`) |
| bub Python plugin setup | `src/agents/bub.ts`(`BubConfig.pythonPlugins`) |
| 本地 skill A/B 示例 | `examples/zh/coding-agent-skill/experiments/*.ts` |

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

## Sandbox([sandbox.md](sandbox.md))

| 行为 | 文件 |
|---|---|
| `Sandbox` 统一接口 | `src/sandbox/types.ts`(`Sandbox`) |
| Docker provider(dockerode,node:24-slim,非 root,tar 上传) | `src/sandbox/docker.ts`(编排)+ `src/sandbox/docker-stream.ts`(exec 流解复用 / tar 工具) |
| 三 provider 共享工具(shellQuote / find 脚本构造 / 宿主文件遍历) | `src/sandbox/shell.ts`、`src/sandbox/local-files.ts` |
| provider 选择(`auto` / `docker` / `vercel`,核心不按名字分支) | `src/sandbox/resolve.ts` |
| Provisioning 限流分类 + 退避重试(各 provider 的 `classifyProvisionError` → 中性 kind → `createProvider()` 统一重试) | `src/sandbox/errors.ts`、`src/sandbox/retry.ts`;各 provider 文件的 `classifyProvisionError` |
| `defineSandbox`(自定义 provider 逃生舱:`create()` 直接产出 `Sandbox` 实例,`resolve.ts` 里 `r.create` 优先于内置 backend switch) | `src/define.ts`、`src/sandbox/resolve.ts`(`createBackend`) |
| 沙箱编排固定段(git 基线 / 采 diff;起始文件上传已改为 `test()` 里手工调用,不再是固定段) | `src/runner/sandbox-prep.ts` |
| 沙箱生命周期钩子(`SandboxSpec.setup()` / `.teardown()` 链式方法、多钩子顺序、失败语义) | `src/sandbox/types.ts`(`SandboxHooks<Self>`,类型定义);`src/runner/attempt.ts`(按序调用 `sandboxSetupHooks` / 逆序调用 `sandboxTeardownHooks`) |

## Scoring([scoring.md](scoring.md))

| 行为 | 文件 |
|---|---|
| 值断言匹配器(includes / equals / matches / similarity / satisfies / makeAssertion) | `src/expect/index.ts` |
| 作用域断言(succeeded / calledTool / event / fileChanged / notInDiff …) | `src/scoring/scoped.ts` |
| 断言收集器(延迟评估 + 链式 gate/soft/atLeast) | `src/scoring/collector.ts` |
| LLM-as-judge(OpenAI 兼容 /chat/completions) | `src/scoring/judge.ts` |
| 判定规则(passed / failed / errored / skipped,无 `scored` 中间态) | `src/scoring/verdict.ts` |

## `t` 上下文与会话([eval-authoring.md](eval-authoring.md))

| 行为 | 文件 |
|---|---|
| 构造 `t`(send / reply / newSession / check / 作用域断言 / judge / sandbox) | `src/context/context.ts` |
| 会话驱动(多轮 send → agent.send,事件 / 用量累加,newSession) | `src/context/session.ts` |
| 控制流信号(skip / require 失败 / turn 失败) | `src/context/control-flow.ts` |
| `t.sandbox.file(path)` 延迟引用(到 finalize 才读沙箱文件) | `src/context/context.ts`(`FileRef`) |

## Runner / CLI / Experiments([runner.md](runner.md) / [cli.md](cli.md) / [experiments.md](experiments.md))

| 行为 | 文件 |
|---|---|
| 发现(evals/ 的 *.eval.ts,experiments/ 的实验,路径推导 id) | `src/runner/discover.ts` |
| 有界并发调度 + 首过即停 + budget 在飞预扣 | `src/runner/run.ts` |
| 单 attempt 生命周期(沙箱 / OTLP 接收器 Scope、超时硬边界、沙箱编排固定段) | `src/runner/attempt.ts` |
| 指纹缓存((eval 源码 + 运行配置) 哈希,跨 run 结果携入) | `src/runner/fingerprint.ts` |
| reporter 编排 + 运行级汇总 + eval 级 reporter 作用域(scopeReporter / filterSummary) | `src/runner/report.ts` |
| remote 占位 Sandbox / eval 级本地路径视图(Proxy) | `src/runner/remote-sandbox.ts` |
| 报告器(Console / Json / JUnit / Live / 符号表) | `src/runner/reporters/{console,json,live,table,shared,index}.ts` |
| Braintrust 上报(运行 → experiment,attempt → 一行) | `src/runner/reporters/braintrust.ts` |
| eval 级折叠 / 计票口径(CLI 表格与 view 共用) | `src/shared/verdict.ts` |
| 本地结果保存格式(快照目录 `.niceeval/<experiment>/<snapshot>/snapshot.json` + attempt 级 `result.json` / JSON artifact) | `src/runner/reporters/artifacts.ts`(reporter 薄壳,按 experimentId 路由到快照 writer)、`src/results/writer.ts`(`createResultsWriter`)、`src/results/types.ts`(`SnapshotMeta` / `AttemptRecord`) |
| CLI(exp / show / list / view / clean / init,--help,parseArgs 表驱动,.env 加载,NICEEVAL_* 环境变量层) | `src/cli.ts` |
| `niceeval show` 终端宿主(Selection 合成「现刻水位」、--history 复印件不占行、--report 装载 + 组合语义矩阵、证据切面 transcript/trace/diff) | `src/show/{index,compose,render}.ts` |
| 数据集加载器(loadJson / loadYaml) | `src/loaders/index.ts` |

## Results Lib 与 Reports

设计文档:[results-lib.md](results-lib.md) / [reports.md](reports.md) / [view.md](view.md) 合流一节。实现落点(show 与 view 两个宿主的 `--report` 装载都已接线;view = 报告槽 + 证据室,裸跑渲染 `defaultReport`):

| 行为 | 文件 |
|---|---|
| `openResults`:实验/结果快照/eval 分层、版本分流(skipped 三种原因)、懒加载(attempt 目录→artifactBase 携带条目回退) | `src/results/open.ts` |
| 布局与版本知识(attempt 目录规则、快照分类、完整 producer) | `src/results/format.ts` |
| `results.latest()`(Selection + 四种警告)/ `Selection.filter` / `dedupeAttempts`(身份键去重) | `src/results/select.ts` |
| `createResultsWriter`(快照目录独占创建、快照级元数据落盘、attempt 记录与 artifact 增量落盘、`finish()` 补 `completedAt`) | `src/results/writer.ts` |
| `copySnapshots`(发布原语:瘦身复制 + knownEvalIds 补记) | `src/results/copy.ts` |
| 分层契约(Experiment / Snapshot / Eval / AttemptHandle / AttemptRef / Selection / 警告类型) | `src/results/types.ts` |
| `defineMetric` 与内置指标(verdict 逐项表态) | `src/report/metrics.ts` |
| `flag()`(experiment flags 当维度 / 轴) | `src/report/flag.ts` |
| 两级聚合引擎 / 维度 / MetricCell 计算 / 聚合前去重接线 | `src/report/aggregate.ts` |
| 九个计算函数(挂组件上的 `.data`:RunOverview / MetricTable / MetricMatrix(=MetricBars)/ Scoreboard / MetricScatter / MetricLine / DeltaTable / CaseList) | `src/report/compute.ts`(装配在 `src/report/components.tsx`) |
| 数据契约(Metric 字面量键泛型、TableData\<K\> … CaseListData;`MetricCell.refs` 必填) | `src/report/types.ts` |
| 元素树 / `defineComponent`(双面)/ 渲染前树校验 / text 遍历渲染 | `src/report/tree.ts` |
| 排版原语 Row / Col / Section / Text / Style(五个内置双面组件) | `src/report/primitives.tsx` |
| 官方组件 text 面(终端形态、字符坐标图、分栏排版) | `src/report/text/{faces,layout,plot}.ts` |
| `defineReport` / `ReportContext` / text 宿主装载入口 `renderReportToText` | `src/report/report.ts` |
| `--report` 装载(两宿主共用:存在性/默认导出判别、dev server 的 mtime cache-busting) | `src/report/load.ts` |
| show 宿主接线(组合语义矩阵、attemptCommand 下钻、内置默认报告即出厂报告槽) | `src/show/index.ts`(Selection 合成与时间轴口径在 `src/show/compose.ts`,详情/证据切面渲染在 `src/show/render.ts`,测试 `src/show/show.test.ts`) |
| web 宿主装载入口 `renderReportToStaticHtml`(唯一 import react-dom 的一侧) | `src/report/web.ts` |
| `DefaultReport`(官方水位整块,宿主注入 Selection)与 `defaultReport`(内置默认报告值,`niceeval/report` 公开导出;裸跑 ≡ `--report` 它) | `src/report/default-report.tsx` |
| 实验组推导(experimentId 的 `/` 前缀分组,`defaultReport` 分节用,住中性共享层) | `src/shared/aggregate.ts`(`experimentGroupOf`) |
| 报告 chrome 文案的 locale 字典(`ReportLocale = "en" \| "zh-CN"`,渲染入口 options 收 `locale`,经 `WebContext` / `TextContext` 携带) | `src/report/locale.ts` |
| 九个组件的 web 面 + 稳定散列配色 + styles.css(令牌与 view 同源,`.nre` 作用域自带) | `src/report/react/`(零件复用入口 `index.tsx`;演示 `scripts/report-react-demo.tsx`) |
| 渐进增强 runtime(表头排序 / 行过滤 / hover tooltip,只作用于 `.nre` 与 `data-nre-*`;宿主内联) | `src/report/react/enhance.js` |
| 双面验收(renderToStaticMarkup + text 快照,两面同口径) | `src/report/dual-render.test.tsx` |
| view attempt 深链(`#/attempt/<snapshot>/<attempt>`,路由参数即 AttemptRef `{ snapshot, attempt }`) | `src/view/app/lib/attempt-route.ts`、`src/view/app/App.tsx`、`src/view/data.ts`(`annotateResult` 注入,ref 直接用 `niceeval/results` 的 `attempt.ref`) |
| view 数据层(openResults;`__NICEEVAL_VIEW_DATA__` 只携带证据室数据:快照明细 + skipped + 壳元信息,统计住报告槽) | `src/view/data.ts`(数据契约在 `src/view/shared/types.ts`) |
| view 报告槽(裸跑填充 `defaultReport`、`--report` 整槽替换;组合语义经 show 的 Selection 合成、`renderReportSlot` 静态渲染、en/zh-CN 两遍烘成两个 `<template>` 静态块、增强 runtime 与官方样式内联、位置参数判定 `resolveViewInput`) | `src/view/data.ts`、`src/view/server.ts`、`src/view/index.ts`、前端摆放 `src/view/app/{main.tsx,App.tsx}`(测试 `src/view/view-report.test.ts`) |
| **未落地** | memory-evals 静态导出流水线(reports.md 场景三)、view 的 Compare(view.md 计划) |

## 与设计文档的已知差异(实现取舍)

- **judge 走 OpenAI 兼容 `/chat/completions`**,base/key 解析顺序:`judge.baseUrl/apiKeyEnv` → `NICEEVAL_JUDGE_BASE`/`CODEX_BASE_URL` → OpenAI 官方。这样在只有 OpenAI 兼容代理(无 Anthropic key)的环境里 judge 自动复用代理。model 解析:eval/config 的 `judge.model` → `NICEEVAL_JUDGE_MODEL`;**没有内置默认模型**,解析不到而用到 judge 断言时报清晰错误。
- **MVP 范围**:`niceeval view` 已实现为本地 web 查看器;`init`、指纹缓存、Vercel/E2B 沙箱、失败分类、budget/strict/tag/JUnit flag 已实现。`watch` 仍未实现。运行器支持 remote `defineAgent` 的会话型 eval；文件写入、diff、验证命令仍只属于沙箱型 agent。
- **TestContext 类型**:用一个宽接口承载全部动作(运行时按 capability 守卫),而非文档设想的 TS 条件类型 —— 因为被测项目经 `tsx` 运行(不做类型检查),宽接口更省心且不影响运行时正确性。
- **接收者与评分 API 已按目标设计落地**:作用域断言对齐 eve 的接收者模型(`t` = run 级聚合视图、`session` = 单 session snapshot、`turn` = 单 Turn snapshot,同一套作用域断言词汇)、会话驱动 API 补齐到 eve 形状(`t.send(input)` / `t.sendFile(path, text?)` / `t.requireInputRequest` / `t.respond` / `t.respondAll` / `t.newSession()`)、结果读取字段按接收者分开、judge 按接收者决定默认材料、判定类型合并成单一 `Verdict`、链式断言收窄成 `.atLeast(x)` / `.gate(x?)`、移除 `defineEval.workspace`、`t.sandbox` 作为 eval 内唯一的沙箱操作接口 且不暴露 `stop()`、验证命令改成 `t.sandbox.runCommand` + `t.check(result, commandSucceeded())`、judge 收窄成固定的 `autoevals.{closedQA,factuality,summarizes}`、`t.transcript` 命名空间已移除。
