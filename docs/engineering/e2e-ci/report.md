# 报告域

报告域回答一个问题：**一次真实运行落盘的结果与对外的报告出口，是否逐字段符合公开契约。** 它由一个 contract 仓库承担：`results-contract`（group `contract`）。适配器仓库不复制格式知识，读结果只走公开读取面（见[总则 · Results 读取边界](README.md#42-results-读取边界)）。

仓库使用真实 Agent 与真实模型产生结果——真实优先没有例外。稳定性来自断言对象：只断言机制事实（文件集合、字段形状、口径一致性），不断言模型输出质量。

## 验收计划

仓库运行一个小型真实 Experiment，然后从四个出口逐一核对同一份事实：

1. **落盘格式**：`snapshot.json`、attempt 目录的 `result.json`、`events.json`、`sources.json`、`o11y.json`（有 tracing 面时含 `trace.json`）的字段与版本依据 [Results Format](../../feature/results/architecture.md) 契约逐项断言——`verdict` 四态、断言明细、`durationMs` / `usage` / `estimatedCostUSD` 三件套成组出现、`snapshot.json` 不含逐 attempt 数据。
2. **公开读取面**：`openResults()` 遍历出的快照、attempt 与推导聚合和盘上文件一致——读取面是落盘事实的忠实投影，不是第二份口径。
3. **JSON 出口**：CLI `--json` 输出的机器摘要与读取面口径一致。
4. **JUnit 出口**：显式 `--junit` 文件里 `failed` 折叠为 `<failure>`、`errored` 折叠为 `<error>`，用例集合与实际 attempt 对应。

格式变更只需要更新这个仓库，不需要修改任何适配器仓库。

## 边界

show / view 的终端布局、HTML 结构与报告组件渲染不在 E2E 层验收——报告组件与证据室是确定性渲染语义，场景登记与测试方法在[单元测试 Reports](../unit-tests/reports/README.md)。E2E 验收的是数据契约：落盘文件、读取面与机器出口。

每个仓库验收链尾的 [CLI 读回](README.md#43-cli-读回)会在真实数据上驱动 show 的读取与渲染路径，但断言停在自有事实的出现与口径一致；逐字段的格式与出口契约只在本仓库验收一次。
