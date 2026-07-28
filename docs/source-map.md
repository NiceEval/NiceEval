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
| `AgentContext.experimentId`(路径推导的实验 id,与结果归属同源;沙箱生命周期 Hook 按它隔离跨 attempt 状态) | `src/agents/types.ts`(`AgentContext.experimentId`) |
| 能力调用守卫(缺声明的动作第一次调用即报清晰错误;conversation gate 第二轮起) | `src/context/context.ts`(`capabilityGuard`) |
| 逐 API 适配义务(send / newSession / respond 的运行器侧翻译) | `src/context/session.ts`(`SessionManager` / `RunSession`)、`src/context/context.ts` |
| `defineSandboxAgent` / `defineAgent`(`kind: "sandbox" | "remote"`,无能力位字段) | `src/define.ts` |
| `shared` 工具袋(ensureInstalled / captureLatestJsonl(可按 sessionId 精确定位)/ writeFile / extractJsonlFromStdout / codexThreadId / firstJsonField / shellQuote / diagnoseFailure / parseCodex·parseClaudeCode·parseBub) | `src/agents/shared.ts` |
| 采集矩阵(collection.md:每 agent 的通道 / 字段来源) | `src/agents/{claude-code,codex,bub}.ts`(采集)+ `src/o11y/parsers/*.ts`(字段提取) |
| `turnFromAiSdk`(AI SDK 结果 → 标准事件流,v4/v5/v7 字段漂移兜底;v7 tool approval → `input.requested` + `status: "waiting"`) | `src/agents/ai-sdk.ts`(+ 同目录 `.test.ts`) |
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

## 执行失败分类:时间轴重试与空间轴止损([README](feature/error-classification/README.md) / [架构](feature/error-classification/architecture.md) / [库用法](feature/error-classification/library.md))

| 行为 | 文件 |
|---|---|
| 两轴词表(`FailureScope` / `FailureClass` / `AttemptFailureInfo` / `AttemptFailureClassifier`)、糖衣类(`ExperimentFatalError` / `EvalFatalError`)、结构守卫 `failureClassOf`、生命周期分类链(`resolveAttemptFailureClass` / `attemptFailureInfo`) | `src/shared/failure-class.ts`(全仓单源,零 effect 依赖;sandbox provisioning 分类共享这份词表) |
| turn 链决议 `resolveTurnFailureClass`、保守兜底分类器 `classifyTurnError`、受理证据门 `hasAgentEvidence`、`turnErrorText` / `turnFailureText`、`TurnFailure` / `TurnErrorClassifier` | `src/context/turn-errors.ts` |
| `Agent.classifyTurnError` 挂载面(`SandboxAgentDef` / `DirectAgentDef` / `Agent`) | `src/agents/types.ts`;经 `src/define.ts` 的 `defineSandboxAgent` / `defineAgent` 透传 |
| 重试执行体 `sendWithTurnRetry`(两层预算、指数全抖动退避、`ConcurrencySlot` 槽位释放、activity 与耗尽摘要) | `src/context/send-retry.ts` |
| 挂载点:包住 `agent.send(...)` 的那一次调用(非 otel / otel 两条路径) | `src/context/session.ts`(`SessionManager.sendSerialized` / `sendWithOtel`) |
| `concurrencySlot`(globalSem / 实验级 runSem 的临时释放/收回)从 run 级信号量到 context 的透传 | `src/runner/run.ts` → `src/runner/attempt.ts`(`runAttemptEffect` / `AttemptResources`)→ `src/context/context.ts`(`ContextDeps.concurrencySlot`) |
| `expectOk()` 的失败文本(`turnErrorText` 同源) | `src/context/context.ts`(`makeTurnHandle.expectOk`) |

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
| o11y 摘要与沙箱注入(`__niceeval__/results.json` 的原子 writer、写失败诊断与清理) | `src/o11y/derive.ts`(`buildO11ySummary`) → `src/o11y/sandbox-results.ts` → `src/context/session.ts`(send 后刷新) / `src/context/context.ts`(用户 Sandbox 命令前刷新) |
| codex 用量从 `turn.completed.usage` 抠出 | `src/o11y/parsers/codex.ts` |
| 用量 → 成本(实测优先 → 用户覆盖 → 内置 Run) | `src/o11y/cost.ts` |

## Sandbox([feature/sandbox/](feature/sandbox/README.md))

| 行为 | 文件 |
|---|---|
| `Sandbox` 统一接口 | `src/sandbox/types.ts`(`Sandbox`) |
| Docker provider(dockerode,node:24-slim,非 root,tar 上传) | `src/sandbox/docker.ts`(编排)+ `src/sandbox/docker-stream.ts`(exec 流解复用 / tar 工具) |
| Local provider(宿主机本地目录、零隔离;仓库根解析 / 显式 `dir`;`{ root: true }` 报错;`downloadDirectory` 复用 vercel/e2b 的 find+read 模板) | `src/sandbox/local.ts`(`LocalSandbox`) |
| 变更分类账 GIT_DIR / 导出目录的按 sandboxId 覆盖登记(local 用宿主侧每实例私有临时目录,避免同机多次运行互相踩踏;其余 provider 用固定沙箱内路径,不登记) | `src/sandbox/ledger-paths.ts`;消费端在 `src/runner/ledger.ts`(`gitEnv` / `createChangeLedger` / `buildExportScript`) |
| provider 级独占串行闸(`exclusive` 中性声明:`resolveSandbox()` 对 local 恒为 true,自定义 provider 由 `defineSandbox({ exclusive })` 声明;`--max-concurrency` / 实验级 `maxConcurrency` 都不解除) | `src/sandbox/resolve.ts`(`ResolvedSandbox.exclusive`)、`src/sandbox/types.ts`(`CustomSandboxSpec.exclusive`)、`src/runner/run.ts`(`providerExclusiveSems` / `exclusiveSemFor`) |
| 三 provider 共享工具(shellQuote / find 脚本构造 / 宿主文件遍历) | `src/sandbox/shell.ts`、`src/sandbox/local-files.ts` |
| `downloadDirectory`(vercel/e2b 共用的 find 列路径 + 逐文件二进制读取两阶段模板;docker 走 `getArchive` 单次 tar 取回,见上一行 docker-stream.ts) | `src/sandbox/download-directory.ts` |
| NiceEval 公共 E2B baseline 的具名版本钉死 ref、官方起点派生 factory、三模板统一的运行用户 npm global 契约 | `src/sandbox/e2b-agent-template.ts`(`NICEEVAL_*_E2B_TEMPLATE` / `PUBLISHED_E2B_BASELINE_TAG` / `e2bCodingAgentTemplate` / `verifyE2BNodeToolContract`)；发布构建与最终状态自检在 `sandbox/e2b/build-agent-template.mts`，已发布事实的台账在 `sandbox/e2b/published.json` |
| 官方基线制品的版本号(`<Agent 版本>-r<配方修订>`,niceeval 自身版本不参与) | `src/agents/coding-cli-versions.ts`(`AGENT_BASELINE_VERSION` / `AGENT_BASELINE_RECIPE_REVISION` / `agentBaselineVersionTag`)——同一批常量喂 Adapter 的运行时回退安装；一致性守护在 `src/sandbox/official-baselines.test.ts` |
| NiceEval 公共 Docker 基线镜像的具名 ref | `src/sandbox/docker-agent-image.ts`(`NICEEVAL_*_DOCKER_IMAGE`)；配方在 `sandbox/docker/Dockerfile`，按配方变更发布的 CI 在 `.github/workflows/docker-image.yml`；Agent 集合是完整的 `CodingAgentBaseline`，E2B 侧子集见 `E2BCodingAgent` |
| 显式 `SandboxSpec` 解析与 provider 实例创建(无默认值、无环境探测) | `src/sandbox/resolve.ts` |
| Provisioning 瞬时错误分类 + 退避重试(各 provider 的 `classifyProvisionError` 认原生限流,兜底走与文件 IO 共用的瞬时分类器 → `createProvider()` 统一重试) | `src/sandbox/errors.ts`、`src/sandbox/retry.ts`;各 provider 文件的 `classifyProvisionError` |
| `defineSandbox`(自定义 provider 逃生舱:`create()` 直接产出 `Sandbox` 实例,`resolve.ts` 里 `r.create` 优先于内置 backend switch) | `src/define.ts`、`src/sandbox/resolve.ts`(`createBackend`) |
| 沙箱编排固定段(变更分类账锚点 / 折叠 agent diff;起始文件上传是 `test()` 里的手工调用,不属于固定段) | `src/runner/sandbox-prep.ts` |
| 沙箱生命周期 Hook(`SandboxSpec.setup()` / `.teardown()` 链式方法、多 Hook 顺序、失败语义；`SandboxHook` / `SandboxHookContext` 从 `niceeval/sandbox` 公开导出) | `src/sandbox/types.ts`(`SandboxHooks<Self>`,类型定义);`src/sandbox/index.ts`(公开类型出口);`src/runner/attempt.ts`(setup 按注册序、同层 teardown 按 LIFO 调用) |
| 留存(`--keep-sandbox`):suspend 路由、detached 生命周期(inspect / wake / suspend / destroy)、provider 原生 enter 命令、留存提交时的 `expiresAt` 计算(vercel 写 `keptAt` + 默认 Run 保留期,e2b/docker 不写) | `src/sandbox/keep.ts`(`computeExpiresAt`、`suspendSandbox`;provider 名分支只在 sandbox/ 域内)+ 各 provider 的 `suspend()`(`src/sandbox/{docker,e2b,vercel}.ts`);写入点在 `src/runner/attempt.ts` 提交 `writeKeptEntry` 处。`suspendSandbox` 拿到的实例经过 `src/sandbox/resolve.ts`(`createSandbox`)的 `normalizeSandboxPaths()` 包装(`src/sandbox/paths.ts`)——这层必须把 `suspend`(与 `appendLog` 同类的接口外可选能力)原样转发,否则 in-run suspend 对三家 provider 全部找不到能力、留存永远停在 `alive`——踩坑记录见 memory [keep-sandbox-suspend-wrapper-drops-capability](../memory/keep-sandbox-suspend-wrapper-drops-capability.md)。`niceeval sandbox enter/history/diff` 的 detached 唤醒/回眠走独立的 `wakeDetached`/`suspendDetached`(不经过这层包装,直接按 provider 名 + `sandboxId` 重新连接实例)。 |
| `--keep-sandbox` 的创建前组合校验(自定义 provider、或内置但不在 `KEEPABLE_PROVIDERS` 里的 provider 如 local,统一报清晰错误) | `src/runner/attempt.ts`(`runAttemptEffect` 顶部,读 `resolveSandbox().create` / `KEEPABLE_PROVIDERS`) |
| 留存注册表(`.niceeval/sandboxes/` 逐条目原子文件、entry id 散列、向上发现 `.niceeval/`、条目级 lease) | `src/sandbox/keep-registry.ts`(+ 同目录 `.test.ts`) |
| `niceeval sandbox list/enter/history/diff/stop` 命令组 | `src/sandbox/cli-commands.ts`(`runSandboxCommand`;dispatch 在 `src/cli.ts`) |
| 创建期运行标识元数据(host/pid/startedAt;docker label / e2b metadata,与 `niceeval.keep-candidate` / provision token 同通道)、孤儿三条件判定(`classifyRunIdentity`:同宿主+pid 存活→整个排除、同宿主+pid 不存活→orphan、异宿主→unverified) | `src/sandbox/run-identity.ts` |
| `sandbox list --orphans` / `sandbox prune`(docker 按 label 查本地 daemon、e2b 按 metadata 过滤 SDK 列表,排除留存注册表条目;prune 幂等 + `--force` 语义,单台失败列出继续处理其余) | `src/sandbox/orphans.ts`(判定与销毁)+ `src/sandbox/cli-commands.ts`(`listOrphansCommand` / `pruneCommand` / `orphanReminder` 输出编排) |

## Assertions / Judge / Verdict

契约分别见 [Assertions](./feature/assertions/README.md)、[Judge](./feature/judge/README.md) 与
[Verdict](./feature/verdict/README.md)。当前实现仍集中在 `src/scoring/`，源码目录名不定义产品概念边界。

| 行为 | 文件 |
|---|---|
| 值断言匹配器(includes / equals / matches / similarity / satisfies / makeAssertion) | `src/expect/index.ts` |
| 作用域断言(succeeded / calledTool / event / fileChanged / notInDiff …) | `src/scoring/scoped.ts` |
| 断言收集器(延迟评估 + 链式 gate/soft/atLeast;`.points(n)` 挂在 `RecordHandle` 上——`finalize` 按 `n × score` 写进 `AssertionResult.points`;`AssertionCollector.score(label, n)` 立即记录 `ScoreEntry`,不像断言那样等 finalize 求值) | `src/scoring/collector.ts` |
| 计分制的前置中止(句柄上的 `.gate()` 使该断言就地求值并进入中止态,下一次 `t.*` 调用或 finalize 抛中止信号;matcher 自带/链上的 severity 只贡献 threshold,不触发中止) | `src/scoring/collector.ts`(`RecordHandle.gate` 的计分制分支、`t.*` 入口的待决前置结算)、`src/context/control-flow.ts`(中止异常) |
| 计分制题型(`defineEval`/`defineScoreEval` 分别定死 `EvalDef.scoring` 为 `"pass"`/`"points"`,禁止手写;`ScoreEvalDef` 的 `test(t)` 换成 `ScoreTestContext`) | `src/define.ts`(工厂函数)、`src/runner/types.ts`(`EvalScoring`、`EvalDef.scoring`、`ScoreEvalDef`、`EvalDescriptor.scoring`) |
| 给分词汇的类型分离(`ScoreAssertionHandle` 在 `AssertionHandle` 上加 `.points(n)` 并去掉 `.atLeast(x)`,`.points(n)` 的返回句柄只剩 `.gate()`/`.optional()`;`ScoreTestContext` 在 `TestContext` 上加 `t.score(label, n)` 并去掉 `t.require`;通过制 `t` 上没有给分词汇,类型层拒绝,不需要运行时守护) | `src/context/types.ts`(`ScoreAssertionHandle`、`ScoreTestContext`)、`src/scoring/types.ts`(`ScoreEntry`、`AssertionResult.points`) |
| 题型发现投影与实验同型校验(`evalDescriptorOf` 把 `EvalDef.scoring` 兜底为 `"pass"` 投影进 `EvalDescriptor`;`splitByScoring` 纯函数按题型分桶,检测不抛错) | `src/runner/eval-selection.ts` |
| 混型实验启动期报错(两桶都非空即报「两类 eval id + 收窄建议」并退出) | `src/cli.ts`(`splitByScoring` 调用点)+ `src/i18n/{en,zh-CN}.ts`(`cli.experiment.mixedScoring`) |
| `t.require` 中止语义(通过制的前置词;前置断言按 gate 记录,未过即抛 `EvalRequirementFailed`,`test()` 后续代码不再执行,已记录的断言决定判定;`runAttemptEffect` 捕获该异常时不设 `error`,verdict 走正常判定路径而非 errored。计分制的 `.gate()` 中止复用同一条异常与捕获分支) | `src/context/context.ts`(`require`)、`src/context/control-flow.ts`(`EvalRequirementFailed`)、`src/runner/attempt.ts`(捕获分支) |
| LLM-as-judge(OpenAI 兼容 /chat/completions;model/key 解析不到时记 `unavailable` 断言而非静默) | `src/scoring/judge.ts` |
| 判定规则(passed / failed / errored / skipped;非 optional 的 `unavailable` 断言 → errored;计分制 attempt 的 `failed` 只由前置中止产生,得分点丢分不参与判定) | `src/scoring/verdict.ts` |
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
| 变更分类账(workdir 外私有 git dir、锚点冻结排除清单、eval/agent 归因 commit、整相一条命令导出全部 send 窗口) | `src/runner/ledger.ts`(+ 同目录 `.test.ts`) |
| 指纹缓存((eval 源码闭包 + 运行配置) 哈希,携带以 attempt 为粒度——`planCarry` 逐条比较每个 attempt 自己的终态 + 指纹,产出 `carriedAttemptsByKey`(具体序号集合,不是整段 key 命中就携入);`run.ts` 的调度按这个具体序号集合跳过,缺失序号真实派发) | `src/runner/fingerprint.ts`(`planCarry`)、`src/runner/run.ts`(attempt 展开处按 `carriedAttemptsByKey.get(carryKey)?.has(i)` 跳过) |
| 强杀后的收尾登记(`.niceeval/teardowns/` 逐条目原子文件,与留存注册表同纪律)+ 启动自愈(触发 setup 前核对本实验自己的遗留登记、同宿主 pid 已死则先补执行一次 teardown 再走本次 setup、反馈标注 `recovery: true`)+ `--teardown` 独立入口 | `src/runner/teardown-registry.ts`(登记表原子写/读/删)、`src/runner/run.ts`(`recoverStaleTeardownRegistration` / `ensureExperimentSetup` / `runExperimentTeardown` 的磁盘镜像写入与删除)、`src/cli.ts`(`--teardown` 分支 + 未选中实验的遗留提醒) |
| reporter 编排 + 运行级汇总 + eval 级 reporter 作用域(scopeReporter / filterSummary)+ required/best-effort 兜错(runReporter) | `src/runner/report.ts` |
| remote 占位 Sandbox / eval 级本地路径视图(Proxy) | `src/runner/remote-sandbox.ts` |
| 反馈 coordinator(形态解析、纯 reducer、human/json renderer、终端 sink、可注入 FeedbackIO) | `src/runner/feedback/{profile,reducer,renderer,human,json,sink,coordinator,io,testing,index}.ts` |
| 终端框线渲染件(区域框契约的唯一物理实现:宽度上限 100、边框嵌字与「先保标题后保 meta」截断次序、嵌套 Section 降横隔、非 TTY/窄终端降级为无框文本;同步纯函数,不做 IO)+ 三处消费方 | `src/report/model/panel.ts`(`renderPanel` + `encodeDividerLine`/`decodeDividerLine`/`rowsFromBodyText` 的嵌套桥接);消费方:`src/report/definition/primitives.tsx`(`Section` text 面,`panelMode` 经 `TextContext`/`HostTextRenderOptions` 从 `niceeval show` 的真实 TTY/`NO_COLOR` 探测注入)、`src/runner/feedback/human.ts`(PLAN/live 面板/`FAILED`·`PASSED`/`FAILURES`/`KEPT SANDBOXES`/`NEXT`,`panelCapabilityOf(io)` 按 `io.stderr.isTTY` + `io.env.NO_COLOR` 判定)、`src/sandbox/cli-commands.ts`(`list`/`history`,启动时探测一次) |
| 机器 / 平台 reporter(Artifacts / Json / JUnit(同目录 temp→rename 原子写)/ Braintrust) | `src/runner/reporters/{artifacts,json,braintrust,index}.ts` |
| eval 级折叠 / 计票口径(CLI 退出码与 view 共用) | `src/shared/verdict.ts` |
| 本地结果保存格式(Run 目录 `.niceeval/<experiment>/<run>/run.json` + attempt 级 `result.json` / JSON artifact;fresh attempt 调度前即生成最终 `locator`,与 Artifacts writer 共用同一个 `snapshotStartedAt`) | `src/runner/reporters/artifacts.ts`(reporter 薄壳,按 experimentId 路由到 Run writer)、`src/record/writer.ts`(`createWriter`;写入面收窄类型 `AttemptEntry = Omit<EvalResult, …>`)、`src/record/types.ts`(`RunMeta`)、`src/runner/types.ts`(`EvalResult`——architecture.md `result.json` 一节里的 `AttemptRecord` 是该持久化形状的文档概念名,对应的运行时类型就是它;同文件的 `RECORD_SCHEMA_VERSION` / `RECORD_FORMAT` 常量随 `EvalResult` 同址声明,经 `src/types.ts` facade 转出给 `src/record/` 域 import,不在 `src/record/types.ts` 里重新声明)、`src/runner/run.ts`(locator 生成点) |
| `EvalResult.scoring`(取 `evalDef.scoring` 兜底 `"pass"`)与 `scoreEntries`(仅 `scoring: "points"` 时落,取 `collector.scoreEntries`)的落盘接线 | `src/runner/attempt.ts`(`runAttemptEffect` 组装 `EvalResult` 处) |
| CLI(exp / show / list / view / clean / init,--help,parseArgs 表驱动,.env 加载,输出形态解析;调度项没有环境变量层,见[配置与凭据边界](architecture.md#配置从代码来凭据从环境来)) | `src/cli.ts` |
| `niceeval show` 终端宿主(Sample 合成「现刻水位」、--history 逐 experimentId+evalId 分节的 attempt 执行时间轴、--report/--page 经 report/runtime/host.ts 装载 + 组合语义矩阵、证据切面 --source/--execution/--diff) | `src/show/{index,compose,render,command}.ts` + `src/report/runtime/host.ts`(两宿主共用) |
| 测试集加载器(loadJson / loadYaml) | `src/loaders/index.ts` |

## Record / Sample Lib 与 Reports

设计文档：[feature/record/](feature/record/README.md) / [feature/reports/](feature/reports/README.md) 合流一节。
实现落点中，show 与 view 共用 `--report` 装载；裸宿主装载同一份内建报告，并各选对应渲染面。
两个宿主的 Sample 都由中性的 `selectLatestPerEval` 产出：

三层的数据形状与各层操作画在[Reading](feature/reading/README.md)的总图上,这里只给同一条链路的
文件落点。

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
③  src/report/model/{metrics,aggregate,flag}.ts  值怎么算、两级怎么折叠
    src/report/model/types.ts                    当前数据契约(MetricCell / *Data)
    src/report/components/*/compute.ts           当前组件计算函数
    src/report/definition/tree.ts                resolveReportTree + 渲染前树校验
    src/report/definition/report.ts              defineReport / 外壳与页列表
  │
  ├─ text 面  src/report/runtime/text.ts  →  src/show/*   宿主
  └─ web 面   src/report/runtime/web.ts   →  src/view/*   宿主
              两宿主共用装载 src/report/runtime/{load,host}.ts
```

| 行为 | 文件 |
|---|---|
| `openRecord`:实验/Run/eval 分层、版本分流(三种 unreadable 原因)、懒加载(attempt 目录→artifactBase 携带条目回退) | `src/record/open.ts` |
| 布局与版本知识(attempt 目录规则、Run 分类、完整 producer) | `src/record/format.ts` |
| `latestRunSample(record)` / `currentSample(record)`、`Sample.scope` / `.filter` / `.freshOnly`、`dedupeAttempts` 与 `SampleIssue` | `src/sample/index.ts` |
| `createWriter`(Run 目录独占创建、Run 级元数据落盘、attempt 记录与 artifact 增量落盘、`finish()` 补 `completedAt`) | `src/record/writer.ts` |
| `publish`(发布原语:计划 → 预检 → 复制,knownEvalIds 补记) | `src/record/copy.ts` |
| 发布预算常量(50 MiB 单文件预检上限) | `src/record/publish.ts` |
| 落盘截断(单值 256 KiB 上限,events / spans 写入前截断并标记) | `src/record/truncate.ts` |
| 分层契约(Experiment / Run / Eval / AttemptHandle(含 `carried` 携带条目投影)/ AttemptRef / Sample(含 `coverage: SampleCoverage[]`)/ issue 类型) | `src/record/types.ts` |
| `defineMeasure` 与内置读数 | `src/report/model/metrics.ts`(定义)、`src/report/index.ts`(公开导出) |
| `sampleSummary()` / `SampleSummaryContent` | `src/report/components/summaries/compute.ts`、`summaries/{ScopeSummary.tsx,faces.ts}` |
| `flag()`(experiment flags 当维度 / 轴) | `src/report/model/flag.ts` |
| 两级聚合引擎 / 维度 / `MeasureCell` 计算 / 聚合前去重接线 | `src/report/model/aggregate.ts` |
| 数据契约(`Measure`、`TableData` / `MatrixData` / `ScatterData` / `LineData` / `ScoreboardData` / `DeltaData` / `SampleSummaryContent` 等) | `src/report/model/types.ts` |
| 报告 chrome 文案的 locale 字典；`MeasureCell.display` 生成面 | `src/report/model/locale.ts` |
| 元素树 / `defineComponent`(双面)/ 渲染前树校验 / text 遍历渲染 | `src/report/definition/tree.ts` |
| 组件数据解析 pass(`resolveReportTree`:装载规范化产物之后、render 之前递归遍历树;遇到 spec 形态组件就调它自己的解析面(代调配套 `*Data` 计算函数)并换成 data 形态 props,同层 sibling 并行、保持节点顺序;text/web 两面 × 整份报告/单页两种粒度的四个渲染入口都先跑它,报告作者因此不用手写取数) | `src/report/definition/tree.ts`(`resolveReportTree`;被 `src/report/runtime/text.ts` 与 `src/report/runtime/web.ts` 调用) |
| 排版原语 Row / Col / Grid / Section / Stat / Text / Style / Tabs / Tab / Table（十个内置双面组件；Table 的 text 面在 `src/report/definition/table-text.ts`、官方表状组件共用；`Tab` 只能直接放在 `<Tabs>` 下，不参与路由、没有 id） | `src/report/definition/primitives.tsx`（Grid / Stat 的两面适配）+ `src/report/definition/grid-layout.ts`（`normalizeGrid` 展平、`balanceColumns` / `planGridColumns` / `gridContainerRules` / `planTextGrid` 两面同源列数算术；同步纯函数，不 import show / view、Results IO 或 stylesheet） |
| 文本排版工具箱(`stringWidth` / `padEnd` / `padStart` / `wrapText` / `indent` / `bar` / `columns`,从 `niceeval/report` 导出;跨组件族共用,不属于任一组件族) | `src/report/model/text-layout.ts` |
| `defineReport` / `ReportShell` / `ReportPage` / `buildReportMeta` / `resolveReportTitle`(报告外壳与页列表的规范化,与宿主装载方式无关) | `src/report/definition/report.ts` |
| text 宿主装载入口 `pickReportPage` / `ReportHostContext` / `renderReportToText`(选页 → `resolveReportTree` → 校验 → text 渲染;宿主不设树外警告通道——挑选警告的唯一呈现件是页内 `SampleWarnings` 组件,按动作聚合层在 `src/report/components/site-components/scope-warnings.ts`,web/text 两面共用)/ 逐页 text 入口 `renderReportTreeToText`(两宿主共用的联系面调用)/ `ReportPageNotFoundError`(`--page` 未命中)/ `ReportPageNeedsLocatorError`(attempt-input page 缺 locator) | `src/report/runtime/text.ts` |
| `--report` 装载(两宿主共用:存在性/默认导出判别、dev server 的 mtime cache-busting) | `src/report/runtime/load.ts` |
| show 宿主接线(无条件调 `currentSample` 产出 Sample、裸跑装载 `niceeval/report/built-in` 默认导出的 text 面、`--report`/`--page` 经 `report/runtime/host.ts` 装载自定义 text 报告、attempt locator 下钻;多页时选初始页——`--page` 指定或缺省第一页——的逻辑在 `src/show/index.ts`,渲染完初始页后由 `src/show/render.ts` 的 `otherPagesText` 在尾部追加「其余页」索引与可复制命令) | `src/show/index.ts`(现刻水位选择器在中性的 `src/sample/index.ts`;单 Eval、Attempt 详情与证据切面渲染在 `src/show/render.ts`;`src/show/compose.ts` 只留 `--history` 逐 attempt 执行时间轴口径;两宿主共用的报告装载规范化/标题回退在 `src/report/runtime/host.ts`;show 专属的可复制命令拼装 `showCommand` 在 `src/show/command.ts`;测试 `src/show/show.test.ts`、`src/show/command.test.ts`、`src/report/runtime/host.test.ts`) |
| web 宿主装载入口 `renderReportToStaticHtml`(唯一 import react-dom 的一侧;同样选页 → `resolveReportTree` → 校验 → web 渲染,同样不设树外警告前置块)/ 逐页 web 入口 `renderReportTreeToStaticHtml` | `src/report/runtime/web.ts` |
| 当前内建报告；目标将专用叶子改成 `Callouts source={sampleWarnings}`、`Table source={attemptRows}` 等原语 + 数据源，并把 `ExperimentComparison` 改为 `SampleOverview` | `src/report/built-in/standard.tsx`、`src/report/built-in/index.tsx` |
| 当前跨组件共享辅助与 `MeasureCellView`；目标原语只消费通用 Cell / Content | `src/report/components/shared.ts` + `shared-compute.ts` + `shared-faces.ts` + `cell.tsx` |
| `sampleSummary()` / `SampleSummary` | `src/report/components/summaries/compute.ts`、`summaries/{index.tsx,ScopeSummary.tsx,faces.ts}` |
| `SampleOverview` | `src/report/components/summaries/index.tsx` |
| `experimentRows` / `evalRows` / `attemptRows` 数据源与仍在迁移中的专用组件 | `src/report/components/entity-lists/{compute.ts,index.tsx,faces.ts}` |
| `measureRows` / `measureMatrix` / `scoreboard` / `deltaRows` / `stabilityRows` 数据源、`Table` 原语与仍在迁移中的专用组件 | `src/report/components/metric-views/{compute.ts,index.tsx,faces.ts}` |
| 图表族当前结构树解析、`chartData(input, spec)` 与 `ChartData`、轴值域推定、字符坐标图 text 面 | `src/report/components/metric-views/`(`compute.ts` / `chart-math.ts` / `plot.ts` / `faces.ts`) |
| Attempt 详情组件族:11 个叶子(`AttemptSummary` / `AttemptError` / `AttemptAssertions` / `AttemptSource` / `AttemptFixPrompt` / `AttemptTimeline` / `AttemptConversation` / `AttemptDiagnostics` / `UsageTable` / `AttemptTrace` / `AttemptDiff`,均以 `AttemptEvidence` 为输入的双面组件)+ 2 个组合(`AttemptAssessment`、`AttemptDetail`,只用公开叶子装配、没有私有 renderer) | `src/report/components/attempt-detail/index.tsx`(计算在 `compute.ts`,每叶子一个 `attempt*Data(evidence)`/`usageTableData(evidence)`;text 面在 `faces.ts`;测试 `attempt-components.test.tsx`) |
| `AttemptAssertions` 的计分制字段；目标由 `attemptAssertions` 数据源产出 `TableContent` | `src/report/components/attempt-detail/compute.ts`(`attemptAssertionsData`、`groupByPath`)、`AttemptAssertions.tsx`、`faces.ts`、`src/report/model/format.ts` |
| 站点组件(`Hero` / `HeroCard` / `PoweredBy` / `SampleWarnings` / `CopyFixPrompt` / `TraceWaterfall`;品牌、hero、警告区、批量修复 prompt、trace 瀑布都是页内组件,宿主不渲染任何对应 chrome) | `src/report/components/site-components/index.tsx`(定义;计算在 `compute.ts`;text 面在 `faces.ts`;警告按动作聚合在 `scope-warnings.ts`,两面共用;测试 `site-components.test.tsx`) |
| 当前官方专用组件 web 面 + 页级色分配；目标收敛为通用原语 renderer | `src/report/components/{summaries,entity-lists,metric-views}/*.tsx` + `src/report/assets/colors.ts` + `styles.css`；公开入口 `src/report/react/index.tsx` |
| 渐进增强 runtime(表头排序 / 行过滤 / hover tooltip,只作用于 `.niceeval-report` 与 `data-niceeval-*`;宿主内联) | `src/report/assets/enhance.js` |
| 双面验收(renderToStaticMarkup + text Run,两面同口径) | `src/report/runtime/dual-render.test.tsx` |
| view attempt 深链(`#/attempt/@<locator>`,路由参数是不透明的 `AttemptLocator`,与报告槽 `ctx.attemptHref` 同一格式) | `src/view/app/lib/attempt-dialog.ts`(hash ↔ locator 互转、`attempt/<locator>.html` 链接拦截与 dialog 内容抠取)、`src/view/app/App.tsx`、`src/view/data.ts`(`annotateResult` 注入,locator 直接用 `niceeval/record` 的 `attempt.locator`)、`src/view/shared/types.ts`(`ViewEvalResult.locator` 类型来自 `src/record/locator.ts`) |
| view 数据层(openRecord;`__NICEEVAL_VIEW_DATA__` 只携带证据室数据:Run 明细 + skipped + 壳元信息(含报告外壳/页导航的 `ViewReportMeta`),统计住报告页)。`latestRunSample(record)` 结果(命名为 `latestPerExperiment`)只用于给证据室 Run 打「latest」标记,与报告槽 Sample 是两条独立通道,不参与报告计算;`viewData.snapshots` 是完整记录根的全量通道,只服务 attempt 详情路由(`#/attempt/@<locator>`)的解析,不随报告 Sample 收窄 | `src/view/data.ts`(数据契约在 `src/view/shared/types.ts`) |
| view 报告槽与导航(裸跑装载内建报告默认导出、`--report` 整槽替换、`--page` 定初始页;报告槽 Sample 由 view 直接调 `currentSample` 产出;报告装载/规范化/标题回退经两宿主共用的 `src/report/runtime/host.ts`;`renderReportSlot` 逐页静态渲染、en/zh-CN 两遍烘成 `<template id="niceeval-report-<pageId>-<locale>">` 静态块;导航项 = 报告页列表(声明序),路由只有 `#/page/<id>` 与 attempt 详情 `#/attempt/@<locator>`,宿主不追加导航项、不渲染 hero/警告横幅等任何页面内容 chrome(`App.tsx` 的 `BRAND_HREF` 恒渲染的页头 NiceEval 字标除外——那是宿主保留的机器位,与页面内 `PoweredBy` 品牌行分属两处),浏览器 `<title>` 是宿主保留的文档单例;外壳 styles/scripts 按声明序注入、增强 runtime 与官方样式内联、输入判定 `resolveViewInput`(`--record`/`--run` 互斥,位置参数只表示 eval id 前缀)) | `src/view/data.ts`、`src/view/server.ts`、`src/view/index.ts`、`src/report/runtime/host.ts`(两宿主共用,不属于 show)、前端摆放 `src/view/app/{main.tsx,App.tsx}`(测试 `src/view/view-report.test.ts`;渲染出的导航结构与外壳 chrome 归 `docs/engineering/testing/e2e/report.md` 对真实产物验收) |
| **Roadmap(未定落点)** | memory-evals 静态导出流水线(reports.md 场景三) |

## 与目标契约的已知实现差异

本节只记录实现差异。Feature 文档仍是目标契约；这里的当前名称和路径用于定位源码，
不反向限制目标 API。

### P1：报告与宿主

- **Reports 仍有专用组件残留。** `SampleOverview`、`SampleSummary`、`defineMeasure`、`Source` 与
  通用 `Table` 已经形成公开面，但实体列表和指标视图还保留专用组件及其计算函数。通用数据源与
  原语尚未完全替代这些实现。

### P2：制品
- **E2B 公共 baseline 尚未换代。** 配方和构建校验已修，但公开常量与
  `sandbox/e2b/published.json` 仍指向旧 `v0.6.1`。需要真实构建、以运行用户验证、发布新 tag，
  再同步台账与常量。

### 已从差异清单删除

- `commands.json` 的核心采集、落盘、读取、publish 与 Attempt 展示已经存在；只剩 View 静态导出漏复制。
- `currentSample()` 已保留真实贡献 Run，并直接使用这些事实实体。
- feedback 的 agent / ci 机器面已合并为 `json.ts`。
- 宽 `TestContext` + runtime guard 已与目标契约一致。
- hooks、keep-sandbox、orphans、error-classification 与 Verdict 主折叠没有新的结构性 gap。
- view 的项目侧监听已收窄到报告 / 主题 / 项目配置及其静态 import 闭包
  （`src/view/server.ts` 的 `projectWatchTargets` 与 `ProjectFileWatcher`）。
