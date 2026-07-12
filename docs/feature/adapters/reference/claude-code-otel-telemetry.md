# Claude Code 自带的 OTel 遥测 —— 能不能替代"等 CLI 跑完再读 transcript"

**来源:** [Claude Code 官方 Monitoring 文档](https://code.claude.com/docs/en/monitoring-usage)(2026-07 抓取原始页面核对,不是转述摘要);对照读了 `/Users/ctrdh/Code/agent-eval`(vercel-labs/agent-eval)的 `claude-code.ts` + `o11y/parsers/claude-code.ts` 源码。

## 先回答问题

**能不能"马上拿到"、还是要等全部结果:两者之间——是"近实时增量",不是"瞬时推送",也不是现在这样"全部跑完才给"。**

- Claude Code 的 OTel 导出是**定时批量导出**(OTel SDK 标准的 BatchProcessor 行为),不是每条事件产生就立刻 POST 一次。间隔可调,metrics 默认 60s、logs/traces 默认 5s,**最低可以调到 1000ms**(见下表),进程退出时也会把剩余缓冲区强制 flush 一次。
- 所以"增量"是相对的:比起 niceeval 现在的 claude-code adapter(`src/agents/claude-code.ts`)—— `runCommand` 等整个 `claude --print` 进程退出,再一次性读回整份 transcript JSONL —— 这条路径能在**进程运行过程中**分批收到 span,粒度是秒级,不是"跑完才有"。
- 但也不是 eve / 自建 remote agent 那种"事件发生即推"的上限:批量间隔就是延迟下限,想要更低延迟只能继续调小间隔(有性能/开销代价,官方文档明确说"debug 用完记得调回去")。

结论细化到"该不该接"见文末[结论](#结论这条路径值不值得接)。

## agent-eval 不是答案来源:它压根没用 OTel

先排除一个容易搞混的点:`/Users/ctrdh/Code/agent-eval`(vercel-labs 的 agent-eval)里的 Claude Code 适配(`packages/agent-eval/src/lib/agents/claude-code.ts`)**完全没有用 OTel**——它是纯粹的"沙箱里跑 `claude --print`,`sandbox.runCommand()` 等命令退出,再 `ls -t ~/.claude/projects/**/*.jsonl | head -1` 找最新一份磁盘 transcript 整份读回来"(`captureTranscript()`),`captureTranscriptBestEffort()` 只在命令完成 / abort / catch 分支里调用一次。跟 niceeval 自己的 `src/agents/claude-code.ts` 是**同一套磁盘旁读策略**,niceeval 这边还额外记过一篇源码阅读笔记([agent-eval 参考](agent-eval.md))。

也就是说:agent-eval 对"能不能提前拿到结果"这个问题没有帮助——它对这个问题给出的答案是"不能,等 CLI 退出"。真正有价值的信息来自 Claude Code CLI **自己**另开的一条官方能力:内建的 OpenTelemetry 导出器,和 agent-eval 怎么适配它无关。

## Claude Code 的 OTel 导出:三种信号,两种成熟度

| 信号 | 状态 | 启用变量 | 默认导出间隔 | 可调最低间隔 |
|---|---|---|---|---|
| **Metrics**(计数器/累计值) | GA | `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_METRICS_EXPORTER=otlp` | `OTEL_METRIC_EXPORT_INTERVAL` 默认 **60000ms** | 官方 debug 示例用到 1000ms |
| **Logs/Events**(结构化事件,如 `user_prompt`、`tool_result`、`api_request`…) | GA | 同上 + `OTEL_LOGS_EXPORTER=otlp` | `OTEL_LOGS_EXPORT_INTERVAL` 默认 **5000ms** | 文档给出 1000 / 10000 两档示例 |
| **Traces/Spans**(时间轨,span 树) | **Beta**,默认关 | `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` + `OTEL_TRACES_EXPORTER=otlp` | `OTEL_TRACES_EXPORT_INTERVAL` 默认 **5000ms** | 同上,1000ms 起 |

三种信号的间隔各自独立配置,互不影响。**这一段跟 niceeval 现有观测设计对上号的是 Traces**——metrics/logs 是聚合计数和审计日志,不是"这一步工具调用花了多久"这种瀑布图数据。

### Span 层级(启用 traces 后长这样)

```text
claude_code.interaction          ← 每个 user prompt 起一个根 span
├── claude_code.llm_request      ← 每次 API 请求
├── claude_code.hook             ← 需要更深一档的 detailed beta tracing 才有
└── claude_code.tool             ← 每次工具调用
    ├── claude_code.tool.blocked_on_user   ← 等权限决策的时间
    ├── claude_code.tool.execution         ← 真正执行的时间
    └── (Agent / Task 工具时)子 agent 的 llm_request / tool span 嵌在这里
```

`llm_request`、`tool.execution`、`hook` 三种 span 失败时会带 OTel `status=ERROR`,其余 span 恒为 `UNSET`——不是靠属性猜成功与否,是标准 OTel status。子 agent(Task 工具生的)的 span 会正确嵌套在父 `claude_code.tool` 下面,不是摊平的。

### 关键限制:内容默认全部脱敏

**span 默认只有结构和计时,没有内容。** `user_prompt`、`tool_input`、工具执行的输入输出内容,默认都不出现在 span 属性里,要显式加:

```bash
export OTEL_LOG_USER_PROMPTS=1     # 把 prompt 原文带进去
export OTEL_LOG_TOOL_DETAILS=1     # 工具参数(Bash 命令、MCP server/tool 名、skill 名…)
export OTEL_LOG_TOOL_CONTENT=1     # 工具的输入输出内容本身
```

也就是说,不开这三个 flag,拿到的 span 只能回答"跑了哪些工具、每步花多久、有没有出错",回答不了"这次 Read 读的是哪个文件、Bash 跑的是什么命令、模型说了什么"——而这些恰恰是 niceeval 磁盘旁读 transcript 现在**免费**能拿到的东西。开了这三个 flag 才能拉平,但意味着把敏感的 prompt / 工具明文经 OTLP 发到我们自己起的本机接收器——链路仍在本机(容器 → 宿主的临时端口),不出网,风险可控,但这是要显式做的取舍,不是零成本升级。

### Gating:这条路径对 `-p` 模式是开放的

> "In interactive CLI sessions, this also requires your organization to be allowlisted for the feature. Agent SDK and non-interactive `-p` sessions are not gated."

niceeval 的 `src/agents/claude-code.ts` 一直是拿 `--print`(即 `-p`)跑的沙箱型 adapter——**刚好落在不受组织白名单限制的那一半**,不用等 Anthropic 给账号开权限就能试。这是这条路径对 niceeval 场景友好的地方。

## 跟 niceeval 现有 OTLP 接收器天然兼容

niceeval 已经有一套本机 OTLP 接收器(`src/o11y/otlp/receiver.ts`),给 remote agent 的 `capabilities.tracing` 用:每个沙箱起一个临时端口,只认 `POST .../v1/traces`,`src/o11y/otlp/parse.ts` 同时吃 **OTLP/JSON** 和 **OTLP/protobuf** 两种线编码(手写了一个够用的 protobuf reader,没有额外依赖)。

Claude Code 的 traces 导出器支持的协议是 `grpc` / `http/json` / `http/protobuf` 三选一(`OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`)。**只要选 `http/json` 或 `http/protobuf`,不选 `grpc`**(现有接收器是个普通 `http.createServer`,不认 gRPC 的 HTTP/2 帧),Claude Code 就能把 span 直接导出到现有接收器,格式层面**不需要新写解析代码**——`parseOtlpTraces` 已经覆盖。

理论上可以这样接(未验证,只是根据文档推出的配置):

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf     # 或 http/json,别选 grpc
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=<TraceReceiver.endpoint(host)>   # 沙箱里跑 claude 时复用现有 receiver
OTEL_TRACES_EXPORT_INTERVAL=1000                      # 拉到近实时,eval 场景短会话不必顾虑"生产环境该调大"
```

## 跟现有采集矩阵的关系

**已落地(2026-07)**:下文"升级档"描述的接线已经实现——`claudeCodeAgent` 的 `tracing.env` 注入本页这组 env,与 bub/codex 一样默认开启(见 `src/agents/claude-code.ts`),[采集矩阵](../collection.md#采集矩阵现状与-src-对齐)的时间轨一行已同步。span 只有结构与计时(未开内容 flag),行为轨与断言仍走 transcript 旁读,与下文结论一致。

## 结论:这条路径值不值得接

**不建议现在替换行为轨(`StreamEvent[]`)的采集方式。** 磁盘旁读 transcript 免费给全量内容(prompt / 工具参数 / 工具输出 / 助手文本),OTel 版本要拿到同等内容得开三个额外 flag、还处于 beta(字段随时可能变,`user_prompt` 等内容属性文档原文写明"不是稳定 span schema 的一部分")。负断言完整性([契约](../contract.md#负断言的完整性规则))经不起一个 beta 功能说变就变。

**值得作为时间轨(`TraceSpan[]`)的可选升级路径考虑,分两档:**

1. **保底档(不用动 adapter 代码):** 什么都不接,继续用 transcript 时间戳合成 span——这是现状,降级安全,`view` 少一些真实的 span 层级细节(比如工具"等权限"和"真正执行"分不开),但断言不受影响。
2. **升级档(可选,给需要更真实瀑布图的用户):** `claudeCodeAgent` 配置里加一个开关,setup 阶段给沙箱里跑 `claude` 的进程注入上面那组 env(复用沙箱已经有的 `TraceReceiver`,跟 remote agent 的 tracing 走同一个接收器/同一个 `o11y/otlp/mappers/` 归一管线),用户自己决定要不要为了更真实的瀑布图打开内容脱敏(`OTEL_LOG_TOOL_DETAILS` 等)。这是**加法**,不影响现有行为轨,失败也只是"没拿到 trace",不影响断言——符合[采集设计](../collection.md)里"时间轨缺数据是降级,不是契约问题"的既有原则。

**不建议**因为这个能力去改变现有"等 `runCommand` 返回再读 transcript"的行为轨轮询模型:近实时的是 span(计时结构),不是行为数据本身——`StreamEvent[]` 需要的完整内容(尤其是断言要读的工具参数/输出/助手文本)目前只有磁盘旁读的完整 transcript 能免费给,OTel 版本要么没内容要么要额外开脱敏 flag 且不保证字段稳定性。

## 相关阅读

- [采集设计](../collection.md) —— 双轨四通道设计、claude-code 现有采集矩阵。
- [agent-eval 参考](agent-eval.md) —— agent-eval 的 claude-code 适配源码阅读(纯磁盘旁读,不涉及 OTel)。
- [OTel GenAI 等标准参考](otel-genai.md) —— OTel GenAI semconv 本身讲的是"字段该叫什么",这篇讲的是"Claude Code 到底发不发、多快发"。
- [Observability](../../../observability.md) —— niceeval 的 `TraceReceiver` / OTLP 解析管线现状。
