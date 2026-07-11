# Memory 索引

memory 的召回全靠这份索引:漏索引的条目等于不存在。维护规则:

- **先读后动**:动手涉及下面某个分区(沙箱、judge、tier-sync、docs 生成……)前,先扫该分区;命中一行才读正文,大多数条目停在一行即可。
- **写完即索引**:新增 memory 文件必须同步在这里加一行,格式 `- [条目名](条目文件名.md) — 一句现象+结论`。`test/memory-index.test.ts` 随 `pnpm test` 校验每个条目都有索引行。
- **修好标注,不删除**:bug 修好后行首标「已修」,并在条目正文补修法落点(文件/commit)。已修条目是后续复盘"这个修法合理不合理"的材料,不归档不删除。
- **复盘出口**:修法复盘后被确认为长期约束的,升格为 CLAUDE.md 或 docs/ 里的一句规则(原条目保留作出处);被推翻的,更新原条目记录新判断。
- **设计裁决也记这里**:翻案、砍掉的方案、反复改的来龙去脉记「设计决定」分区,一条 = 裁决 / 曾选方案 / 否决理由 / 日期。docs 正文只写定稿形态与理由,不留时间线;需要出处时链到这里的条目。

## 沙箱与内置 agent

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
- 已修 [npx-skills-add-headless-hang](npx-skills-add-headless-hang.md) — `npx skills add` 默认交互式选 agent,headless 沙箱里卡死;修为 `-y -a <agent>`(claude-code.ts / codex.ts)
- [claude-code-skill-tool-name-not-load-skill](claude-code-skill-tool-name-not-load-skill.md) — claude-code 原生 Skill 工具叫 `Skill`(入参 `{skill,args}`),`t.loadedSkill()` 是给 eve 协议的糖,断不中,要用 `calledTool("Skill", …)`
- [codex-no-native-skill-tool](codex-no-native-skill-tool.md) — codex 没有原生 skill 工具,不显式提示"检查有没有 skill 文件"就几乎不会主动去读装好的 skill
- [mcp-tool-naming-claude-vs-codex](mcp-tool-naming-claude-vs-codex.md) — MCP 工具规范名两家不同:claude-code 是 `mcp__<server>__<tool>`,codex 是 `<server>.<tool>`(点分隔)
- [run-command-canonical-tool-name-portability](run-command-canonical-tool-name-portability.md) — 断言"跑过 shell"要用规范类目 `"shell"`,不要用某一家的原始工具名字面量(如 `"command_execution"` 只对 codex 恰好成立)
- [docker-apple-silicon-amd64-emulation-slow](docker-apple-silicon-amd64-emulation-slow.md) — 本机 Apple Silicon 上 dockerSandbox 默认拉 amd64 镜像走模拟,沙箱型 eval 实测比原生慢好几倍,timeoutMs 要留余量
- [claude-code-persistent-memory-breaks-verbal-isolation](claude-code-persistent-memory-breaks-verbal-isolation.md) — claude-code 会把"帮我记住"写进磁盘 memory,newSession 后合法记得;session-isolation 反证要测 transcript 不回放历史,不测回答不含事实

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
- [model-price-table](model-price-table.md) — Total Cost 显示 $0 的根因与模型价格表(成本估算)的数据来源
- 已修 [sdk-stream-transformers-missing-canonical-tool](sdk-stream-transformers-missing-canonical-tool.md) — `fromCodexThreadEvents` 曾不发 `tool` 规范名,`calledTool("shell")` 在 SDK 流路径静默失配(修在 `src/agents/sdk-streams.ts`;`fromClaudeSdkMessages` 同类未修)
- 已修 [report-web-face-loader-gotchas](report-web-face-loader-gotchas.md) — view --report:tsx 的 jsx 配置按 tsconfig 目录为界,包内 .tsx web 面退化 classic JSX 要全局 React shim(修在 `src/report/web.ts`);`.tsx?mtime=` cache-busting query 在 vite-node 下炸,装载入口退化重试(修在 `src/report/load.ts`)
- 已修 [view-empty-export-silent-exit0](view-empty-export-silent-exit0.md) — view 对零可读结果曾静默导出空报告 exit 0,CI 发布会把空站顶上线;修为 loadViewScan 一律抛错并列 skipped 明细(修在 `src/view/data.ts`)

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

## examples 与 tier-sync

- [tier-sync-merge-tree-pitfalls](tier-sync-merge-tree-pitfalls.md) — 动 `tiers:sync` 前必读:同 base 三方合并解冲突会死循环重报、链式 pair 脏树、lockfile 不能参与合并
- [ai-sdk-usechat-typing-indicator-start-chunk](ai-sdk-usechat-typing-indicator-start-chunk.md) — useChat 收到 start chunk 就推空 assistant 消息,按 role 判断的"思考中"指示器立刻消失
- [ai-sdk-weather-tool-empty-reply-flake](ai-sdk-weather-tool-empty-reply-flake.md) — weather-tool 全断言失败可能是上游模型瞬时空回复,不是采集问题
- [claude-sdk-concurrent-hitl-approve-race](claude-sdk-concurrent-hitl-approve-race.md) — 两条 HITL eval 并发打同一个 claude-sdk server 会永久 404,必须串行或每 attempt 独立实例
- [codex-sdk-web-search-s2a-flaky](codex-sdk-web-search-s2a-flaky.md) — codex-sdk 走 s2a 代理时内置 web_search 极不稳定,WebSearchItem 无成败字段
- [examples-eval-niceeval-file-link-depth](examples-eval-niceeval-file-link-depth.md) — `examples/zh/eval/<name>` 的 `file:`/`link:` 深度容易少写一层,pnpm 不报错但装错
- [origin-examples-real-ai-credentials](origin-examples-real-ai-credentials.md) — origin 示例已删 mock 模式,全部用真实 DeepSeek/Codex 代理凭据
- [vm0-has-public-rest-contract](vm0-has-public-rest-contract.md) — vm0 有公开版本化 REST 契约,"无公开 API"的旧调研结论是错的

## docs 与 docs-site

- 已修 [codex-agent-env-var-doc-drift](codex-agent-env-var-doc-drift.md) — codex agent 鉴权是 `CODEX_API_KEY` 不是 `OPENAI_API_KEY`,文档曾照名字直觉写错
- [docs-otel-mixin-not-implemented](docs-otel-mixin-not-implemented.md) — connect-otel.mdx 曾把未落地的 `otelEvents()` 提案写成已实现 + 死链
- [gen-diff-code-langgraph-config-stale](gen-diff-code-langgraph-config-stale.md) — gen-diff-code 的 langgraph 配对配置和 origin 实际语言对不上
- 已修 [gen-diff-code-run-residue-and-stale-claims](gen-diff-code-run-residue-and-stale-claims.md) — 运行残留文件混进 diff 页;intro 里的事实声明会过期
- [gen-diff-code-venv-oom](gen-diff-code-venv-oom.md) — gen-diff-code 不排除 `.venv`/`__pycache__`,生成 166MB mdx 把 mint validate 撑爆
- [mintlify-mdx-html-rendering-limits](mintlify-mdx-html-rendering-limits.md) — Mintlify MDX 渲染原生 HTML 的四个坑(GitHub 式 diff 页踩出)
- [mintlify-zh-heading-anchor-slug](mintlify-zh-heading-anchor-slug.md) — 中文标题的锚点 slug 规则,github-slugger 直觉全错
- [mintlify-npx-cache-corruption](mintlify-npx-cache-corruption.md) — docs:dev/validate 报 ENOTEMPTY / permission denied 是 npx 缓存损坏,清 `~/.npm/_npx` 别改脚本
- 已修 [reference-docs-drift-generated-regions](reference-docs-drift-generated-regions.md) — 参考页手写漂移(matches 写成正则、虚构 .soft() 等);修法=TSDoc 唯一事实来源 + `pnpm docs:reference` 生成区块 + vitest 漂移守护,区块内永远不手改

## 环境、发布与部署

- [optional-peer-deps-raw-ts-consumer-typecheck](optional-peer-deps-raw-ts-consumer-typecheck.md) — 发布裸 .ts 源码时,可选 peer 依赖必须独立子路径导出,绝不从主入口 re-export
- [pnpm11-allowbuilds-placeholder-blocks-install](pnpm11-allowbuilds-placeholder-blocks-install.md) — pnpm 11 给新依赖写 allowBuilds 占位符并让 install exit 1,要手改 pnpm-workspace.yaml
- [pnpm11-verify-deps-gate-blocks-niceeval-cli](pnpm11-verify-deps-gate-blocks-niceeval-cli.md) — pnpm 11 pre-run gate 会在 niceeval 启动前拦死 CLI(消费方项目)
- [vercel-site-domain-and-docs-routing](vercel-site-domain-and-docs-routing.md) — niceeval.com 域名指向和 docs routing 容易分裂成 404,部署 Ready ≠ 域名指对
- [site-blog-empty-post-dir-breaks-build](site-blog-empty-post-dir-breaks-build.md) — posts/ 下缺 mdx 的空目录(git 不跟踪)让 site:build ENOENT 崩;全 draft 时 slug 页 404 是预期
- [shared-worktree-concurrent-commit-race](shared-worktree-concurrent-commit-race.md) — 多 agent 共用工作树时 `git add`→`commit` 之间有竞态,暂存文件会被别人的提交带走;用 `git commit <paths>` 一步提交
- [e2e-suite-landing-gotchas](e2e-suite-landing-gotchas.md) — 拷 tier1 项目要同步改 package.json `file:` 与 workspace `link:` 两处深度;`budget` 对不报 usage 的 agent 空转不设防;GH runner 上 Codex bwrap 沙箱起不来要 `CODEX_SANDBOX_MODE=danger-full-access`
- 已修 [typescript7-no-api-alias-recipe](typescript7-no-api-alias-recipe.md) — TS7 原生版只有 tsc 没有编程 API,直升会炸 next build;官方 alias 双装配方(`typescript`→typescript6 + `@typescript/native`→ts7),`typescript` 名下是 6.0.x 是有意为之
- 已修 [site-seo-lcp-and-stale-audit](site-seo-lcp-and-stale-audit.md) — landing 移动端 LCP 慢在渲染阻塞 CSS + 启动 JS(prism 同 chunk),不是字体/图片,`inlineCss`+`next/dynamic` 修(5f1ba01);审计报 `/docs` 死链是 7-03 proxy 修复前的旧数据,先 curl 核实

## 设计决定

- [terminology-overhaul-2026-07](terminology-overhaul-2026-07.md) — 术语大改名裁决(两批):Outcome→Verdict(经 Conclusion 同日翻案,eve/TTCN-3 先例)、Backend→Provider、早停→首过即停(代码名不动)、Judge/Attempt/Turn/artifact/Selection 中文直用、值断言/严重度/dual-render、结果快照限定语;多义词逐语境甄别纪律
- [sandbox-field-no-bare-string](sandbox-field-no-bare-string.md) — `sandbox` 字段只接受工厂产出的 SandboxSpec:不接受裸字符串、没有默认值、没有自动探测(用户 review 明确定案)
- [registermcp-post-hoc-primitive](registermcp-post-hoc-primitive.md) — 翻案裁决:不提供后置追加 MCP 原语,`shared.registerMcp` 当日落地当日撤销;MCP 只走 factory 构造期,条件包装器应接收 factory 而不是已构造 Agent
- [sandbox-lifecycle-hooks](sandbox-lifecycle-hooks.md) — 环境预置的家是 SandboxSpec 链式 `.setup()/.teardown()`(实验级/沙箱级两次翻案后定案);ExperimentDef 保持纯数据;persistentState 不做,状态钩子自管、键用 ctx.experimentId
- [experiment-flags-naming-reversal](experiment-flags-naming-reversal.md) — 条件键定名 flags(A/B feature flag 语义,2026-07-10 params 同日翻案);字段改名=递增 schemaVersion,不做读取别名
