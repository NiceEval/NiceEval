# Codex Responses Lite + custom provider 不暴露 Web Search

## 现象

2026-08-13，PR #47 的 Codex configFile live E2E 把同一 Eval 分给
`web_search = "live"` 与 `web_search = "disabled"` 两个 Experiment。disabled 侧正常通过，
live 侧的 Turn 也正常完成，但模型明确回复 `web_search is unavailable`，公开执行证据里没有
`web_search` 工具调用。外层重跑仍失败，因此不是模型偶发漏调用。

## 根因

CI 使用自定义 `s2a` Responses provider，模型目录把 `gpt-5.6-luna` 标为 Responses Lite。
OpenAI Codex CLI 0.144.1 对 Responses Lite 不发送 hosted Web Search，而改走 standalone Web
Search；同版本的 standalone extension 只在 OpenAI provider 或 actor authorization 下可用。
因此 `web_search = "live"` 虽然被正确解析并写入 `~/.codex/config.toml`，仍不能让这个 provider
获得该工具。把缺工具归因于 Adapter 丢配置、改 prompt 或重试都不成立。

官方 0.144.1 源码的 `hosted_model_tool_specs()`、`standalone_web_search_enabled()` 与
`WebSearchExtensionConfig::from()` 共同构成这条门控。本地用 0.144.1 的无网络请求探针也确认：
当前配置层确实收到 top-level `web_search`，但 custom Responses Lite 请求不出现 Web Search。

## 修法与验收

configFile E2E 改用同版本稳定支持、且不依赖 provider 能力的
`features.shell_tool = true/false` 做同 Eval A/B。相同 prompt 在 enabled 侧必须调用一次
`exec_command`（NiceEval 公开归一名为 `shell`），disabled 侧 Turn 仍成功且零 `shell` 调用。
0.144.1 的无网络协议探针确认 false 会从请求工具面同时移除 `exec_command` 与 `write_stdin`。

以后为 Agent 原生配置写正反对照时，正调必须先证明底层 CLI、所选模型形态和当前 provider
共同支持目标工具；单看配置键合法或官方默认值不足以证明工具可见。provider-gated 能力不适合
充当通用 configFile 传播哨兵。
