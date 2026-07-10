export const zhCN = {
  "agent.installFailed": "安装失败:{{key}}\n{{tail}}",
  "agent.unknown": "未知 agent \"{{name}}\"。已注册:{{known}}。",
  "agent.diagnose.exitCode": "agent 运行退出码 {{code}}",
  "agent.diagnose.lastError": "最后错误:{{message}}",
  "agent.diagnose.noTranscript": "transcript 未生成",
  "agent.diagnose.outputTail": "输出末尾:{{tail}}",
  "agent.diagnose.zeroEvents": "transcript 存在但 0 事件",
  "bub.homeDetectFailed": "无法探测沙箱 $HOME(printf $HOME 输出为空)。不兜底到后端专属固定路径,请检查沙箱后端。",
  "bub.installFailed": "bub 安装失败(重试 {{attempts}} 次):\n{{tail}}",
  "bub.setupNotRun": "bub adapter 的 setup() 尚未在该沙箱运行(缺 home/workspace 信息);运行器应先调 setup 再 send。",
  "checkpoint.emptyTar": "checkpoint: tar 为空(paths: {{paths}})",
  "cli.all": "(全部)",
  "cli.browserOpenFailed": "无法自动打开浏览器,请手动访问:{{url}}\n",
  "cli.clean.done": "已删除 .niceeval/ 历史运行工件。\n",
  "cli.config.missing":
    "找不到 niceeval.config.ts。\n" +
    "修法:\n" +
    "  - [init] 运行 `npx niceeval init` 生成 niceeval.config.ts 和 evals/\n" +
    "  - [cd] 切到包含 niceeval.config.ts 的项目根再运行\n" +
    "  文档:node_modules/niceeval/docs-site/zh/quickstart.mdx",
  "cli.config.noDefault": "niceeval.config.ts 需要 default export(defineConfig(...))。",
  "cli.dry.header": "\n[dry] {{evals}} 个 eval × {{configs}} 个运行配置:\n",
  "cli.dry.noMatches": "(无匹配)",
  "cli.dry.row": "  {{who}}{{experiment}}: {{evals}}  ×{{runs}}\n",
  "cli.error": "niceeval 出错:{{error}}\n",
  "cli.flag.invalidNumber": "标志 --{{flag}} 需要数字,收到 \"{{value}}\"。\n",
  "runner.budgetUnenforceable":
    "{{budgetKey}} 的 budget:连续多个 attempt 完成后都拿不到成本数据(agent 不上报用量且模型不在价格表)——该 agent 的 budget 无法执行,取消护栏继续跑。\n",
  "judge.modelMissing":
    "judge 未配置模型:在 defineConfig({ judge: { model: \"...\" } })、eval 的 judge 配置或环境变量 NICEEVAL_JUDGE_MODEL 里指定评判模型(没有内置默认模型)。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/guides/scoring-guide.mdx",
  "loaders.yamlMissing":
    "loadYaml(\"{{path}}\") 需要 YAML 解析器:请先 `pnpm add yaml`(或改用 loadJson + JSON 数据集)。",
  "cli.flag.parseError": "{{message}}\n运行 `niceeval --help` 查看用法。\n",
  "cli.envInvalidNumber": "环境变量 {{name}} 不是数字:\"{{value}}\"。\n",
  "cli.help":
    "niceeval — agent-native evals\n\n" +
    "用法:\n" +
    "  niceeval exp [组|实验] [eval-id 前缀…]   跑实验\n" +
    "  niceeval show [eval-id 前缀…]            终端读结果\n" +
    "      裸跑:每个 experiment 的现刻判决(跨 run 合成)\n" +
    "      单个 eval id:attempt 与断言明细\n" +
    "      --transcript / --trace / --diff[=文件]   单 eval 的证据切面\n" +
    "      --history   跨 run 时间轴(与 --report 互斥)\n" +
    "      --run <目录> 钉死结果目录   --experiment <id> 只看该实验\n" +
    "      --attempt <n> 指定 attempt   --report <文件> 自定义报告\n" +
    "  niceeval list                            列出发现到的 eval\n" +
    "  niceeval view [eval-id 前缀…|summary.json] [--out 目录] [--port n] [--no-open]\n" +
    "      报告槽 + 证据室;--report <文件> 整槽换成自定义报告(与 show 同一文件)\n" +
    "      --run <目录> 钉死结果目录   --experiment <id> 只看该实验\n" +
    "      --out <目录> 静态导出:index.html 连同查看器工件,可直接静态托管\n" +
    "  niceeval clean                           删除 .niceeval/ 历史工件\n" +
    "  niceeval init                            脚手架 config + evals/\n\n" +
    "标志:\n" +
    "  --runs n  --max-concurrency n  --timeout ms  --budget usd  --tag t\n" +
    "  --early-exit / --no-early-exit  --strict  --force  --dry  --quiet\n" +
    "  --junit path  --json path  --out dir  --port n  --open / --no-open  -h, --help  -v, --version\n\n" +
    "位置参数只选「跑哪些 eval」(id 前缀);对着哪个 agent、怎么跑来自 experiments/ 与\n" +
    "标志。环境变量覆盖(标志 > 环境变量 > config):\n" +
    "  NICEEVAL_RUNS  NICEEVAL_MAX_CONCURRENCY  NICEEVAL_TIMEOUT  NICEEVAL_BUDGET\n",
  // show 的错误文案保持英文(错误文案英文的仓库约定);noResults 是提示,翻译。
  "cli.show.noResults": "{{root}} 下没有结果。先 `niceeval exp` 跑一轮,再 `niceeval show`。\n",
  "cli.show.runDirMissing": "Results directory not found: {{dir}}\n",
  "cli.show.noEvalMatch": "No results matched: {{patterns}}. Evals with results: {{evals}}\n",
  "cli.show.noExperimentMatch": "No experiment matched --experiment {{arg}}. Experiments with results: {{experiments}}\n",
  "cli.show.historyReportConflict":
    "`--history` and `--report` are mutually exclusive: --history is the built-in trend view. For a custom trend, compose exp.snapshots inside your report file instead.\n",
  "cli.show.evidenceNeedsEval":
    "--transcript / --trace / --diff show one eval's evidence, but the selection matched {{matched}} evals. Narrow to a single eval id first: niceeval show <eval id> --transcript\n",
  "cli.show.attemptNeedsEval":
    "--attempt picks one attempt of a single eval; pass a full eval id (and --experiment when several experiments ran it).\n",
  "cli.show.attemptNotFound": "Attempt {{attempt}} not found for {{evalId}}. Available attempts: {{available}}\n",
  "cli.eval.noMatch": "没有匹配的 eval:{{patterns}}。\n",
  "cli.eval.noMatchHintExperiment": "提示:\"{{pattern}}\" 是实验{{kind}},你大概想跑:niceeval exp {{pattern}}\n",
  "cli.eval.noMatchKnown": "已发现 {{count}} 个 eval:{{evals}}\n",
  "cli.exp.agentModelFlagUnsupported": "`--agent` / `--model` 不能覆盖 experiment。请在 experiments/ 里新增或复制一个配置文件。\n",
  "cli.experiment.noMatch": "没有匹配的实验:{{arg}}。已发现:{{experiments}}\n",
  "cli.experimentGroup": "组",
  "cli.fallbackCleanupTimeout": "\ngraceful 清理超时,强制清理沙箱…\n",
  "cli.forceCleanupExit": "\n强制清理沙箱并退出…\n",
  "cli.init.done": "已就绪:evals/、niceeval.config.ts,以及 AGENTS.md 里的 niceeval agent 指引区块(指向 node_modules/niceeval/docs-site/zh)。\n",
  "cli.interruptCleanup": "\n收到中断,正在清理沙箱容器…(再按一次强制清理并退出)\n",
  "cli.list.header": "发现 {{count}} 个 eval:\n",
  "cli.noAgent": "未指定 agent(用 --agent <name>)。\n",
  "cli.none": "(无)",
  "cli.pressCtrlC": "按 Ctrl+C 退出。\n",
  "cli.resultsPath": "结构化结果:{{path}}(每条结果的 artifactsDir 下是该次 attempt 的 events.json / trace.json / diff.json)\n",
  "cli.run.experimentRequired":
    "运行 eval 必须通过 experiment:用 `niceeval exp [实验组|配置] [eval id 前缀]`。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/guides/write-experiment.mdx\n",
  "cli.run.experimentRequiredHint": "提示:\"{{pattern}}\" 是实验{{kind}},你大概想跑:niceeval exp {{pattern}}\n",
  "cli.run.experimentRequiredKnown": "已发现实验:{{experiments}}\n",
  "cli.unimplemented": "命令 \"{{command}}\" 暂未实现(MVP)。\n",
  "cli.view.exportedDir": "已导出静态查看站:{{out}}(整个目录可直接静态托管;本地打开 {{out}}/index.html 需经 http 服务,file:// 下工件 fetch 不可用)\n",
  "cli.view.incompatible": "{{dir}}: 由 niceeval {{producer}} 写入(schemaVersion {{schemaVersion}}),当前 CLI 只读 schemaVersion {{supported}}。\n运行 `{{command}}` 查看这份报告。\n",
  "cli.view.noResults": "{{root}} 下没有结果。先 `niceeval exp` 跑一轮,再 `niceeval view`。\n",
  "cli.view.incompatibleForeign": "{{dir}}: 由 {{name}} {{version}} 写入(schemaVersion {{schemaVersion}}),当前 CLI 只读 schemaVersion {{supported}}。\n请用写出它的那个工具查看这份报告。\n",
  "cli.view.url": "niceeval view: {{url}}\n",
  "context.capabilityMissing":
    "agent \"{{agent}}\" 不是沙箱型(defineSandboxAgent 构造),t.{{method}} 这类断言只有沙箱型 agent 可用。换用 defineSandboxAgent 构造的 agent,或去掉这条断言。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/guides/sandbox-agent.mdx",
  "context.skipEmpty": "skip() 需要一个非空理由。",
  "context.turnFailed": "本轮 send 返回 failed(turn status = failed):{{message}}",
  "context.turnFailedDefault": "本轮 send 返回 failed(turn status = failed)",
  "define.agentNameRequired": "defineAgent 需要 name。",
  "define.evalIdRejected": "defineEval 不接受 id —— id 由文件路径推导。",
  "define.evalTestRequired": "defineEval 需要一个 async test(t) 函数。",
  "define.experimentAgentRequired": "defineExperiment 需要 agent。",
  "define.experimentIdRejected": "defineExperiment 不接受 id —— id 由文件路径推导。",
  "define.sandboxAgentNameRequired": "defineSandboxAgent 需要 name。",
  "define.sandboxCreateRequired": "defineSandbox 需要一个 create() 函数。",
  "define.sandboxNameRequired": "defineSandbox 需要 name。",
  "docker.commandTimeout": "Command timed out after {{timeoutMs}}ms",
  "docker.containerNotInitialized": "Container not initialized",
  "docker.imagePullDone": "Docker image ready: {{image}}",
  "docker.imagePullStart": "Pulling Docker image: {{image}}...",
  "docker.readFileFailed": "Failed to read file {{path}}: {{stderr}}",
  "docker.unsupportedRuntime": "Unsupported runtime: {{runtime}}",
  "hitl.answerNeedsOptionOrText": "t.respond 的对象形式需要 optionId 或 text 二选一(两者都没给)。",
  "hitl.invalidOption": "回答 \"{{optionId}}\" 不是请求 {{requestId}} 的可选项({{options}})。",
  "hitl.noOptions": "该请求没有可选项",
  "hitl.requestMissingId": "该 input.requested 请求没有稳定的 id,无法生成 responses——adapter 侧要给每条待回答请求一个稳定 id。",
  "hitl.respondAllEmpty": "没有待回答的 input.requested 请求,respond() / respondAll() 无法工作;先用 t.parked() 确认停轮,再用 t.requireInputRequest() 或 t.respond() 回答。",
  "hitl.respondEmpty": "t.respond(...) 至少需要一个回答。",
  "hitl.stringAmbiguous": "有 {{count}} 条待回答请求,字符串回答无法对位,请用 { request, optionId } 或 { request, text } 对象形式显式指名。",
  "judge.apiKeyMissing": "judge 缺少 API key(CODEX_API_KEY / OPENAI_API_KEY)。",
  "judge.httpError": "judge HTTP {{status}}: {{body}}",
  "judge.probeFailed": "judge 预检失败({{model}}): {{error}}",
  "judge.probeMissingKey": "judge 模型 {{model}} 缺少 API key —— 请配置 {{envHint}}",
  "live.more": "… 其余 {{hidden}} 项({{running}} 运行中 · {{waiting}} 等待 · {{done}} 已完成)",
  "live.running": "  正在运行 {{totalRuns}} 次 ({{evals}} eval × {{configs}} 配置, 并发 {{concurrency}})       {{completed}}/{{total}} 完成",
  "live.runningUnknown": "  正在运行…  {{completed}}/{{total}} 完成",
  "live.waiting": "排队等待中…",
  "report.assertionThreshold": " (得分 {{score}} < {{threshold}})",
  "report.error": "错误",
  "report.errored": "错误",
  "report.failed": "失败",
  "report.gate": "gate",
  "report.passed": "通过",
  "report.result": "\n结果:{{parts}}  ({{duration}} · {{tokens}}{{cost}})\n\n",
  "report.runStart": "\n本次运行 {{count}} 个 eval{{extra}}(并发 {{concurrency}})\n\n",
  "report.runStartExtra": " × {{configs}} 配置 = {{totalRuns}} 次运行",
  "report.viewHint": "运行 `pnpm exec niceeval view` 以图形化查看结果。\n",
  "report.skipped": "跳过",
  "report.soft": "soft",
  "report.summary.errored": "{{count}} 错误",
  "report.summary.failed": "{{count}} 失败",
  "report.summary.passed": "{{count}} 通过",
  "report.summary.skipped": "{{count}} 跳过",
  "report.table.agent": "Agent",
  "report.table.avgDuration": "平均耗时",
  "report.table.cost": "预估成本",
  "report.table.default": "默认",
  "report.table.duration": "耗时",
  "report.table.eval": "Eval",
  "report.table.evalTitle": "各 Eval:",
  "report.table.experiment": "实验",
  "report.table.experimentsTitle": "实验",
  "report.table.model": "模型",
  "report.table.reason": "原因",
  "report.table.result": "结果",
  "report.table.runs": "轮次",
  "report.table.status": "状态",
  "report.table.successRate": "成功率",
  "report.table.tokens": "Tokens",
  "otel.noSpans": "otel:本轮 0 span —— 端点没接上?(env 没注入 / 服务没重启 / 没 flush)",
  "otel.portInUse": "OTLP 接收端口 {{port}} 已被占用(另一个进程占着这个端口)。在 defineConfig({ telemetry: { port } }) 里换一个空闲端口,或者停掉占用 {{port}} 的进程后重试。",
  "otel.windowAttribution": "otel:span 未带本轮 traceparent,按时间窗口归属(该 agent 的轮次已串行;应用支持 W3C 传播后自动并发)",
  "runner.diffProgress": "采 diff:{{changed}} 改 / {{deleted}} 删",
  "runner.driveAgent": "驱动 agent…",
  "runner.evalSetup": "eval setup(装依赖)…",
  "runner.interrupted": "  · 已中断:沙箱容器已清理,输出本次已完成的部分结果。\n",
  "runner.judgePrecheck": "  · 预检 judge 配置…\n",
  "runner.otlpInSandbox": "OTLP in-sandbox collector → {{endpoint}}{{proto}}",
  "runner.otlpOverride": "OTLP 接收器(覆盖 host) → {{endpoint}}",
  "runner.otlpReceiver": "OTLP 接收器 → {{endpoint}}{{proto}}",
  "runner.otlpShared": "OTLP 共享接收器(run 级) → {{endpoint}}",
  "runner.remoteSandboxUnavailable": "remote agent 没有 sandbox.{{method}};请改用 sandbox agent 或移除 workspace 断言。",
  "runner.reporterDiagnostic": "  · [diagnostic] {{stage}} 失败(已忽略):{{message}}\n",
  "runner.scoreJudge": "评分 / judge…",
  "runner.skip": "skip:{{reason}}",
  "runner.startAgentSetup": "agent setup(装 CLI / 写配置)…",
  "runner.startAgentTracing": "agent tracing(写 otel 导出配置)…",
  "runner.startSandbox": "起沙箱…",
  "runner.timeout": "attempt 超时({{timeoutMs}}ms)\n最近进度:\n{{recentLogs}}",
  "runner.traceSelected": " → 留 {{count}}(按语义)",
  "runner.resumeCarry": "  · 复用上次 {{carried}} 个通过的结果,重跑 {{retry}} 个 eval\n",
  "runner.resumeCarryDetail": "      复用 [{{experiment}}] {{evals}}\n",
  "runner.useRemoteAgent": "使用 remote agent(不创建沙箱)…",
  "sandbox.backendNotImplemented": "{{backend}} sandbox backend not implemented; use docker, vercel, or e2b",
  "sandbox.missingSpec":
    "沙箱型 agent 需要一个 sandbox,但没有提供。niceeval 不再自动选默认后端——请在 defineExperiment()/defineConfig() 里把 sandbox 设成 dockerSandbox() / vercelSandbox() / e2bSandbox()(从 \"niceeval/sandbox\" 导入)。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/guides/sandbox-backends.mdx",
  "sandbox.dependencyMissing.docker": "Docker sandbox requires 'dockerode'. Install it with: pnpm add dockerode @types/dockerode",
  "sandbox.dependencyMissing.e2b": "E2B sandbox requires 'e2b'. Install it with: pnpm add e2b",
  "sandbox.dependencyMissing.vercel": "Vercel sandbox requires '@vercel/sandbox'. Install it with: pnpm add @vercel/sandbox",
  "sandbox.forceCleanup": "  · [sandbox] 强制清理 {{count}} 个沙箱…\n",
  "sandbox.stopFailed": "  · [sandbox] 停沙箱 {{id}} 失败(已忽略,靠后端过期兜底):{{message}}\n",
  "sandbox.stopTimeout": "stop 超时({{timeoutMs}}ms)",
  "scoring.evalError": "评估出错: {{error}}",
  "session.fileFallback": "[file]",
  "session.tools": "{{count}} 工具",
  "session.turn.primary": "第{{turn}}轮",
  "session.turn.secondary": "会话{{session}}·第{{turn}}轮",
  "util.requiredEnv": "缺少必需的环境变量 {{name}}(请在 .env 里配置)。",
  "vercel.fileNotFound": "File not found: {{path}}",
  "vercel.rotateFailed": "[VercelSandbox] session rotate failed ({{seconds}}s): {{error}}",
  "vercel.rotated": "[VercelSandbox] session rotated after {{seconds}}s → {{sessionId}}",
} as const;

export type MessageKey = keyof typeof zhCN;
export type Messages = Record<MessageKey, string>;
