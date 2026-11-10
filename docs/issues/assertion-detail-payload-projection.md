# attempt.assertion.detail 全量输出超大材料导致缓冲区溢出 (ENOBUFS)，缺少紧凑裁剪选项

## 观察与期望
在诊断包含长程对话、大量工具调用或深层断言的 Attempt 时，调用 `attempt.assertion.detail` 读取单项断言的判定结果和原因，该接口会无条件返回断言关联的完整原始材料（`assertion-material`、全部工具调用输入输出文本、turns 与源码切片）。

在真实安装题（如 DB-GPT、GPT Researcher）中，单次 `attempt.assertion.detail` 响应的 JSON 体积常常超过 1MB~5MB。当外部脚本（如 Node.js `spawnSync` / `execSync` 或 Python `subprocess.check_output`）调用时，默认 1MB 的管道缓冲区直接溢出，抛出 `Error: spawnSync /bin/sh ENOBUFS`。

期望：
`attempt.assertion.detail`（或 Query 协议层）提供轻量级投影选项（如 `projection: "compact"` 或 `fields` 过滤），允许调用方只获取断言判定（`decision`）、贡献分值（`contribution`）与裁判理由（`rationale`），而不倾泻巨大的原始工具和执行材料，避免外部进程管道溢出崩溃。

## 公开入口证据
在消费 NiceEval 的项目中，通过 Node.js 脚本读取真实长任务 Attempt 的断言详情：
- Attempt：`@1Z2NDWH8SWVYJ`（`install/canary` / `install/db-gpt`，Run `33a27dc0-12fe-4fcd-a985-26564a03b5cb`）
- 断言：`ae_e85b61bfb1ac54b549db`（没有退回 online main 文档）
- 执行命令：
  ```sh
  pnpm --silent exec niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.assertion.detail","locator":"@1Z2NDWH8SWVYJ","entryId":"ae_e85b61bfb1ac54b549db"}}'
  ```
- 结果：Node.js `execSync` 直接抛出：
  ```text
  Error: spawnSync /bin/sh ENOBUFS
  errno: -105, code: 'ENOBUFS', syscall: 'spawnSync /bin/sh'
  ```
  单次 JSON 字符量超过 100 万字符（~1.2MB），主要被 `evaluation.retainedRows` 中所保留的全部 88 个工具调用参数和上下文占满。

## 影响
- **外部工具集成极易崩溃**：CI 脚本、看板抓取器或 Coding Agent 工具只要未显式调大几十兆的 maxBuffer，就会在遍历断言时发生崩溃。
- **传输效率低下**：大多数场景下调用方仅需判断断言通过与否及简短诊断文本，全量序列化 megabyte 级文本浪费巨量内存和 CPU 序列化开销。

## 建议方案
1. 在 `attempt.assertion.detail` 的 Operation 请求参数中增加可选的 `projection?: "full" | "summary" | "compact"`（默认为 `full` 保留向后兼容）；
2. 当指定 `summary` 或 `compact` 时，仅返回 `check.state`、`entry.decision`、`entry.contribution` 和顶层 `rationale`，省略 `retainedRows` 中的庞大工具上下文和材料全文。

## 环境与来源
2026-11，Linux，Node.js 24，pnpm 11.12.0；项目：NiceEval-Eval（消费 niceeval@0.19.1-canary.117 / 本地开发候选）。

## 处理裁决与契约采纳

- **状态**：`accepted`（已定稿采纳）
- **采纳契约**：[`docs/feature/inspection/cli.md`](../feature/inspection/cli.md#从-attempt-outline-下钻到一项详情)、[`docs/feature/inspection/architecture.md`](../feature/inspection/architecture.md)
- **裁决结论**：
  将判定诊断与原始材料归档解耦。在 `attempt.assertion.detail` 契约中支持 `projection: "compact" | "full"`。`compact` 模式仅交付判定结果、分值、结构化理由与聚焦证据，裁剪庞大的原始工具调用行全文，保证单次响应体积安全，彻底避免管道溢出。
