# Source Map —— 文档行为 → 实现文件

文档是设计依据。
这一页为每条目标契约指定唯一的源码 owner，防止同一语义在多个模块各写一份。它不是“已经落地”的进度表；代码缺失或偏离时不降低 Feature 契约，也不在本页保留兼容路径，只按这里的 owner 修正实现。
niceeval 以 TS 源码经 `tsx` 运行,无编译步骤(`bin/niceeval.mjs` 注册 `tsx/esm/api` 后加载 `src/cli.ts`)。

## 总览:模块 → 文件

| 设计文档里的概念 | 实现文件 |
|---|---|
| 核心类型契约(聚合 facade;类型按域住各自目录) | `src/types.ts`(re-export)← `src/shared/types.ts`(原子)、`src/o11y/types.ts`、`src/sandbox/types.ts`、`src/agents/types.ts`、`src/assertions/types.ts`、`src/context/types.ts`、`src/runner/types.ts` |
| 公开导出(`niceeval`,eval 作者用的核心面) | `src/index.ts` |
| 公开导出(`niceeval/adapter`,Agent/Adapter) | `src/agents/index.ts` |
| 公开导出(`niceeval/sandbox`,Sandbox) | `src/sandbox/index.ts` |
| `defineEval` / `defineConfig` / `defineExperiment` / `defineAgent` / deprecated alias `defineDirectAgent` / `defineSandboxAgent` / `defineSandbox` | `src/define.ts` |
| `requireEnv` / 工具 | `src/util.ts` |

## Agents 与 Adapters([入口](feature/adapters/README.md) / [库用法](feature/adapters/library.md) / [架构](feature/adapters/architecture.md))

公共调用与组合按任务位于 `feature/adapters/library/`；数据结构、状态机与完整性不变量位于 `feature/adapters/architecture/`。

| 行为 | 文件 |
|---|---|
| Agent 契约(`kind: "sandbox" | "direct"`,无能力位字段)/ 三类配置归属 / typed `SessionSlot` | `src/agents/types.ts`(`Agent` / `AgentContext` / `AgentSession` / `SpanMapper`)、`src/agents/session-slot.ts`(`createSessionSlot`) |
| `AgentContext.experimentId`(路径推导的实验 id,与结果归属同源;沙箱生命周期 Hook 按它隔离跨 attempt 状态) | `src/agents/types.ts`(`AgentContext.experimentId`) |
| 能力调用守卫(缺声明的动作第一次调用即报清晰错误;conversation gate 第二轮起) | `src/context/context.ts`(`capabilityGuard`) |
| 逐 API 适配义务(send / newSession / respond 的运行器侧翻译) | `src/context/session.ts`(`SessionManager` / `RunSession`)、`src/context/context.ts` |
| `defineSandboxAgent` / `defineAgent`(`kind: "sandbox" | "direct"`,无能力位字段) / `defineDirectAgent` deprecated alias | `src/define.ts` |
| `shared` 工具袋(会话定位、JSONL 提取、shell quoting、失败摘要与协议 parser；Sandbox IO 只用 `SandboxOperations`) | `src/agents/shared.ts` |
| 采集矩阵(collection.md:每 agent 的通道 / 字段出处) | `src/agents/{claude-code,codex,bub}.ts`(采集)+ `src/o11y/parsers/*.ts`(字段提取) |
| `turnFromAiSdk`(AI SDK 结果 → 标准事件流,v4/v5/v7 字段漂移兼容;v7 tool approval → `input.requested` + `status: "waiting"`) | `src/agents/ai-sdk.ts`(+ 同目录 `.test.ts`) |
| 内置 adapter(claude-code / codex / bub) | **由被测项目自带**(`agents/*.ts`),niceeval 提供 `shared` + 归一器 |
| `uiMessageStreamAgent`(AI SDK UI Message Stream 协议的内置无侵入 adapter) | `src/agents/ui-message-stream.ts` |
| SDK 原生事件流转换器：`createClaudeSdkEventStream` / `createPiAgentEventStream` / `createCodexThreadEventStream` | `src/agents/sdk-streams.ts`(+ 同目录 `.test.ts`);逐 SDK 契约见 `docs/feature/adapters/sdk/` |
| LangGraph 官方事件流转换器：`createLangGraphEventStream` | `src/agents/langgraph.ts`;契约见 `docs/feature/adapters/sdk/langgraph/README.md` |
| OpenCode sandbox Agent(`openCodeAgent`) | `src/agents/opencode.ts` + `src/o11y/parsers/opencode.ts`;契约见 `docs/feature/adapters/sdk/opencode/README.md` |
| Hermes Agent sandbox Agent(`hermesAgent`) | `src/agents/hermes.ts` + `src/o11y/parsers/hermes.ts`;契约见 `docs/feature/adapters/sdk/hermes/README.md` |
| OpenClaw sandbox Agent(`openClawAgent`) | `src/agents/openclaw.ts` + `src/o11y/parsers/openclaw.ts`;契约见 `docs/feature/adapters/sdk/openclaw/README.md` |
| OpenAI 兼容结果转换器：`turnFromChatCompletion` / `turnFromResponses` | `src/agents/openai-compat.ts`;契约见 `docs/feature/adapters/sdk/openai-compat/README.md` |
| AI SDK 结果转换器：`turnFromAiSdk` | `src/agents/ai-sdk.ts`;契约见 `docs/feature/adapters/sdk/ai-sdk/README.md` |
| 原生配置文件替换(`settingsFile` / `configFile`:项目根内路径校验、上传替换、保留键冲突检测、SHA-256 进 checkpoint key) | `src/agents/native-config.ts`(共享层)+ `src/agents/{claude-code,codex}.ts`(各自保留键表) |
| Marketplace 注册名回读校验(`marketplace add` 后回读列表,配置名对不上立刻报错) | `src/agents/marketplace.ts`(claude-code / codex 共用,回读命令由 adapter 传入) |
| `AgentEnsure` / 判别联合 `AgentInstaller`、`prepareArtifact()`、安装模式(`staged` / `sandbox-network` / `verify-only`)与 payload/context 形状 | `src/agents/types.ts` |
| Agent Ensure(agent.ensure 循环:探测、缺失时配对安装层 install、复检;staged payload 准备与共享 cache) | `src/agents/`(ensure 循环与内置安装层;内置 Agent 的声明在 `src/agents/{claude-code,codex,bub}.ts`);Run 级 staged payload 准备接线在 `src/runner/run.ts` / `src/runner/attempt.ts` |

## 执行失败分类:时间轴重试与空间轴止损([README](feature/error-classification/README.md) / [架构](feature/error-classification/architecture.md) / [库用法](feature/error-classification/library.md))

| 行为 | 文件 |
|---|---|
| 两轴词表(`FailureScope` / `FailureClass` / `AttemptFailureInfo` / `AttemptFailureClassifier`)、 fatal 错误类(`ExperimentFatalError` / `EvalFatalError`)、结构守卫 `failureClassOf`、生命周期分类链(`resolveAttemptFailureClass` / `attemptFailureInfo`) | `src/shared/failure-class.ts`(全仓单源,零 effect 依赖;sandbox provisioning 分类共享这份词表) |
| send 链决议 `resolveSendFailureClass`、保守回退分类器、`SendFailure.acceptance` 受理证据门、`sendFailureText`、`SendFailureClassifier` | `src/context/send-failures.ts` |
| `Agent.classifySendFailure` 挂载面(`SandboxAgentDef` / `DirectAgentDef` / `Agent`) | `src/agents/types.ts`;经 `src/define.ts` 的 `defineSandboxAgent` / `defineAgent` 透传 |
| 重试执行体 `sendWithTurnRetry`(两层预算、指数全抖动退避、`ConcurrencySlot` 槽位释放、activity 与耗尽摘要) | `src/context/send-retry.ts` |
| 挂载点:包住 `agent.send(...)` 的那一次调用(非 otel / otel 两条路径) | `src/context/session.ts`(`SessionManager.sendSerialized` / `sendWithOtel`) |
| `concurrencySlot`(globalSem / 实验级 runSem 的临时释放/收回)从 run 级信号量到 context 的透传 | `src/runner/run.ts` → `src/runner/attempt.ts`(`runAttemptEffect` / `AttemptResources`)→ `src/context/context.ts`(`ContextDeps.concurrencySlot`) |
| `SendFailure` → `agent-send-failed` 结构化执行错误 Observation（`sendFailureText` 同源）→ 以它为依据的 `errored` Verdict Claim；`Turn.failed` 只进入 `succeeded()` Assertion Claim，不改变 Attempt lifecycle | `src/context/context.ts` |

## Coding Agent Skills / Plugins DX([用法](feature/adapters/library/coding-agent-extensions.md) / [架构](feature/adapters/architecture/coding-agent-extensions.md))

| 行为 | 文件 |
|---|---|
| `SkillSpec` / `AgentSetupManifest` 类型 | `src/agents/types.ts` |
| Skill 安装(本地形状、repo clone + ref、选择规则、发现指引) | `src/agents/skills.ts`(经 `shared.installSkills` 也给自定义 adapter 用) |
| Claude Code skill / native plugin / MCP setup | `src/agents/claude-code.ts`(`ClaudeCodeConfig.skills` / `plugins` / `mcpServers`、`ClaudeCodePluginSpec`) |
| Codex skill / native plugin / MCP setup | `src/agents/codex.ts`(`CodexConfig.skills` / `plugins` / `mcpServers`、`CodexPluginSpec`) |
| bub skill / Python plugin setup | `src/agents/bub.ts`(`BubConfig.skills` / `pythonPlugins`、`PythonPluginSpec`;package 集合进安装 checkpoint key) |
| 安装 manifest 的构造(adapter 宿主侧内存对象,不落沙箱盘)与读(运行器) | `src/agents/manifest.ts`、`src/runner/attempt.ts`(存成 attempt artifact `agent-setup.json`) |
| 本地 skill A/B 示例 | [coding-agent-skill](https://github.com/CorrectRoadH/coding-agent-skill)(独立仓库) |

## 标准事件流与可观测性([observability.md](observability.md))

| 行为 | 文件 |
|---|---|
| 原始 transcript → 标准 `StreamEvent[]` + 用量 + 压缩计数 | `src/o11y/parsers/{codex,claude-code,bub}.ts`、`parsers/index.ts`(`ParsedTranscript`;无按名字分派的入口,adapter 直连具体 parser) |
| 规范工具名归一(共享基表 + per-agent 差异叠加) | `src/o11y/tool-names.ts` |
| 原生 OTLP span → canonical GenAI semconv(mapper 由 Agent 经 `spanMapper` 声明,core 不按名字分支;默认走通用 heuristic) | `src/o11y/otlp/mappers/{codex,bub}.ts`、`src/o11y/otlp/canonical.ts`(`heuristicTag` / `mapGenericSpans`) |
| run 级共享 OTLP 接收 + 逐轮归属(traceparent → `ctx.telemetry.headers`;send 区间回退 + 未确认时该 agent 轮次串行) | `src/o11y/otlp/turn-otel.ts`(`AgentOtelChannel` / `OtelReceiverPool`);接线在 `src/runner/attempt.ts`(池取通道)与 `src/context/session.ts`(`sendWithOtel`:归属 / 派生 / 合并) |
| 固定端口 / 自定义接收 host 模式(`defineConfig({ telemetry: { host, port } })`,niceeval 项目内唯一入口,不读进程变量) | `src/runner/run.ts`(`OtelReceiverPool` 取 `config.telemetry.port`)、`src/runner/attempt.ts`(`config.telemetry.host`)、`src/o11y/otlp/receiver.ts`(`makeTraceReceiver(port)`,端口被占用时报 `otel.portInUse`) |
| Sandbox attempt-scope OTLP receiver 放置(`otlpHost: string` 才承诺宿主回连；`null` 在 Sandbox 内采集；显式 `telemetry.host` 优先) | `src/sandbox/types.ts`、各 provider 的 `otlpHost`、`src/runner/attempt.ts`、`src/o11y/otlp/{receiver,sandbox-receiver}.ts` |
| `deriveRunFacts`(toolCalls / subagents / parked / compactions) | `src/o11y/derive.ts` |
| 宿主侧行为断言 `t.o11y`(读取时从当前累积事件现算) | `src/o11y/derive.ts`(`buildO11ySummary`) → `src/context/context.ts`(`t.o11y` getter) |
| codex 用量从 `turn.completed.usage` 抠出 | `src/o11y/parsers/codex.ts` |
| 用量 → 成本(实测优先 → 用户自定价目 → 内置 Run) | `src/o11y/cost.ts` |

## Sandbox([feature/sandbox/](feature/sandbox/README.md))

| 行为 | 文件 |
|---|---|
| `SandboxOperations` 单一词汇与语义、`Sandbox` / `EvalSandbox` / `SandboxCommandTarget` 三个能力视图、`CommandOptions` / `CommandResult` | `src/sandbox/types.ts` |
| Docker provider(dockerode,node:24-slim,非 root,tar 上传) | `src/sandbox/docker.ts`(编排)+ `src/sandbox/docker-stream.ts`(exec 流解复用 / tar 工具) |
| Local provider(宿主机本地目录、零隔离;仓库根定位 / 显式 `dir`;`{ user }` 报错;`downloadDirectory` 复用 vercel/e2b 的 find+read 模板) | `src/sandbox/local.ts`(`LocalSandbox`) |
| 变更分类账 GIT_DIR / 导出目录的按 sandboxId 改写登记(local 用宿主侧每实例私有临时目录,避免同机多次运行互相踩踏;其余 provider 用固定沙箱内路径,不登记) | `src/sandbox/ledger-paths.ts`;消费端在 `src/runner/ledger.ts`(`gitEnv` / `createChangeLedger` / `buildExportScript`) |
| provider 级调度 lane 与独占 admission（local 与自定义 provider 都在 physical planning 完成态声明；运行参数不解除独占约束） | `src/sandbox/layer.ts`(`SandboxProviderScheduling` / provider modules)、`src/runner/sandbox-selection.ts`(`schedulingForPreparedPairs`)、`src/runner/run.ts` |
| 三 provider 共享工具(shellQuote / find 脚本构造 / 宿主文件遍历) | `src/sandbox/shell.ts`、`src/sandbox/local-files.ts` |
| `downloadDirectory`(vercel/e2b 共用的 find 列路径 + 逐文件二进制读取两阶段模板;docker 走 `getArchive` 单次 tar 取回,见上一行 docker-stream.ts) | `src/sandbox/download-directory.ts` |
| NiceEval 公共 E2B baseline 的具名版本锁定 ref、官方起点派生 factory、三模板统一的运行用户 npm global 契约 | `src/sandbox/e2b-agent-template.ts`(`NICEEVAL_*_E2B_TEMPLATE` / `PUBLISHED_E2B_BASELINE_TAG` / `e2bCodingAgentTemplate` / `verifyE2BNodeToolContract`)；发布构建与最终状态自检在 `sandbox/e2b/build-agent-template.mts`，已发布事实登记在 `sandbox/e2b/published.json` |
| 单 Dockerfile 按需构建（Docker image / E2B template 的 BuildKey、cache lookup、构建与 locator） | `src/sandbox/dockerfile-build.ts`；Run 级收集与 provider 路由在 `src/runner/build-preparation.ts` |
| 官方起点 image / template 的版本号(`<Agent 版本>-r<配方修订>`,niceeval 自身版本不参与) | `src/agents/coding-cli-versions.ts`(`AGENT_BASELINE_VERSION` / `AGENT_BASELINE_RECIPE_REVISION` / `agentBaselineVersionTag`)——同一批常量喂 Adapter 的运行时回退安装；一致性守护在 `src/sandbox/official-baselines.test.ts` |
| NiceEval 公共 Docker 镜像的具名 ref | `src/sandbox/docker-agent-image.ts`(`NICEEVAL_*_DOCKER_IMAGE`)；配方在 `sandbox/docker/Dockerfile`，按配方变更发布的 CI 在 `.github/workflows/docker-image.yml`；Agent 集合是完整的 `CodingAgentBaseline`，E2B 侧子集见 `E2BCodingAgent` |
| `SandboxLayer` link、physical planning 与 provider 实例创建（无默认值、无 profile registry、无宿主条件探测） | `src/sandbox/link.ts`、`src/sandbox/plan.ts`、`src/sandbox/runtime.ts` |
| Provisioning 瞬时错误分类 + 退避重试(各 provider 的 `classifyProvisionError` 认原生限流,未命中时走与文件 IO 共用的瞬时分类器 → `createProvider()` 统一重试) | `src/sandbox/errors.ts`、`src/sandbox/retry.ts`;各 provider 文件的 `classifyProvisionError` |
| `defineSandbox` 自定义 provider 与 `defineSandboxCase` 自定义 case（强类型 callback 只存在于私有 ProviderModule binding） | `src/define.ts`、`src/sandbox/layer.ts`、`src/sandbox/runtime.ts` |
| Sandbox 实例(唯一主 Sandbox 及伴随资源、services 完成态、BuildKey / CaseKey) | `src/sandbox/case-types.ts`、`src/sandbox/identity.ts`；规划与创建 provider 实例的接线在 `src/sandbox/layer.ts`、`src/sandbox/runtime.ts` |
| Run 级构建协调(single-flight、构建并发与逐 key timeout、`sandbox.build` timings 与 `sandboxBuilds` provenance) | `src/sandbox/build-coordinator.ts`;接线在 `src/runner/run.ts` |
| Docker Compose case(原生 build/up/down、受管 overlay、黑名单、ready、整组 finalizer) | `src/sandbox/compose.ts`(复用 `src/sandbox/docker.ts` 的连接层) |
| 沙箱编排固定段(变更分类账记账起点 / 折叠 agent diff;起始文件上传是 `test()` 里的手工调用,不属于固定段) | `src/runner/sandbox-prep.ts` |
| 两层作者 `SandboxLayer.prepare()` 与 `onCleanup()` 的顺序、owner 归因与 LIFO 收尾 | `src/sandbox/types.ts`、`src/runner/attempt.ts` |
| 留存(`--keep-sandbox`):`MaterializedSandboxCase.retention.suspend()` 与 detached `inspect / wake / suspend / destroy`、provider 原生 enter、`expiresAt` 计算；能力不挂在 `Sandbox` 隐藏成员上 | `src/sandbox/keep.ts` + 各 provider 的 retention 实现；写入点在 `src/runner/attempt.ts` 提交 `SandboxGroupEntry` 处 |
| 命令树寿命：正常 transport 关闭不误杀任务服务；timeout / cancellation / interruption 在 Promise settle 前确认命令树终止，失败时退休 Sandbox | `src/sandbox/process-tree.ts` 与各 provider command transport；Agent send settle 接线在 `src/context/session.ts` |
| `--keep-sandbox` 的创建前组合校验(自定义 provider、或内置但不在 `KEEPABLE_PROVIDERS` 里的 provider 如 local,统一报清晰错误) | `src/runner/attempt.ts`(`runAttemptEffect` 顶部,读 `resolveSandbox().create` / `KEEPABLE_PROVIDERS`) |
| 留存注册表(`.niceeval/sandboxes/` 逐条目原子文件、entry id 散列、向上发现 `.niceeval/`、条目级 lease) | `src/sandbox/keep-registry.ts`(+ 同目录 `.test.ts`) |
| `niceeval sandbox list/enter/history/diff/stop` 命令组 | `src/sandbox/cli-commands.ts`(`runSandboxCommand`;dispatch 在 `src/cli.ts`) |
| 创建期运行标识元数据(host/pid/startedAt;docker label / e2b metadata,与 `niceeval.keep-candidate` / provision token 同通道)、孤儿三条件判定(`classifyRunIdentity`:同宿主+pid 存活→整个排除、同宿主+pid 不存活→orphan、异宿主→unverified) | `src/sandbox/run-identity.ts` |
| `sandbox list --orphans` / `sandbox prune`(docker 按 label 查本地 daemon、e2b 按 metadata 过滤 SDK 列表,排除留存注册表条目;prune 幂等 + `--force` 语义,单台失败列出继续处理其余) | `src/sandbox/orphans.ts`(判定与销毁)+ `src/sandbox/cli-commands.ts`(`listOrphansCommand` / `pruneCommand` / `orphanReminder` 输出编排) |

## Assertions / Judge / Verdict

契约分别见 [Assertions](./feature/assertions/README.md)、[Judge](./feature/judge/README.md) 与[Verdict](./feature/verdict/README.md)。
这组契约的 owner 集中在 `src/assertions/`；源码目录名不定义产品概念边界。

| 行为 | 文件 |
|---|---|
| 值断言匹配器(includes / equals / matches / similarity / satisfies / makeAssertion) | `src/expect/index.ts` |
| 作用域断言(succeeded / calledTool / event / fileChanged / notInDiff …) | `src/assertions/scoped.ts` |
| 断言收集器(延迟评估 + 链式 gate/soft/atLeast;`.points(n)` 与 `AssertionCollector.score(label, n)` 形成带证据依据的 Assertion / score Claim；它们不占用 AttemptPayloadV1，也不等同于生命周期状态) | `src/assertions/collector.ts` |
| 计分制的前置中止(句柄上的 `.gate()` 使该断言就地求值并进入中止态,下一次 `t.*` 调用或 finalize 抛中止信号;matcher 自带/链上的 severity 只贡献 threshold,不触发中止) | `src/assertions/collector.ts`(`RecordHandle.gate` 的计分制分支、`t.*` 入口的待决前置结算)、`src/context/control-flow.ts`(中止异常) |
| 计分制题型(`defineEval`/`defineScoreEval` 分别定死 `EvalDefinition.evaluationKind` 为 `"pass"`/`"points"`,禁止手写;`ScoreEvalInput` 的 `test(t)` 换成 `ScoreTestContext`) | `src/define.ts`(工厂函数)、`src/runner/types.ts`(`EvaluationKind`、`EvalDefinition.evaluationKind`、`ScoreEvalInput`、`EvalDescriptor.evaluationKind`) |
| 给分词汇的类型分离(`ScoreAssertionHandle` 在 `AssertionHandle` 上加 `.points(n)` 并去掉 `.atLeast(x)`,`.points(n)` 的返回句柄只剩 `.gate()`/`.optional()`;`ScoreTestContext` 在 `TestContext` 上加 `t.score(label, n)` 并去掉 `t.require`;通过制 `t` 上没有给分词汇,类型层拒绝,不需要运行时守护) | `src/context/types.ts`(`ScoreAssertionHandle`、`ScoreTestContext`)、`src/assertions/types.ts`(`ScoreEntry`、`AssertionResult.points`) |
| 题型发现投影与混型保真(`evalDescriptorOf` 把定义期 `evaluationKind` 投影进 `EvalDescriptor`；同一 Experiment 的两类 Eval 都进入调度与落盘) | `src/runner/eval-selection.ts`、`src/runner/run.ts` |
| `t.require` 中止语义(通过制的前置词;前置断言按 gate 登记,未过即抛 `EvalRequirementFailed`,`test()` 后续代码不再执行,已登记的 Assertion Claim 决定 Verdict Claim;`runAttemptEffect` 捕获该异常时不造执行错误 Observation。计分制的 `.gate()` 中止复用同一条异常与捕获分支) | `src/context/context.ts`(`require`)、`src/context/control-flow.ts`(`EvalRequirementFailed`)、`src/runner/attempt.ts`(捕获分支) |
| LLM-as-judge(OpenAI 兼容 /chat/completions；单条 `{model}` → Experiment → Eval → config 逐字段定值；model/key 缺失记 `unavailable`) | `src/assertions/judge.ts`、`src/runner/config.ts` |
| Verdict 四态折叠、durable `niceeval.verdict/1` Attempt Claim（固定 ID preimage、anchor、active nonmembership、terminal membership 与 `verdict-claim-invalid`）、内建 `niceeval/verdict/1` Projector 的 exact Claim lookup 与 graph-invalid 边界 | `src/shared/verdict.ts`(折叠)、`src/record/protocol/verdict.ts`(Claim shape/ID/anchor/key)、`src/record/graph/{catalog,verification,read}.ts`(catalog 与 full verification)、`src/record/{attempt-evidence,open}.ts`(Projector context/读取面)、`src/runner/attempt.ts`(形成 terminal Claim) |
| 证据完整性(Agent 必填六通道 `EvidenceCoverage`、`completeEvidenceCoverage`、`TurnEvidenceCoverage` 降档、Adapter Provenance 与 Turn Observation 的 `evidenceCoverage`、worst 聚合、三值折叠；不写入 AttemptPayloadV1) | `src/assertions/coverage.ts`(算法)+ `src/agents/types.ts`(声明类型)+ `src/assertions/scoped.ts`(`coverageGap` 折叠接线) |
| diff 数据派生(`DiffArtifact = DiffWindow[]` → 文件汇总 / 匹配谓词) | `src/assertions/diff.ts` |

## `t` 上下文与会话([feature/eval/](feature/eval/README.md))

| 行为 | 文件 |
|---|---|
| 构造 `t`(send / reply / newSession / check / 作用域断言 / judge / sandbox) | `src/context/context.ts` |
| 会话驱动(多轮 send → agent.send；事件与 raw usage 追加为 Observation，读取总量经 Projector 得出;newSession) | `src/context/session.ts` |
| 控制流信号(skip / `.stopOnFailure()` 前置中止；send 执行异常独立走 `SendFailure`) | `src/context/control-flow.ts`、`src/context/send-failures.ts` |
| `t.sandbox.file(path)` 延迟引用(到 finalize 才读沙箱文件) | `src/context/context.ts`(`FileRef`) |

## Runner / CLI / Experiments([runner.md](runner.md) / [cli.md](cli.md) 架构 / [feature/experiments/](feature/experiments/README.md))

| 行为 | 文件 |
|---|---|
| 发现(evals/ 的 *.eval.ts / *.eval.tsx 与目录入口 eval.ts,experiments/ 的实验,路径推导 id;同 id 双入口报重名) | `src/runner/discover.ts` |
| Eval 源码捕获、folder-local 目录入口 base id、loader 隐藏输入登记与 build context 交叉检查 | `src/runner/eval-source.ts`、`src/loaders/index.ts`;接线在 `src/runner/discover.ts` |
| 普通本地上传的 transfer manifest 与动态泄漏比对 | `src/sandbox/` 上传包装、`src/runner/attempt.ts`、fingerprint/carry planner 与 materializer closure 登记;契约见 `docs/feature/eval/use-case/criteria-files.md` |
| 有界并发调度 + 首过即停 + budget 已花费护栏(不做预测性预扣);Run 级共享准备(构建协调 / staged payload 准备)不占 attempt 并发位 | `src/runner/run.ts` |
| 并发 Invocation 协作(用例锁防双跑；`maxConcurrency` 只限本 Invocation；`sharedState.key` 按完整 Experiment/Sandbox lifecycle 独占外部状态) | `src/runner/run.ts`、`src/runner/eval-lock.ts`、`src/runner/state-lease.ts` |
| 单 Attempt 生命周期(沙箱 / OTLP 接收器 Scope、超时硬边界、沙箱编排固定段、`active` / `completed` / `abandoned` 转换、Agent Ensure 调用；执行错误另写 Observation 并支撑 Verdict Claim) | `src/runner/attempt.ts` |
| 两层时间模型(时间参照点、失败标记、收尾段测量、hook 与命令子节点先写 timing boundary Observation；`PhaseTiming` / `TimingActivity` / `TimingOrigin` 是固定 GraphRef 上 timing Projector 的读面，不进入 AttemptPayloadV1) | `src/runner/timing.ts`(`TimingRecorder`;attempt 侧接线在 `src/runner/attempt.ts`,Run 侧接线在 `src/runner/run.ts`);类型在 `src/runner/types.ts` / `src/record/types.ts` |
| 变更分类账(workdir 外私有 git dir、记账起点冻结排除清单、eval/agent 归因 commit、整相一条命令导出全部 send 区间) | `src/runner/ledger.ts`(+ 同目录 `.test.ts`) |
| 指纹缓存((eval 源码闭包 + 运行配置) 哈希；携带逐条核验一个明确的历史 Attempt revision 及其 Verdict Claim 与指纹，产出待采用集合。当前 Run 仅写 Run-scoped carry Claim 与 `RunContribution`，不复制或重挂 Attempt；`run.ts` 只跳过该集合，缺失序号真实派发) | `src/runner/fingerprint.ts`(`planCarry`)、`src/runner/run.ts`(attempt 展开处按 `carriedAttemptsByKey.get(carryKey)?.has(i)` 跳过) |
| 强杀后的收尾登记(`.niceeval/teardowns/` 逐条目原子文件,与留存注册表同纪律)+ 启动自愈(触发 setup 前核对本实验自己的遗留登记、同宿主 pid 已死则先补执行一次 teardown 再走本次 setup、反馈标注 `recovery: true`)+ `--teardown` 独立入口 | `src/runner/teardown-registry.ts`(登记表原子写/读/删)、`src/runner/run.ts`(`recoverOrphanedTeardownRegistration` / `ensureExperimentSetup` / `runExperimentTeardown` 的磁盘镜像写入与删除)、`src/cli.ts`(`--teardown` 分支 + 未选中实验的遗留提醒) |
| reporter 编排 + 运行级汇总 + eval 级 reporter 作用域(scopeReporter / filterSummary)+ required/best-effort 兜错(runReporter) | `src/runner/report.ts` |
| remote 占位 Sandbox / eval 级本地路径视图(Proxy) | `src/runner/remote-sandbox.ts` |
| 反馈 coordinator(形态判定、纯 reducer、human/json renderer、终端 sink、可注入 FeedbackIO);Run 级共享 activity 行与未知 activity key 的通用 label 投影 | `src/runner/feedback/{profile,reducer,renderer,human,json,sink,coordinator,io,testing,index}.ts` |
| 终端框线渲染件(区域框契约的唯一物理实现:宽度上限 100、边框嵌字与「先保标题后保 meta」截断次序、嵌套 Section 降横隔、非 TTY/窄终端降级为无框文本;同步纯函数,不做 IO)+ 三处消费方 | `src/report/model/panel.ts`(`renderPanel` + `encodeDividerLine`/`decodeDividerLine`/`rowsFromBodyText` 的嵌套桥接);消费方:`src/report/definition/primitives.tsx`(`Section` text 面,`panelMode` 经 `TextContext`/`HostTextRenderOptions` 从 `niceeval show` 的真实 TTY/`NO_COLOR` 探测注入)、`src/runner/feedback/human.ts`(PLAN/live 面板/`FAILED`·`PASSED`/`FAILURES`/`KEPT SANDBOXES`/`NEXT`,`panelCapabilityOf(io)` 按 `io.stderr.isTTY` + `io.env.NO_COLOR` 判定)、`src/sandbox/cli-commands.ts`(`list`/`history`,启动时探测一次) |
| 机器 / 平台 reporter(Json / JUnit(同目录 temp→rename 原子写)/ Braintrust) | `src/runner/reporters/{json,braintrust,index}.ts` |
| eval 级折叠 / 计票口径(CLI 退出码与 view 共用) | `src/shared/verdict.ts` |
| Record 提交与身份(每次提交写新的 committed Graph root,并与 mutable 元数据 head + append-only committedRoots 原子更新;runner 在外部副作用前 CAS reservation;完整性由 stream / Attempt / Run / receipt 表达;carry / accept / rename 经 Claim 与 RunContribution,Attempt 永属 origin Run;Attempt locator 是完整 128-bit `attemptId` 的 26 字符规范大写 Crockford 编码,CLI 是 `@` 加 26 字符) | `src/record/{writer,protocol/entities,graph/{catalog,committed-roots,verification}}.ts`、`src/runner/{run,attempt}.ts` |
| 实验改名与结果重绑(`exp rename`:同 fingerprint 的跨 experimentId 审计迁移、整批预检与 rename Claim 写入) | `src/runner/rename-experiment.ts`(资格门、计划与写入)、`src/cli.ts`(命令拆解与人读/JSON 反馈) |
| `evaluationKind`(直接取 factory 固定的 `evalDef.evaluationKind`；缺失定义拒绝进入运行)与仅 points 题形成的 score Claim | `src/runner/attempt.ts`(`runAttemptEffect` 的 Claim 组装处) |
| bundled CLI root 映射(`<project>/.niceeval/record`)、owner-aware `clean`、`--record` 实际 Store root 与 mirror 后单一路由 | `src/cli.ts`、`src/record/store/{root,paths,record-store}.ts`、`src/record/{index,open,copy}.ts` |
| route switch 的 receipt、Reporter、机器输出、公开 types/exports、Sample/Reports/show/view、rename/copy/reuse/fingerprint 审计；旧 `publish` 删除而非改名 | `src/runner/{run,attempt,report,rename-experiment,fingerprint}.ts`、`src/runner/reporters/{json,artifacts}.ts`、`src/{types,index,cli}.ts`、`src/record/{index,publish,copy}.ts`、`src/sample/index.ts`、`src/report/index.ts`、`src/show/`、`src/view/` |
| `niceeval show` 终端宿主(显式 GraphRef / Sample selection 决定成员，绝不以最近 Run、目录或时间重选事实；`--history` 逐 experimentId+evalId 分节的 Attempt 时间轴、--report/--page 经 report/runtime/host.ts 装载 + 组合语义矩阵、证据切面 --source/--execution/--timing/--diff;Run 级与 Attempt 级 timing Projection、未知 activity key 通用 label 投影、sandboxBuild 专用卡读 provenance) | `src/show/{index,compose,render,command}.ts` + `src/report/runtime/host.ts`(两宿主共用) |
| 测试集与判据文件加载器(loadJson / loadYaml / loadText) | `src/loaders/index.ts` |

## Record / Sample Lib 与 Reports

设计文档：[feature/record/](feature/record/README.md) / [feature/reports/](feature/reports/README.md) 合流一节。
实现落点中，show 与 view 共用 `--report` 装载；不带选项的宿主命令装载同一份内建报告，并各选对应渲染面。
Record 保存不可变 Observation 与带依据的 Claim，读取经 Projector 进 Report；Sample 的样本选择归中性的 Sample 层：

```text
<project>/.niceeval/record  RecordStore(跨 Invocation / Experiment / Run 长期追加)
  │
  │  openRecordStore(root)        绑定 root 并打开 Store
  │  openRecord(store)            打开 Store 的声明 head（不按它选择事实）
  │  openRecordGraph(store, ref)  重开固定 revision
  ▼
①  src/record/                   RecordSubject、Merkle entity catalog、Attempt locator index
                                 Run / Attempt / Stream / Claim / RunContribution payload（AttemptPayloadV1 只含 identity、origin、provenance ref、lifecycle、stream bindings）
                                 提交 = committed Graph root + head + append-only committedRoots
                                 receipt = AttemptReceiptSnapshot / RunReceipt / InvocationReceipt
  │
  │  Projector(追踪式 ProjectionReadContext → basedOn)
  ▼
②  src/sample/index.ts           exportSample → SampleBundle
  │
  │  sample.attempts
  ▼
③  src/report/model/calculation.ts            rollup / aggregate / metricValue / evidenceRow
    src/report/model/conversions.ts            公开 to* 实体与投影转换
    src/report/model/{types,format,flag}.ts    数据契约与格式化
    src/report/components/*/compute.ts         内部计算(经 conversions 公开)
    src/report/definition/report.ts            defineReport / page.render / 外壳与页列表
    src/report/runtime/page-render.ts          page render 执行与 Promise 缓存
    src/report/definition/tree.ts              resolveReportTree + 渲染前树校验 + text/web 遍历
    src/report/extension/                      defineRenderer 与扩展资产
  │
  ├─ text 面  src/report/runtime/text.ts  →  src/show/*   宿主
  └─ web 面   src/report/runtime/web.ts   →  src/view/*   宿主
              两宿主共用装载 src/report/runtime/{load,host,resolved-page}.ts
```

| 行为 | 文件 |
|---|---|
| Record Store root、精确子根 create/open、temporary retain → Layout → fixed ref → handle retain/read lease 的 minimal bootstrap，以及 Store/Handle/SourceSet 的 close/admission ownership | `src/record/store/{root,paths,record-store,retain,read-lease,graph-access,gate}.ts`、`src/record/open.ts`、`src/record/index.ts` |
| `await using store = await openRecordStore(root)` 绑定实际 root 并打开 Store；`await using record = await openRecord(store)` 只打开 Store 的声明 head；`openRecordGraph(store, ref)` 重开明确的不可变 revision。Record handle 只读 Observation / Claim，选择与聚合不在这一层，也不按目录、时间或最近 Run 选事实 | `src/record/{index,open,types}.ts` |
| Record 容器(frozen typed-object Graph:RecordSubject、Merkle entity catalog、Attempt locator index 与 Run / Attempt / Stream / Claim / RunContribution payload；AttemptPayloadV1 只含 identity、origin、provenance ref、lifecycle、stream bindings；每次提交产生新的 committed Graph root,与 head + append-only committedRoots 原子更新;完整性由 stream / Attempt / Run / receipt 表达) | `src/record/` |
| 先 `captureRecordMirrorSnapshot(source)`，再以 `mirrorRecord(source, target, { snapshot })` 复制完整 Record committed root history 与每个 Graph strong closure；没有省略 snapshot 的重载 | `src/record/{copy,open}.ts`、`src/record/graph/{traversal,verification,committed-root-verify}.ts`、`src/record/store/{backend,record-store}.ts` |
| `materializeSample(recordHandle, selection)` / `narrowSample(sample, selector)` / `unionSamples(samples, conflictPolicy)`；Sample coverage 只读取 expected membership capability，与真实 Verdict Projector smoke 分开 | `src/sample/index.ts`、`src/record/evidence/builtin.ts` |
| `createSampleBundleStore` / `openSampleBundleStore` / `exportSample(sample, { sources: RecordSourceSet, target })` / `openSampleBundle(source, ref, input?)`；Bundle export 只继承 SourceSet registry，Bundle open 捕获显式 registry | `src/sample/index.ts`、`src/record/{open,attempt-evidence}.ts`、`src/record/evidence/{registry,builtin}.ts` |
| `loadReportDefinition(entryModule)` / `createReportArtifactStore` / `openReportArtifactStore` / `exportReport(frozenDefinition, { sample, sources: RecordSourceSet, parameters, target })` / `openReportArtifact`；每次 export 有独立 session，SourceSet 不拥有 memo/session | `src/report/{index,runtime/host,runtime/page-render}.ts`、`src/record/{open,attempt-evidence}.ts` |
| 分页 `RecordEvidenceProofIndexV1` / `evidenceProofs` 为 event、object、Claim 与 absence 提供统一 proof index；纯结构 parse/verify 不依赖 registry，export 只从 SourceSet 继承 instance | `src/record/graph/{proof-index,evidence-path,verification}.ts`、`src/record/attempt-evidence.ts`、`src/record/evidence/{registry,builtin}.ts` |
| 落盘截断(单值预算,events / spans 写入前截断并标记) | `src/record/truncate.ts` |
| 分层契约(RecordSubject / AttemptHandle(含 origin Run)/ Observation / Claim / `RunContribution` / receipt 类型；`TimingActivity` / `TimingOrigin` 是 Projection，`SandboxBuildRecord` 是 Run-scoped Observation，而非 Attempt 或 Run payload) | `src/record/types.ts` |
| `rollup` / `aggregate` / `metricValue` / `evidenceRow` 与分组函数(`agent` / `model` / `experiment` / `evalId`)；官方 Calculation `passRate` / `costUSD` / `totalScore` 等 | `src/report/model/calculation.ts`(公开导出在 `src/report/index.ts`;测试 `calculation.test.ts`) |
| 公开 `to*` 转换(`toExperimentRows` / `toAttemptRows` / `toSampleNotices` / `toTraceNodes` / `toAttemptSource` 等) | `src/report/model/conversions.ts` |
| 内部 Measure 字面量读数(不公开导出；官方读数以 Calculation 为准) | `src/report/model/metrics.ts` |
| `flag()`(experiment flags 当维度 / 轴) | `src/report/model/flag.ts` |
| show 切片两级聚合与表格 `MetricValue` 形状(内部：`delta` / `stability`) | `src/report/model/aggregate.ts`、`src/report/slices/` |
| 数据契约(`MetricValue`、`EvidenceRow`、内部 `TableData` / `MatrixData` / `ScatterData` / `LineData` 等) | `src/report/model/types.ts` + `src/report/model/calculation.ts` |
| 报告 chrome 文案的 locale 字典；`formatMetricValue` / `formatAxisTick` 格式化单点 | `src/report/model/locale.ts`、`src/report/model/format.ts` |
| 元素树 / `defineComponent`(双面) / 内部 `ResolveMemo`(树求值上下文记忆化，不从 `niceeval/report` 导出) / 渲染前树校验 / text 遍历渲染 | `src/report/definition/tree.ts` |
| `defineRenderer` 与扩展资产(`niceeval/report/extension`) | `src/report/extension/{define,types,assets,index}.ts` |
| `resolveReportTree` + `validateReportTree`(page.render 产出组件树之后递归校验 props 形态、收集维度声明;同层 sibling 并行、保持节点顺序;text/web 两面 × 整份报告/单页四种渲染入口都经 `resolved-page.ts` 先求值再投影) | `src/report/definition/tree.ts`、`src/report/runtime/resolved-page.ts`(被 `text.ts` / `web.ts` 调用) |
| `executePageRender` / `resolveDefinitionPage`(选页 → 校验 input 分支 → await page.render → 缓存 Promise;同一 page 实例 + 输入身份只执行一次 render) | `src/report/runtime/page-render.ts`(测试 `page-render.test.tsx`) |
| 排版原语 Row / Col / Grid / Section / Stat / Text / Style / Tabs / Tab / Table / Chart / Scatter / Line / Bars / Area（内置双面组件；Table 的 text 面在 `src/report/definition/table-text.ts`;`Scatter` 等接 `points=`，内部桥到 Dataset；`Chart` 收 Dataset 多 mark 组合) | `src/report/definition/primitives.tsx` + `src/report/definition/primitives/{chart,marks,points-dataset}.tsx`（Grid / Stat 的两面适配）+ `src/report/definition/grid-layout.ts`（`normalizeGrid` 展平、`balanceColumns` / `planGridColumns` / `gridContainerRules` / `planTextGrid` 两面同源列数算术；同步纯函数，不 import show / view、Results IO 或 stylesheet） |
| 文本排版工具箱(`stringWidth` / `padEnd` / `padStart` / `wrapText` / `indent` / `bar` / `columns`,从 `niceeval/report` 导出;跨组件族共用,不属于任一组件族) | `src/report/model/text-layout.ts` |
| 显示值格式化单点(`formatMetricValue` / `formatAxisTick`;`unit` 分派与千位缩写住在这里，Content 层不得另写 `String(value)`) | `src/report/model/format.ts` |
| `missing` 格的 code 词表与 `missingText`(内建 `noSamples` / `notRun` / `unscorable`,两面共用一份文案) | `src/report/model/locale.ts`(词典)+ `src/report/definition/cell.ts`(`formatCellText`) |
| 维度呈现(`presentDimension` 与页级槽位分配的公开面;色板与取色函数是内部实现,不出现在任一公开入口) | `src/report/presentation.ts` + `src/report/assets/colors.ts`(内部) |
| `defineReport` / `ReportShell` / `ReportPage` / `buildReportMeta` / `resolveReportTitle`(报告外壳与页列表的规范化,与宿主装载方式无关) | `src/report/definition/report.ts` |
| text 宿主装载入口 `pickReportPage` / `ReportHostContext` / `renderReportToText`(选页 → `resolveDefinitionPage` → text 投影;宿主不设树外警告通道——挑选警告的唯一呈现件是页内 `Callouts` + `toSampleNotices` / `toRunNotices`,按动作聚合层在 `src/report/components/site-components/scope-warnings.ts`,web/text 两面共用)/ 逐页 text 入口 `renderReportTreeToText`(两宿主共用的联系面调用)/ `ReportPageNotFoundError`(`--page` 未命中)/ `ReportPageNeedsLocatorError`(attempt-input page 缺 locator) | `src/report/runtime/text.ts` |
| `--report` 装载(两宿主共用:存在性/默认导出判别、dev server 的 mtime cache-busting) | `src/report/runtime/load.ts` |
| show 宿主接线(先固定 `RecordGraphRef`，把位置参数、`--exp`、`--run` 规范化为显式 `SampleSelection`，再用 `materializeSample` 形成一份不追随 head 的输入；不带 `--report` 的单 locator 选择标准 Attempt 诊断 target；显式 `--report` / `--page` 只选择同一份 Plan 已枚举的 page instance) | `src/show/index.ts`(Sample 构造在中性的 `src/sample/index.ts`;target 与 text 输出在 `src/show/`;报告装载、计划与执行在 `src/report/runtime/`) |
| web 宿主装载入口 `renderReportToStaticHtml`(唯一 import react-dom 的一侧;选页 → `resolveDefinitionPage` → web 投影,不设树外警告前置块)/ 逐页 web 入口 `renderReportTreeToStaticHtml` | `src/report/runtime/web.ts` |
| 内建报告 `standard` / `failures` / `stability`(每页 `page.render` + 公开 `to*` + 原语 plain props:`Callouts items=`、`Waterfall nodes=`、`CopyBlock content=`、`Table rows=` 等) | `src/report/built-in/{standard,failures,stability}.tsx`、`src/report/built-in/index.tsx` |
| 跨组件共享辅助与 `Cell` / `MetricValue` 渲染 | `src/report/components/shared.ts` + `shared-compute.ts` + `shared-faces.ts` + `cell.tsx` |
| `toSummaryItems` / `SampleSummary` | `src/report/model/conversions.ts` → `src/report/components/summaries/compute.ts`、`summaries/{index.tsx,faces.ts}` |
| `SampleOverview`(首页摘要 + Experiment 散点 + 实验表) | `src/report/components/summaries/index.tsx` |
| `toExperimentRows` / `toEvalRows` / `toAttemptRows` 与 `ExperimentList` / `EvalList` / `AttemptList` | `src/report/model/conversions.ts` → `src/report/components/entity-lists/{compute.ts,index.tsx,faces.ts}` |
| show 对照 / 稳定性切片(`deltaTableData` / `stabilityMatrixData`) | `src/report/slices/{compute,content,validate}.ts` |
| 图表族 Dataset 组装、轴值域推定、字符坐标图 text 面 | `src/report/model/chart/{math,plot}.ts` + `src/report/definition/primitives/{chart,marks,points-dataset}.tsx` |
| Attempt 详情:`AttemptDetails` 组合件 + 公开 `to*`(`toAttemptSummary` / `toConversationTurns` / `toDiffFiles` / `toAttemptSource` 等) | `src/report/components/attempt-detail/index.tsx`(内部计算在 `compute.ts` / `content.tsx`;公开转换在 `conversions.ts`;text 面在 `faces.ts`;测试 `attempt-components.test.tsx`) |
| 文件差异:`DiffFile` 形状、摘要与逐 `DiffWindow` patch 文本、内联预算、路径树构成 | `src/report/definition/primitives/diff-lines.ts`(两面共用的纯模块,`src/show/render.ts` 的 `diffText` 与 `DiffView` 都引它);逐 `DiffWindow` hunk 生成在 `attempt-detail/compute.ts`(`attemptDiffData`) |
| `toAttemptAssertions` 计分制字段与分组 | `src/report/model/conversions.ts` → `attempt-detail/compute.ts`(`attemptAssertionsData`、`groupByPath`)、`faces.ts`、`src/report/model/format.ts` |
| 站点组件(`Hero` / `HeroCard` / `PoweredBy` / `Callouts` + `toSampleNotices` / `toRunNotices` / `CopyBlock` + `toSampleFixPrompt` / `Waterfall` + `toTraceNodes`) | `src/report/components/site-components/index.tsx`(投影在 `projections.ts` / `compute.ts`;text 面在 `faces.ts`;警告聚合在 `scope-warnings.ts`;测试 `site-components.test.tsx`) |
| 官方专用组件 web 面样式与页级色分配 | `src/report/components/{summaries,entity-lists}/*.tsx` + `src/report/assets/colors.ts` + `styles.css`；React 入口 `src/report/react/index.tsx` |
| 渐进增强 runtime(表头排序 / 行过滤 / hover tooltip,只作用于 `.niceeval-report` 与 `data-niceeval-*`;宿主内联) | `src/report/assets/enhance.js` |
| 双面验收(renderToStaticMarkup + text Run,两面同口径) | `src/report/runtime/dual-render.test.tsx` |
| view 参数化页深链(`#/<pageId>/<key>`,泛化自 `ReportTarget{page,params}`;路由与拦截按报告清单里的参数化页 id 集合判定,不硬编码 `attempt`) | `src/view/app/lib/target-dialog.ts`(hash ↔ target 互转:`hashForTarget`/`targetFromHash`;`<pageId>/<key>.html` 链接拦截与 dialog 内容抠取,泛化自旧版 `attempt-dialog.ts`)、`src/view/app/App.tsx`(按 `ViewReportMeta.paramPageIds` 判定拦截与嵌套下钻)、`src/view/data.ts`(`ViewScan.paramPages` 按页 id 索引,href 经 `src/report/runtime/target.ts` 的 `targetHref` 单源)、`src/view/shared/types.ts`(`ViewReportMeta.paramPageIds`) |
| view 数据层先固定 `RecordGraphRef` 与 `MaterializedSample`；页面、详情深链与证据室只消费 Plan 已枚举的 membership 和 ReportData，不从时间戳、可变 head 或浏览器请求重选 Run / Attempt | `src/view/data.ts`(数据契约在 `src/view/shared/types.ts`) |
| view 报告槽与导航(不带选项装载标准 `ReportDefinition`，`--report` 替换定义，`--page` 选择已计划 instance；与 show 共用同一份固定 Sample、ReportPlan 与 ReportData；renderer assets 按内容哈希复制，`--out` 写独立 Report artifact，不能当作 Record 或 SampleBundle 打开) | `src/view/data.ts`、`src/view/server.ts`、`src/view/index.ts`、`src/report/runtime/host.ts`、`src/view/app/{main.tsx,App.tsx}` |
