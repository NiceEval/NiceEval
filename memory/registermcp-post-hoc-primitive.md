# 设计裁决:不提供后置追加 MCP 的原语(`shared.registerMcp` 已撤销)

**裁决**(2026-07-10,用户明确定案):MCP 只有一条进入路径——adapter factory 的构造期 `mcpServers`(未来收敛进 `PluginSpec` 的 `kind: "mcp"`)。不提供任何「给已构造 Agent 后置追加配置」的原语;Agent 构造之后不做后置修改,变体差异永远落在构造入参上。

**曾选方案**(同日上午落地、同日撤销,commit 52476b0):`shared.registerMcp(agent, servers): Agent`——接收已构造的 sandbox agent,按 `agent.name` 分发(`MCP_WRITERS`:claude-code 读回 `~/.claude.json` 合并写,codex `cat >>` 追加 `[mcp_servers.x]`),包装 `setup` 后置写入,bub/remote fail fast。附带 `shared.appendFile`、两个 i18n key、`shared.test.ts`、四处文档小节。动机来自 downstream(coding-agent-memory-evals)的 `withMempal` wrapper:它拿到的是已构造 Agent,只能手写两家 CLI 配置文件格式,遂提「后置追加原语」为候选上游 feature。

**否决理由**:

1. `MCP_WRITERS` 就是 `agent.name == "claude-code"` 的行为分支,放在中立 shared 模块里违反 Architecture Boundaries;且把两家 CLI 配置文件格式知识从 factory 复制了一份(落地当天就自认「两处重复,漂移要改两处」)。
2. 它宣称的场景(「只拿到已构造 Agent、没有原始 config」)是姿势问题不是能力缺口:条件包装器应接收 **factory** 而不是已构造的 Agent,在包装内部 `factory({ mcpServers: [...] })` 构造——条件仍收拢一处,MCP 走构造期,格式知识留在 adapter。downstream 的 `withMempal(codexAgent(), ...)` 改签名为 `mempalAgent(codexAgent, ...)` 即可,wrapper 剩下的二进制上传/预热/hook/状态载入本来就不复制 adapter 知识,继续用 setup 包装。
3. 后置修改破坏 Agent 的构造证据模型:`setup` 是闭包、没有可变 option bag 是设计优点,`registerMcp` 等于开「构造之后还能改配置」的口子。

**撤销范围**:`src/agents/shared.ts`(registerMcp/appendFile/MCP_WRITERS/writeClaudeMcp/writeCodexMcp)、`src/agents/shared.test.ts`(整文件)、`src/i18n/{en,zh-CN}.ts` 两 key、`docs/adapters/{authoring,coding-agent-skills-plugins}.md`、`docs/source-map.md`、`docs-site/zh/guides/official-adapters.mdx`。52476b0 顺手修正的两处过期声明(claude 是 `~/.claude.json` 不是 `~/.claude/claude.json`;codex 是复数 `[mcp_servers.x]`)保留。反面契约已写进 `docs/adapters/authoring.md`(shared 一节)与 `coding-agent-skills-plugins.md`(adapter 翻译一节)。

**连带评估**(downstream 同场讨论的其它 DX 提案,当时结论):`persistentState`(跨 attempt 持久状态,key 默认 experiment id + 调度器按 key 强制串行)是唯一 userland 做不干净、值得上游化的——**此条同日被 [[sandbox-lifecycle-hooks]] 翻案:不做**,状态由用户钩子自管、键用 `ctx.experimentId`;e2b 并发上限可配合理;`defineAgentExtension` 组合器、`uploadHostCached` 不做(宿主语言积木够用);「adapter setup 写完 mcpServers 后跑 `mcp list` 自省留 log」是合理的 adapter 内部改进,不新增 API 面。

关联:[[mcp-tool-naming-claude-vs-codex]](MCP 两家 CLI 差异的断言层坑)、[[sandbox-lifecycle-hooks]](同日后续裁决:环境预置的家)。
