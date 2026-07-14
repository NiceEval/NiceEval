# Memory 索引

memory 的召回全靠这份索引:漏索引的条目等于不存在。维护规则:

- **先读后动**:动手涉及下面某个分区(沙箱、judge、tier-sync、docs 生成……)前,先扫该分区;命中一行才读正文,大多数条目停在一行即可。
- **写完即索引**:新增 memory 文件必须同步在这里加一行,格式 `- [条目名](条目文件名.md) — 一句现象+结论`。`test/memory-index.test.ts` 随 `pnpm test` 校验每个条目都有索引行。
- **修好标注,不删除**:bug 修好后行首标「已修」,并在条目正文补修法落点(文件/commit)。已修条目是后续复盘"这个修法合理不合理"的材料,不归档不删除。
- **复盘出口**:修法复盘后被确认为长期约束的,升格为 CLAUDE.md 或 docs/ 里的一句规则(原条目保留作出处);被推翻的,更新原条目记录新判断。
- **设计裁决也记这里**:翻案、砍掉的方案、反复改的来龙去脉记「设计决定」分区,一条 = 裁决 / 曾选方案 / 否决理由 / 日期。docs 正文只写定稿形态与理由,不留时间线;需要出处时链到这里的条目。

## 沙箱与内置 agent

- [skill-install-via-git-not-skills-cli](skill-install-via-git-not-skills-cli.md) — 设计裁决:repo skill 改走 git clone(`skills` CLI 没法钉 ref、也枚举不出仓库里有哪些 skill);已真机验证；Claude Code E2E 曾错用 `calledTool("Skill")` 查找已归一成 `skill.loaded` 的事件，现已修并 2/2 真机通过
- [native-plugin-marketplace-name-not-caller-assignable](native-plugin-marketplace-name-not-caller-assignable.md) — `ClaudeCodePluginSpec`/`CodexPluginSpec` 的 `marketplace.name` 文档暗示调用方自定,真实 CLI 按目标仓库 manifest 自己的 `name` 注册,名字不匹配时 `marketplace add` 静默成功、下一步 `plugin install/add` 才报错;真实仓库复现,此 fixture 已落成两条 Docker 真机 e2e(Claude Code + Codex),bug 本身未修
- 已修 [codex-plugin-list-json-shape-guessed-wrong](codex-plugin-list-json-shape-guessed-wrong.md) — `codex plugin list --json` 真实形状是 `{ installed: [...] }` + `pluginId` 字段,旧代码猜成裸数组/`{ plugins: [...] }` + `id`,`resolvedVersion` 对任何真实安装恒返回 undefined;native plugin 真机 e2e 复现(修在 `src/agents/codex.ts`)
- 已修 [brief-crashes-on-preview-undefined](brief-crashes-on-preview-undefined.md) — `JSON.stringify(undefined)` 返回值 undefined 不是字符串,`brief()` 不兜底会让断言预览 undefined 字段值时抛 TypeError 而不是显示 "undefined"(修在 `src/util.ts`)
- 已修 [agent-setup-workspace-writes-pollute-diff](agent-setup-workspace-writes-pollute-diff.md) — git 基线早于 `agent.setup`,所以 setup 往 workspace 装的 skill / AGENTS.md 会被当成 agent 产出记进 diff;修为写 `.git/info/exclude`(能放 `$HOME` 就别放 workspace)
- **待裁决** [structural-typing-cannot-reject-spec-swap](structural-typing-cannot-reject-spec-swap.md) — 同形的两个具名 Spec,TS 结构类型拦不住互换;文档已止血(只承诺**形状**不承诺**值**),但「要不要加判别字段/品牌化真的拦住」未定,2026-07-13 处理
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
- 已修 [skill-loaded-input-field-is-skill-not-command](skill-loaded-input-field-is-skill-not-command.md) — 实现 `skill.loaded` 归一化时凭印象把入参字段猜成 `input.command`,正确字段是 `input.skill`(仓库已有实测 memory 记录了这个形状,没检索到就重新猜错了);修在 `src/o11y/parsers/claude-code.ts`
- [mcp-tool-naming-claude-vs-codex](mcp-tool-naming-claude-vs-codex.md) — MCP 工具规范名两家不同:claude-code 是 `mcp__<server>__<tool>`,codex 是 `<server>.<tool>`(点分隔)
- [run-command-canonical-tool-name-portability](run-command-canonical-tool-name-portability.md) — 断言"跑过 shell"要用规范类目 `"shell"`,不要用某一家的原始工具名字面量(如 `"command_execution"` 只对 codex 恰好成立)
- [docker-apple-silicon-amd64-emulation-slow](docker-apple-silicon-amd64-emulation-slow.md) — 本机 Apple Silicon 上 dockerSandbox 默认拉 amd64 镜像走模拟,沙箱型 eval 实测比原生慢好几倍,timeoutMs 要留余量
- [claude-code-persistent-memory-breaks-verbal-isolation](claude-code-persistent-memory-breaks-verbal-isolation.md) — claude-code 会把"帮我记住"写进磁盘 memory,newSession 后合法记得;session-isolation 反证要测 transcript 不回放历史,不测回答不含事实
- [sandbox-provision-ratelimit-retry](sandbox-provision-ratelimit-retry.md) — 设计裁决:provisioning 限流按 provider 归类成中性 kind,退避重试放在 resolve.ts 而非 runner,不覆盖运行期限流
- 已修 [provision-retry-holds-concurrency-slot](provision-retry-holds-concurrency-slot.md) — provisioning 退避重试期间攥着 sandboxSem 并发名额陪跑 setTimeout,一批 429 能把实际并发拖到远低于 --max-concurrency 声明值(个位数);修为 ProvisionSlot 退避前 release、睡醒后 reacquire(`src/sandbox/retry.ts` + `resolve.ts` + `runner/attempt.ts`)

## judge

- [judge-agent-default-material](judge-agent-default-material.md) — `t.judge.agent` 默认材料写死成 diff,对话型 eval 会被误判 0 分
- [judge-criteria-cannot-see-tool-calls](judge-criteria-cannot-see-tool-calls.md) — judge 默认材料看不到工具调用,criteria 要求「基于工具作答」会恒判 0
- 已修 [judge-config-precheck-hard-fails-without-key](judge-config-precheck-hard-fails-without-key.md) — 显式设 `judge.model` 后没有对应 API key 曾是跑前直接抛错退出;现预检只对「实际要跑且源码含 judge」的 eval 生效(修在 `src/runner/run.ts` judgeProbeTargets)
- [deepseek-judge-thinking-mode-tool-choice](deepseek-judge-thinking-mode-tool-choice.md) — 纯 DeepSeek 网关下 `judge.autoevals.closedQA` 必错:thinking mode 不支持其 tool_choice
- [coding-agent-skill-judge-model-proxy-503](coding-agent-skill-judge-model-proxy-503.md) — coding-agent-skill 的 judge 模型在代理端点上 503,judge precheck 直接失败

## 写 eval:context、断言与类型

- [context-spread-getter-freezes-t-reply](context-spread-getter-freezes-t-reply.md) — 顶层 `t.reply` / `t.events` / `t.sessionId` 永远冻结在初始值,断言要用 turn 作用域取
- [pending-tool-call-status-defaults-completed](pending-tool-call-status-defaults-completed.md) — 等审批中的调用在 facts 里默认 completed,"批准前没执行"要对事件流查 action.result 而不是 notCalledTool(status)
- 已修 [loose-gate-regex-plus-soft-judge-false-pass](loose-gate-regex-plus-soft-judge-false-pass.md) — 宽泛 OR 正则 gate + soft judge 阈值叠加,会把明确失败判成 passed(gate 正则别放过泛词)
- [drive-frame-stream-reducer-variance](drive-frame-stream-reducer-variance.md) — `driveFrameStream` 单型参时 reducer 与传输帧联合类型不兼容,tsc 过不了
- [ai-sdk-v7-streamtext-reuse-and-gateway-image-limits](ai-sdk-v7-streamtext-reuse-and-gateway-image-limits.md) — eval 复用生产 streamText 的正确姿势(v7 await 字段即消费流);网关不支持图像在 eval 侧 skip,不改应用元数据

## o11y 采集与 view

- [ai-sdk-otel-needsapproval-no-execute-tool-span](ai-sdk-otel-needsapproval-no-execute-tool-span.md) — @ai-sdk/otel 不给 `needsApproval:true` 的工具产 execute_tool span,action 断言派生不出
- [langsmith-dialect-langchain-completion-shape-gap](langsmith-dialect-langchain-completion-shape-gap.md) — langsmith 方言解析不了 LangChain ChatOpenAI 实际吐的 gen_ai.completion 形状,message 事件恒空
- [codex-mapcodexspans-not-publicly-exported](codex-mapcodexspans-not-publicly-exported.md) — `mapCodexSpans` 没从 `niceeval/adapter` 公开导出,外部包只能省略 spanMapper 走通用 heuristic
- [events-user-message-and-source-loc](events-user-message-and-source-loc.md) — 事件流 user message 曾丢失 + `t.event("message")` 计数翻倍的根因与修法
- [view-tool-io-dropped-not-adapter-bug](view-tool-io-dropped-not-adapter-bug.md) — view 里工具出入参"看不到"是渲染层丢的,不是 adapter / SDK 的问题
- 已修 [static-site-export-drops-sources](static-site-export-drops-sources.md) — 静态托管导出丢 sources.json,code view 显示"源码未捕获"(0.3.0 已修)
- 已修 [view-sources-artifact-serving-not-dereferenced](view-sources-artifact-serving-not-dereferenced.md) — sources.json 落盘改两层去重存储后,`server.ts`/`index.ts` 的 artifact 出口仍原样转发/拷贝引用格式(`{path,sha256}[]`),浏览器端 guard 因缺 `content` 字段静默判空;修为两处都改经 `AttemptHandle.sources()` 解引用(`src/view/server.ts` + `src/view/index.ts` + `src/view/data.ts` 的 `loadAttemptIndex`/`attemptsByBase`)
- [oversized-tool-output-blows-up-artifacts](oversized-tool-output-blows-up-artifacts.md) — 一条递归 grep 撞进 minified bundle(`head -100` 只限行数不限字节,单行 4.2MB)让 trace.json 撑到 101MB,同一份 51MB 在盘上存三遍;修法=写入面统一截断(运行时全量、落盘 256 KiB,不影响判决),契约已落 docs,代码待实现
- [model-price-table](model-price-table.md) — Total Cost 显示 $0 的根因与模型价格表(成本估算)的数据来源
- 已修 [sdk-stream-transformers-missing-canonical-tool](sdk-stream-transformers-missing-canonical-tool.md) — `fromCodexThreadEvents` 曾不发 `tool` 规范名,`calledTool("shell")` 在 SDK 流路径静默失配(修在 `src/agents/sdk-streams.ts`;`fromClaudeSdkMessages` 同类未修)
- 已修 [report-web-face-loader-gotchas](report-web-face-loader-gotchas.md) — view --report:tsx 的 jsx 配置按 tsconfig 目录为界,包内 .tsx web 面退化 classic JSX 要全局 React shim(修在 `src/report/web.ts`);`.tsx?mtime=` cache-busting query 在 vite-node 下炸,装载入口退化重试(修在 `src/report/load.ts`)
- 已修 [view-empty-export-silent-exit0](view-empty-export-silent-exit0.md) — view 对零可读结果曾静默导出空报告 exit 0,CI 发布会把空站顶上线;修为 loadViewScan 一律抛错并列 skipped 明细(修在 `src/view/data.ts`)
- 已修 [codeview-perline-hidden-scrollbar-clips-text](codeview-perline-hidden-scrollbar-clips-text.md) — AttemptModal 代码视图长行(尤其 t.send prompt)被裁断且无滚动条提示,根因是横向滚动挂在每行自己身上还把滚动条砍成 0;改为整块 `.code-lines` 统一滚动(修在 `src/view/styles.css`,`d0b6718` 重构带入,记得改完要 `pnpm run view:build`)
- 已修 [attempt-review-transparent-and-weak-diff](attempt-review-transparent-and-weak-diff.md) — Attempt review 的半透明模糊遮罩保留了报告纹理，暗色下断言行状态色又过淡；遮罩改为高不透明纯色，代码面强制不透底并提高 diff 红绿 gutter/行色对比
- 已修 [reasonfor-priority-and-severity-bug](reasonfor-priority-and-severity-bug.md) — `MetricTable` 展开子行、`CaseList.data`、`<DefaultReport />` failing board 曾各写一份 `.find(a => !a.passed)`,优先级还是断言先于 error、不查 skipReason、soft 断言混进失败原因;提炼成 `compute.ts` 的 `reasonFor`/`failingGateAssertions` 三处共用(修在 `src/report/compute.ts` + `official-report.tsx`)
- 已修 [visual-migration-silently-changed-computed-formulas](visual-migration-silently-changed-computed-formulas.md) — `d0b6718` 把裸跑 UI 迁进 `defaultReport` 时没先建行为矩阵,静默换掉了通过率(two-level mean→朴素比例)、失败原因优先级、组汇总数字三处公式;修法=计算层预先算好唯一正确值(`OverviewData.totals.passRate`、共用 `reasonFor`、新增 `GroupSummary`),渲染面只展示不重算

## CLI 与运行

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
- 已修 [attempt-phase-tracking-teardown-always-last](attempt-phase-tracking-teardown-always-last.md) — 给失败通知补 `phase` 字段时,朴素地取「最后一次 onPhase 回调」几乎恒等于 `"teardown"`(它在 `finally` 里无条件触发,且从不影响 verdict);修为 `run.ts` 的 `lastPhase` 显式排除 teardown(`src/runner/run.ts` + `src/runner/attempt.ts` 新增的 `onPhase` 参数)
- [lifecycle-operation-missing-eval-teardown](lifecycle-operation-missing-eval-teardown.md) — v6 结构化 error/diagnostics 的 `operation` 取自封闭 `LifecycleOperationName`,但集合没有 eval 的 teardown/cleanup 项(agent/sandbox 都有);eval cleanup 失败的诊断按 owner 归到 `eval.setup`,要精确区分需先给 docs 补 `eval.teardown` 项(契约未修,`src/runner/attempt.ts`)

## examples 与 tier-sync

- [tier-sync-merge-tree-pitfalls](tier-sync-merge-tree-pitfalls.md) — 动 `tiers:sync` 前必读:同 base 三方合并解冲突会死循环重报、链式 pair 脏树、lockfile 不能参与合并
- [ai-sdk-usechat-typing-indicator-start-chunk](ai-sdk-usechat-typing-indicator-start-chunk.md) — useChat 收到 start chunk 就推空 assistant 消息,按 role 判断的"思考中"指示器立刻消失
- [ai-sdk-weather-tool-empty-reply-flake](ai-sdk-weather-tool-empty-reply-flake.md) — weather-tool 全断言失败可能是上游模型瞬时空回复,不是采集问题
- [claude-sdk-concurrent-hitl-approve-race](claude-sdk-concurrent-hitl-approve-race.md) — 两条 HITL eval 并发打同一个 claude-sdk server 会永久 404,必须串行或每 attempt 独立实例
- [codex-sdk-web-search-s2a-flaky](codex-sdk-web-search-s2a-flaky.md) — codex-sdk 走 s2a 代理时内置 web_search 极不稳定,WebSearchItem 无成败字段
- [examples-eval-niceeval-file-link-depth](examples-eval-niceeval-file-link-depth.md) — `examples/zh/eval/<name>` 的 `file:`/`link:` 深度容易少写一层,pnpm 不报错但装错
- [origin-examples-real-ai-credentials](origin-examples-real-ai-credentials.md) — origin 示例已删 mock 模式,全部用真实 DeepSeek/Codex 代理凭据
- 已修 [prompt-ab-variant-loosens-tool-discipline](prompt-ab-variant-loosens-tool-discipline.md) — 整份替换 systemPrompt 的 A/B 变体会顺带改松工具纪律:模型心算跳过工具,HITL/calledTool 断言失真;变体里工具规则要写得和默认 prompt 一样硬(修在 tier3/pi-sdk concise.ts)
- [vm0-has-public-rest-contract](vm0-has-public-rest-contract.md) — vm0 有公开版本化 REST 契约,"无公开 API"的旧调研结论是错的

## docs 与 docs-site

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
- 已修 [custom-reports-dimension-false-dichotomy](custom-reports-dimension-false-dichotomy.md) — custom-reports guide 曾写「内置维度覆盖不了的都走 flag()」,漏讲自定义维度 `{name, of}`,把下游 agent 推去改 8 个 experiment 文件;修法=「换分组:三种维度」三路并列 + 选择判据(guide 讲联合类型要逐臂对照导出面)

## 环境、发布与部署

- [optional-peer-deps-raw-ts-consumer-typecheck](optional-peer-deps-raw-ts-consumer-typecheck.md) — 发布裸 .ts 源码时,可选 peer 依赖必须独立子路径导出,绝不从主入口 re-export
- [npm-published-lags-verdict-rename](npm-published-lags-verdict-rename.md) — 本地 checkout 的 docs 已经在讲 `verdict`,但 npm 上的 `niceeval@0.5.4` 还是改名前的 `outcome`/`outcomes`;写外部消费者项目代码时以 `node_modules/niceeval/src/` 实际字段为准,不要以本仓库 docs 为准
- [pnpm11-allowbuilds-placeholder-blocks-install](pnpm11-allowbuilds-placeholder-blocks-install.md) — pnpm 11 给新依赖写 allowBuilds 占位符并让 install exit 1,要手改 pnpm-workspace.yaml
- [pnpm11-verify-deps-gate-blocks-niceeval-cli](pnpm11-verify-deps-gate-blocks-niceeval-cli.md) — pnpm 11 pre-run gate 会在 niceeval 启动前拦死 CLI(消费方项目)
- [vercel-site-domain-and-docs-routing](vercel-site-domain-and-docs-routing.md) — niceeval.com 域名指向和 docs routing 容易分裂成 404,部署 Ready ≠ 域名指对
- [site-blog-empty-post-dir-breaks-build](site-blog-empty-post-dir-breaks-build.md) — posts/ 下缺 mdx 的空目录(git 不跟踪)让 site:build ENOENT 崩;全 draft 时 slug 页 404 是预期
- [shared-worktree-concurrent-commit-race](shared-worktree-concurrent-commit-race.md) — 多 agent 共用工作树时 `git add`→`commit` 之间有竞态,暂存文件会被别人的提交带走;用 `git commit <paths>` 一步提交
- 已修 [vitest-collects-agent-worktree-copies](vitest-collects-agent-worktree-copies.md) — `.claude/worktrees/` 被 git 忽略但不被 vitest 忽略,4 个废弃 agent worktree 里的整份 src 副本被当成正式测试跑(45% 的测试跑的是旧源码,抓不到回归却能凭陈旧原因弄红 CI);修为 vitest.config.ts 的 exclude 补 `.claude/**`(与 `.repos/**` 同类)
- [e2e-suite-landing-gotchas](e2e-suite-landing-gotchas.md) — 拷 tier1 项目要同步改 package.json `file:` 与 workspace `link:` 两处深度;`budget` 对不报 usage 的 agent 空转不设防;GH runner 上 Codex bwrap 沙箱起不来要 `CODEX_SANDBOX_MODE=danger-full-access`
- [e2e-verify-results-format-drift](e2e-verify-results-format-drift.md) — `verify.mjs` 手写扫描还认落快照(schemaVersion 4)之前的 `summary.json`,和当前 `snapshot.json`+`result.json` 布局对不上导致每次 push 必红;e2e 重构期间已把 `e2e.yml` 触发器收窄到只剩 `workflow_dispatch`
- 已修 [typescript7-no-api-alias-recipe](typescript7-no-api-alias-recipe.md) — TS7 原生版只有 tsc 没有编程 API,直升会炸 next build;官方 alias 双装配方(`typescript`→typescript6 + `@typescript/native`→ts7),`typescript` 名下是 6.0.x 是有意为之
- 已修 [site-seo-lcp-and-stale-audit](site-seo-lcp-and-stale-audit.md) — landing 移动端 LCP 慢在渲染阻塞 CSS + 启动 JS(prism 同 chunk),不是字体/图片,`inlineCss`+`next/dynamic` 修(5f1ba01);审计报 `/docs` 死链是 7-03 proxy 修复前的旧数据,先 curl 核实

## 设计决定

- [test-budget-inverted-pyramid](test-budget-inverted-pyramid.md) — 裁决(2026-07-13):测试预算按「静默出错的代价」分配,不按代码量或好测程度,行覆盖率不作指标;出处=全套件审计实测「读结果/画结果」测到 0.91 而「判断对错」(scoring/expect/fingerprint/runEvals/computeVerdict)测到 0;套件质量本身是好的,问题是指向了错的代码,落成 docs/engineering/unit-tests/
- [parity-test-compares-source-to-its-own-copy](parity-test-compares-source-to-its-own-copy.md) — 裁决(2026-07-13):「公开 API 够不够用户重建内置报告」由 fixture 能编译过证明,不由输出比对证明;曾选 643 行 built-in-user-parity 测试(把内置报告逐字拷进 fixture 再比对两者输出)因是纯改名检测器被否决——JSX 主体一字不差,恒成立,只在重构时收改名税
- [e2e-repo-autonomy-replaces-shared-suite](e2e-repo-autonomy-replaces-shared-suite.md) — 裁决（2026-07-13）：E2E 从共享 factory/profile + 中央 verifier 翻案为独立 repo；每个 repo 自有 app/adapter/eval/experiment/验收，根仓只注入候选包并编排，crabbox 原样执行 repo 命令
- [ai-bundled-docs-root-index](ai-bundled-docs-root-index.md) — 裁决：AI 随包文档以 npm 包根 `INDEX.md` 为稳定路由入口，不放进 Mintlify 内容树；INIT 与托管指引只依赖该入口
- [terminology-overhaul-2026-07](terminology-overhaul-2026-07.md) — 术语大改名裁决(两批):Outcome→Verdict(经 Conclusion 同日翻案,eve/TTCN-3 先例)、Backend→Provider、早停→首过即停(代码名不动)、Judge/Attempt/Turn/artifact/Selection 中文直用、值断言/严重度/dual-render、结果快照限定语;多义词逐语境甄别纪律
- [sandbox-field-no-bare-string](sandbox-field-no-bare-string.md) — `sandbox` 字段只接受工厂产出的 SandboxSpec:不接受裸字符串、没有默认值、没有自动探测(用户 review 明确定案)
- [registermcp-post-hoc-primitive](registermcp-post-hoc-primitive.md) — 翻案裁决:不提供后置追加 MCP 原语,`shared.registerMcp` 当日落地当日撤销;MCP 只走 factory 构造期,条件包装器应接收 factory 而不是已构造 Agent
- [sandbox-lifecycle-hooks](sandbox-lifecycle-hooks.md) — 环境预置的家是 SandboxSpec 链式 `.setup()/.teardown()`(实验级/沙箱级两次翻案后定案);ExperimentDef 保持纯数据;persistentState 不做,状态钩子自管、键用 ctx.experimentId
- [experiment-flags-naming-reversal](experiment-flags-naming-reversal.md) — 条件键定名 flags(A/B feature flag 语义,2026-07-10 params 同日翻案);字段改名=递增 schemaVersion,不做读取别名
- [report-zero-js-to-progressive-enhancement](report-zero-js-to-progressive-enhancement.md) — 翻案裁决:报告 web 面「零客户端 JS」改为渐进增强(enhance.js:表头排序/行过滤/tooltip);口径同源由 sort 预排保证,view 默认首页迁到报告槽后榜单没有排序过滤在浏览上不成立
- [report-locale-rendering](report-locale-rendering.md) — 裁决:report 渲染面引入 locale(en/zh-CN)与内部字典 src/report/locale.ts,不复用 CLI 专用的 src/i18n;label 扩 LocalizedText 而 display 不本地化(display 是口径的一部分)
- [results-per-snapshot](results-per-snapshot.md) — 裁决(2026-07-11):落盘单位 run→快照,实验目录在外层、判决落 attempt 级 result.json,run 级 summary.json 废除;翻案 2026-07-10「判定 journal 不做」;schemaVersion 4
- [bench-direct-invocation-not-niceeval-project](bench-direct-invocation-not-niceeval-project.md) — 裁决(2026-07-11):phase-timings.md 的 bench/ 是直接调 runAttemptBody 的脚本,不是 niceeval 项目+Reports 报告页;曾选 show 对比/compare.mjs 均否决
- [carry-includes-failed-verdict](carry-includes-failed-verdict.md) — 裁决(2026-07-11):resume/carry 携入条件从「只 passed」改为「passed 或 failed」,只有 errored 重跑;曾选「只 passed 携入」否决(failed 也是判定确定的终态,没理由白花成本重复验证)
- [metrictable-expand-replaces-default-report-caselist](metrictable-expand-replaces-default-report-caselist.md) — 裁决(2026-07-11):defaultReport 榜单加 MetricTable.data 的 expand 选项(TableSubRow,web 面原生 details、text 面缩进明细),experiment 行点开看逐题判定/原因,取代裸跑报告尾部单独的 CaseList 板块;`<DefaultReport/>` 官方水位锚点不受影响仍用 CaseList
- 已实现 [entitylist-components-replace-experimenttable-caselist](entitylist-components-replace-experimenttable-caselist.md) — 裁决(2026-07-12):`ExperimentList`/`EvalList`/`AttemptList` 三个实体层级组件取代混合实体的 `ExperimentTable`、独立的 `CaseList`,以及仅一天前才定案的 `MetricTable.expand`/`TableSubRow`(见上一条);`MetricTable` 收窄回纯维度 × 指标;后续报告实体只保留 locator,不携带报告专用证据 capability
- 已修 [experimentlist-entity-boundary-keeps-comparison-table](experimentlist-entity-boundary-keeps-comparison-table.md) — 裁决(2026-07-13):保留 ExperimentList 一项一个 experiment 的实体边界,web 面恢复固定八列比较表、text 面保持 experiment→Eval→Attempt 层级;locator 不附证据字母;单实验散点照常画;裸 show/view 共用 `ExperimentComparison` 的 text/web 面
- [execution-tree-merges-events-and-otel-spans](execution-tree-merges-events-and-otel-spans.md) — 裁决(2026-07-12):`buildExecutionTree(events, spans)` 把标准事件流与 OTel span 合并进一棵树,事件当骨架、span 只补时间,推翻 `docs/observability.md` 现行"events 与 spans 永不合并"的旧决定;设计已定稿代码未实现
- 已修 [global-react-jsx-shim-rejected](global-react-jsx-shim-rejected.md) — 裁决(2026-07-12):否决 `src/report/jsx-runtime-patch.ts` 的 `globalThis.React` 全局补丁(914a0bd 引入),改为 package-owned report runtime 发布预编译 ESM、固定自己的 JSX 语义,不依赖消费方 cwd/tsconfig;补丁已删除,`dist/report/**` 已接线(`pnpm run build:report`)
- [report-build-rootdir-and-module-identity](report-build-rootdir-and-module-identity.md) — 落地上一条裁决时的三个构建期坑:rootDir 收窄到 src/report 撞 TS6059、declaration 撞 unique symbol「cannot be named」、raw src 与编译产物是两份模块实例(WebContext 状态/`ReportDefinition`品牌互不相认)
- [report-component-data-fn-spyon-must-target-component](report-component-data-fn-spyon-must-target-component.md) — 组件 `.data` 是 `Object.assign` 装配时按值拷贝的,`vi.spyOn(计算模块, "xxxData")` 拦不住经组件属性发起的调用,要 spy 组件对象自己(`vi.spyOn(ExperimentList, "data")`)
- [attempt-locator-and-source-dedup](attempt-locator-and-source-dedup.md) — 裁决(2026-07-12):`AttemptLocator`/eval 源码去重接入 writer/open/copy,schemaVersion 4→5;携带条目的 locator 只能原样复制不能重算(原快照 startedAt 读取时已丢失),`buildLocatorIndex` 不适用于携带链路;sources 去重是快照根两层存储(attempt 级引用 + `sources/<sha256>.json`),`copySnapshots` 靠 `attempt.sources()` 解引用后重新落盘,不是单文件 `copyFile`
- [feedback-redraw-clock-to-state-change](feedback-redraw-clock-to-state-change.md) — 裁决(2026-07-13):human dashboard 重画从 80ms `setInterval` 驱动的 spinner 帧改为「reducer 真实状态变化 + coordinator tick 机会 + 同帧不写」驱动;旧模型是 live-overflow-redraw-appends-frames / live-raw-stderr-write-desyncs-redraw 两次滚屏 bug 的共同根因,根治靠拆开状态源与重画时机,不是再打一个 ANSI 光标补丁
- [feedback-profile-replaces-tty-detection](feedback-profile-replaces-tty-detection.md) — 裁决(2026-07-13):`niceeval exp` 退役 `--quiet` 与 `stderr.isTTY` 直接决定 Live/Console 的旧模型,改为显式 `--output human|agent|ci`(`auto` 只做环境侦测顺序:显式值→TTY→CI 环境变量→agent 兜底);TTY 是传输能力不是消费者身份,`--quiet` 曾试图用一个开关同时压低给人看和给机器看的输出,两边都没做对(见 quiet-progress-result-stream-asymmetry)
- [attempt-phase-scoped-feedback-api-deferred](attempt-phase-scoped-feedback-api-deferred.md) — 裁决(2026-07-13):本次只把 `AttemptPhase` 实现成 runner 内部枚举(attempt.ts 沿既有生命周期步骤发出),`docs/feature/experiments/cli.md`「Attempt 阶段」描述的更完整形态——按 owner 分层的具名 operation scope + 面向 Sandbox provider/Agent adapter 的公开 `ScopedFeedback.progress()/diagnostic()` API——推迟出本次范围;原因是材料上远大于本次 TODO 清单、且仓促做容易在核心调度路径长出 agent==X/sandbox==Y 式特判,应先让内部枚举跑稳再决定要不要对外暴露
- [phase-timings-teardown-steps-and-show-view](phase-timings-teardown-steps-and-show-view.md) — 裁决(2026-07-14):`phases` 闭集补收尾段(agent.teardown/sandbox.teardown/sandbox.stop,不入 durationMs 口径)、setup/teardown 钩子链新增 step 级明细(phase 级合计保留),消费面扩到 show 首页 timing 行 + `--timing` 切面与 view Attempt 详情;翻案「teardown 不计时」「钩子链只合计」「show/view 不提供阶段视图」三条原契约
- [unified-attempt-timing-tree](unified-attempt-timing-tree.md) — 裁决(2026-07-14):扁平 phase steps 升级为 phase→hook/turn→sandbox command 的递归时间树,turn 以 traceId 挂接 OTel agent/model/tool；`--timing` 成为完整时间入口,`--execution` 只保留事件旁时间注释；推翻「agent.setup 不细分」与「timing/execution 各管半边时间」
- [lifecycle-phase-vocabulary-unification](lifecycle-phase-vocabulary-unification.md) — 裁决(2026-07-14):AttemptPhase/PhaseName/LifecycleOperationName 三套生命周期词表合一为 `LifecyclePhase` 闭集(含归并对照表,新增 eval.teardown);`error.operation`/`diagnostics.operation` 改名 `phase`,schemaVersion 6→7;曾选「保留三套+映射表」因永久同步税与已发生的可见漂移否决
- [scoped-feedback-finalized](scoped-feedback-finalized.md) — 裁决(2026-07-14):ScopedFeedback(progress/diagnostic)定稿为 feature 契约、单一归属 experiments/library.md,roadmap 提案页删除;三个遗留分歧逐条裁决(ctx 注入签名、core 中立属实现纪律、`ctx.log` = progress 别名);07-13 的推迟裁决仍约束实现排期,不再约束文档定稿状态
- [results-schema-version-history](results-schema-version-history.md) — Results Format schemaVersion 逐版差异台账(1→7),正文只声明当前版本,升版时来这里追加一行
- [test-system-two-layers-no-offline-integration](test-system-two-layers-no-offline-integration.md) — 裁决(2026-07-14):测试体系只有 unit(确定性 fixture)+E2E(全真实)两层,否决「离线 CLI 集成层/无 key 档」(AI 不贵,mock 协议=再实现一遍协议);同批确立变更预算判据(无关测试变红=缺陷)、unit-tests 每 Feature 拆架构/用例两页,并修正 budget 与 Results 选择两处旧测试文档漂移
