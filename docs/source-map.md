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
| 采集矩阵(collection.md:每 agent 的通道 / 字段来源) | `src/agents/{claude-code,codex,bub}.ts`(采集)+ `src/o11y/parsers/*.ts`(字段提取) |
| `turnFromAiSdk`(AI SDK 结果 → 标准事件流,v4/v5/v7 字段漂移兼容;v7 tool approval → `input.requested` + `status: "waiting"`) | `src/agents/ai-sdk.ts`(+ 同目录 `.test.ts`) |
| 内置 adapter(claude-code / codex / bub) | **由被测项目自带**(`agents/*.ts`),niceeval 提供 `shared` + 解析器 |
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
| `SendFailure` → `AttemptError{code: "agent-send-failed"}` 与 `sendFailureText` 同源；`Turn.failed` 只进入 `succeeded()` 断言 | `src/context/context.ts` |

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
| run 级共享 OTLP 接收 + 逐轮归属(traceparent → `ctx.telemetry.headers`;窗口回退 + 未确认时该 agent 轮次串行) | `src/o11y/otlp/turn-otel.ts`(`AgentOtelChannel` / `OtelReceiverPool`);接线在 `src/runner/attempt.ts`(池取通道)与 `src/context/session.ts`(`sendWithOtel`:归属 / 派生 / 合并) |
| 固定端口 / 自定义接收 host 模式(`defineConfig({ telemetry: { host, port } })`,niceeval 项目内唯一入口,不读环境变量) | `src/runner/run.ts`(`OtelReceiverPool` 取 `config.telemetry.port`)、`src/runner/attempt.ts`(`config.telemetry.host`)、`src/o11y/otlp/receiver.ts`(`makeTraceReceiver(port)`,端口被占用时报 `otel.portInUse`) |
| `deriveRunFacts`(toolCalls / subagents / parked / compactions) | `src/o11y/derive.ts` |
| 宿主侧行为断言 `t.o11y`(读取时从当前累积事件现算) | `src/o11y/derive.ts`(`buildO11ySummary`) → `src/context/context.ts`(`t.o11y` getter) |
| codex 用量从 `turn.completed.usage` 抠出 | `src/o11y/parsers/codex.ts` |
| 用量 → 成本(实测优先 → 用户覆盖 → 内置 Run) | `src/o11y/cost.ts` |

## Sandbox([feature/sandbox/](feature/sandbox/README.md))

| 行为 | 文件 |
|---|---|
| `SandboxOperations` 单一词汇与语义、`Sandbox` / `EvalSandbox` / `SandboxCommandTarget` 三个能力视图、`CommandOptions` / `CommandResult` | `src/sandbox/types.ts` |
| Docker provider(dockerode,node:24-slim,非 root,tar 上传) | `src/sandbox/docker.ts`(编排)+ `src/sandbox/docker-stream.ts`(exec 流解复用 / tar 工具) |
| Local provider(宿主机本地目录、零隔离;仓库根解析 / 显式 `dir`;`{ user }` 报错;`downloadDirectory` 复用 vercel/e2b 的 find+read 模板) | `src/sandbox/local.ts`(`LocalSandbox`) |
| 变更分类账 GIT_DIR / 导出目录的按 sandboxId 覆盖登记(local 用宿主侧每实例私有临时目录,避免同机多次运行互相踩踏;其余 provider 用固定沙箱内路径,不登记) | `src/sandbox/ledger-paths.ts`;消费端在 `src/runner/ledger.ts`(`gitEnv` / `createChangeLedger` / `buildExportScript`) |
| provider 级调度 lane 与独占 admission（local 与自定义 provider 都在 physical planning 完成态声明；运行参数不解除独占约束） | `src/sandbox/layer.ts`(`SandboxProviderScheduling` / provider modules)、`src/runner/sandbox-selection.ts`(`schedulingForPreparedPairs`)、`src/runner/run.ts` |
| 三 provider 共享工具(shellQuote / find 脚本构造 / 宿主文件遍历) | `src/sandbox/shell.ts`、`src/sandbox/local-files.ts` |
| `downloadDirectory`(vercel/e2b 共用的 find 列路径 + 逐文件二进制读取两阶段模板;docker 走 `getArchive` 单次 tar 取回,见上一行 docker-stream.ts) | `src/sandbox/download-directory.ts` |
| NiceEval 公共 E2B baseline 的具名版本锁定 ref、官方起点派生 factory、三模板统一的运行用户 npm global 契约 | `src/sandbox/e2b-agent-template.ts`(`NICEEVAL_*_E2B_TEMPLATE` / `PUBLISHED_E2B_BASELINE_TAG` / `e2bCodingAgentTemplate` / `verifyE2BNodeToolContract`)；发布构建与最终状态自检在 `sandbox/e2b/build-agent-template.mts`，已发布事实记录在 `sandbox/e2b/published.json` |
| 单 Dockerfile 按需构建（Docker image / E2B template 的 BuildKey、cache lookup、构建与 locator） | `src/sandbox/dockerfile-build.ts`；Run 级收集与 provider 路由在 `src/runner/build-preparation.ts` |
| 官方起点 image / template 的版本号(`<Agent 版本>-r<配方修订>`,niceeval 自身版本不参与) | `src/agents/coding-cli-versions.ts`(`AGENT_BASELINE_VERSION` / `AGENT_BASELINE_RECIPE_REVISION` / `agentBaselineVersionTag`)——同一批常量喂 Adapter 的运行时回退安装；一致性守护在 `src/sandbox/official-baselines.test.ts` |
| NiceEval 公共 Docker 镜像的具名 ref | `src/sandbox/docker-agent-image.ts`(`NICEEVAL_*_DOCKER_IMAGE`)；配方在 `sandbox/docker/Dockerfile`，按配方变更发布的 CI 在 `.github/workflows/docker-image.yml`；Agent 集合是完整的 `CodingAgentBaseline`，E2B 侧子集见 `E2BCodingAgent` |
| `SandboxLayer` link、physical planning 与 provider 实例创建（无默认值、无 profile registry、无环境探测） | `src/sandbox/link.ts`、`src/sandbox/plan.ts`、`src/sandbox/runtime.ts` |
| Provisioning 瞬时错误分类 + 退避重试(各 provider 的 `classifyProvisionError` 认原生限流,未命中时走与文件 IO 共用的瞬时分类器 → `createProvider()` 统一重试) | `src/sandbox/errors.ts`、`src/sandbox/retry.ts`;各 provider 文件的 `classifyProvisionError` |
| `defineSandbox` 自定义 provider 与 `defineSandboxCase` 自定义 case（强类型 callback 只存在于私有 ProviderModule binding） | `src/define.ts`、`src/sandbox/layer.ts`、`src/sandbox/runtime.ts` |
| Sandbox case（唯一主 Sandbox、资源组、services 完成态、BuildKey / CaseKey） | `src/sandbox/case-types.ts`、`src/sandbox/identity.ts`；规划与创建 provider 实例的接线在 `src/sandbox/layer.ts`、`src/sandbox/runtime.ts` |
| Run 级构建协调(single-flight、构建并发与逐 key timeout、`sandbox.build` timings 与 `sandboxBuilds` provenance) | `src/sandbox/build-coordinator.ts`;接线在 `src/runner/run.ts` |
| Docker Compose case(原生 build/up/down、受管 overlay、黑名单、ready、整组 finalizer) | `src/sandbox/compose.ts`(复用 `src/sandbox/docker.ts` 的连接层) |
| 沙箱编排固定段(变更分类账锚点 / 折叠 agent diff;起始文件上传是 `test()` 里的手工调用,不属于固定段) | `src/runner/sandbox-prep.ts` |
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
| 断言收集器(延迟评估 + 链式 gate/soft/atLeast;`.points(n)` 挂在 `RecordHandle` 上——`finalize` 按 `n × score` 写进 `AssertionResult.points`;`AssertionCollector.score(label, n)` 立即记录 `ScoreEntry`,不像断言那样等 finalize 求值) | `src/assertions/collector.ts` |
| 计分制的前置中止(句柄上的 `.gate()` 使该断言就地求值并进入中止态,下一次 `t.*` 调用或 finalize 抛中止信号;matcher 自带/链上的 severity 只贡献 threshold,不触发中止) | `src/assertions/collector.ts`(`RecordHandle.gate` 的计分制分支、`t.*` 入口的待决前置结算)、`src/context/control-flow.ts`(中止异常) |
| 计分制题型(`defineEval`/`defineScoreEval` 分别定死 `EvalDefinition.evaluationKind` 为 `"pass"`/`"points"`,禁止手写;`ScoreEvalInput` 的 `test(t)` 换成 `ScoreTestContext`) | `src/define.ts`(工厂函数)、`src/runner/types.ts`(`EvaluationKind`、`EvalDefinition.evaluationKind`、`ScoreEvalInput`、`EvalDescriptor.evaluationKind`) |
| 给分词汇的类型分离(`ScoreAssertionHandle` 在 `AssertionHandle` 上加 `.points(n)` 并去掉 `.atLeast(x)`,`.points(n)` 的返回句柄只剩 `.gate()`/`.optional()`;`ScoreTestContext` 在 `TestContext` 上加 `t.score(label, n)` 并去掉 `t.require`;通过制 `t` 上没有给分词汇,类型层拒绝,不需要运行时守护) | `src/context/types.ts`(`ScoreAssertionHandle`、`ScoreTestContext`)、`src/assertions/types.ts`(`ScoreEntry`、`AssertionResult.points`) |
| 题型发现投影与混型保真(`evalDescriptorOf` 把定义期 `evaluationKind` 投影进 `EvalDescriptor`；同一 Experiment 的两类 Eval 都进入调度与记录) | `src/runner/eval-selection.ts`、`src/runner/run.ts` |
| `t.require` 中止语义(通过制的前置词;前置断言按 gate 记录,未过即抛 `EvalRequirementFailed`,`test()` 后续代码不再执行,已记录的断言决定判定;`runAttemptEffect` 捕获该异常时不设 `error`,verdict 走正常判定路径而非 errored。计分制的 `.gate()` 中止复用同一条异常与捕获分支) | `src/context/context.ts`(`require`)、`src/context/control-flow.ts`(`EvalRequirementFailed`)、`src/runner/attempt.ts`(捕获分支) |
| LLM-as-judge(OpenAI 兼容 /chat/completions；单条 `{model}` → Experiment → Eval → config 逐字段解析；model/key 缺失记 `unavailable`) | `src/assertions/judge.ts`、`src/runner/config.ts` |
| 判定规则(passed / failed / errored / skipped;非 optional 的 `unavailable` 断言 → errored;计分制 attempt 的 `failed` 只由前置中止产生,得分点丢分不参与判定) | `src/shared/verdict.ts` |
| 证据完整性(Agent 必填六通道 `EvidenceCoverage`、`completeEvidenceCoverage`、`TurnEvidenceCoverage` 降档、`AttemptRecord.evidenceCoverage` 必填、worst 聚合、三值折叠) | `src/assertions/coverage.ts`(算法)+ `src/agents/types.ts`(声明类型)+ `src/assertions/scoped.ts`(`coverageGap` 折叠接线) |
| diff 数据派生(`DiffArtifact = DiffWindow[]` → 文件汇总 / 匹配谓词) | `src/assertions/diff.ts` |

## `t` 上下文与会话([feature/eval/](feature/eval/README.md))

| 行为 | 文件 |
|---|---|
| 构造 `t`(send / reply / newSession / check / 作用域断言 / judge / sandbox) | `src/context/context.ts` |
| 会话驱动(多轮 send → agent.send,事件 / 用量累加,newSession) | `src/context/session.ts` |
| 控制流信号(skip / `.stopOnFailure()` 前置中止；send 执行异常独立走 `SendFailure`) | `src/context/control-flow.ts`、`src/context/send-failures.ts` |
| `t.sandbox.file(path)` 延迟引用(到 finalize 才读沙箱文件) | `src/context/context.ts`(`FileRef`) |

## Runner / CLI / Experiments([runner.md](runner.md) / [cli.md](cli.md) 架构 / [feature/experiments/](feature/experiments/README.md))

| 行为 | 文件 |
|---|---|
| 发现(evals/ 的 *.eval.ts / *.eval.tsx 与目录入口 eval.ts,experiments/ 的实验,路径推导 id;同 id 双入口报重名) | `src/runner/discover.ts` |
| Eval 源码捕获、folder-local 目录入口 base id、loader 隐藏输入登记与 build context 交叉检查 | `src/runner/eval-source.ts`、`src/loaders/index.ts`;接线在 `src/runner/discover.ts` |
| 普通本地上传的 transfer manifest 与动态泄漏比对 | `src/sandbox/` 上传包装、`src/runner/attempt.ts`、fingerprint/carry planner 与 materializer closure 记录;契约见 `docs/feature/eval/use-case/criteria-files.md` |
| 有界并发调度 + 首过即停 + budget 已花费护栏(不做预测性预扣);Run 级共享准备(构建协调 / staged payload 准备)不占 attempt 并发位 | `src/runner/run.ts` |
| 并发 Invocation 协作(用例锁防双跑；`maxConcurrency` 只限本 Invocation；`sharedState.key` 按完整 Experiment/Sandbox lifecycle 独占外部状态) | `src/runner/run.ts`、`src/runner/eval-lock.ts`、`src/runner/state-lease.ts` |
| 单 attempt 生命周期(沙箱 / OTLP 接收器 Scope、超时硬边界、沙箱编排固定段、LifecyclePhase 转换、Agent Ensure 调用) | `src/runner/attempt.ts` |
| 两层时间模型(`PhaseTiming` / `TimingActivity` / `TimingOrigin`:锚点 enter / 失败标记 / 收尾段测量 / hook 与命令子节点;Run 级 `RunMeta.timings` 的双时钟 recorder) | `src/runner/timing.ts`(`TimingRecorder`;attempt 侧接线在 `src/runner/attempt.ts`,Run 侧接线在 `src/runner/run.ts`);类型在 `src/runner/types.ts` / `src/record/types.ts` |
| 变更分类账(workdir 外私有 git dir、锚点冻结排除清单、eval/agent 归因 commit、整相一条命令导出全部 send 窗口) | `src/runner/ledger.ts`(+ 同目录 `.test.ts`) |
| 指纹缓存((eval 源码闭包 + 运行配置) 哈希,携带以 attempt 为粒度——`planCarry` 逐条比较每个 attempt 自己的终态 + 指纹,产出 `carriedAttemptsByKey`(具体序号集合,不是整段 key 命中就携入);`run.ts` 的调度按这个具体序号集合跳过,缺失序号真实派发) | `src/runner/fingerprint.ts`(`planCarry`)、`src/runner/run.ts`(attempt 展开处按 `carriedAttemptsByKey.get(carryKey)?.has(i)` 跳过) |
| 强杀后的收尾登记(`.niceeval/teardowns/` 逐条目原子文件,与留存注册表同纪律)+ 启动自愈(触发 setup 前核对本实验自己的遗留登记、同宿主 pid 已死则先补执行一次 teardown 再走本次 setup、反馈标注 `recovery: true`)+ `--teardown` 独立入口 | `src/runner/teardown-registry.ts`(登记表原子写/读/删)、`src/runner/run.ts`(`recoverOrphanedTeardownRegistration` / `ensureExperimentSetup` / `runExperimentTeardown` 的磁盘镜像写入与删除)、`src/cli.ts`(`--teardown` 分支 + 未选中实验的遗留提醒) |
| reporter 编排 + 运行级汇总 + eval 级 reporter 作用域(scopeReporter / filterSummary)+ required/best-effort 兜错(runReporter) | `src/runner/report.ts` |
| remote 占位 Sandbox / eval 级本地路径视图(Proxy) | `src/runner/remote-sandbox.ts` |
| 反馈 coordinator(形态解析、纯 reducer、human/json renderer、终端 sink、可注入 FeedbackIO);Run 级共享 activity 行与未知 activity key 的通用 label 投影 | `src/runner/feedback/{profile,reducer,renderer,human,json,sink,coordinator,io,testing,index}.ts` |
| 终端框线渲染件(区域框契约的唯一物理实现:宽度上限 100、边框嵌字与「先保标题后保 meta」截断次序、嵌套 Section 降横隔、非 TTY/窄终端降级为无框文本;同步纯函数,不做 IO)+ 三处消费方 | `src/report/model/panel.ts`(`renderPanel` + `encodeDividerLine`/`decodeDividerLine`/`rowsFromBodyText` 的嵌套桥接);消费方:`src/report/definition/primitives.tsx`(`Section` text 面,`panelMode` 经 `TextContext`/`HostTextRenderOptions` 从 `niceeval show` 的真实 TTY/`NO_COLOR` 探测注入)、`src/runner/feedback/human.ts`(PLAN/live 面板/`FAILED`·`PASSED`/`FAILURES`/`KEPT SANDBOXES`/`NEXT`,`panelCapabilityOf(io)` 按 `io.stderr.isTTY` + `io.env.NO_COLOR` 判定)、`src/sandbox/cli-commands.ts`(`list`/`history`,启动时探测一次) |
| 机器 / 平台 reporter(Artifacts / Json / JUnit(同目录 temp→rename 原子写)/ Braintrust) | `src/runner/reporters/{artifacts,json,braintrust,index}.ts` |
| eval 级折叠 / 计票口径(CLI 退出码与 view 共用) | `src/shared/verdict.ts` |
| 本地结果保存格式(Run 目录 `.niceeval/<experiment>/<run>/run.json` + attempt 级 `result.json` / JSON artifact;runner 调度前预分配 `runId`,按 `{runId,evalId,attempt}` 生成并登记 fresh `locator`,Artifacts writer 原样写入同一 `runId` 与 `locatorRunId`;carry 保留来源身份;reader 折叠同来源副本、保留不同来源多候选并区分 malformed / not-found / ambiguous) | `src/runner/run.ts`(Run 身份分配、locator 生成与记录根碰撞预检)、`src/runner/reporters/artifacts.ts`(reporter 薄壳,转交预分配 Run 身份并按 experimentId 路由)、`src/record/locator.ts`(60-bit Crockford 编码、多候选索引与写入登记检查)、`src/record/open.ts`(`locatorRunId` / `artifactBase` 来源回溯与 `resolveLocator` 三类失败)、`src/record/writer.ts`(`createWriter`;写入面收窄类型 `AttemptEntry = Omit<EvalResult, …>`)、`src/record/types.ts`(`RunMeta` / `AttemptHandle.locatorIdentity`)、`src/runner/types.ts`(`EvalResult`——architecture.md `result.json` 一节里的 `AttemptRecord` 是该持久化形状的文档概念名,对应的运行时类型就是它;同文件的 `RECORD_SCHEMA_VERSION` / `RECORD_FORMAT` 常量随 `EvalResult` 同址声明,经 `src/types.ts` facade 转出给 `src/record/` 域 import,不在 `src/record/types.ts` 里重新声明) |
| 实验改名与结果重绑(`exp rename`:同 fingerprint 的跨 experimentId 审计迁移、整批预检与单 snapshot 写入) | `src/runner/rename-experiment.ts`(资格门、计划与写入)、`src/cli.ts`(命令解析与人读/JSON 反馈)、`src/runner/types.ts`(`RenamedResult` / `EvalResult.renamedFrom`) |
| `EvalResult.evaluationKind`(直接取 factory 固定的 `evalDef.evaluationKind`；缺失定义拒绝进入运行)与 `scoreEntries`(仅 `evaluationKind: "points"` 时落) | `src/runner/attempt.ts`(`runAttemptEffect` 组装 `EvalResult` 处) |
| CLI(exp / show / list / view / clean / init,--help,parseArgs 表驱动,.env 加载,输出形态解析;调度项没有环境变量层,见[配置与凭据边界](architecture.md#配置从代码来凭据从环境来)) | `src/cli.ts` |
| `niceeval show` 终端宿主(Sample 合成当前结果集、--history 逐 experimentId+evalId 分节的 attempt 执行时间轴、--report/--page 经 report/runtime/host.ts 装载 + 组合语义矩阵、证据切面 --source/--execution/--timing/--diff;Run 级与 attempt 级 timing 树、未知 activity key 通用 label 投影、sandboxBuild 专用卡读 provenance) | `src/show/{index,compose,render,command}.ts` + `src/report/runtime/host.ts`(两宿主共用) |
| 测试集与判据文件加载器(loadJson / loadYaml / loadText) | `src/loaders/index.ts` |

## Record / Sample Lib 与 Reports

设计文档：[feature/record/](feature/record/README.md) / [feature/reports/](feature/reports/README.md) 合流一节。
实现落点中，show 与 view 共用 `--report` 装载；不带选项的宿主命令装载同一份内建报告，并各选对应渲染面。
两个宿主的 Sample 都由中性的 `selectLatestPerEval` 产出：

三层的数据形状与各层操作画在[Reading](feature/reading/README.md)的总图上,这里只给同一条链路的文件落点。

```text
磁盘  .niceeval/<experiment>/<run>/
  │
  │  openRecord()
  ▼
①  src/record/open.ts      扫描 / 导航 / 版本分流 / 懒加载
    src/record/format.ts    目录布局与版本知识
    src/record/types.ts     分层契约(Experiment / Run / AttemptHandle / Sample)
    src/record/locator.ts   身份键
    src/record/writer.ts    createWriter        ← 第三方 harness 写进来
    src/record/copy.ts      publish             → 发布出去
  │
  │  currentSample() / latestRunSample()
  ▼
②  src/sample/index.ts      latestRunSample / currentSample / Sample.filter
                            dedupeAttempts / SampleIssue
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
| `openRecord`:实验/Run/eval 分层、版本分流(三种 unreadable 原因)、懒加载(attempt 目录→artifactBase 携带条目回退);`RunMeta.timings` / `sandboxBuilds` 与 attempt activity 子树原样读回 | `src/record/open.ts` |
| 布局与版本知识(attempt 目录规则、Run 分类、完整 producer) | `src/record/format.ts` |
| `latestRunSample(record)` / `currentSample(record)`、`Sample.scope` / `.filter`、结构化 coverage missing、`dedupeAttempts` 与 `SampleIssue` | `src/sample/index.ts` |
| `createWriter`(Run 目录独占创建、Run 级元数据落盘含 `timings` / `sandboxBuilds`、attempt 记录与 artifact 增量落盘、`finish()` 补 `completedAt` 并原子封口 Run timings) | `src/record/writer.ts` |
| `publish`(发布原语:计划 → 预检 → 复制,knownEvalIds 补记;`timings` / `sandboxBuilds` / origin 引用忠实保留) | `src/record/copy.ts` |
| 发布预算常量(50 MiB 单文件预检上限) | `src/record/publish.ts` |
| 落盘截断(单值 256 KiB 上限,events / spans 写入前截断并标记) | `src/record/truncate.ts` |
| 分层契约(Experiment / Run / Eval / AttemptHandle(含 `carried` 携带条目投影)/ AttemptRef / Sample(含 `coverage: SampleCoverage[]`)/ issue 类型;`TimingActivity` / `TimingOrigin` / `SandboxBuildRecord` / `RunMeta.timings`) | `src/record/types.ts` |
| `rollup` / `aggregate` / `metricValue` / `evidenceRow` 与分组函数(`agent` / `model` / `experiment` / `evalId`)；官方 Calculation `passRate` / `costUSD` / `totalScore` 等 | `src/report/model/calculation.ts`(公开导出在 `src/report/index.ts`;测试 `calculation.test.ts`) |
| 公开 `to*` 转换(`toExperimentRows` / `toAttemptRows` / `toSampleNotices` / `toTraceNodes` / `toAttemptSource` 等) | `src/report/model/conversions.ts` |
| 内部 Measure 字面量读数(不公开导出；官方读数以 Calculation 为准) | `src/report/model/metrics.ts` |
| `flag()`(experiment flags 当维度 / 轴) | `src/report/model/flag.ts` |
| show 切片两级聚合与表格 `MetricValue` 形状(内部：`delta` / `stability`) | `src/report/model/aggregate.ts`、`src/report/slices/` |
| 数据契约(`MetricValue`、`EvidenceRow`、内部 `TableData` / `MatrixData` / `ScatterData` / `LineData` 等) | `src/report/model/types.ts` + `src/report/model/calculation.ts` |
| 报告 chrome 文案的 locale 字典；`formatMetricValue` / `formatAxisTick` 格式化单点 | `src/report/model/locale.ts`、`src/report/model/format.ts` |
| 元素树 / `defineComponent`(双面) / 内部 `ResolveMemo`(树解析环境记忆化，不从 `niceeval/report` 导出) / 渲染前树校验 / text 遍历渲染 | `src/report/definition/tree.ts` |
| `defineRenderer` 与扩展资产(`niceeval/report/extension`) | `src/report/extension/{define,types,assets,index}.ts` |
| `resolveReportTree` + `validateReportTree`(page.render 产出组件树之后递归校验 props 形态、收集维度声明;同层 sibling 并行、保持节点顺序;text/web 两面 × 整份报告/单页四种渲染入口都经 `resolved-page.ts` 先解析再投影) | `src/report/definition/tree.ts`、`src/report/runtime/resolved-page.ts`(被 `text.ts` / `web.ts` 调用) |
| `executePageRender` / `resolveDefinitionPage`(选页 → 校验 input 分支 → await page.render → 缓存 Promise;同一 page 实例 + 输入身份只执行一次 render) | `src/report/runtime/page-render.ts`(测试 `page-render.test.tsx`) |
| 排版原语 Row / Col / Grid / Section / Stat / Text / Style / Tabs / Tab / Table / Chart / Scatter / Line / Bars / Area（内置双面组件；Table 的 text 面在 `src/report/definition/table-text.ts`;`Scatter` 等接 `points=`，内部桥到 Dataset；`Chart` 收 Dataset 多 mark 组合) | `src/report/definition/primitives.tsx` + `src/report/definition/primitives/{chart,marks,points-dataset}.tsx`（Grid / Stat 的两面适配）+ `src/report/definition/grid-layout.ts`（`normalizeGrid` 展平、`balanceColumns` / `planGridColumns` / `gridContainerRules` / `planTextGrid` 两面同源列数算术；同步纯函数，不 import show / view、Results IO 或 stylesheet） |
| 文本排版工具箱(`stringWidth` / `padEnd` / `padStart` / `wrapText` / `indent` / `bar` / `columns`,从 `niceeval/report` 导出;跨组件族共用,不属于任一组件族) | `src/report/model/text-layout.ts` |
| 显示值格式化单点(`formatMetricValue` / `formatAxisTick`;`unit` 分派与千位缩写住在这里，Content 层不得另写 `String(value)`) | `src/report/model/format.ts` |
| `missing` 格的 code 词表与 `missingText`(内建 `noSamples` / `notRun` / `unscorable`,两面共用一份文案) | `src/report/model/locale.ts`(词典)+ `src/report/definition/cell.ts`(`formatCellText`) |
| 维度呈现(`presentDimension` 与页级槽位分配的公开面;色板与取色 helper 是内部实现,不出现在任一公开入口) | `src/report/presentation.ts` + `src/report/assets/colors.ts`(内部) |
| `defineReport` / `ReportShell` / `ReportPage` / `buildReportMeta` / `resolveReportTitle`(报告外壳与页列表的规范化,与宿主装载方式无关) | `src/report/definition/report.ts` |
| text 宿主装载入口 `pickReportPage` / `ReportHostContext` / `renderReportToText`(选页 → `resolveDefinitionPage` → text 投影;宿主不设树外警告通道——挑选警告的唯一呈现件是页内 `Callouts` + `toSampleNotices` / `toRunNotices`,按动作聚合层在 `src/report/components/site-components/scope-warnings.ts`,web/text 两面共用)/ 逐页 text 入口 `renderReportTreeToText`(两宿主共用的联系面调用)/ `ReportPageNotFoundError`(`--page` 未命中)/ `ReportPageNeedsLocatorError`(attempt-input page 缺 locator) | `src/report/runtime/text.ts` |
| `--report` 装载(两宿主共用:存在性/默认导出判别、dev server 的 mtime cache-busting) | `src/report/runtime/load.ts` |
| show 宿主接线(无条件调 `currentSample` 产出 Sample；不带 `--report` 的 `@<locator>` 直接装配官方 Attempt 诊断切片，不读取 `config.report`；显式 `@<locator> --report` 与普通 `--report`/`--page` 经 `report/runtime/host.ts` 装载自定义 text 报告；多页时选初始页——`--page` 指定或默认第一页——的逻辑在 `src/show/index.ts`,渲染完初始页后由 `src/show/render.ts` 的 `otherPagesText` 在尾部追加「其余页」索引与可复制命令) | `src/show/index.ts`(当前结果集选择器在中性的 `src/sample/index.ts`;单 Eval、Attempt 详情与证据切面渲染在 `src/show/render.ts`;`src/show/compose.ts` 只留 `--history` 逐 attempt 执行时间轴口径;两宿主共用的报告装载规范化/标题回退在 `src/report/runtime/host.ts`;show 专属的可复制命令拼装 `showCommand` 在 `src/show/command.ts`;测试 `src/show/render.test.ts`、`src/show/command.test.ts`、`src/report/runtime/host.test.ts`;进程级选择收窄与用法错误矩阵归 `docs/engineering/testing/e2e/report.md` 对真实进程验收) |
| web 宿主装载入口 `renderReportToStaticHtml`(唯一 import react-dom 的一侧;选页 → `resolveDefinitionPage` → web 投影,不设树外警告前置块)/ 逐页 web 入口 `renderReportTreeToStaticHtml` | `src/report/runtime/web.ts` |
| 内建报告 `standard` / `failures` / `stability`(每页 `page.render` + 公开 `to*` + 原语 plain props:`Callouts items=`、`Waterfall nodes=`、`CopyBlock content=`、`Table rows=` 等) | `src/report/built-in/{standard,failures,stability}.tsx`、`src/report/built-in/index.tsx` |
| 跨组件共享辅助与 `Cell` / `MetricValue` 渲染 | `src/report/components/shared.ts` + `shared-compute.ts` + `shared-faces.ts` + `cell.tsx` |
| `toSummaryItems` / `SampleSummary` | `src/report/model/conversions.ts` → `src/report/components/summaries/compute.ts`、`summaries/{index.tsx,faces.ts}` |
| `SampleOverview`(首页摘要 + Experiment 散点 + 实验表) | `src/report/components/summaries/index.tsx` |
| `toExperimentRows` / `toEvalRows` / `toAttemptRows` 与 `ExperimentList` / `EvalList` / `AttemptList` | `src/report/model/conversions.ts` → `src/report/components/entity-lists/{compute.ts,index.tsx,faces.ts}` |
| show 对照 / 稳定性切片(`deltaTableData` / `stabilityMatrixData`) | `src/report/slices/{compute,content,validate}.ts` |
| 图表族 Dataset 解析、轴值域推定、字符坐标图 text 面 | `src/report/model/chart/{math,plot}.ts` + `src/report/definition/primitives/{chart,marks,points-dataset}.tsx` |
| Attempt 详情:`AttemptDetails` 组合件 + 公开 `to*`(`toAttemptSummary` / `toConversationTurns` / `toDiffFiles` / `toAttemptSource` 等) | `src/report/components/attempt-detail/index.tsx`(内部计算在 `compute.ts` / `content.tsx`;公开转换在 `conversions.ts`;text 面在 `faces.ts`;测试 `attempt-components.test.tsx`) |
| 文件差异:`DiffFile` 形状、摘要与逐窗口 patch 文本、内联预算、路径树构成 | `src/report/definition/primitives/diff-lines.ts`(两面共用的纯模块,`src/show/render.ts` 的 `diffText` 与 `DiffView` 都引它);逐窗口 hunk 生成在 `attempt-detail/compute.ts`(`attemptDiffData`) |
| `toAttemptAssertions` 计分制字段与分组 | `src/report/model/conversions.ts` → `attempt-detail/compute.ts`(`attemptAssertionsData`、`groupByPath`)、`faces.ts`、`src/report/model/format.ts` |
| 站点组件(`Hero` / `HeroCard` / `PoweredBy` / `Callouts` + `toSampleNotices` / `toRunNotices` / `CopyBlock` + `toSampleFixPrompt` / `Waterfall` + `toTraceNodes`) | `src/report/components/site-components/index.tsx`(投影在 `projections.ts` / `compute.ts`;text 面在 `faces.ts`;警告聚合在 `scope-warnings.ts`;测试 `site-components.test.tsx`) |
| 官方专用组件 web 面样式与页级色分配 | `src/report/components/{summaries,entity-lists}/*.tsx` + `src/report/assets/colors.ts` + `styles.css`；React 入口 `src/report/react/index.tsx` |
| 渐进增强 runtime(表头排序 / 行过滤 / hover tooltip,只作用于 `.niceeval-report` 与 `data-niceeval-*`;宿主内联) | `src/report/assets/enhance.js` |
| 双面验收(renderToStaticMarkup + text Run,两面同口径) | `src/report/runtime/dual-render.test.tsx` |
| view 参数化页深链(`#/<pageId>/<key>`,泛化自 `ReportTarget{page,params}`;路由与拦截按报告清单里的参数化页 id 集合判定,不硬编码 `attempt`) | `src/view/app/lib/target-dialog.ts`(hash ↔ target 互转:`hashForTarget`/`targetFromHash`;`<pageId>/<key>.html` 链接拦截与 dialog 内容抠取,泛化自旧版 `attempt-dialog.ts`)、`src/view/app/App.tsx`(按 `ViewReportMeta.paramPageIds` 判定拦截与嵌套下钻)、`src/view/data.ts`(`ViewScan.paramPages` 按页 id 索引,href 经 `src/report/runtime/target.ts` 的 `targetHref` 单源)、`src/view/shared/types.ts`(`ViewReportMeta.paramPageIds`) |
| view 数据层(openRecord;`__NICEEVAL_VIEW_DATA__` 只携带证据室数据:Run 明细 + skipped + 壳元信息(含报告外壳/页导航的 `ViewReportMeta`),统计住报告页)。`latestRunSample(record)` 结果(命名为 `latestPerExperiment`)只用于给证据室 Run 打「latest」标记,与报告槽 Sample 是两条独立通道,不参与报告计算;`viewData.snapshots` 是完整记录根的全量通道,只服务各参数化页深链(`#/<pageId>/<key>`)的解析,不随报告 Sample 收窄 | `src/view/data.ts`(数据契约在 `src/view/shared/types.ts`) |
| view 报告槽与导航(不带选项运行装载内建报告默认导出、`--report` 整槽替换、`--page` 定初始页;报告槽 Sample 由 view 直接调 `currentSample` 产出;报告装载/规范化/标题回退经两宿主共用的 `src/report/runtime/host.ts`;`renderReportSlot` 逐页静态渲染、en/zh-CN 两遍烘成 `<template id="niceeval-report-<pageId>-<locale>">` 静态块;导航项 = 报告页列表(声明序),路由只有 `#/page/<id>` 与各参数化页深链 `#/<pageId>/<key>`,宿主不追加导航项、不渲染 hero/警告横幅/页脚/页头链接等任何页面内容 chrome(`App.tsx` 的 `BRAND_HREF` 恒渲染的页头 NiceEval 字标除外——那是宿主保留的机器位,与页面内 `PoweredBy` 品牌行分属两处),浏览器 `<title>` 是宿主保留的文档单例;外壳 head 与主题 styles 按声明序注入、renderer assets 按内容哈希复制并随 scope/参数化页注入、增强 runtime 与官方样式内联、输入判定 `resolveViewInput`(`--record`/`--run` 互斥,位置参数只表示 eval id 前缀)) | `src/view/data.ts`、`src/view/server.ts`、`src/view/index.ts`、`src/report/runtime/host.ts`(两宿主共用,不属于 show)、前端摆放 `src/view/app/{main.tsx,App.tsx}`(测试 `src/view/data.test.ts`;渲染出的导航结构与外壳 chrome、`resolveViewInput` 的进程级输入校验归 `docs/engineering/testing/e2e/report.md` 对真实产物验收) |
