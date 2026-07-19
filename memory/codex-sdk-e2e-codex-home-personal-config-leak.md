---
name: codex-sdk-e2e-codex-home-personal-config-leak
description: e2e/repos/codex-sdk 在开发者本机跑会读到真实 `~/.codex/config.toml`(ChatGPT 桌面版注册的 node_repl MCP server、danger-full-access 沙箱、approval_policy=never),三个坑同时被这一次泄漏掩盖/引出
metadata:
  type: infra-bug
---

**现象**：`e2e/repos/codex-sdk` 补齐 `coverage: completeCoverage` 后真机验证暴露一连串反直觉行为：

1. `evals/mcp-tool.eval.ts` 断言 `calledTool("e2e.get-sum")` 概率性失败——`events.json` 显示模型改调了一个从未在 `agents/codex-sdk.ts` 里挂载过的 `mcp_tool_call`，`server: "node_repl"`，入参 `{"code":"nodeRepl.write(100 + 23)"}`。
2. 把 `evals/mcp-tool.eval.ts` 的 prompt 从"用 MCP 工具，别自己算"加固到显式点名 `e2e.get-sum` 并禁止 shell/apply_patch 后，`evals/coding-tool.eval.ts` 反而开始 100% 失败：模型自称"当前工作区是只读沙箱，写入被阻止了"，直接拒绝建文件（不是运行期报错，是模型读到沙箱描述后主动放弃）。
3. `evals/usage.eval.ts` 断言 `turn.event("thinking")` 恒为 0 次；用探针脚本绕过 niceeval 直接调 `@openai/codex-sdk`、打印 `turn.completed` 的原始 `usage.reasoning_output_tokens`，发现该字段确实 > 0（模型真的在推理），但事件流里从没出现过 `reasoning` item——niceeval 的 `fromCodexThreadEvents` 转换器逻辑没问题，是 Codex 压根没请求 reasoning summary。

**根因**：三件事共享同一个根：`agents/codex-sdk.ts` 里 `new Codex({...})` 没有传 `env`，SDK 默认把当前 Node 进程的完整 `process.env`（含真实 `HOME`）转发给它 spawn 的 `codex` CLI 子进程，子进程于是读取**开发者本机真实的** `~/.codex/config.toml`，而不是这条 e2e 的沙箱配置：

- 该文件里有 ChatGPT 桌面版自己注册的 `[mcp_servers.node_repl]`（指向 `/Applications/ChatGPT.app/.../cua_node/bin/node_repl`，一个真实能跑的本地 Node REPL MCP server），和这条 Eval 自己挂的 `mcp_servers.e2e` 一起进了模型的工具列表——模型两个都能选，选中 node_repl 就是"更顺手的逃生舱"，不是 prompt 用词不够狠。（旁证：`codex features list` 里 `js_repl`/`js_repl_tools_only` 都标 `removed`，Codex 自己并没有内置的 JS REPL 工具；`node_repl` 是这台机器 ChatGPT 桌面版装的第三方 MCP server，和 s2a 代理、和 Codex CLI 本体都无关。）
- 同一份个人配置里还有 `sandbox_mode = "danger-full-access"` 和 `approval_policy = "never"`——这两条**之前一直在悄悄兜底**这条 e2e 的文件写入/命令执行，让"本地不设，保持 Codex 默认沙箱"这句话（写在改动前的代码注释里）显得成立。一旦按坑 1 的修法把 `CODEX_HOME` 隔离掉，Codex 对全新 home 的真实默认就露出来了：`codex exec`（headless，无人可批）默认更保守，直接判定成 read-only，文件写入被模型自己拒绝。
- `model_reasoning_summary` 这个 config 键决定 Codex 是否向 Responses API 请求 reasoning summary；Codex 内置模型目录会给已知模型开这个开关，但这条 e2e 用的是自定义 `model_providers["e2e-provider"]`（指向 `CODEX_BASE_URL` 代理），不在内置目录里，这个开关默认关——所以即使 `reasoning_output_tokens > 0`（模型确实花了推理 token），事件流里也不会出现 `reasoning` item 可总结。另外发现：不显式钉 `modelReasoningEffort` 时，这条 e2e 之前也是靠同一份个人配置里的 `model_reasoning_effort = "high"` 兜底；隔离 `CODEX_HOME` 后 reasoning 力度掉回 Codex 自己的默认，对"9 乘以 7"这类一步心算，`reasoning_output_tokens` 经常直接是 0（真机验证 2/3 次），不是配置错，是题目太简单模型没什么可总结的推理过程。

**修法**（落在 `e2e/repos/codex-sdk/agents/codex-sdk.ts`，同批改了 `evals/mcp-tool.eval.ts`、`evals/usage.eval.ts`）：

- `new Codex({ env: { ...process.env, CODEX_HOME: <仓库私有目录，如 `.codex-home/`，随 workspace/ 一样运行时 `mkdir`、gitignore、跨 attempt 复用以保 session 续接> }, ... })`——整体保留 `process.env`（PATH/npx 等还要用），只覆盖 `CODEX_HOME`，从根上切断读到个人配置的可能，而不是在 prompt 里堆条件去猜开发者本机装了什么 MCP server。
- `ThreadOptions` 显式钉 `sandboxMode: process.env.CODEX_SANDBOX_MODE ?? "workspace-write"`（不再是"省略 = Codex 默认沙箱"）和 `approvalPolicy: "never"`（这条 adapter 本来就没有审批回调）。
- Codex `config` 里加 `model_reasoning_summary: "detailed"`；`ThreadOptions.modelReasoningEffort` 改成 `ctx.reasoningEffort ?? "high"` 的兜底（不再是"省略就整个不传"）。
- `mcp-tool.eval.ts` 的 prompt 从"用 MCP 工具，别自己算"改成显式点名 `e2e.get-sum` 且逐条禁止 shell/apply_patch/自己心算（真机验证 6/6）。
- `usage.eval.ts` 的题目从一步心算"9 乘以 7"换成三步应用题（火车变速求总路程），同样的 reasoning 配置下真机验证 5/5 稳定产出 `reasoning` item——保留住"reasoning/usage 逐轮进 Turn"的断言意图，没有退化成只看 token 数。

真机验证：`pnpm e2e --repo codex-sdk`（走真实 tarball 打包 + 隔离 checkout 的根编排器路径）连续两次干净全绿；mcp-tool / usage 各自额外单独跑 3 次（`runs: 2`，共 6 attempts）零翻车。

适用场景：任何用 `@openai/codex-sdk`（或直接 spawn 真实 `codex`/`claude`/其他有 `$HOME` 落盘配置的 CLI）、且在**开发者本机**（而非全新 CI VM）跑真机 e2e 的场景——真实 CLI 的本机个人配置（MCP server 注册、沙箱策略、审批策略、推理力度）都可能悄悄污染或掩盖测试结果，二者都要防：既要防"多出来的工具/权限让断言随机过"，也要防"过去意外全绿其实是踩了个人配置的顺风车，隔离后才现出真实默认值"。

关联：[[e2e-suite-landing-gotchas]](同一条 `CODEX_SANDBOX_MODE` 环境开关，当时只覆盖了 CI/bwrap 场景，没发现本地也需要显式钉沙箱)、[[codex-sdk-web-search-s2a-flaky]](同一条 adapter 上另一类"模型有更顺手的内置/代理侧工具，prompt 拦不住"的坑，但那次根因是代理端 web_search 本身不稳定，和这次的本机配置泄漏是两个不同根因)。
