# Memory 索引

memory 的召回全靠这份索引:漏索引的条目等于不存在。维护规则:

- **先读后动**:动手涉及下面某个分区(沙箱、judge、tier-sync、docs 生成……)前,先扫该分区;命中一行才读正文,大多数条目停在一行即可。
- **写完即索引**:新增 memory 文件必须同步在这里加一行,格式 `- [条目名](条目文件名.md) — 一句现象+结论`。`test/memory-index.test.ts` 随 `pnpm test` 校验每个条目都有索引行。
- **修好标注,不删除**:bug 修好后行首标「已修」,并在条目正文补修法落点(文件/commit)。已修条目是后续复盘"这个修法合理不合理"的材料,不归档不删除。
- **复盘出口**:修法复盘后被确认为长期约束的,升格为 CLAUDE.md 或 docs/ 里的一句规则(原条目保留作出处);被推翻的,更新原条目记录新判断。

## 沙箱与内置 agent

- 已修 [sandbox-home-hardcode](sandbox-home-hardcode.md) — sandbox 的 $HOME 因 backend 而异,不能 hardcode `/home/node`;agent `setup()` 动态探测(修在 `src/agents/bub.ts`)
- 已修 [bub-workspace-path-hardcode](bub-workspace-path-hardcode.md) — 同上但漏了 workspace:bub 的 `--workspace` 曾写死 Docker 路径,要读 `sb.workdir`(修在 `src/agents/bub.ts`)
- [docker-default-image-no-python3](docker-default-image-no-python3.md) — dockerSandbox 默认镜像没有 python3,依赖 python 的 eval 必失败
- 已修 [vercel-sandbox-issues](vercel-sandbox-issues.md) — Vercel session 寿命 ~360-390s(上游限制,压并发绕过);SESSION_TIMEOUT_MS 必须固定常量,timeout 传越大 session 反而越短(修在 `src/sandbox/vercel.ts`)
- [e2b-sandbox](e2b-sandbox.md) — e2b base 模板只有 node20 + ~481MB 内存(npm install 会 OOM kill),内存/node 版本由模板烘焙决定;重 eval 用预制模板 `fasteval-agents`,构建踩坑清单在正文
- [claude-agent-sdk-permission-mode-silent-skip](claude-agent-sdk-permission-mode-silent-skip.md) — claude-agent-sdk `query()` 默认 permissionMode 在 headless 服务里静默跳过工具调用,模型幻觉作答不报错
- [pi-agent-core-no-session-persistence](pi-agent-core-no-session-persistence.md) — pi SDK 没有落盘 resume 机制,多轮会话要服务端自存并回灌 `agent.state.messages`

## judge

- [judge-agent-default-material](judge-agent-default-material.md) — `t.judge.agent` 默认材料写死成 diff,对话型 eval 会被误判 0 分
- [judge-criteria-cannot-see-tool-calls](judge-criteria-cannot-see-tool-calls.md) — judge 默认材料看不到工具调用,criteria 要求「基于工具作答」会恒判 0
- [judge-config-precheck-hard-fails-without-key](judge-config-precheck-hard-fails-without-key.md) — 显式设 `judge.model` 后没有对应 API key 是跑前直接抛错退出,不是"judge 断言自动跳过"
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

## CLI 与运行

- [cli-fresh-flag-is-noop](cli-fresh-flag-is-noop.md) — `--fresh` 不是真 flag 会被静默吞掉;跳过缓存结果用 `--force`;parseArgs 对未知 flag 不报错
- 已修 [runner-earlyexit-key-misses-experiment](runner-earlyexit-key-misses-experiment.md) — earlyExit 去重键漏 experimentId,同 agent 同 model 只差 flags 的 A/B 实验会有一组被静默跳过(修在 `src/runner/run.ts` 键加 experimentId、`reporters/artifacts.ts` 工件路径加实验段)

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

## 环境、发布与部署

- [optional-peer-deps-raw-ts-consumer-typecheck](optional-peer-deps-raw-ts-consumer-typecheck.md) — 发布裸 .ts 源码时,可选 peer 依赖必须独立子路径导出,绝不从主入口 re-export
- [pnpm11-allowbuilds-placeholder-blocks-install](pnpm11-allowbuilds-placeholder-blocks-install.md) — pnpm 11 给新依赖写 allowBuilds 占位符并让 install exit 1,要手改 pnpm-workspace.yaml
- [pnpm11-verify-deps-gate-blocks-niceeval-cli](pnpm11-verify-deps-gate-blocks-niceeval-cli.md) — pnpm 11 pre-run gate 会在 niceeval 启动前拦死 CLI(消费方项目)
- [vercel-site-domain-and-docs-routing](vercel-site-domain-and-docs-routing.md) — niceeval.com 域名指向和 docs routing 容易分裂成 404,部署 Ready ≠ 域名指对
- [site-blog-empty-post-dir-breaks-build](site-blog-empty-post-dir-breaks-build.md) — posts/ 下缺 mdx 的空目录(git 不跟踪)让 site:build ENOENT 崩;全 draft 时 slug 页 404 是预期
- [shared-worktree-concurrent-commit-race](shared-worktree-concurrent-commit-race.md) — 多 agent 共用工作树时 `git add`→`commit` 之间有竞态,暂存文件会被别人的提交带走;用 `git commit <paths>` 一步提交
- [e2e-suite-landing-gotchas](e2e-suite-landing-gotchas.md) — 拷 tier1 项目要同步改 package.json `file:` 与 workspace `link:` 两处深度;`budget` 对不报 usage 的 agent 空转不设防;GH runner 上 Codex bwrap 沙箱起不来要 `CODEX_SANDBOX_MODE=danger-full-access`

## 设计决定

- [sandbox-field-no-bare-string](sandbox-field-no-bare-string.md) — `sandbox` 字段只接受工厂产出的 SandboxSpec:不接受裸字符串、没有默认值、没有自动探测(用户 review 明确定案)
