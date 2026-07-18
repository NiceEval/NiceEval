export const zhCN = {
  "agent.installFailed": "安装失败:{{key}}\n{{tail}}",
  "agent.unknown": "未知 agent \"{{name}}\"。已注册:{{known}}。",
  "agent.diagnose.exitCode": "agent 运行退出码 {{code}}",
  "agent.diagnose.lastError": "最后错误:{{message}}",
  "agent.diagnose.noTranscript": "transcript 未生成",
  "agent.diagnose.outputTail": "输出末尾:{{tail}}",
  "agent.diagnose.zeroEvents": "transcript 存在但 0 事件",
  "bub.homeDetectFailed": "无法探测沙箱 $HOME(printf $HOME 输出为空)。不兜底到 provider 专属固定路径,请检查沙箱 provider。",
  "bub.checkpointCaptureFailed": "bub checkpoint 缓存回填失败(本沙箱不受影响,后续沙箱会重新安装):{{error}}",
  "bub.checkpointRestoreFailed": "bub checkpoint 还原失败,回退到全量安装:{{error}}",
  "bub.installFailed": "bub 安装失败(重试 {{attempts}} 次):\n{{tail}}",
  "bub.setupNotRun": "bub adapter 的 setup() 尚未在该沙箱运行(缺 home/workspace 信息);运行器应先调 setup 再 send。",
  "checkpoint.emptyTar": "checkpoint: tar 为空(paths: {{paths}})",
  "checkpoint.archiveFailed": "checkpoint 归档失败(exit {{exitCode}}): {{detail}}",
  "checkpoint.restoreFailed": "checkpoint 恢复失败(exit {{exitCode}}): {{detail}}",
  "skill.localMissing": "本地 skill 路径不存在:\"{{path}}\"(解析到 {{resolved}})。path 相对跑 niceeval 的项目根解析。",
  "skill.localDirNoSkillFile": "本地 skill 目录 \"{{path}}\" 里没有 SKILL.md。目录形态的 skill 必须在根下带一个 SKILL.md。",
  "skill.localUnsupportedShape": "本地 skill 路径 \"{{path}}\" 形态不支持。只接受:含 SKILL.md 的目录,或单个 .md 文件。",
  "skill.repoCloneFailed": "repo skill 拉取失败:{{source}}(ref: {{ref}})\n{{tail}}",
  "skill.repoNoSkills": "repo skill {{source}} 里没找到任何 SKILL.md。",
  "skill.repoAmbiguous": "repo skill {{source}} 里有多个 skill,必须用 `skills: [...]` 明确选择要启用哪些。可选:{{available}}。",
  "skill.repoUnknownSkill": "repo skill {{source}}(ref: {{ref}})里没有名为 \"{{skill}}\" 的 skill。可选:{{available}}。",
  "skill.copyFailed": "skill \"{{name}}\" 装进 {{dest}} 失败:\n{{tail}}",
  "mcp.ambiguousTransport":
    "MCP server \"{{name}}\" 同时给出了 command 和 url——二选一:本地 stdio 进程写 command,远程 Streamable HTTP 端点写 url。",
  "plugin.marketplaceFailed": "{{agent}} marketplace \"{{name}}\" 连接失败(source: {{source}}, ref: {{ref}}):\n{{tail}}",
  "plugin.marketplaceVerifyFailed": "{{agent}} marketplace \"{{name}}\" add 后回读注册列表失败({{command}}):\n{{tail}}",
  "plugin.marketplaceNameMismatch":
    "{{agent}} marketplace 名不匹配:配置的 name \"{{expected}}\"(source: {{source}})不在 add 后回读的注册列表里,本次实际注册为:{{actual}}。" +
    "marketplace.name 必须等于目标仓库 manifest 声明的 name,改成真实名字再跑。",
  "plugin.installFailed": "{{agent}} plugin \"{{name}}\"(marketplace: {{marketplace}})安装失败:\n{{tail}}",
  "nativeConfig.pathNotProjectRelative":
    "{{agent}} {{field}} 只接受项目根内的相对路径,收到 \"{{path}}\"。绝对路径、包含 `..` 的路径和 `~` 路径都不行;项目根外的配置先复制进项目再引用。",
  "nativeConfig.missing":
    "{{agent}} {{field}} 指向的文件不存在:\"{{path}}\"(解析到 {{resolved}})。路径相对运行 niceeval 的项目根(含 niceeval.config.ts 的目录)解析,不相对 eval / experiment 源码文件。",
  "nativeConfig.escapesRoot": "{{agent}} {{field}} \"{{path}}\" 经符号链接解析到项目根之外({{resolved}})。配置文件必须真实位于项目根内。",
  "nativeConfig.notFile": "{{agent}} {{field}} \"{{path}}\" 不是普通文件。指向一份完整的官方配置文件。",
  "nativeConfig.invalidSyntax": "{{agent}} {{field}} \"{{path}}\" 不是合法的 {{format}}:{{detail}}",
  "nativeConfig.reservedKeys":
    "{{agent}} {{field}} \"{{path}}\" 含保留键:{{keys}}。这些键由 experiment 与 Adapter 拥有(model、鉴权、MCP、OTel 经独立配置层叠加),从文件里删掉再跑。",
  "nativeConfig.uploadFailed": "原生配置文件 \"{{path}}\" 上传沙箱失败({{dest}}):\n{{tail}}",
  "cli.all": "(全部)",
  "cli.browserOpenFailed": "无法自动打开浏览器,请手动访问:{{url}}\n",
  "cli.clean.done": "已删除 .niceeval/ 历史运行 artifact。\n",
  "cli.config.missing":
    "找不到 niceeval.config.ts。\n" +
    "修法:\n" +
    "  - [init] 运行 `npx niceeval init` 生成 niceeval.config.ts 和 evals/\n" +
    "  - [cd] 切到包含 niceeval.config.ts 的项目根再运行\n" +
    "  文档:node_modules/niceeval/docs-site/zh/tutorials/quickstart.mdx",
  "cli.config.noDefault": "niceeval.config.ts 需要 default export(defineConfig(...))。",
  "cli.dry.header": "\n[dry] {{evals}} 个 eval × {{configs}} 个运行配置:\n",
  "cli.dry.noMatches": "(无匹配)",
  "cli.dry.row": "  {{who}}{{experiment}}: {{evals}}  ×{{runs}}\n",
  "cli.error": "niceeval 出错:{{error}}\n",
  "cli.flag.invalidNumber": "标志 --{{flag}} 需要数字,收到 \"{{value}}\"。\n",
  "cli.flag.invalidOutput": "标志 --output 需要 auto|human|agent|ci 之一,收到 \"{{value}}\"。\n",
  "runner.budgetUnenforceable":
    "{{budgetKey}} 的 budget:连续多个 attempt 完成后都拿不到成本数据(agent 不上报用量且模型不在价格表)——该 agent 的 budget 无法执行,取消护栏继续跑。\n",
  "runner.experimentTeardownFailed":
    "实验 {{experimentId}} 的 setup 返回的 cleanup 执行失败:{{message}}。结果不受影响,但该实验起的宿主机资源可能没有回收,请手动检查。\n",
  "runner.experimentTeardownLate":
    "实验 {{experimentId}} 的 teardown 未被正常计数路径触发,已在运行收尾兜底执行。结果不受影响;这行出现说明命中了一个未定位的调度间歇问题,请把本次运行信息记入 memory 台账。\n",
  "judge.modelMissing":
    "judge 未配置模型:在 defineConfig({ judge: { model: \"...\" } })、eval 的 judge 配置或环境变量 NICEEVAL_JUDGE_MODEL 里指定裁判模型(没有内置默认模型)。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/tutorials/scoring-guide.mdx",
  "loaders.yamlMissing":
    "loadYaml(\"{{path}}\") 需要 YAML 解析器:请先 `pnpm add yaml`(或改用 loadJson + JSON 数据集)。",
  "cli.flag.parseError": "{{message}}\n运行 `niceeval --help` 查看用法。\n",
  "cli.envInvalidNumber": "环境变量 {{name}} 不是数字:\"{{value}}\"。\n",
  "cli.help":
    "niceeval — agent-native evals\n\n" +
    "用法:\n" +
    "  niceeval exp [组|实验] [eval-id 前缀…]   跑实验\n" +
    "  niceeval show [eval-id 前缀… | @<locator>]   终端读结果\n" +
    "      裸跑:每个 experiment 的现刻判定(跨 run 合成),每行带紧凑 attempt 索引\n" +
    "        (locator + 失败原因)\n" +
    "      单个 eval id:attempt 与断言明细\n" +
    "      @<locator>  精确一个 attempt:无 flag → 紧凑全景;带 flag → 对应证据切面\n" +
    "      --source      该 attempt 运行时保存的 Eval 源码,断言标回源码行\n" +
    "      --execution   该 attempt 的执行事件流(消息/thinking/Skill/工具调用),\n" +
    "        有 OTel 时同一节点补时间\n" +
    "      --timing      整个 attempt 的统一时间树(阶段 + hook/命令/turn + 轮内 OTel)\n" +
    "      --diff[=文件] agent 归因的文件改动摘要;=文件 按窗口展开单个文件\n" +
    "      --history   逐 experiment × eval 的执行时间轴(与 --report 互斥)\n" +
    "      --results <目录> 钉死结果根   --exp <id> 只看该实验\n" +
    "      --report <文件> 自定义报告   --page <id> 定初始页(多页报告渲染该页,\n" +
    "        尾部再附其余页索引)\n" +
    "  niceeval list                            列出发现到的 eval\n" +
    "  niceeval view [eval-id 前缀…] [--out 目录] [--port n] [--no-open]\n" +
    "      报告页 + 证据室;--report <文件> 整槽换成自定义报告(与 show 同一文件)\n" +
    "      --page <id> 定初始页   --results <目录> 钉死结果根\n" +
    "      --snapshot <文件> 只打开这一份快照   --exp <id> 只看该实验\n" +
    "      --out <目录> 静态导出:index.html 连同查看器 artifact,可直接静态托管\n" +
    "  niceeval sandbox list|enter|history|diff|stop  查看与销毁 --keep-sandbox 留下的现场\n" +
    "  niceeval clean                           删除 .niceeval/ 历史 artifact\n" +
    "  niceeval init                            脚手架 config + evals/\n\n" +
    "标志:\n" +
    "  --runs n  --max-concurrency n  --timeout ms  --budget usd  --tag t\n" +
    "  --early-exit / --no-early-exit  --strict  --force  --dry  --keep-sandbox[=failed|all]\n" +
    "  --output auto|human|agent|ci\n" +
    "  --junit path  --json path  --out dir  --port n  --open / --no-open  -h, --help  -v, --version\n\n" +
    "位置参数只选「跑哪些 eval」(id 前缀);对着哪个 agent、怎么跑来自 experiments/ 与\n" +
    "标志。环境变量覆盖(标志 > 环境变量 > config):\n" +
    "  NICEEVAL_RUNS  NICEEVAL_MAX_CONCURRENCY  NICEEVAL_TIMEOUT  NICEEVAL_BUDGET\n",
  // show 的错误文案保持英文(错误文案英文的仓库约定);noResults 是提示,翻译。
  "cli.show.noResults": "{{root}} 下没有结果。先 `niceeval exp` 跑一轮,再 `niceeval show`。\n",
  "cli.show.runDirMissing": "Results directory not found: {{dir}}\n",
  "cli.show.noEvalMatch": "No results matched: {{patterns}}. Evals with results: {{evals}}\n",
  "cli.show.noExperimentMatch": "No experiment matched --exp {{arg}}. Experiments with results: {{experiments}}\n",
  "cli.show.historyReportConflict":
    "`--history` and `--report` are mutually exclusive: both take over the main output. --history is the host's per-attempt execution timeline; for snapshot-level trends, compose exp.snapshots inside your report file instead.\n",
  "cli.show.evidenceNeedsEval":
    "--source / --execution / --diff show one attempt's evidence, but the selection matched {{matched}} evals. Pick an attempt locator from the index below:\n{{index}}\n",
  "cli.show.locatorMalformed": "{{message}}\n",
  "cli.show.locatorNotFound": "{{message}}\n",
  "cli.eval.noMatch": "没有匹配的 eval:{{patterns}}。\n",
  "cli.eval.noMatchHintExperiment": "提示:\"{{pattern}}\" 是实验{{kind}},你大概想跑:niceeval exp {{pattern}}\n",
  "cli.eval.noMatchKnown": "已发现 {{count}} 个 eval:{{evals}}\n",
  "cli.exp.agentModelFlagUnsupported": "experiment 运行不支持 --agent / --model。请新增或复制一个 experiment 文件并修改 model。\n",
  "cli.exp.viewerFlagUnsupported": "`{{flag}}` 只适用于 niceeval {{command}},不能用于 niceeval exp。\n",
  "cli.experiment.noMatch": "没有匹配的实验:{{arg}}。已发现:{{experiments}}\n",
  "cli.experiment.viewerCommandHint": "你可能想运行:niceeval {{command}}{{args}}\n",
  "cli.experiment.noEvalsSelected": "未选择任何 eval:{{selection}} 匹配到 0 个 eval。可用实验:{{experiments}}。\n",
  "cli.experimentGroup": "组",
  "cli.fallbackCleanupTimeout": "\ngraceful 清理超时,强制清理沙箱…\n",
  "cli.forceCleanupExit": "\n强制清理沙箱并退出…\n",
  "cli.init.done": "已就绪:evals/、niceeval.config.ts,以及 AGENTS.md 里的 niceeval agent 指引区块(指向 node_modules/niceeval/docs-site/zh)。\n",
  "cli.interruptCleanup": "\n收到中断,正在清理沙箱容器…(再按一次强制清理并退出)\n",
  "cli.list.header": "发现 {{count}} 个 eval:\n",
  "cli.noAgent": "未指定 agent(用 --agent <name>)。\n",
  "cli.none": "(无)",
  "cli.pressCtrlC": "按 Ctrl+C 退出。\n",
  "cli.resultsPath": "结构化结果:{{path}}(snapshot.json + 每 attempt 的 result.json / events.json / trace.json / diff.json)\n",
  "cli.run.experimentRequired":
    "运行 eval 必须通过 experiment:用 `niceeval exp [实验组|配置] [eval id 前缀]`。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/tutorials/write-experiment.mdx\n",
  "cli.run.experimentRequiredHint": "提示:\"{{pattern}}\" 是实验{{kind}},你大概想跑:niceeval exp {{pattern}}\n",
  "cli.run.experimentRequiredKnown": "已发现实验:{{experiments}}\n",
  "cli.unimplemented": "命令 \"{{command}}\" 暂未实现(MVP)。\n",
  "cli.view.exportedDir": "已导出静态查看站:{{out}}(整个目录可直接静态托管;本地打开 {{out}}/index.html 需经 http 服务,file:// 下 artifact fetch 不可用)\n",
  "cli.view.incompatible": "{{dir}}: 由 niceeval {{producer}} 写入(schemaVersion {{schemaVersion}}),当前 CLI 只读 schemaVersion {{supported}}。\n运行 `{{command}}` 查看这份报告。\n",
  "cli.view.noResults": "{{root}} 下没有结果。先 `niceeval exp` 跑一轮,再 `niceeval view`。\n",
  "cli.view.incompatibleForeign": "{{dir}}: 由 {{name}} {{version}} 写入(schemaVersion {{schemaVersion}}),当前 CLI 只读 schemaVersion {{supported}}。\n请用写出它的那个工具查看这份报告。\n",
  "cli.view.url": "niceeval view: {{url}}\n",
  "context.capabilityMissing":
    "agent \"{{agent}}\" 不是沙箱型(defineSandboxAgent 构造),t.{{method}} 这类断言只有沙箱型 agent 可用。换用 defineSandboxAgent 构造的 agent,或去掉这条断言。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/tutorials/sandbox-agent.mdx",
  "context.skipEmpty": "skip() 需要一个非空理由。",
  "context.turnFailed": "本轮 send 返回 failed(turn status = failed):{{message}}",
  "context.turnFailedDefault": "本轮 send 返回 failed(turn status = failed)",
  "define.agentNameRequired": "defineAgent 需要 name。",
  "define.evalIdRejected": "defineEval 不接受 id —— id 由文件路径推导。",
  "define.evalEnvironmentEmpty": "defineEval 的 environment 如有提供，必须是非空的 profile id。",
  "define.evalTestRequired": "defineEval 需要一个 async test(t) 函数。",
  "define.experimentAgentRequired": "defineExperiment 需要 agent。",
  "define.experimentFlagNotJson": "experiment.flags.{{key}} 不是可 JSON 序列化的值(函数 / undefined / 循环引用 / bigint 不允许);flags 会原样进入结果快照,必须是纯 JSON。",
  "define.experimentSetupNotFunction": "experiment.setup 必须是函数((ctx) => void | cleanup);要按实验准备沙箱内环境请挂 sandbox spec 的 .setup() 钩子链。",
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
  "feedback.human.active": "ACTIVE",
  "feedback.human.budgetExhausted": "{{experimentId}} 预算已耗尽(已花 {{spent}},未跑 {{unstarted}})",
  "feedback.human.compare": "Compare: niceeval view {{group}}",
  "feedback.human.counts": "共 {{total}} · 复用 {{reused}} · 运行中 {{running}} · 排队 {{queued}} · 已完成 {{completed}}",
  "feedback.human.diffHint": "Diff:    niceeval show {{locator}} --diff",
  "feedback.human.evalHint": "Eval:    niceeval show {{locator}} --source",
  "feedback.human.failuresHeader": "FAILURES",
  "feedback.human.heartbeat": "已运行 {{elapsed}} · {{counts}}",
  "feedback.human.inspect": "Inspect: niceeval show {{locator}}",
  "feedback.human.moreActive": "… 还有 {{count}} 项运行中",
  "feedback.human.plan": "计划:{{total}} 个 attempt · {{evals}} 个 eval × {{configs}} 个配置 · 并发 {{concurrency}}",
  "feedback.human.resultFailed": "FAILED",
  "feedback.human.resultIncomplete": "INCOMPLETE",
  "feedback.human.resultInterrupted": "INTERRUPTED",
  "feedback.human.resultPassed": "PASSED",
  "feedback.human.resultsHeader": "Results:",
  "feedback.human.resultsMore": "… 还有 {{count}} 个",
  "feedback.human.reuse": "复用:{{total}} 中 {{reused}} 条来自缓存 · {{toRun}} 待跑",
  "feedback.human.summaryLine": "{{passed}} 通过 · {{failed}} 失败 · {{errored}} 出错  (复用 {{reused}})",
  "feedback.human.summaryAllReusedLine": "{{passed}} 通过 · {{failed}} 失败 · {{errored}} 出错  (全部 {{reused}} 条复用)",
  "feedback.human.suppressedFailures": "… 还有 {{count}} 条失败被折叠",
  "feedback.human.trace": "Trace:   niceeval show {{locator}} --execution",
  "feedback.phase.agentSetup": "agent 预置",
  "feedback.phase.evalRun": "运行 eval",
  "feedback.phase.evalSetup": "eval 预置",
  "feedback.phase.sandboxCreate": "创建沙箱",
  "feedback.phase.sandboxQueue": "排队等沙箱",
  "feedback.phase.experimentSetup": "实验预置",
  "feedback.phase.experimentTeardown": "实验收尾",
  "feedback.human.hookDone": "完成",
  "feedback.human.hookFailed": "失败",
  "feedback.phase.sandboxSetup": "沙箱预置",
  "feedback.phase.scoring": "评分",
  "feedback.phase.teardown": "清理中",
  "feedback.phase.telemetryCollect": "收集 trace",
  "feedback.phase.telemetryConfigure": "配置 telemetry",
  "feedback.phase.workspaceBaseline": "准备工作区",
  "feedback.phase.workspaceDiff": "采集 diff",
  "feedback.rendererError": "  · [feedback] renderer 处理 {{context}} 失败(已忽略):{{message}}\n",
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
  "runner.failFast": "{{evalId}} 的错误 {{code}} 连续复现,判定为确定性错误;停止派发该配置剩余的 attempt(fail-fast)。",
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
  "runner.startSandboxSetup": "sandbox setup(环境预置钩子)…",
  "runner.startSandboxTeardown": "sandbox teardown(环境预置钩子)…",
  "runner.timeout": "attempt 超时({{timeoutMs}}ms)\n最近进度:\n{{recentLogs}}",
  "runner.traceSelected": " → 留 {{count}}(按语义)",
  "runner.useRemoteAgent": "使用 remote agent(不创建沙箱)…",
  "sandbox.providerNotImplemented": "{{provider}} sandbox provider not implemented; use docker, vercel, or e2b",
  "sandbox.missingSpec":
    "沙箱型 agent 需要一个 sandbox,但没有提供。niceeval 不再自动选默认 provider——请在 defineExperiment()/defineConfig() 里把 sandbox 设成 dockerSandbox() / vercelSandbox() / e2bSandbox()(从 \"niceeval/sandbox\" 导入)。\n" +
    "  文档:node_modules/niceeval/docs-site/zh/tutorials/sandbox-providers.mdx",
  "sandbox.dependencyMissing.docker": "Docker sandbox requires 'dockerode'. Install it with: pnpm add dockerode @types/dockerode",
  "sandbox.dependencyMissing.e2b": "E2B sandbox requires 'e2b'. Install it with: pnpm add e2b",
  "sandbox.dependencyMissing.vercel": "Vercel sandbox requires '@vercel/sandbox'. Install it with: pnpm add @vercel/sandbox",
  "sandbox.forceCleanup": "  · [sandbox] 强制清理 {{count}} 个沙箱…\n",
  "sandbox.provisionReconcileFailed": "  · [sandbox] 创建重试前对账失败,放弃重试(可能已创建的实例无法核实/销毁):{{error}}\n",
  "sandbox.provisionRetry": "  · [sandbox] 创建被限流,{{delayMs}}ms 后重试(第 {{attempt}}/{{maxAttempts}} 次)…\n",
  "sandbox.stopFailed": "  · [sandbox] 停沙箱 {{id}} 失败(已忽略,靠 provider 过期兜底):{{message}}\n",
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
