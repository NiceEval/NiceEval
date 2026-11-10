# niceeval query 缺乏命令行快捷参数，常见读取必须拼装完整 JSON 协议，交互极度繁琐

## 观察与期望
作为开发者或 Coding Agent 在命令行交互时，读取运行结果最常用的高频操作是 `run.list`、`run.get <runId>`、`attempt.get @<locator>`。

当前 `niceeval query` 仅支持两种输入方式：
1. `--request <file|->` 从文件或 stdin 传入完整 JSON 请求；
2. `--request-json <document>` 传入完整的 JSON 字符串。

即使只是想查看最近的运行列表，也必须构造出包含协议封包的完整字符串：
```sh
niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"run.list"}}'
```
在 Shell 环境下，单双引号混用极易引发转义问题；在 Agent 使用 shell 工具调用时，增加了大量无谓的 token 消耗和语法解析失败概率。

期望：
`niceeval query` 支持直接通过 CLI 子命令或常用参数快速调用固定操作，由 CLI 自动封装默认的协议信封（protocol envelope），例如：
- `niceeval query run.list`（或 `niceeval query runs`）
- `niceeval query run.get <run-id>`
- `niceeval query attempt.get @<locator>`
同时仍保留 `--request` / `--request-json` 处理复杂或自定义请求。

## 公开入口证据
在任何已安装 NiceEval 的项目中尝试执行简单的列表或查询操作：
- `niceeval query run run.list`：缺少 `--request` 或 `--request-json` 参数，无法直接执行；
- 必须输入完整的 `niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"run.list"}}'` 才能执行。

## 影响
- **Agent 工具调用效率低**：Coding Agent 在自动化诊断流程中，必须频繁通过拼接长字符串或借助外部 node 脚本来与 query 交互；
- **人类可交互性差**：开发者在终端调试时，极难手工输入这种长 JSON，导致 `query` 这个官方推荐的机器出口无法兼顾轻量的人机交互。

## 建议方案
在 `query` 命令层引入便利映射（Convenience Subcommands / Aliases）：
1. 识别无 `--request` / `--request-json` 时的首个位置参数；若为已注册的 Operation ID（如 `run.list`、`attempt.get`），自动用当前环境最新的 Query Protocol（如 `niceeval.query/v3`）包裹该 operation；
2. 后续位置参数映射为该 operation 的必需参数（例如 `attempt.get` 的 locator）；
3. 保持 stdout 输出依然为标准的 Query 响应 JSON，不破坏向下游的机器契约。

## 环境与来源
2026-11，Linux，Node.js 24，pnpm 11.12.0；项目：NiceEval-Eval（消费 niceeval@0.19.1-canary.117 / 本地开发候选）。观察来自真实评测诊断与自动化脚本编写体验。

## 处理裁决

- **状态**：`closed (duplicate/superseded)`
- **主要工作项**：[`docs/issues/resource-oriented-cli-and-json-output.md`](resource-oriented-cli-and-json-output.md)
- **采纳契约**：[`docs/feature/inspection/cli.md`](../feature/inspection/cli.md#niceeval-show)
- **裁决结论**：
  不采用在 `query` 协议上添加语法糖别名的局部修补方案（避免把内部协议方法暴露为 CLI 语义）。统一通过 `niceeval show @<locator> --json` 与 `niceeval show --run <id> --json` 提供零协议信封的纯净 JSON 输出，`query` 保持为底层严格协议通道。
