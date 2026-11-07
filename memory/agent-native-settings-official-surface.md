# 设计裁决:coding agent 原生行为开关走官方 `settings` 面,不做透传口、不做单需求字段

**裁决**(2026-07-14):`claudeCodeAgent` / `codexAgent` factory 新增 `settings` 字段——各 agent **原生配置词汇**的结构化对象(claude-code 是 settings.json 的 JSON 对象,codex 是 config.toml 的 TOML 形状对象),setup 阶段由 Adapter 序列化落进对应配置文件。并按用户裁决升格为 coding-agent Adapter 的**契约义务**:被测 CLI 有原生配置文件,factory 就提供 `settings`(bub 没有,config 上没有该字段)。配套契约:保留键(model / 鉴权 / OTel 导出 / MCP 表)出现在 settings 里 setup 报错并点名;settings 进安装 checkpoint key 与 manifest;secret 只走 env。核心原则一句话:**新的行为需求先看 CLI 原生配置能否表达,能表达就天然被 `settings` 覆盖;不为单个需求铸语义字段,不能表达的去上游提 FR。**

**动机**:codex 内置 web_search 在 benchmark 里真实检索到题目答案(答案污染,是结果效度问题不是性能问题),而 CodexConfig 此前没有任何关它的入口。config.toml 本来就是 adapter 自己写的,无上游依赖,等不起上游 FR。

**曾选方案与否决**:

1. **透传口(raw TOML/JSON 原文直写)**——同轮先被用户否掉「逃生舱」定位,再在「要不要转译」讨论中彻底否决:TOML 顶层键必须出现在所有 `[table]` 之前,原文拼接会让 `web_search = "disabled"` 静默掉进上一个表(不报错、污染照旧,恰是该功能要防的事故);保留键校验必须 parse,parse 完就已经是结构;字符串不可组合(A/B 变体要 spread/merge、结果面要结构化 diff);与 mcpServers/plugins/skills 全结构化的现状不一致。
2. **`webSearch: boolean` 这类跨 agent 语义字段**——否决:每个需求一个字段追不完上游,跨 agent 中间词汇是假抽象;web_search 只作为 settings 的文档示例存在。
3. **开放写文件的权力(sandbox 钩子里自己写 config)**——否决:违反 agent-contract.md「配置归属不变量」与 sandbox 库文档「钩子不复制 factory 拥有的配置知识」;时序上 agent setup 在 sandbox 钩子之后写主配置,手写文件会被覆盖;保留键校验、checkpoint key、manifest 审计全部失守。
4. **`McpServer.tools?: string[]` 白名单**——搁置不做:共享 `McpServer` 形状的前提是两家 CLI 都能原生表达;CLI 没有原生 per-server 工具过滤时,niceeval 要自造过滤 stdio proxy(改变被测对象本身,即「每个下游自己绕」的税)。等至少一边原生支持后再提升进共享类型,届时不支持的一侧 setup 响亮报错,不静默忽略。

**待办(上游 FR,截至 2026-07-14 均未提交)**:① agent CLI 的 MCP per-server 工具白名单(「工具定义税」:MCP server 一挂一堆工具定义进 context);② codex web_search 的 benchmark 答案污染 motivation。另:关工具挡不住 shell `curl`,更强的网络隔离属于 Sandbox 层,是独立 roadmap 候选,未立项。

**落点**:`docs/feature/adapters/architecture/agent-contract.md`(配置归属不变量表 + factory 行)、`architecture/coding-agent-extensions.md`(类型边界/安装顺序/可复现性/失败语义/Manifest)、`library/coding-agent-extensions.md`(写入原生设置一节)、`sdk/claude-code/README.md`、`sdk/codex-cli/README.md`、`docs-site/zh/guides/official-adapters.mdx`。docs 先行,src 实现待做(CodexConfig/ClaudeCodeConfig 加字段 + TOML 序列化落位 + 保留键校验 + checkpoint key/manifest 接线)。

关联:[[registermcp-post-hoc-primitive]](同一条边界:agent 配置只从 factory 构造期进)、[[codex-sdk-web-search-s2a-flaky]](web_search 在代理下的另一类坑)、[[mcp-tool-naming-claude-vs-codex]](MCP 两家差异)。
