# 面向资源的 CLI 架构：废弃命令行 query 封包协议，统一以资源子命令和 --json 输出作为公开接口

## 期望工作流与架构设计
现代开发者与 Coding Agent 交互命令行工具时，普遍遵循以资源为中心（Resource-Oriented）的 Unix / 行业标准模型（如 GitHub CLI `gh`、Docker、Kubectl、Stripe CLI）。

读取和诊断评估结果的期望工作流应为：
1. **统一名词与动词体系**：通过直观的资源子命令访问对象，而不是手写内部协议；
   - 查看运行列表：`niceeval runs`（或 `niceeval run list`）
   - 查看指定运行：`niceeval run <run-id>`
   - 查看 Attempt 详情：`niceeval attempt @<locator>`
   - 查看断言清单：`niceeval attempt @<locator> --assertions`
   - 查看改动对比：`niceeval attempt @<locator> --diff`
2. **全局 `--json` 输出标识**：彻底消除人机交互的双轨割裂。
   - 默认模式：输出排版整齐、包含状态图标与色彩的终端文本（人类友好）；
   - 追加 `--json` 选项：原样输出该资源的纯净结构化 JSON 数据（机器与 Agent 友好，天然支持 Unix 管道和 `jq` 过滤）。
   ```sh
   niceeval attempt @1EM9AT9SZYR96 --json
   niceeval runs --experiment install/canary --json | jq '.[].verdict'
   ```

## 当前缺口与实际观察
当前 NiceEval 在 CLI 读取面采用了人造的“双轨制”：
- 人类使用 `niceeval show`：输出格式化文本，但关键数据（如断言判定状态、各项得分）严重缺失，且无法给脚本做结构化解析；
- 机器/脚本被强迫使用 `niceeval query`：直接把底层类似 RPC / GraphQL 的内部网络通信协议（`niceeval.query/v3`）原样暴露到终端命令行：
  ```sh
  niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.get","locator":"@1Z2NDWH8SWVYJ"}}'
  ```
- 这种协议穿透到命令行的设计带来了严重的认知负担与工程缺陷：
  - 命令行单双引号嵌套极易转义崩溃；
  - 每次简单查询都需要构造并传输大量无意义的 `protocol`、`operation` 模板代码；
  - 无法利用 Shell 自动补全；
  - 无法自然配合 Unix 管道（Unix Philosophy）。

## 影响
- **割裂了人类与 Coding Agent 的心智模型**：人类不敢用 `query`，Agent 用 `show` 拿不到结构化结果，两头难受；
- **严重阻碍生态与自动化脚本开发**：任何集成 NiceEval 的上层脚本都需要自己封装一套复杂的 JSON 请求生成器与错误重试逻辑。

## 建议方案
1. **重构顶层 CLI 命令路由为面向资源（Resource-Oriented）结构**：
   - 将 `run`、`attempt`、`experiment` 提升为一等子命令；
   - 任何资源命令均支持 `--json`（输出标准 JSON）和 `--format text`（默认，输出终端渲染视图）；
2. **下沉 `query` 协议**：
   - 将 `niceeval.query/v3` 协议作为底层 SDK 内部实现或浏览器 `view` 的 IPC 通道保留，不再作为主推的用户命令行交互界面；
   - 原有的 `niceeval query run` 保留用于向后兼容或特殊调试场景。

## 环境与来源
2026-11，Linux，Node.js 24，pnpm 11.12.0；项目：NiceEval 与 NiceEval-Eval。架构设计源于对现有 CLI 交互摩擦的深入反思与开发者体验（DX）重构诉求。
