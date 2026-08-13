# 成本投影 —— CLI

成本投影不新增命令。
用户通过真实 Report 页面交付结果：

```sh
niceeval show --run <run-id> --report ./reports/quality-cost.ts --page /cost
niceeval view --run <run-id> --report ./reports/quality-cost.ts --page /cost
niceeval view --run <run-id> --report ./reports/quality-cost.ts --out ./cost-report
```

价格 Profile 由受信任的 Report module 声明。
CLI 不接受 `--pricing`、`--reprice`、URL 或“读取网络更新价格”的选项。
`show` 与 `view` 沿用现行选择契约：不带 selection 时形成当前项目的全部匹配 Runs，可重复的
`--run <RunId>` 审计指定历史 Run。成本投影不引入任何额外 Run 选择条件。

## Human 输出

成本卡片恒显示状态、basis、Profile content identity、报价 currency、小数位和按 provider + model 列出的 coverage。
只在同一 currency 内显示 combined total，并把 observed 与 estimated 分量分开。

```text
Cost · mixed · partial
Pricing profile sha256:4a…91 · USD · 2 decimals
Provider observed   USD 3.20
Profile estimated   USD 1.08
Known total         USD 4.28 · 18 / 20 slots
Unpriced            2 slots
Observed elsewhere  EUR 0.41 · not converted
```

`partial` 与 `unavailable` 不能被颜色、空白或零替代。
Human 页面逐项列出 Usage 或 billing-subject Attachment 问题、collection limitation、缺少或未报价的 provider + model subject 和不换算的 currency。
`show`、`view` 与静态页从同一 `ReportExecution` 渲染这些内容。

## JSON

`niceeval.report-show/v1` 保持既有 Report JSON 外壳。
成本 Calculation 的 `value` 使用 [Library](library.md) 的 `CostProjectionValue`，不另立 CLI 成本格式。
因此每份 JSON 都包含：

- Profile content identity、currency、小数位与完整 provider + model coverage；
- `available`、`partial` 或 `unavailable`；
- observed、estimated 和 same-currency combined 分量；
- 未换算 observed currency、Slot coverage、billable subject 和具名 reasons。

JSON 不内联 Usage 或 binding 原始 payload，不读取当前价格，也不以缺失字段暗示零。
object key 与 array 顺序继续遵守 `show --json` 的 canonical JSON 规则。

## dry、并发与审计

`niceeval exp --dry` 只规划 execution，不形成 Sample 的 Usage projection，因此不显示成本预测。
`show` 与 `view` 不提供成本专用 dry；它们只对已发布 Run 执行固定 Report。

Report execution 在 frozen reader view 上完成。
同一 Record root 的 writer 可以继续发布后续 Run，但不会改写正在显示的 execution。
`view` 的下一 revision 会形成新的 frozen execution；旧 revision 保留旧 Profile content identity。

审计信息随 `ReportExecution`、`show --json` 和静态 Report 保存。
它不进入 Record，不修改 Usage observation，也不让今天的 Profile 改写已经导出的报告。

## 退出码与失败

| 情况 | `show` / `view` | `view --out` |
|---|---:|---:|
| available、partial 或 unavailable 成本 value | 0 | 0，且可导出 |
| Profile 结构、coverage 或 decimal 无效 | 沿用既有 Report definition failure | 沿用既有 Report definition failure |
| Record、现行 Run selection 或 requested projection 无法执行 | 沿用既有 typed CLI failure | 沿用既有 typed CLI failure |
| Report callback、tree 或 route execution problem | 既有 Report host 的退出语义不变；局部显示 execution-failed | 既有导出失败语义不变；整体不发布 |
| 进程中断 | 130 | 130 |

`partial` 和 `unavailable` 是可呈现 Calculation value，不是 CLI 失败。
它们不改变 Eval Verdict、Invocation receipt 或 Runner 退出码。
本方向不新增、重映射或借用成本专用退出码。

## 删除与公开验收

CLI 删除成本专用运行命令、重新定价 flag 和将估算金额写入 Record 的输出路径。
没有读取 Record 的 Report module 不能取得成本数据。

生产验收执行真实 `show`、`view` 和 `view --out`。
验收核对 observed-only、estimated-only、mixed、partial、unavailable、不同 currency observed，以及同 provider 不同 model 不串价的页面和 JSON。
此处不新增 Eval Assertion；CLI-only 行为由真实 CLI/E2E 旅程证明。
