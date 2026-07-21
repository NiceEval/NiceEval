# Memory 索引

memory 的召回全靠这份索引:漏索引的条目等于不存在。维护规则:

- **按子系统主轴归档**:分区就是"动手前扫哪块"——沙箱/Agent、Runner·CLI、报告·view、o11y 采集、写 eval·scoring·judge、examples、docs、环境。动手涉及某块前先扫该块;命中一行才读正文,大多数条目停在一行即可。
- **大区内再分「裁决 / 台账」**:沙箱、Runner、报告三块条目多,内部拆两个子标题——**裁决**(设计决定/否决方案:一条 = 裁决 / 曾选方案 / 否决理由 / 日期)、**台账**(踩坑/bug:现象 / 根因 / 修法)。小区不分。设计裁决归到它约束的子系统,不再单列"设计决定"分区;真正跨切面的(术语、测试预算、错误反馈契约等)才进 **跨切面裁决**。
- **写完即索引**:新增 memory 文件必须同步在这里加一行,格式 `- [条目名](条目文件名.md) — 一句现象+结论`,归到对应子系统(大区里再判裁决/台账)。`test/memory-index.test.ts` 随 `pnpm test` 校验每个条目都有索引行。
- **修好标注,不删除**:bug 修好后行首标「已修」,并在条目正文补修法落点(文件/commit)。已修条目是后续复盘"这个修法合理不合理"的材料,不归档不删除。
- **复盘出口**:修法复盘后被确认为长期约束的,升格为 CLAUDE.md 或 docs/ 里的一句规则(原条目保留作出处);被推翻的,更新原条目记录新判断。

## 沙箱 · Agent adapter

### 裁决

- [skill-install-via-git-not-skills-cli](skill-install-via-git-not-skills-cli.md) — 设计裁决:repo skill 改走 git clone(`skills` CLI 没法钉 ref、也枚举不出仓库里有哪些 skill);已真机验证；Claude Code E2E 曾错用 `calledTool("Skill")` 查找已归一成 `skill.loaded` 的事件，现已修并 2/2 真机通过
- **待裁决** [structural-typing-cannot-reject-spec-swap](structural-typing-cannot-reject-spec-swap.md) — 同形的两个具名 Spec,TS 结构类型拦不住互换;文档已止血(只承诺**形状**不承诺**值**),但「要不要加判别字段/品牌化真的拦住」未定,2026-07-13 处理
- [sandbox-provision-ratelimit-retry](sandbox-provision-ratelimit-retry.md) — 设计裁决:provisioning 瞬时错误退避重试(2026-07-14 两轮 + 2026-07-15 推翻「拒绝类可盲重试」)——防线 = provider create 的 kill-on-failure + 有对账通道时任何重试前按 provision token 对账(对账失败即放弃重试),无检索通道则歧义类第一次抛;vercel 外层封顶收窄防嵌套放大;重试在 resolve.ts 而非 runner
- [diff-attribution-send-window-ledger](diff-attribution-send-window-ledger.md) — 设计裁决:agent diff 改为 send 窗口归因的私有 git 分类账(2026-07-14),推翻「空基线 + git diff HEAD」;E2B 实跑补齐 `*venv*/` 排除、按窗口批量导出与证据上限(2026-07-15)
- [keep-dormancy-provider-forms](keep-dormancy-provider-forms.md) — 设计裁决:留存现场转入 provider 休眠形态(docker stop 停驻 / e2b pause 可 resume;2026-07-14),推翻「keep = 保持运行」;docker pause 与 commit 转镜像同场否决
- [reuse-once-setup-supersedes-idempotent-hooks](reuse-once-setup-supersedes-idempotent-hooks.md) — 裁决(2026-07-21):沙箱复用定稿为串行复用(`--reuse-sandbox`,温基线一次装好、题间只 reset workdir),推翻 runner.md 旧「每 attempt 重跑幂等钩子」;与 keep/local/异构批次组合创建前报错,复用结果不进缓存
- [keep-reuse-carry-insulation-decision](keep-reuse-carry-insulation-decision.md) — 裁决(2026-07-21):keep 留存档内不消费携带(否决「让用户配 --force」)、reuse 与缓存双向绝缘、显式 `--max-concurrency`×reuse 创建前报用法错误(否决静默钉 1);起因是 keep 两篇用例被携带击穿成零派发
- [eval-environment-profile-sandbox-resolver](eval-environment-profile-sandbox-resolver.md) — 裁决:Eval 只声明 provider-neutral environment profile；否决 Eval 直接绑定 template/provider。resolver 解析形态 2026-07-17 被推翻,见下条
- [eval-environments-map-replaces-resolver](eval-environments-map-replaces-resolver.md) — 裁决:profile→预制产物映射改为 sandbox spec 工厂的 environments 数据表(删 resolver 与函数指纹);否决按环境拆 experiment(分数横截面被切碎)与 config 顶层注册表
- [sandbox-field-no-bare-string](sandbox-field-no-bare-string.md) — `sandbox` 字段只接受工厂产出的 SandboxSpec:不接受裸字符串、没有默认值、没有自动探测(用户 review 明确定案)
- [registermcp-post-hoc-primitive](registermcp-post-hoc-primitive.md) — 翻案裁决:不提供后置追加 MCP 原语,`shared.registerMcp` 当日落地当日撤销;MCP 只走 factory 构造期,条件包装器应接收 factory 而不是已构造 Agent
- 部分被后续裁决替代 [sandbox-lifecycle-hooks](sandbox-lifecycle-hooks.md) — 环境预置的家是 SandboxSpec 链式 `.setup()/.teardown()`;「ExperimentDef 保持纯数据/实验级钩子不存在」一条已被下一行推翻,其余(沙箱钩子挂 spec、persistentState 不做)仍有效
- [sandbox-keep-scene-decision](sandbox-keep-scene-decision.md) — 裁决(2026-07-14):debug 沙箱走 opt-in 留存现场(`--keep-sandbox` + `niceeval sandbox list/stop`,Scope 外包 timeout、逐条目原子登记,「不留孤儿」精化为「不留无主」);自定义 provider 因无法跨进程销毁而不支持 keep;曾选「加大 artifact 采集」「按 artifact 重建环境」「接口加 pause/detach」「只打印清理命令不做命令组」均否决
- [agent-native-settings-official-surface](agent-native-settings-official-surface.md) — 裁决(2026-07-14):cc/codex factory 新增官方 `settings`(原生配置词汇的结构化对象)并升格为 Adapter 契约义务;透传原文、webSearch 语义字段、钩子写文件、McpServer.tools 白名单四方案否决/搁置;动机=codex web_search 评测答案污染;两条上游 FR 待提

### 台账

- [budget-warning-requires-agent-turn](budget-warning-requires-agent-turn.md) — `sandbox.create` 等 agent 启动前错误没有成本事实，不得触发 budget-unenforceable；只统计真实 turn 后仍无 cost 的 attempt
- [native-plugin-marketplace-name-not-caller-assignable](native-plugin-marketplace-name-not-caller-assignable.md) — `ClaudeCodePluginSpec`/`CodexPluginSpec` 的 `marketplace.name` 文档暗示调用方自定,真实 CLI 按目标仓库 manifest 自己的 `name` 注册,名字不匹配时 `marketplace add` 静默成功、下一步 `plugin install/add` 才报错;真实仓库复现,此 fixture 已落成两条 Docker 真机 e2e(Claude Code + Codex),bug 本身未修
- 已修 [codex-plugin-list-json-shape-guessed-wrong](codex-plugin-list-json-shape-guessed-wrong.md) — `codex plugin list --json` 真实形状是 `{ installed: [...] }` + `pluginId` 字段,旧代码猜成裸数组/`{ plugins: [...] }` + `id`,`resolvedVersion` 对任何真实安装恒返回 undefined;native plugin 真机 e2e 复现(修在 `src/agents/codex.ts`)
- 已修 [agent-setup-workspace-writes-pollute-diff](agent-setup-workspace-writes-pollute-diff.md) — git 基线早于 `agent.setup`,所以 setup 往 workspace 装的 skill / AGENTS.md 会被当成 agent 产出记进 diff;修为写 `.git/info/exclude`(能放 `$HOME` 就别放 workspace)
- 已修 [sandbox-home-hardcode](sandbox-home-hardcode.md) — sandbox 的 $HOME 因 backend 而异,不能 hardcode `/home/node`;agent `setup()` 动态探测(修在 `src/agents/bub.ts`)
- 已修 [bub-workspace-path-hardcode](bub-workspace-path-hardcode.md) — 同上但漏了 workspace:bub 的 `--workspace` 曾写死 Docker 路径,要读 `sb.workdir`(修在 `src/agents/bub.ts`)
- [docker-default-image-no-python3](docker-default-image-no-python3.md) — dockerSandbox 默认镜像没有 python3,依赖 python 的 eval 必失败
- 已修 [vercel-sandbox-issues](vercel-sandbox-issues.md) — Vercel session 寿命 ~360-390s(上游限制,压并发绕过);SESSION_TIMEOUT_MS 必须固定常量,timeout 传越大 session 反而越短(修在 `src/sandbox/vercel.ts`)
- [e2b-sandbox](e2b-sandbox.md) — e2b base 模板只有 node20 + ~481MB 内存(npm install 会 OOM kill),内存/node 版本由模板烘焙决定;重 eval 用预制模板 `fasteval-agents`,构建踩坑清单在正文
- [claude-agent-sdk-permission-mode-silent-skip](claude-agent-sdk-permission-mode-silent-skip.md) — claude-agent-sdk `query()` 默认 permissionMode 在 headless 服务里静默跳过工具调用,模型幻觉作答不报错
- [pi-agent-core-no-session-persistence](pi-agent-core-no-session-persistence.md) — pi SDK 没有落盘 resume 机制,多轮会话要服务端自存并回灌 `agent.state.messages`
- 已修 [bub-template-preinstall-defeats-pinned-override](bub-template-preinstall-defeats-pinned-override.md) — 模板烘焙的 bub 让 `command -v` 捷径跳过 git-pinned override 安装,修复分支从未落地;pinned 时绕捷径 + 钉 $HOME/.local/bin/bub(修在 `src/agents/bub.ts`)
- 已修 [bub-tapestore-otel-tapeentry-drift](bub-tapestore-otel-tapeentry-drift.md) — bub trace 静默消失:bub ≥0.3.10 vendor 了 `bub.tape`,插件按 `republic.TapeEntry` 做 pydantic 校验全被拒、异常吞成 warning → 0 span;先修在 bub-contrib fork `7c84cc7`,上游 #50 合并后 `OTEL_PLUGIN` 已切回 bubbuild main(bub 本体 fork 未退役)
- 已修 [bub-checkpoint-oversized-transfer-kills-attempt](bub-checkpoint-oversized-transfer-kills-attempt.md) — bub checkpoint 曾打包 `~/.cache/uv` 撑到 100MB+,e2b 文件 API 单次传输超时/重置;且缓存回填失败曾杀掉已装好 bub 的 attempt;修为只打 `~/.local` + 回填/还原失败降级警告(修在 `src/agents/bub.ts`)
- 已修 [bub-ensurebub-warning-no-attribution-prefix](bub-ensurebub-warning-no-attribution-prefix.md) — ensureBub 的 checkpoint 回填/还原警告曾用裸 console.error,并发多配置下无法归属;修为穿入触发 attempt 的 ctx.log(`src/agents/bub.ts`)
- 已修 [npx-skills-add-headless-hang](npx-skills-add-headless-hang.md) — `npx skills add` 默认交互式选 agent,headless 沙箱里卡死;修为 `-y -a <agent>`(claude-code.ts / codex.ts)
- 已修 [claude-code-skill-tool-name-not-load-skill](claude-code-skill-tool-name-not-load-skill.md) — `t.loadedSkill()` 曾是 `calledTool("load_skill")` 的糖,而 parser 早已把 Skill 加载归一成 `skill.loaded` 一等事件 → 在 claude-code 上永远静默断不中;修为 `loadedSkill()` 直接读 `skill.loaded`(`src/scoring/scoped.ts`)
- [codex-no-native-skill-tool](codex-no-native-skill-tool.md) — codex 没有原生 skill 工具,不显式提示"检查有没有 skill 文件"就几乎不会主动去读装好的 skill
- 已修 [codex-hook-trust-headless-silent-skip](codex-hook-trust-headless-silent-skip.md) — codex 对非 managed hook 要求交互式授信,headless 下未授信 hook 被静默跳过零报错(插件 hook 配置全对也零触发);bypass_hook_trust 是 runtime-only,修为 exec 一律带 `--dangerously-bypass-hook-trust`(src/agents/codex.ts)
- 已修 [skill-loaded-input-field-is-skill-not-command](skill-loaded-input-field-is-skill-not-command.md) — 实现 `skill.loaded` 归一化时凭印象把入参字段猜成 `input.command`,正确字段是 `input.skill`(仓库已有实测 memory 记录了这个形状,没检索到就重新猜错了);修在 `src/o11y/parsers/claude-code.ts`
- [mcp-tool-naming-claude-vs-codex](mcp-tool-naming-claude-vs-codex.md) — MCP 工具规范名两家不同:claude-code 是 `mcp__<server>__<tool>`,codex 是 `<server>.<tool>`(点分隔)
- [run-command-canonical-tool-name-portability](run-command-canonical-tool-name-portability.md) — 断言"跑过 shell"要用规范类目 `"shell"`,不要用某一家的原始工具名字面量(如 `"command_execution"` 只对 codex 恰好成立)
- [docker-apple-silicon-amd64-emulation-slow](docker-apple-silicon-amd64-emulation-slow.md) — 本机 Apple Silicon 上 dockerSandbox 默认拉 amd64 镜像走模拟,沙箱型 eval 实测比原生慢好几倍,timeoutMs 要留余量
- [codex-docker-default-image-missing-git](codex-docker-default-image-missing-git.md) — dockerSandbox 默认镜像 node:24-slim 不带 git,codex native Plugin(owner/repo 形态)与 SkillSpec{kind:"repo"} 都靠系统 git clone 实现,必现 ENOENT;修法是只给需要的实验用 `dockerSandbox().setup()` 装 git,不全局装
- [codex-cli-callid-collision-across-resumed-turns](codex-cli-callid-collision-across-resumed-turns.md) — codex exec --json 的 item.id 按单次进程调用从零编号,`codex exec resume` 续接是新进程、同样从头编号;多轮会话各自一次工具调用时数字常年撞车,call id 配对跨轮错位;要断言多个工具调用就收进同一轮 t.send()
- [codex-cli-show-board-collapses-multi-experiment](codex-cli-show-board-collapses-multi-experiment.md) — 裸 `niceeval show` 在多 experiment 仓库里按实验组折叠成汇总表,不逐条列 Eval id;"少排用例不能全绿"检查要用 `show --page attempts`,已修在 e2e/adapter/codex-cli/scripts/verify.ts
- 已修 [codex-cli-execution-tool-header-shows-raw-name](codex-cli-execution-tool-header-shows-raw-name.md) — `show --execution` 的 TOOL 卡片头显示 `ExecutionActionNode.name`(协议原始名),codex 的 command_execution/file_change 不会显示 shell/file_edit;verify.ts 断言改 OR 兼容两种(镜像 codex-sdk 已有写法)
- [codex-cli-otel-tool-span-callid-not-in-json-protocol](codex-cli-otel-tool-span-callid-not-in-json-protocol.md) — codex CLI `--json` 协议的 item 只有 item.id,原生 OTel 工具 span 的关联键是另一套 call_id(OpenAI Responses 风格),两者协议层面无共同字段,现有 call_id 精确匹配策略对 codex CLI 工具级 span 结构性地永远关联不上;真机验证到字段级,是否/如何解决未定,留待裁决
- [claude-code-persistent-memory-breaks-verbal-isolation](claude-code-persistent-memory-breaks-verbal-isolation.md) — claude-code 会把"帮我记住"写进磁盘 memory,newSession 后合法记得;session-isolation 反证要测 transcript 不回放历史,不测回答不含事实
- 已修 [e2b-provision-429-duplicate-sandbox](e2b-provision-429-duplicate-sandbox.md) — E2B create 成功后的 mkdir 初始化请求撞 429 被归拒绝类盲重试,同 token 开两台、首台泄漏计费(实跑 10 evals 见 14 台);修为 create 内 kill-on-failure(e2b.ts/docker.ts)+ 重试前一律对账且对账失败不重试(retry.ts)
- 已修 [ledger-gitignore-pathspec-and-gitlinks](ledger-gitignore-pathspec-and-gitlinks.md) — ledger 裸 pathspec 只排根级缓存，嵌套 repo 又静默记成 gitlink 吞掉内部 diff；修为 gitignore glob 编译 + mode 160000 fail fast
- 已修 [provision-retry-holds-concurrency-slot](provision-retry-holds-concurrency-slot.md) — provisioning 退避重试期间攥着 sandboxSem 并发名额陪跑 setTimeout,一批 429 能把实际并发拖到远低于 --max-concurrency 声明值(个位数);修为 ProvisionSlot 退避前 release、睡醒后 reacquire(`src/sandbox/retry.ts` + `resolve.ts` + `runner/attempt.ts`)
- 已修 [e2b-list-returns-paginator-not-array](e2b-list-returns-paginator-not-array.md) — reconcileProvision 用 `as unknown as` 猜了个 e2b `Sandbox.list()` 从未真实存在过的签名(真实是同步返回 `SandboxPaginator`,不是 `Promise<数组>`),for...of 直接 `TypeError: sandboxes is not iterable`,对账硬失败、重试被 abort;修为改用真实类型 + `hasNext`/`nextItems()` 翻页 + 服务端 metadata 过滤(`src/sandbox/e2b.ts`)
- 已修 [ui-message-stream-coverage-undeclared](ui-message-stream-coverage-undeclared.md) — 内置 uiMessageStreamAgent 没声明 EvidenceCoverage,真机跑 e2e/adapter/ai-sdk 时 succeeded()/notCalledTool()/noFailedActions() 全部 unknown→errored(不是断言写错);修为补 coverage(complete + usage unavailable)(`src/agents/ui-message-stream.ts`)
- 已修 [docker-uploadfile-tmp-mv-eperm](docker-uploadfile-tmp-mv-eperm.md) — Docker sandbox 的 `uploadFile()` 不 chown 上传文件(与 `uploadFiles()` 不同),claude-code `settingsFile` 真机上传到 `/tmp` 后 `mv` 到 `~/.claude/settings.json` 因 sticky-bit 目录 + root 属主 100% EPERM;修为 putArchive 后补 `chownToSandboxUser(absPath)`(`src/sandbox/docker.ts`,同路径也影响 codex 的 `configFile`)
- [hard-kill-leaves-orphans-and-experiment-leaks](hard-kill-leaves-orphans-and-experiment-leaks.md) — SIGKILL(外部看门狗 ~1h 强杀)下孤儿容器与实验 teardown 泄漏无事后入口;设计定稿三面兜底(运行标识+prune / 收尾登记+启动自愈 / attempt 级续跑),实现见 plan/hard-kill-recovery.md

## Runner · 调度 · CLI · 生命周期

### 裁决

- [external-review-round2-rulings](external-review-round2-rulings.md) — 设计裁决:第二轮外部评审翻案清单(2026-07-14)——coverage 省略=unknown、AssertionResult 判别联合、redact 必填、earlyExit 只认 passed、keep=failed|all、passRate 三拆、Selection 物化 attempts、ExperimentRunInfo 存 resolved
- [dispatch-priority-binds-to-slot-grant](dispatch-priority-binds-to-slot-grant.md) — 裁决(2026-07-20):瓶颈优先绑在「全局并发位分配时刻」而非 fiber 创建顺序,空位给等待集中轮次最高者、不看谁先等;否决为 setup 中的瓶颈 run 预留名额(容量空转)、抢占在飞 attempt(成本不可回收)、削弱承诺(在最该生效的场景失效);根因是承诺句与「setup 不占并发位」组合不自洽的设计 bug,实现未走样
- [lifecycle-paired-teardown-replaces-cleanup-return](lifecycle-paired-teardown-replaces-cleanup-return.md) — 裁决(2026-07-18):四层生命周期统一成对 setup/teardown、setup 返回 void,否决 setup-returns-cleanup(双写法并存、setup 半途抛错丢收尾、可见性差);触发规则=同层 setup 时点走到过;attempt 层状态通道以 sandbox 实例作键(纠正「一律模块闭包」);postSetup 配对命名 preTeardown;旧写法运行时护栏报错
- [end-to-end-pass-rate-is-default](end-to-end-pass-rate-is-default.md) — 裁决(2026-07-15):三指标拆分保留,但默认“成功率”从排除 errored 的 `taskPassRate` 改为 `endToEndPassRate`;`taskPassRate` 只作带限定名称的条件诊断指标,不能驱动默认排名;`2 passed / 5 errored` 默认显示 2/7 而非 100%
- [experiment-level-lifecycle-hooks](experiment-level-lifecycle-hooks.md) — 翻案裁决(2026-07-17):`ExperimentDef.setup` 落地(整场一次、宿主机侧、返回 cleanup 即 teardown);动因是 nowledge 隧道被迫住在 wrapper 脚本里;setup 失败全 attempt 合成 errored 且绕过 fail-fast,词表新增 experiment.* 两员不递增 schemaVersion
- [experiment-flags-naming-reversal](experiment-flags-naming-reversal.md) — 条件键定名 flags(A/B feature flag 语义,2026-07-10 params 同日翻案);字段改名=递增 schemaVersion,不做读取别名
- [results-per-snapshot](results-per-snapshot.md) — 裁决(2026-07-11):落盘单位 run→快照,实验目录在外层、判决落 attempt 级 result.json,run 级 summary.json 废除;翻案 2026-07-10「判定 journal 不做」;schemaVersion 4
- [bench-direct-invocation-not-niceeval-project](bench-direct-invocation-not-niceeval-project.md) — 裁决(2026-07-11):phase-timings.md 的 bench/ 是直接调 runAttemptBody 的脚本,不是 niceeval 项目+Reports 报告页;曾选 show 对比/compare.mjs 均否决
- [carry-includes-failed-verdict](carry-includes-failed-verdict.md) — 裁决(2026-07-11):resume/carry 携入条件从「只 passed」改为「passed 或 failed」,只有 errored 重跑;曾选「只 passed 携入」否决(failed 也是判定确定的终态,没理由白花成本重复验证)
- [feedback-redraw-clock-to-state-change](feedback-redraw-clock-to-state-change.md) — 裁决(2026-07-13):human dashboard 重画从 80ms `setInterval` 驱动的 spinner 帧改为「reducer 真实状态变化 + coordinator tick 机会 + 同帧不写」驱动;旧模型是 live-overflow-redraw-appends-frames / live-raw-stderr-write-desyncs-redraw 两次滚屏 bug 的共同根因,根治靠拆开状态源与重画时机,不是再打一个 ANSI 光标补丁
- [feedback-profile-replaces-tty-detection](feedback-profile-replaces-tty-detection.md) — 裁决(2026-07-13):`niceeval exp` 退役 `--quiet` 与 `stderr.isTTY` 直接决定 Live/Console 的旧模型,改为显式 `--output human|agent|ci`(`auto` 只做环境侦测顺序:显式值→TTY→CI 环境变量→agent 兜底);TTY 是传输能力不是消费者身份,`--quiet` 曾试图用一个开关同时压低给人看和给机器看的输出,两边都没做对(见 quiet-progress-result-stream-asymmetry)
- [attempt-phase-scoped-feedback-api-deferred](attempt-phase-scoped-feedback-api-deferred.md) — 裁决(2026-07-13):本次只把 `AttemptPhase` 实现成 runner 内部枚举(attempt.ts 沿既有生命周期步骤发出),`docs/feature/experiments/cli.md`「Attempt 阶段」描述的更完整形态——按 owner 分层的具名 operation scope + 面向 Sandbox provider/Agent adapter 的公开 `ScopedFeedback.progress()/diagnostic()` API——推迟出本次范围;原因是材料上远大于本次 TODO 清单、且仓促做容易在核心调度路径长出 agent==X/sandbox==Y 式特判,应先让内部枚举跑稳再决定要不要对外暴露
- [phase-timings-teardown-steps-and-show-view](phase-timings-teardown-steps-and-show-view.md) — 裁决(2026-07-14):`phases` 闭集补收尾段(agent.teardown/sandbox.teardown/sandbox.stop,不入 durationMs 口径)、setup/teardown 钩子链新增 step 级明细(phase 级合计保留),消费面扩到 show 首页 timing 行 + `--timing` 切面与 view Attempt 详情;翻案「teardown 不计时」「钩子链只合计」「show/view 不提供阶段视图」三条原契约
- [unified-attempt-timing-tree](unified-attempt-timing-tree.md) — 裁决(2026-07-14/15):phase→hook/operation/turn→sandbox command 递归时间树并按 traceId 挂 OTel；`--timing` 是统一入口但裸 flag 按 80-node 预算有界投影,`--timing=full` 才无界展开；producer 写 operation 语义,renderer 不猜 shell family、不自动 pager
- [lifecycle-phase-vocabulary-unification](lifecycle-phase-vocabulary-unification.md) — 裁决(2026-07-14):AttemptPhase/PhaseName/LifecycleOperationName 三套生命周期词表合一为 `LifecyclePhase` 闭集(含归并对照表,新增 eval.teardown);`error.operation`/`diagnostics.operation` 改名 `phase`,schemaVersion 6→7;曾选「保留三套+映射表」因永久同步税与已发生的可见漂移否决
- [scoped-feedback-finalized](scoped-feedback-finalized.md) — 裁决(2026-07-14):ScopedFeedback(progress/diagnostic)定稿为 feature 契约、单一归属 experiments/library.md,roadmap 提案页删除;三个遗留分歧逐条裁决(ctx 注入签名、core 中立属实现纪律、`ctx.log` = progress 别名);07-13 的推迟裁决仍约束实现排期,不再约束文档定稿状态

### 台账

- 已修 [exp-eval-prefix-segment-drift](exp-eval-prefix-segment-drift.md) — `exp` 把「eval ID 前缀」实现成路径段匹配，和文档/show/view 分叉；统一为裸字符串 prefix
- 已修 [experiment-maxconcurrency-was-global-clamp](experiment-maxconcurrency-was-global-clamp.md) — 实验级 maxConcurrency 曾按最小值钳全局,一个串行实验拖慢整批;修为 runner 两级信号量按实验限流(src/runner/run.ts + cli.ts)
- 已修 [cli-exit-code-attempt-level-not-eval-level](cli-exit-code-attempt-level-not-eval-level.md) — 退出码曾按 attempt 计红,earlyExit 重试吸收的失败也 exit 1;修为 foldEvalOutcome 按 eval 折叠(src/cli.ts + e2e verify.mjs)
- [cli-fresh-flag-is-noop](cli-fresh-flag-is-noop.md) — `--fresh` 不是真 flag 会被静默吞掉;跳过缓存结果用 `--force`;parseArgs 对未知 flag 不报错
- [tsx-dynamic-import-require-cycle](tsx-dynamic-import-require-cycle.md) — tsx 动态 import 用户 .ts(config / --report)在无 `"type":"module"` 的目录下报 ERR_REQUIRE_CYCLE_MODULE;绕法是用户项目声明 type module
- [rerun-with-eval-filter-partial-snapshot](rerun-with-eval-filter-partial-snapshot.md) — 带 eval-id 位置参数补跑产出部分快照,遮蔽 latestPerExperiment 口径;补跑要不带位置参数重跑实验/组;carry 基线只看最近 run 的坑已修(loadLatestResultsPerEval)
- 已修 [runner-earlyexit-key-misses-experiment](runner-earlyexit-key-misses-experiment.md) — earlyExit 去重键漏 experimentId,同 agent 同 model 只差 flags 的 A/B 实验会有一组被静默跳过(修在 `src/runner/run.ts` 键加 experimentId、`reporters/artifacts.ts` 工件路径加实验段)
- 已修 [live-overflow-redraw-appends-frames](live-overflow-redraw-appends-frames.md) — live 状态表行数超终端高度时 `\x1B[nA` 回跳被屏顶截断,每帧追加整表刷屏;修为按 `stderr.rows` 截断 + 隐藏行折叠成摘要(修在 `src/runner/reporters/live.ts`)
- 已修 [live-rows-fold-experiment-variants](live-rows-fold-experiment-variants.md) — live 进度行 who 曾取 agent/model,同 agent 同 model 的实验变体被折叠成一行,"0/2" 误读成跑两次;修为 runWho() 有 experimentId 用 basename(`src/runner/types.ts` + attempt.ts + cli.ts 同源);同时 resume 复用改为按 experiment 列清单
- 已修 [live-who-key-mismatch-freezes-rows](live-who-key-mismatch-freezes-rows.md) — 上一条修复漏改 live.ts 自己两处(eval:start / onEvalComplete)手写的 who,导致有 experimentId 时逐行永远卡"waiting for a slot"、`0/N` 不动,但表头总数正常涨,极像 sandbox/budget 卡死实则纯展示 bug;修为两处都改调 runWho()(`src/runner/reporters/live.ts`)
- 已修 [quiet-progress-result-stream-asymmetry](quiet-progress-result-stream-asymmetry.md) — `--quiet` 下进度流直写 stderr 但结果流被摘空,errored 全程无声极像"还在跑",下游还把串行交接误读成并发失控;修为新增 Quiet reporter,errored/failed 各补一行 stderr(`src/runner/reporters/quiet.ts` + cli.ts)
- 已修 [parallel-runs-same-ms-summary-clobber](parallel-runs-same-ms-summary-clobber.md) — 同命令并行 spawn 的 niceeval 进程毫秒同刻共享 run 目录,summary.json 互相盲写覆盖、判决单点丢失(同 spawn 启动耗时强相关,撞名非小概率);修法 = schemaVersion 4 快照制重设(见 results-per-snapshot 裁决)
- 已修 [budget-probe-starves-global-semaphore](budget-probe-starves-global-semaphore.md) — 有 budget 的实验把「等成本样本」的探测循环包在全局信号量里面攥着槽位空等;根治后发现探测/预测节流本身就是未文档化的多余设计,budget 已简化成只按已完成花费判断(修在 `src/runner/run.ts`)
- 已修 [cli-exp-multi-experiment-positional-noop](cli-exp-multi-experiment-positional-noop.md) — `niceeval exp a b` 不会跑两个实验,`exp` 只认 `positionals[0]` 当选择器,第二个及以后一律是 eval 过滤器,不共享目录的 flat 实验没有一条命令跑多个的写法;修在 docs-site 的 codex-skill/plugin 示例命令
- 已修 [live-carry-row-shows-waiting-forever](live-carry-row-shows-waiting-forever.md) — 被携入(carry)的行永远等不到 eval:start,live 表格卡在 waiting for a slot 到进程结束,底层调度其实是对的;修为 carry 判断提成 planCarry() 共用、cli.ts 提前算好传给 live 表格,LiveRow 新增 carriedVerdict 让携入行第一帧就渲染真实 verdict(`fingerprint.ts` + `cli.ts` + `runner/reporters/live.ts`)
- 已修 [live-raw-stderr-write-desyncs-redraw](live-raw-stderr-write-desyncs-redraw.md) — sandbox teardown 失败/budget 不可执行/reporter 抛错等独立诊断行绕开 live 表格裸写 stderr,回跳量与实际光标错位,每帧越滚越多刷屏(行数不超屏也会触发,和 live-overflow-redraw-appends-frames 是两条不同根因);修为新增 `src/tty-line.ts` 统一诊断行出口,live.ts 订阅后先清显示再放行(`tty-line.ts` + `sandbox/registry.ts` + `runner/run.ts` + `runner/report.ts` + `sandbox/docker.ts` + `sandbox/vercel.ts` + `runner/reporters/live.ts`)
- 已修 [show-skipped-version-hint-missing](show-skipped-version-hint-missing.md) — `niceeval show` 全部落盘不可读时只报 `skipped <dir> (reason)`,不像 `view` 那样给 `npx niceeval@<version>` 建议;`show --run` 认结果根不认单快照,修为按版本分组给统一 `--run` 建议(`src/results/skipped-notice.ts` + `src/show/render.ts` 的 `skippedRunsText`)
- 已修 [exp-show-unbounded-output-cases](exp-show-unbounded-output-cases.md) — 真机实测:exp 全 reused 时缺 FAILURES + per-config 复用清单铺开 + `0s` 却 `$7.04`(时长本次/成本累计矛盾);show 的 `commandSucceeded` Result 单元格 dump 整段 stdout ~30 行;契约已补 docs,exp 反馈侧与 show 展示侧(两步压缩第二步 + received 分层塑形 + CommandResult.command evidence)均已修,落点见正文
- 已修 [received-ansi-control-bytes-leak](received-ansi-control-bytes-leak.md) — `received`(jest/vitest 命令输出)的 ANSI 着色码在 exp/show/report 里显成乱码:`summaryText` 只折 `\s` 不覆盖 ESC/BEL/BS;修为新增 `stripControl`(去 ANSI+不可打印控制字节、保留 glyph 与换行),summaryText 与两个报告详情面共用,原始字节仍存 artifact(`src/scoring/display.ts` + `AttemptAssertions/AttemptSource.tsx`)
- 已被后续裁决替代 [attempt-phase-tracking-teardown-always-last](attempt-phase-tracking-teardown-always-last.md) — 给失败通知补 `phase` 字段时,朴素地取「最后一次 onPhase 回调」几乎恒等于 `"teardown"`;排除 teardown 仍会被正常的 diff/scoring/trace collect 污染,最终修法见下一条
- 已修 [failure-notice-phase-is-error-origin-not-last-lifecycle-phase](failure-notice-phase-is-error-origin-not-last-lifecycle-phase.md) — failure 通知对 `failed` 不发 phase,对 `errored` 直接取 `result.error.phase`;不能用最后 lifecycle phase 反推 verdict 原因
- 已修 [experiment-setup-progress-activity-blackhole](experiment-setup-progress-activity-blackhole.md) — 实验级 setup 全程零输出(状态行全员 queued 像卡死):runner 不为 setup 发布事件且 cli.md 无显示契约,`ctx.progress`→`reportActivity` 因四个渲染器都没实现可选 `activity()` 钩子被静默丢弃;修为 runner 发布 `experiment-hook` 起止事件 + 运行级 active 行 + agent/ci 起止行,human 实现 `activity()`(feedback 各文件 + run.ts)
- [lifecycle-operation-missing-eval-teardown](lifecycle-operation-missing-eval-teardown.md) — v6 结构化 error/diagnostics 的 `operation` 取自封闭 `LifecycleOperationName`,但集合没有 eval 的 teardown/cleanup 项(agent/sandbox 都有);eval cleanup 失败的诊断按 owner 归到 `eval.setup`,要精确区分需先给 docs 补 `eval.teardown` 项(契约未修,`src/runner/attempt.ts`)
- 已修 [force-exit-skips-experiment-teardown](force-exit-skips-experiment-teardown.md) — Ctrl-C 强清路径跳过实验级 teardown 留孤儿;一修=加速收尾三件套(注册表兜底+先停沙箱+逐调用体 30s 超时);二修(2026-07-18)=事件驱动收口:15s 窗口 < 30s 预算倒挂且在飞收尾对 drain 不可见,改为 memoized promise 可等待、settle 即退、兜底上限 2×CLEANUP_TIMEOUT_MS 从常量推导
- 已修 [eval-reserved-word-breaks-predicate-example](eval-reserved-word-breaks-predicate-example.md) — `eval` 是 strict mode 保留绑定标识符,不能当参数名;`ExperimentDef.evals` 类型签名与 docs 示例原写成 `(eval) => eval.id...` 会让用户抄示例直接语法报错,统一改参数名为 `e`(`src/runner/types.ts` + `docs/feature/experiments/{library,README}.md`)
- [experiment-teardown-missed-once-in-batch](experiment-teardown-missed-once-in-batch.md) — 实验级 teardown 在一次 72-attempt 批跑中未触发(间歇,根因未定位,候选已排除清单在正文);兜底修法:run 收尾幂等扫尾 + `experiment-teardown-late` 诊断探针,看到该诊断请回填本条
- [results-schema-version-history](results-schema-version-history.md) — Results Format schemaVersion 逐版差异台账(1→7),正文只声明当前版本,升版时来这里追加一行

## 报告 · view

### 裁决

- [publish-redaction-copysnapshots-not-report](publish-redaction-copysnapshots-not-report.md) — 设计裁决:发布消毒移到 copySnapshots({ redact }),AttemptList.redact 降为展示层(2026-07-14),推翻「消毒归报告」——view --out 原样发布 artifact,列表脱敏挡不住深链
- [view-compare-tab-rejected](view-compare-tab-rejected.md) — 裁决(2026-07-21):不做 view 内建 Compare tab 与 Eval 目录页,roadmap「View 增强」删除;两快照对比由 `DeltaTable by="snapshot"` 报告组件承担,内建 tab 违反「宿主不拥有 pages 之外的导航」契约
- [chart-subcomponent-syntax-decisions](chart-subcomponent-syntax-decisions.md) — 裁决(2026-07-21):图表子组件语法三候选收敛为自研子组件单一设计(recharts SVG 生成器与「只加阶梯」否决,阶梯并入);component-mapping 撤页溶进 library,facet 容器/共享图例/线端标注定为设计上不支持,by+value 合并=精确匹配覆盖;roadmap 文档不留待裁决中间态、不写「现状做不到」
- [view-out-narrowing-reversal](view-out-narrowing-reversal.md) — 裁决(2026-07-17):view 收窄(位置参数/--exp)改为管线输入,滤出有效根,页面+viewData+证据树一致收窄,`view <收窄> --out` ≡ 对收窄后的根导出;翻案旧「--out 与收窄互斥、发布收窄走 copySnapshots」;中途方案「只滤证据清单、viewData 全量」因数据仍烘进 HTML 出站被收紧;同日 `--experiment` 更名 `--exp`
- [report-extends-and-builtin-view-collection](report-extends-and-builtin-view-collection.md) — 裁决(2026-07-17):报告级复用走 `defineReport({ extends })`(页归 base、外壳逐字段覆盖、调用时折叠),`niceeval/report/built-in` 改为具名视图集合(当前只有 `standard`,默认导出恒等于它);否决照抄唯一路径(加个 title 要抄 40 行)与页具名导出(复用单位应是整份有名字的报告);改 src 后必须 `pnpm run build:report`,exports 指向 dist
- [publish-redaction-removed](publish-redaction-removed.md) — 设计裁决:发布脱敏管线(redact 必填/publish 标记/--allow-sensitive-artifacts/展示层 redact)整体移除;保密边界在采集侧,真实根实测零秘密;兜底方向是只警告不改写的凭据扫描
- [view-server-serves-site-plan](view-server-serves-site-plan.md) — 裁决(2026-07-16):view 本地 server 与 --out 统一为单一站点管线(SitePlan 清单,布局/取数知识单点在 site.ts,逐字节奇偶测试守护);否决双链路各自修与「先导出临时目录再服务」;旁路取数删除,宿主语义只剩首页重建/embed 两条(收窄 2026-07-17 改为管线输入,见 view-out-narrowing-reversal)
- [report-head-channel-replaces-asset-attrs](report-head-channel-replaces-asset-attrs.md) — 裁决(2026-07-16):外壳第三方脚本/meta/favicon 走结构化 `head` 通道(白名单 tag+attrs+children),否决 ReportAsset 加 attrs、JSX 直给 `<script>`、raw HTML 字符串三方案;`{src}` 外链装载报错指引 head
- [report-shell-brand-title-axis-rulings](report-shell-brand-title-axis-rulings.md) — 裁决(2026-07-16,第六批):页头品牌位恒 NiceEval、title 落点改 hero/浏览器标题(回退终点改内置文案)、ReportLink.icon 只收内联 SVG 不收组件(外壳可序列化)、散点轴向跟随 better 恒右上越好(翻案「左上」文案修正);品牌位与 hero 归宿主部分 2026-07-17 被第七批再翻案,见 reports-no-privilege-chrome-rulings
- [reports-no-privilege-chrome-rulings](reports-no-privilege-chrome-rulings.md) — 裁决(2026-07-17,第七批):宿主内容特权清零——内建报告改三页(Attempts/Traces 成普通页)、Hero/HeroCard/ScopeWarnings/PoweredBy/CopyFixPrompt/TraceWaterfall 组件化、品牌=组件不给配置、show 多页改渲染初始页+尾部索引、深链改由 attempt 详情路由对全根解析保证、skipped 快照并进 unreadable-snapshot warning;翻案第二轮「证据页归宿主」与第四/六批品牌裁决(内容归属部分已被下一条再取代)
- [attempt-detail-is-a-parametrized-page](attempt-detail-is-a-parametrized-page.md) — 裁决(2026-07-19):attempt 详情从宿主固定路由内容翻案为报告里唯一 `input:"attempt"` 参数化 page,`ExperimentComparison`/`AttemptDetail` 都只是组合件,无 attempt page 即无隐式 locator 目标;取代上一条与 reports-redesign-implementation.md 第48/51条里"内容归宿主"的部分
- [attempt-source-visual-aligns-landing-e2e-owns-styles](attempt-source-visual-aligns-landing-e2e-owns-styles.md) — 裁决(2026-07-20):AttemptSource 与 landing 示例卡定为同一视觉语言的两份实现(否决共享组件:hydration vs 零 JS、发布依赖、数据方向相反),规范落 attempt-detail.md;样式守护从单元层(JSDOM computed-style/markup 断言)移交 e2e 真实浏览器,jsdom devDep 移除
- [scope-warnings-group-by-action](scope-warnings-group-by-action.md) — 裁决(2026-07-17):ScopeWarnings 从逐条平铺翻案为按动作(experimentId)聚合——组头徽标+去重命令恒可见,message 明细收 `<details>`(≤3 默认展开);否决按 kind 分组、整块折叠、折叠开关 props;kind 表新增类别/徽标模板两列
- [reports-component-page-report-redesign](reports-component-page-report-redesign.md) — 裁决(2026-07-16):Reports 三层重设计——组件自带 resolve(spec/data 双形态)、defineReport 单一产物+页字段 content、内建报告塌缩一行、Selection→Scope、ctx.report 只读声明;否决了手工两步式唯一写法、Body/Site 双产物、ReportBuild、definePage、自定义 config 袋
- [reports-dx-dogfood-rulings](reports-dx-dogfood-rulings.md) — 裁决(2026-07-16):真实 repo 试写回灌——pairsByFlag 派生配对(A/B 由 flags 导出不手抄 id)、FailureList 成品组合件、非空元组按元素来源二分(pairs/questions 放宽)、repeatedFailedCommands 内置;否决隐藏未命中 pair 的旋钮
- [reports-fourth-review-rulings](reports-fourth-review-rulings.md) — 裁决(2026-07-16):Reports 第四轮全量 docs 评审——ScopeOverview 并入 ScopeSummary(votes 选计票级)、--run→--results、Runs 页→Attempts、turns→assistantTurns、across→acrossEvals、数据形状维度名统一 +Dimension 后缀、redact 扩到三列表、evalGroup/--history/--snapshot/Row·Style 补契约、evals 计数示例对账修正;撤回 locales 与 relativeTo 改名(尊重第三轮否决)、poweredBy 开关(用户当场推翻)
- [reports-external-review-rulings](reports-external-review-rulings.md) — 裁决(2026-07-16):Reports 外部评审第三轮——current() 加可比性前提、AttemptListItem 瘦身成 failureSummary、ReportNode 穷尽定义、Scoreboard 拆 notRun/unscorable、ScopeOverview/ScopeSummary/runConfig()/--source 等改名;否决 groupBy/locales 旋钮(路径即分组 API、回退即多语)与 Powered-by/locator/redact 各改名翻案
- [annotated-source-absorbs-send-annotations](annotated-source-absorbs-send-annotations.md) — 裁决(2026-07-15):`--eval` 在 t.send 行标注 turn 头行事实,`AnnotatedEvalSource` 收编 `SendAnnotation`,推翻头注「events → 轮次是 ExecutionTree 地盘」;send 标注不设 unmapped 兜底桶
- [report-zero-js-to-progressive-enhancement](report-zero-js-to-progressive-enhancement.md) — 翻案裁决:报告 web 面「零客户端 JS」改为渐进增强(enhance.js:表头排序/行过滤/tooltip);口径同源由 sort 预排保证,view 默认首页迁到报告槽后榜单没有排序过滤在浏览上不成立
- [report-locale-rendering](report-locale-rendering.md) — 裁决:report 渲染面引入 locale(en/zh-CN)与内部字典 src/report/locale.ts,不复用 CLI 专用的 src/i18n;label 扩 LocalizedText 而 display 不本地化(display 是口径的一部分)
- [metrictable-expand-replaces-default-report-caselist](metrictable-expand-replaces-default-report-caselist.md) — 裁决(2026-07-11):defaultReport 榜单加 MetricTable.data 的 expand 选项(TableSubRow,web 面原生 details、text 面缩进明细),experiment 行点开看逐题判定/原因,取代裸跑报告尾部单独的 CaseList 板块;`<DefaultReport/>` 官方水位锚点不受影响仍用 CaseList
- 已实现 [entitylist-components-replace-experimenttable-caselist](entitylist-components-replace-experimenttable-caselist.md) — 裁决(2026-07-12):`ExperimentList`/`EvalList`/`AttemptList` 三个实体层级组件取代混合实体的 `ExperimentTable`、独立的 `CaseList`,以及仅一天前才定案的 `MetricTable.expand`/`TableSubRow`(见上一条);`MetricTable` 收窄回纯维度 × 指标;后续报告实体只保留 locator,不携带报告专用证据 capability
- 已修 [experimentlist-entity-boundary-keeps-comparison-table](experimentlist-entity-boundary-keeps-comparison-table.md) — 裁决(2026-07-13):保留 ExperimentList 一项一个 experiment 的实体边界,web 面恢复固定八列比较表、text 面保持 experiment→Eval→Attempt 层级;locator 不附证据字母;单实验散点照常画;裸 show/view 共用 `ExperimentComparison` 的 text/web 面
- [default-report-partitions-experiment-groups](default-report-partitions-experiment-groups.md) — 设计翻案(2026-07-19):默认报告取消实验组,直接比较当前 Scope;各 experiment 的 eval 集读取 `selectedEvalIds`,路径只负责身份与选择
- [experimentcomparison-relativeto-cosmetic-vs-groupby](experimentcomparison-relativeto-cosmetic-vs-groupby.md) — 裁决(2026-07-20,同日翻案):`ExperimentList`/`ExperimentComparison` 的显式 `relativeTo` 当天被推翻,改为行标签默认自动缩成最短唯一后缀(与 `MetricScatter` 点标签共用算法),零配置
- 已修 [global-react-jsx-shim-rejected](global-react-jsx-shim-rejected.md) — 裁决(2026-07-12):否决 `src/report/jsx-runtime-patch.ts` 的 `globalThis.React` 全局补丁(914a0bd 引入),改为 package-owned report runtime 发布预编译 ESM、固定自己的 JSX 语义,不依赖消费方 cwd/tsconfig;补丁已删除,`dist/report/**` 已接线(`pnpm run build:report`)
- [attempt-locator-and-source-dedup](attempt-locator-and-source-dedup.md) — 裁决(2026-07-12):`AttemptLocator`/eval 源码去重接入 writer/open/copy,schemaVersion 4→5;携带条目的 locator 只能原样复制不能重算(原快照 startedAt 读取时已丢失),`buildLocatorIndex` 不适用于携带链路;sources 去重是快照根两层存储(attempt 级引用 + `sources/<sha256>.json`),`copySnapshots` 靠 `attempt.sources()` 解引用后重新落盘,不是单文件 `copyFile`

### 台账

- [view-shell-nav-ignores-page-navigation-flag](view-shell-nav-ignores-page-navigation-flag.md) — scope-input page 显式声明 `navigation: false` 时,view 外壳导航仍把它渲染成 tab;`renderReportSlot` 算出的 `navigablePages` 只喂 `initialPageId` 兜底,没喂 `viewData.report.pages`;目前无场景触发(唯一会设它的 attempt-input page 更早已被过滤掉),未修
- 已修 [scatter-series-color-collision](scatter-series-color-collision.md) — 散点两个不同 series(bub/codex)散列进同一色格显示同色不可辨;修为同图键集合按图例顺序线性探测消解冲突,跨图稳定让位图内可辨(`src/report/react/colors.ts` 的 colorIndicesForKeys)
- 已修 [react19-dangerously-set-inner-html-identity](react19-dangerously-set-inner-html-identity.md) — React 19 对 dangerouslySetInnerHTML 只比 `{__html}` 对象身份,内联字面量让任何重渲染都整树重建报告槽(开关 attempt 弹窗丢 details/排序/过滤状态);修为 useMemo 包 `{__html}`(`src/view/app/App.tsx` 的 ReportSlot)
- [details-ua-slot-breaks-display-contents-tabs](details-ua-slot-breaks-display-contents-tabs.md) — `<details>` 的 UA shadow slot 让 display:contents 布局失效(Chrome 下 order 失效、残留 0 宽盒);Tabs 增强改用 flex 换行方案(styles.css)
- [view-tool-io-dropped-not-adapter-bug](view-tool-io-dropped-not-adapter-bug.md) — view 里工具出入参"看不到"是渲染层丢的,不是 adapter / SDK 的问题
- 已修 [static-site-export-drops-sources](static-site-export-drops-sources.md) — 静态托管导出丢 sources.json,code view 显示"源码未捕获"(0.3.0 已修)
- 已修 [view-sources-artifact-serving-not-dereferenced](view-sources-artifact-serving-not-dereferenced.md) — sources.json 落盘改两层去重存储后,`server.ts`/`index.ts` 的 artifact 出口仍原样转发/拷贝引用格式(`{path,sha256}[]`),浏览器端 guard 因缺 `content` 字段静默判空;修为两处都改经 `AttemptHandle.sources()` 解引用(`src/view/server.ts` + `src/view/index.ts` + `src/view/data.ts` 的 `loadAttemptIndex`/`attemptsByBase`)
- 已修 [view-unknown-event-type-drops-whole-transcript](view-unknown-event-type-drops-whole-transcript.md) — 源码视图 send 行「无回复」的两个前端根因:`asEvents` 全有全无校验被一条 `skill.loaded` 整体判空(修为逐条过滤+补词汇);原生 transcript 的同文本回显把整轮回复抢进不渲染的 noloc 轮(修为轮归属按 loc 判定,`src/view/app/lib/{guards,transcript-data}` 等,记得 `pnpm run view:build`)
- 已修 [showcase-subpath-no-trailing-slash-breaks-artifact-fetch](showcase-subpath-no-trailing-slash-breaks-artifact-fetch.md) — 导出站挂在无尾斜杠子路径(反代 rewrite)时前端相对路径 fetch 打到上一级目录全 404,源码/trace 显示"artifact 缺失"但文件其实都在;修为 `artifactUrl` 以页面 pathname 自算目录基底(`src/view/app/lib/artifact-url.ts`)
- [oversized-tool-output-blows-up-artifacts](oversized-tool-output-blows-up-artifacts.md) — 一条递归 grep 撞进 minified bundle(`head -100` 只限行数不限字节,单行 4.2MB)让 trace.json 撑到 101MB,同一份 51MB 在盘上存三遍;修法=写入面统一截断(运行时全量、落盘 256 KiB,不影响判决),契约已落 docs,代码待实现
- [model-price-table](model-price-table.md) — Total Cost 显示 $0 的根因与模型价格表(成本估算)的数据来源
- 已修 [report-web-face-loader-gotchas](report-web-face-loader-gotchas.md) — view --report:tsx 的 jsx 配置按 tsconfig 目录为界,包内 .tsx web 面退化 classic JSX 要全局 React shim(修在 `src/report/web.ts`);`.tsx?mtime=` cache-busting query 在 vite-node 下炸,装载入口退化重试(修在 `src/report/load.ts`)
- 已修 [view-empty-export-silent-exit0](view-empty-export-silent-exit0.md) — view 对零可读结果曾静默导出空报告 exit 0,CI 发布会把空站顶上线;修为 loadViewScan 一律抛错并列 skipped 明细(修在 `src/view/data.ts`)
- 已修 [codeview-perline-hidden-scrollbar-clips-text](codeview-perline-hidden-scrollbar-clips-text.md) — AttemptModal 代码视图长行(尤其 t.send prompt)被裁断且无滚动条提示,根因是横向滚动挂在每行自己身上还把滚动条砍成 0;改为整块 `.code-lines` 统一滚动(修在 `src/view/styles.css`,`d0b6718` 重构带入,记得改完要 `pnpm run view:build`)
- 已修 [attempt-review-transparent-and-weak-diff](attempt-review-transparent-and-weak-diff.md) — Attempt review 的半透明模糊遮罩保留了报告纹理，暗色下断言行状态色又过淡；遮罩改为高不透明纯色，代码面强制不透底并提高 diff 红绿 gutter/行色对比
- [view-attempt-detail-buries-failure](view-attempt-detail-buries-failure.md) — view 失败 attempt 弹窗首屏全是全展开 timing 树,契约要求的断言区从未实现(26e967e 删旧分组视图 + 792aae0 插时间树 + 74affaf 契约无场景行无测试);测试方案落 unit-tests/reports,修复计划在 plan/view-attempt-detail-evidence-first.md
- 已修 [reasonfor-priority-and-severity-bug](reasonfor-priority-and-severity-bug.md) — `MetricTable` 展开子行、`CaseList.data`、`<DefaultReport />` failing board 曾各写一份 `.find(a => !a.passed)`,优先级还是断言先于 error、不查 skipReason、soft 断言混进失败原因;提炼成 `compute.ts` 的 `reasonFor`/`failingGateAssertions` 三处共用(修在 `src/report/compute.ts` + `official-report.tsx`)
- 已修 [visual-migration-silently-changed-computed-formulas](visual-migration-silently-changed-computed-formulas.md) — `d0b6718` 把裸跑 UI 迁进 `defaultReport` 时没先建行为矩阵,静默换掉了通过率(two-level mean→朴素比例)、失败原因优先级、组汇总数字三处公式;修法=计算层预先算好唯一正确值(`OverviewData.totals.passRate`、共用 `reasonFor`、新增 `GroupSummary`),渲染面只展示不重算
- [metric-views-compute-nul-byte-separator-blinds-grep](metric-views-compute-nul-byte-separator-blinds-grep.md) — 仓库故意惯例:NUL 字节当防撞车复合 key 分隔符,见于 `metric-views/compute.ts`/`locator.ts`/`skipped-notice.ts`/`EvalList.tsx`;`grep`/`rg` 不带 `-a` 会静默返回空;别当 corruption 用空格"修掉"(2026-07-19 Edit 工具真把一处写坏成 NUL,已 revert,记了怎么分辨)
- 已修 [data-shape-validator-deepening-forward-compat-kind](data-shape-validator-deepening-forward-compat-kind.md) — 深化 `validate*Data` 判别联合炸出既有测试时两种反方向的坑:`ScopeWarning` 未登记 kind 要放行(validator 曾太严,改 validator);`TraceSpan` 字段被两处 fixture 的 `as never` 偷懒绕过(validator 是对的,改 fixture);判断法与两个真实案例见正文
- [report-load-foreign-cwd-jsx-runtime](report-load-foreign-cwd-jsx-runtime.md) — 跨项目 cwd 装载 --report 报 React is not defined:tsx 按进程 cwd 找 tsconfig 拿不到 jsx: react-jsx;未修,workaround 在报告所在项目 cwd 跑
- 已修 [report-src-changes-need-dist-rebuild](report-src-changes-need-dist-rebuild.md) — 改 `src/report/**` 后 CLI 行为不变:show/view 宿主 import 的是 `dist/report` 预编译产物,单测绿 + CLI 旧 ≈ 忘了 `pnpm run build:report`
- 已修 [phase-a-red-tests-pending-standard-attempt-page](phase-a-red-tests-pending-standard-attempt-page.md) — Phase A 后 3 个测试保持红(内建 standard 还没有 attempt page),Phase D 加 standardAttemptPage 后按预期转绿,但要先 `pnpm run build:report`;另有一处硬编码三页的 parity 测试(dual-render.test.tsx)需手工补页
- 已修 [attempt-summary-missing-started-at-attempt-ordinal](attempt-summary-missing-started-at-attempt-ordinal.md) — `attemptSummaryText` 没渲染 `AttemptSummaryData` 已有的 `startedAt`/`identity.attempt`(web 面其实早已渲染,原记录有误);Phase H 修在 `src/report/components/attempt-detail/faces.ts` + 新 locale 键
- 已修 [attempt-detail-component-level-green-composite-broken](attempt-detail-component-level-green-composite-broken.md) — Phase C 11 个叶子组件渲染矩阵全绿,拼成 `standardAttemptPage` 整页渲染一次才发现两处缺陷:5 个证据组件下钻命令丢 locator(不可执行)、失败断言缺源码锚;修法=data 类型加 locator 字段 + `ctx.attemptCommand` 通道 + `assertionLine` 补 `a.loc` 锚点,与 view-attempt-detail-buries-failure 同一类"组件对、组合层缺"问题
- [show-attempt-md-stale-spots-found-in-phase-e](show-attempt-md-stale-spots-found-in-phase-e.md) — Phase H 待办:`docs/feature/reports/show/attempt.md` 三处仍是旧 `attemptOverviewText`/`failureDiagnostics`/单行 timing 过滤的叙述,与新 AttemptDetail 组件族实际输出不符,cases.md 没登记这些行为所以不是 Phase E 该改的范围
- 已修 [attempt-faces-free-text-needs-summarytext-bounding](attempt-faces-free-text-needs-summarytext-bounding.md) — 真实 dogfood repo 冒烟才暴露:断言 received/expected、错误 message、对话逐条回复等自由文本未收口,整份源码/system prompt 原样灌进一行;`summaryText()` 折叠,stack 例外保留多行原样
- 已修 [attempt-page-standalone-document-not-spa-shell](attempt-page-standalone-document-not-spa-shell.md) — Phase F:`attempt/<locator>.html` 不能复用 index.html 的 SPA 外壳(空 #root 违反无 JS 也能读的契约),改用可见 div + hidden 属性切语言;同一轮发现相对路径深度(head 资产)与 locator 编码/解码边界两处只有脱离 server.ts 的真实静态托管才测得出的隐患
- 已修 [view-client-fetch-machinery-fully-removed](view-client-fetch-machinery-fully-removed.md) — Phase F 收尾:AttemptModal/CodeView/Trace/Transcript 整棵客户端手渲染树 + viewData.snapshots 一起删除,attempt 详情改 fetch 独立文档塞 dialog;记录判活依据、无浏览器环境下的验证手法;遗留的 cases.md 陈旧行已在 Phase H 处理(第 218 行删除,198/220 行复核后判定无需改)
- 已修 [attempt-detail-components-shipped-without-styles](attempt-detail-components-shipped-without-styles.md) — `4e45185` 新增 AttemptDetail 却没补官方 CSS，`421474f` 切 view 时又删除旧 CodeView，导致裸排版以及语法高亮、状态色、点击展开同时丢失；修为补齐组件族 CSS，并把 loc 回复投影与 diff 式源码交互迁回公开 AttemptSource
- 已修 [render-matrix-not-just-data-matrix](render-matrix-not-just-data-matrix.md) — 注册表场景写"两面渲染输出"时只测 attempt*Data() 返回形状是弱化替代,typecheck/build/test 全绿也遮不住 9/11 叶子组件渲染函数从未被真正调用过;修法=表驱动直接 renderToStaticMarkup/renderNodeToText 两态各跑一遍(src/report/attempt-components.test.tsx)
- [parity-test-compares-source-to-its-own-copy](parity-test-compares-source-to-its-own-copy.md) — 裁决(2026-07-13):「公开 API 够不够用户重建内置报告」由 fixture 能编译过证明,不由输出比对证明;曾选 643 行 built-in-user-parity 测试(把内置报告逐字拷进 fixture 再比对两者输出)因是纯改名检测器被否决——JSX 主体一字不差,恒成立,只在重构时收改名税
- 已修 [eval-parent-repeats-attempt-failure](eval-parent-repeats-attempt-failure.md) — ExperimentList/EvalList 的 web 面曾在 Eval 父行复述某个 Attempt 的失败摘要,单轮完全重复、多轮又冒充题级事实;父行固定为判定+题级聚合,失败原因只留 Attempt 子行
- [report-build-rootdir-and-module-identity](report-build-rootdir-and-module-identity.md) — 落地上一条裁决时的三个构建期坑:rootDir 收窄到 src/report 撞 TS6059、declaration 撞 unique symbol「cannot be named」、raw src 与编译产物是两份模块实例(WebContext 状态/`ReportDefinition`品牌互不相认)
- 已修 [stale-dist-report-type-identity-typecheck](stale-dist-report-type-identity-typecheck.md) — 改 src 公共类型后 `dist/report` 陈旧,typecheck 在 show/view 宿主报「X not assignable to X」同名类型不相认;修法=先 `pnpm run build:report` 重建再排查,不要顺着报错改 src
- [report-component-data-fn-spyon-must-target-component](report-component-data-fn-spyon-must-target-component.md) — 组件 `.data` 是 `Object.assign` 装配时按值拷贝的,`vi.spyOn(计算模块, "xxxData")` 拦不住经组件属性发起的调用,要 spy 组件对象自己(`vi.spyOn(ExperimentList, "data")`)
- 已修 [show-test-duplicates-selection-and-attempt-detail-coverage](show-test-duplicates-selection-and-attempt-detail-coverage.md) — show.test.ts 曾有三条断言经 `runShow()` 整条 CLI 管线复述 `host-equivalence.test.ts` 已直调 `selectCurrentResults` 验证过的 Selection 语义,另一条渲染断言自认与 Attempt 详情组件测试同契约仍留着;测试体系重划 A2 分拣时删除重复覆盖
- [table-primitive-validation-only-reachable-via-render](table-primitive-validation-only-reachable-via-render.md) — `Table` 的列/行 key 校验只嵌在 `web()`/`text()` 渲染面函数体内、未独立导出,纯 resolve/validate 断言够不着,与已导出且有专属测试的 `validateGridColumns` 不对称;测试体系重划 A4 保留渲染触发作为唯一例外,根治需要 touch `primitives.tsx`(超出 A4 范围)

## o11y 采集

- [ai-sdk-otel-needsapproval-no-execute-tool-span](ai-sdk-otel-needsapproval-no-execute-tool-span.md) — @ai-sdk/otel 不给 `needsApproval:true` 的工具产 execute_tool span,action 断言派生不出
- [ai-sdk-agent-otel-timing-subtree-unlinked](ai-sdk-agent-otel-timing-subtree-unlinked.md) — `aiSdkAgent` 的 attempt-scope tracing 下 `show --execution` 的 span↔节点关联正常工作,但 `show --timing` 的 OTel 子树永远挂不出来:turn 从未拿到 `traceId`(shared-pool 才会赋值),就算强制走 shared-pool,window-attribution 生成的合成 traceId 也从不匹配真实 span traceId;未修,e2e/adapter/ai-sdk 的 verify.ts 已写成非 gating 断言;根因与 Agent 工厂无关,迁到 HTTP 传输层后同一缺口原样复现
- [ai-sdk-official-entry-points-narrowed](ai-sdk-official-entry-points-narrowed.md) — 设计裁决:AI SDK 官方接入面收窄为 `uiMessageStreamAgent`/`fromAiSdk` 两个,`aiSdkAgent` 降级为进程内调用窄例外;e2e/adapter/ai-sdk 删 in-process 覆盖,OTel 证明改挂 HTTP 路径
- [langsmith-dialect-langchain-completion-shape-gap](langsmith-dialect-langchain-completion-shape-gap.md) — langsmith 方言解析不了 LangChain ChatOpenAI 实际吐的 gen_ai.completion 形状,message 事件恒空
- [codex-mapcodexspans-not-publicly-exported](codex-mapcodexspans-not-publicly-exported.md) — `mapCodexSpans` 没从 `niceeval/adapter` 公开导出,外部包只能省略 spanMapper 走通用 heuristic
- [events-user-message-and-source-loc](events-user-message-and-source-loc.md) — 事件流 user message 曾丢失 + `t.event("message")` 计数翻倍的根因与修法
- 已修 [sdk-stream-transformers-missing-canonical-tool](sdk-stream-transformers-missing-canonical-tool.md) — `fromCodexThreadEvents` 曾不发 `tool` 规范名,`calledTool("shell")` 在 SDK 流路径静默失配(修在 `src/agents/sdk-streams.ts`;`fromClaudeSdkMessages` 同类未修)
- [execution-tree-merges-events-and-otel-spans](execution-tree-merges-events-and-otel-spans.md) — 裁决(2026-07-12):`buildExecutionTree(events, spans)` 把标准事件流与 OTel span 合并进一棵树,事件当骨架、span 只补时间,推翻 `docs/observability.md` 现行"events 与 spans 永不合并"的旧决定;设计已定稿代码未实现

## 写 eval · scoring · 断言 · judge

- 已修 [brief-crashes-on-preview-undefined](brief-crashes-on-preview-undefined.md) — `JSON.stringify(undefined)` 返回值 undefined 不是字符串,`brief()` 不兜底会让断言预览 undefined 字段值时抛 TypeError 而不是显示 "undefined"(修在 `src/util.ts`)
- [judge-missing-key-unavailable-not-silent](judge-missing-key-unavailable-not-silent.md) — 设计裁决:judge 缺 key 记 unavailable 断言(gate → errored;2026-07-14),推翻「静默不记录 + CI 自查」;unavailable 态同时承载证据覆盖缺口
- [judge-agent-default-material](judge-agent-default-material.md) — `t.judge.agent` 默认材料写死成 diff,对话型 eval 会被误判 0 分
- [judge-criteria-cannot-see-tool-calls](judge-criteria-cannot-see-tool-calls.md) — judge 默认材料看不到工具调用,criteria 要求「基于工具作答」会恒判 0
- 已修 [judge-config-precheck-hard-fails-without-key](judge-config-precheck-hard-fails-without-key.md) — 显式设 `judge.model` 后没有对应 API key 曾是跑前直接抛错退出;现预检只对「实际要跑且源码含 judge」的 eval 生效(修在 `src/runner/run.ts` judgeProbeTargets)
- [deepseek-judge-thinking-mode-tool-choice](deepseek-judge-thinking-mode-tool-choice.md) — 纯 DeepSeek 网关下 `judge.autoevals.closedQA` 必错:thinking mode 不支持其 tool_choice
- [coding-agent-skill-judge-model-proxy-503](coding-agent-skill-judge-model-proxy-503.md) — coding-agent-skill 的 judge 模型在代理端点上 503,judge precheck 直接失败
- [eval-architecture-original-notes](eval-architecture-original-notes.md) — Eval 架构的原始手动笔记与 eve 源码核对记录(2026-07-14 从 docs 原样迁入,正文已重写为正式架构文档)
- [context-spread-getter-freezes-t-reply](context-spread-getter-freezes-t-reply.md) — 顶层 `t.reply` / `t.events` / `t.sessionId` 永远冻结在初始值,断言要用 turn 作用域取
- [pending-tool-call-status-defaults-completed](pending-tool-call-status-defaults-completed.md) — 等审批中的调用在 facts 里默认 completed,"批准前没执行"要对事件流查 action.result 而不是 notCalledTool(status)
- 已修 [loose-gate-regex-plus-soft-judge-false-pass](loose-gate-regex-plus-soft-judge-false-pass.md) — 宽泛 OR 正则 gate + soft judge 阈值叠加,会把明确失败判成 passed(gate 正则别放过泛词)
- [drive-frame-stream-reducer-variance](drive-frame-stream-reducer-variance.md) — `driveFrameStream` 单型参时 reducer 与传输帧联合类型不兼容,tsc 过不了
- [ai-sdk-v7-streamtext-reuse-and-gateway-image-limits](ai-sdk-v7-streamtext-reuse-and-gateway-image-limits.md) — eval 复用生产 streamText 的正确姿势(v7 await 字段即消费流);网关不支持图像在 eval 侧 skip,不改应用元数据
- 已修 [claude-code-e2e-session-resume-maxtokens-budget-too-tight](claude-code-e2e-session-resume-maxtokens-budget-too-tight.md) — `t.maxTokens(80_000)` 当 usage 非空哨兵时贴着真实采样值设上限,真机第二次跑就在 90008 tokens 假阳性判 regression;usage 哨兵上限要留 2~3 倍余量,不能按样本量 1 定(修在 `e2e/adapter/claude-code/evals/session-resume.eval.ts`,提到 200_000)
- [scoped-match-language-docs-first](scoped-match-language-docs-first.md) — 裁决(2026-07-14):`eventsSatisfy(label, predicate)` label 必填在前、`calledTool` 的 `input` 是深度部分匹配小语言(值位 RegExp/顶层 RegExp/谓词);曾按源码反推把契约改成 `(predicate, label?)`+浅层包含被否决——docs 先行,源码落后应改代码;实现缺口在 src/scoring/scoped.ts

## examples · tier-sync · e2e repos

- [tier-sync-merge-tree-pitfalls](tier-sync-merge-tree-pitfalls.md) — 动 `tiers:sync` 前必读:同 base 三方合并解冲突会死循环重报、链式 pair 脏树、lockfile 不能参与合并
- [ai-sdk-usechat-typing-indicator-start-chunk](ai-sdk-usechat-typing-indicator-start-chunk.md) — useChat 收到 start chunk 就推空 assistant 消息,按 role 判断的"思考中"指示器立刻消失
- [ai-sdk-weather-tool-empty-reply-flake](ai-sdk-weather-tool-empty-reply-flake.md) — weather-tool 全断言失败可能是上游模型瞬时空回复,不是采集问题
- [claude-sdk-concurrent-hitl-approve-race](claude-sdk-concurrent-hitl-approve-race.md) — 两条 HITL eval 并发打同一个 claude-sdk server 会永久 404,必须串行或每 attempt 独立实例
- 已修 [langgraph-e2e-hitl-resume-register-before-send](langgraph-e2e-hitl-resume-register-before-send.md) — 同类并发 HITL 404,但根因已定位:自建 SSE bridge 先发 interrupted 帧再登记 pending queue,客户端 resume 能在同进程代码登记前抢先到达;修为登记必须先于发送(`e2e/adapter/langgraph/src/backend/server.py`)
- 已修 [langgraph-stream-status-stale-across-resume](langgraph-stream-status-stale-across-resume.md) — `fromLangGraphEvents()` 的 `LangGraphStream.status` 是持久 getter,resume 后新帧不碰 lifecycle 时仍读到暂停前的 "waiting";判断"这一帧是否新产生 input.requested"要看 `stream.add(frame)` 自己这次返回了什么,不能读 `status`(修在 `e2e/adapter/langgraph/agents/langgraph.ts`)
- [codex-sdk-web-search-s2a-flaky](codex-sdk-web-search-s2a-flaky.md) — codex-sdk 走 s2a 代理时内置 web_search 极不稳定,WebSearchItem 无成败字段
- 已修 [codex-sdk-e2e-codex-home-personal-config-leak](codex-sdk-e2e-codex-home-personal-config-leak.md) — `e2e/adapter/codex-sdk` 在开发者本机跑会读到真实 `~/.codex/config.toml`:ChatGPT 桌面版注册的 `node_repl` MCP server 让 mcp-tool 断言随机失配;`danger-full-access`/`approval_policy=never` 曾悄悄兜底 coding-tool 的文件写入;隔离后还发现自定义 model_provider 默认不请求 reasoning summary 导致 usage 的 thinking 断言恒 0;三处均已修(`e2e/adapter/codex-sdk/agents/codex-sdk.ts` 隔离 `CODEX_HOME` + 显式 sandboxMode/approvalPolicy/model_reasoning_summary,`evals/mcp-tool.eval.ts`/`evals/usage.eval.ts` 配套改 prompt)
- [examples-eval-niceeval-file-link-depth](examples-eval-niceeval-file-link-depth.md) — `examples/zh/eval/<name>` 的 `file:`/`link:` 深度容易少写一层,pnpm 不报错但装错
- [origin-examples-real-ai-credentials](origin-examples-real-ai-credentials.md) — origin 示例已删 mock 模式,全部用真实 DeepSeek/Codex 代理凭据
- 已修 [prompt-ab-variant-loosens-tool-discipline](prompt-ab-variant-loosens-tool-discipline.md) — 整份替换 systemPrompt 的 A/B 变体会顺带改松工具纪律:模型心算跳过工具,HITL/calledTool 断言失真;变体里工具规则要写得和默认 prompt 一样硬(修在 tier3/pi-sdk concise.ts)
- [vm0-has-public-rest-contract](vm0-has-public-rest-contract.md) — vm0 有公开版本化 REST 契约,"无公开 API"的旧调研结论是错的
- [e2e-repo-autonomy-replaces-shared-suite](e2e-repo-autonomy-replaces-shared-suite.md) — 裁决（2026-07-13）：E2E 从共享 factory/profile + 中央 verifier 翻案为独立 repo；每个 repo 自有 app/adapter/eval/experiment/验收，根仓只注入候选包并编排，crabbox 原样执行 repo 命令
- [e2e-repo-self-root-workspace](e2e-repo-self-root-workspace.md) — 裁决(2026-07-21):每个 E2E 仓库必带只含 `packages: []` 的 pnpm-workspace.yaml 自成 workspace root,否则就地 install 会并入父级 workspace 绕过候选注入;曾半数仓库缺、run.ts 注释错引 §2.1,已补齐仓库+升进 docs §2.1/§8+加结构守护

## docs · docs-site · reference

- 已修 [design-status-from-docs-not-src](design-status-from-docs-not-src.md) — 设计讨论时 agent 两次从源码反推现状被推翻;修法=查询纪律与穷尽形状约定升格为 CLAUDE.md / docs 规则,architecture.md 职责纳入数据建模
- 已修 [codex-agent-env-var-doc-drift](codex-agent-env-var-doc-drift.md) — codex agent 鉴权是 `CODEX_API_KEY` 不是 `OPENAI_API_KEY`,文档曾照名字直觉写错
- [docs-otel-mixin-not-implemented](docs-otel-mixin-not-implemented.md) — connect-otel.mdx 曾把未落地的 `otelEvents()` 提案写成已实现 + 死链
- [gen-diff-code-langgraph-config-stale](gen-diff-code-langgraph-config-stale.md) — gen-diff-code 的 langgraph 配对配置和 origin 实际语言对不上
- 已修 [gen-diff-code-run-residue-and-stale-claims](gen-diff-code-run-residue-and-stale-claims.md) — 运行残留文件混进 diff 页;intro 里的事实声明会过期
- [gen-diff-code-venv-oom](gen-diff-code-venv-oom.md) — gen-diff-code 不排除 `.venv`/`__pycache__`,生成 166MB mdx 把 mint validate 撑爆
- [mintlify-mdx-html-rendering-limits](mintlify-mdx-html-rendering-limits.md) — Mintlify MDX 渲染原生 HTML 的四个坑(GitHub 式 diff 页踩出)
- 已修 [docs-result-outcome-field-doesnt-exist](docs-result-outcome-field-doesnt-exist.md) — 英文 docs-site 多篇示例代码用 `result.outcome` 判定通过/失败,真实字段名是 `verdict`,照抄会静默失效(EvalResult 上从未有过 `outcome` 字段)
- [mintlify-zh-heading-anchor-slug](mintlify-zh-heading-anchor-slug.md) — 中文标题的锚点 slug 规则,github-slugger 直觉全错
- [mintlify-npx-cache-corruption](mintlify-npx-cache-corruption.md) — docs:dev/validate 报 ENOTEMPTY / permission denied 是 npx 缓存损坏,清 `~/.npm/_npx` 别改脚本
- 已修 [reference-docs-drift-generated-regions](reference-docs-drift-generated-regions.md) — 参考页手写漂移(matches 写成正则、虚构 .soft() 等);修法=TSDoc 唯一事实来源 + `pnpm docs:reference` 生成区块 + vitest 漂移守护,区块内永远不手改
- 已修 [reference-generator-url-in-tsdoc-nested-quotes](reference-generator-url-in-tsdoc-nested-quotes.md) — TSDoc 里带引号的 URL 字面量经 docs:reference 的自动反引号包裹生成嵌套引号乱码;修法=TSDoc 不写带引号的 URL 示例,改文字描述
- 已修 [custom-reports-dimension-false-dichotomy](custom-reports-dimension-false-dichotomy.md) — custom-reports guide 曾写「内置维度覆盖不了的都走 flag()」,漏讲自定义维度 `{name, of}`,把下游 agent 推去改 8 个 experiment 文件;修法=「换分组:三种维度」三路并列 + 选择判据(guide 讲联合类型要逐臂对照导出面)
- 已修 [docs-renames-dont-auto-propagate-to-docs-site](docs-renames-dont-auto-propagate-to-docs-site.md) — `--eval`→`--source` 改名与 `defineReport` 函数形态删除都只同步了 `docs/`,`docs-site/` 整篇教旧 API;修法=收尾大改动前单独 grep docs-site 找旧名字,不假设 docs/ 干净等于 docs-site 干净
- [docs-site-en-report-components-stale-groupby](docs-site-en-report-components-stale-groupby.md) — 英文 `docs-site/reference/report-components.mdx` 的 ExperimentComparison 一节仍讲已否决的按父目录分组设计,还引用不存在的 `.data()` 静态方法;需独立重写
- [init-bootstrap-install-first](init-bootstrap-install-first.md) — 裁决(2026-07-18):INIT 收缩成自举文件(心智模型/前置/安装+交接 INDEX.md),接入正文搬进随包 `agent-onboarding.mdx`,顺序翻为「先装后探」;否决安装前维护 9 条官网 URL 路由表(零守护,实测已全 404)与 API 复述(版本错位窗口);守护拦 INIT 里的线上文档链接
- [ai-bundled-docs-root-index](ai-bundled-docs-root-index.md) — 裁决：AI 随包文档以 npm 包根 `INDEX.md` 为稳定路由入口，不放进 Mintlify 内容树；INIT 与托管指引只依赖该入口
- [bundled-index-tree-generated-from-frontmatter](bundled-index-tree-generated-from-frontmatter.md) — 裁决(2026-07-17,两连翻案):包根 INDEX.md 改为构建产物——prepare(build:index)打包时从签入的 INDEX.template.md + 各页 frontmatter 生成,不签入 git(dist/report 同模型);先后否决「手写任务表+覆盖守护」与「生成物签入+漂移守护」,守护改「可生成」(缺 description 红灯)

## 环境 · 发布 · CI · 部署

- 已修 [e2e-repo-needs-react-dep-for-show](e2e-repo-needs-react-dep-for-show.md) — 没有前端的消费方项目(如 pi-agent-core E2E 仓库)跑裸 `niceeval show` 报 `Cannot find package 'react'`:react/react-dom 只是可选 peerDependency,不装就用不了默认内建报告;修为该仓库自己显式加这两个依赖
- [optional-peer-deps-raw-ts-consumer-typecheck](optional-peer-deps-raw-ts-consumer-typecheck.md) — 发布裸 .ts 源码时,可选 peer 依赖必须独立子路径导出,绝不从主入口 re-export
- [npm-published-lags-verdict-rename](npm-published-lags-verdict-rename.md) — 本地 checkout 的 docs 已经在讲 `verdict`,但 npm 上的 `niceeval@0.5.4` 还是改名前的 `outcome`/`outcomes`;写外部消费者项目代码时以 `node_modules/niceeval/src/` 实际字段为准,不要以本仓库 docs 为准
- [pnpm11-allowbuilds-placeholder-blocks-install](pnpm11-allowbuilds-placeholder-blocks-install.md) — pnpm 11 给新依赖写 allowBuilds 占位符并让 install exit 1,要手改 pnpm-workspace.yaml
- [pnpm11-verify-deps-gate-blocks-niceeval-cli](pnpm11-verify-deps-gate-blocks-niceeval-cli.md) — pnpm 11 pre-run gate 会在 niceeval 启动前拦死 CLI(消费方项目)
- [e2e-repos-stale-pnpm-workspace-hijacks-lockfile](e2e-repos-stale-pnpm-workspace-hijacks-lockfile.md) — `e2e/pnpm-workspace.yaml`(旧架构遗留)把 `e2e/adapter/<id>` 的 `pnpm install` 顶到 e2e/ 根共享 lockfile;仓库自己的 install 要加 `--ignore-workspace`
- [e2e-s2a-jihuayu-proxy-decommissioned](e2e-s2a-jihuayu-proxy-decommissioned.md) — 旧 `s2a.jihuayu.site` 代理签发的 `OPENAI_*`/`CODEX_*`/`NICEEVAL_JUDGE_*` 凭据全部 401;`api.deepseek.com` 官方端点可平替 chat-completions 场景,Codex(Responses API)不适用、已暂缓
- 已修 [e2e-run-dangerously-allow-all-builds-conflicts-with-allowbuilds](e2e-run-dangerously-allow-all-builds-conflicts-with-allowbuilds.md) — `run.ts` 隔离安装的 `--config.dangerouslyAllowAllBuilds=true` 在 pnpm 10.33+ 上与仓库自己 `allowBuilds` 派生的 `onlyBuiltDependencies` 互斥,`ERR_PNPM_CONFIG_CONFLICT_BUILT_DEPENDENCIES` 让 e2e matrix 常年判红;连带修了缺失的 GitHub secrets、失效的 `NICEEVAL_JUDGE_KEY`、`results` verify.ts 改名后的断言漂移,六仓库全部转绿
- [vercel-site-domain-and-docs-routing](vercel-site-domain-and-docs-routing.md) — niceeval.com 域名指向和 docs routing 容易分裂成 404,部署 Ready ≠ 域名指对
- [site-blog-empty-post-dir-breaks-build](site-blog-empty-post-dir-breaks-build.md) — posts/ 下缺 mdx 的空目录(git 不跟踪)让 site:build ENOENT 崩;全 draft 时 slug 页 404 是预期
- [shared-worktree-concurrent-commit-race](shared-worktree-concurrent-commit-race.md) — 多 agent 共用工作树时 `git add`→`commit` 之间有竞态,暂存文件会被别人的提交带走;用 `git commit <paths>` 一步提交
- 已修 [vitest-collects-agent-worktree-copies](vitest-collects-agent-worktree-copies.md) — `.claude/worktrees/` 被 git 忽略但不被 vitest 忽略,4 个废弃 agent worktree 里的整份 src 副本被当成正式测试跑(45% 的测试跑的是旧源码,抓不到回归却能凭陈旧原因弄红 CI);修为 vitest.config.ts 的 exclude 补 `.claude/**`(与 `.repos/**` 同类)
- 已修 [vitest-collects-sandbox-plugin-content-under-e2e-repos](vitest-collects-sandbox-plugin-content-under-e2e-repos.md) — 同类问题:`e2e/adapter/codex-sdk/.codex-home/` 下真机拉的第三方插件内容含 `*.test.ts`,被根 vitest 当正式测试跑;修为 exclude 补 `e2e/adapter/**`
- [e2e-suite-landing-gotchas](e2e-suite-landing-gotchas.md) — 拷 tier1 项目要同步改 package.json `file:` 与 workspace `link:` 两处深度;`budget` 对不报 usage 的 agent 空转不设防;GH runner 上 Codex bwrap 沙箱起不来要 `CODEX_SANDBOX_MODE=danger-full-access`
- [e2e-verify-results-format-drift](e2e-verify-results-format-drift.md) — `verify.mjs` 手写扫描还认落快照(schemaVersion 4)之前的 `summary.json`,和当前 `snapshot.json`+`result.json` 布局对不上导致每次 push 必红;e2e 重构期间已把 `e2e.yml` 触发器收窄到只剩 `workflow_dispatch`
- 已修 [ci-dead-legacy-dist-import-typecheck](ci-dead-legacy-dist-import-typecheck.md) — built-ins→built-in 目录改名后残留的 legacy 桥接导入让 CI typecheck 红、本地靠陈旧 dist 假绿;修为删死代码直连新入口(`src/show/report-host.ts`),验证 dist 路径改动要先清 dist 重建
- 已修 [typescript7-no-api-alias-recipe](typescript7-no-api-alias-recipe.md) — TS7 原生版只有 tsc 没有编程 API,直升会炸 next build;官方 alias 双装配方(`typescript`→typescript6 + `@typescript/native`→ts7),`typescript` 名下是 6.0.x 是有意为之
- 已修 [site-seo-lcp-and-stale-audit](site-seo-lcp-and-stale-audit.md) — landing 移动端 LCP 慢在渲染阻塞 CSS + 启动 JS(prism 同 chunk),不是字体/图片,`inlineCss`+`next/dynamic` 修(5f1ba01);审计报 `/docs` 死链是 7-03 proxy 修复前的旧数据,先 curl 核实
- 已修 [e2e-candidate-pack-dist-report-react-notfound](e2e-candidate-pack-dist-report-react-notfound.md) — 编排器候选包里 `niceeval show` 报 `Cannot find package 'react'`;最初疑似多 agent 并行 `pnpm pack` 撞了共享 `dist/report/`,后经字节级比对排除(发布版与候选包产物完全一致);真根因是消费方仓库自己没装可选 peerDependency `react`/`react-dom`,补上即全绿,见 [e2e-repo-needs-react-dep-for-show](e2e-repo-needs-react-dep-for-show.md)
- 已修 [init-md-site-copy-symlink](init-md-site-copy-symlink.md) — `site/public/INIT.md` 曾是根 `INIT.md` 的物理拷贝,靠手动 cp 同步,忘了就 CI diff 红;改成 symlink → `../../INIT.md`,根文件成唯一源、site build 跟随,不再手动 cp,diff 检查保留作 backstop

## 跨切面裁决

- [index-classification-by-subsystem](index-classification-by-subsystem.md) — 裁决(2026-07-21):memory 索引按「子系统」单一主轴归档(分区=动手前扫哪块),溶解「设计决定」分区、报告拆出独立、大区内拆裁决(≈DX 反馈)/台账(≈bug);否决把 bug/DX 反馈当顶层主轴(类型轴切顶层=同一块工作扫两处,正是原问题根因)与分离已修条目(违反不归档规则);commit 05a040e
- [turn-label-plain-words](turn-label-plain-words.md) — 裁决(2026-07-21):轮/窗口标签从 `s<session>/t<turn>` 改为自描述词——主会话 `turn<N>`、`t.newSession()` 会话 `session<K>/turn<N>`(从 2 起),全证据面同一枚 token、`--window` 等值匹配;否决全局连号(并行 session 竞态)与恒带 session 前缀(主线噪音);标签不透明不解析,schemaVersion 不递增、旧快照不迁移
- [test-budget-inverted-pyramid](test-budget-inverted-pyramid.md) — 裁决(2026-07-13):测试预算按「静默出错的代价」分配,不按代码量或好测程度,行覆盖率不作指标;出处=全套件审计实测「读结果/画结果」测到 0.91 而「判断对错」(scoring/expect/fingerprint/runEvals/computeVerdict)测到 0;套件质量本身是好的,问题是指向了错的代码,落成 docs/engineering/testing/unit/
- [terminology-overhaul-2026-07](terminology-overhaul-2026-07.md) — 术语大改名裁决(两批):Outcome→Verdict(经 Conclusion 同日翻案,eve/TTCN-3 先例)、Backend→Provider、早停→首过即停(代码名不动)、Judge/Attempt/Turn/artifact/Selection 中文直用、值断言/严重度/dual-render、结果快照限定语;多义词逐语境甄别纪律
- [error-feedback-message-carries-fix](error-feedback-message-carries-fix.md) — 裁决(2026-07-15):报错必带下一步定为跨切面契约(docs/error-feedback.md,三段式+可选 `command`);曾选「必填独立 fix 字段」否决——拆走下一步破坏「只打 message 就完整」承诺、留内嵌又成重复;AttemptError 划在契约边界外
- [test-system-two-layers-no-offline-integration](test-system-two-layers-no-offline-integration.md) — 裁决(2026-07-14):测试体系只有 unit(确定性 fixture)+E2E(全真实)两层,否决「离线 CLI 集成层/无 key 档」(AI 不贵,mock 协议=再实现一遍协议);同批确立变更预算判据(无关测试变红=缺陷)、unit-tests 每 Feature 拆架构/用例两页,并修正 budget 与 Results 选择两处旧测试文档漂移
- [testing-restructure-flat-e2e-owns-behavior](testing-restructure-flat-e2e-owns-behavior.md) — 裁决(2026-07-21):测试文档三目录合并为 testing/{unit,e2e},e2e 平铺 adapter/cli/report 三域(mechanism 取消);单元层收窄到数据语义,渲染/CLI 进程/协议归一整体归 E2E(adapters 单元维度与 22 个 wire-fixture 测试删除);unit 每 Feature 合并成单篇测试文档、登记单位升为覆盖类别(场景由测试代码枚举);守护取舍=流程守护留、结构复检删(e2e-structure.test.ts 删);跟改率口径落 churn.md,迁移清单落 plan/testing-layer-realignment.md
