# Report 成本投影 —— CLI

成本投影不增加命令、flag 或运行选择规则。用户通过声明了 `pricing` 的 Report 页面查看闭合成本：

```sh
niceeval show --run <run-id> --report ./reports/quality-cost.tsx --page /cost
niceeval view --run <run-id> --report ./reports/quality-cost.tsx --page /cost
niceeval view --run <run-id> --report ./reports/quality-cost.tsx --out ./cost-report
```

CLI 不接受价格文件、URL、网络更新、重新定价或写回选项。Profile 的 rate-card provenance 已在 Report module 中声明；命令只读取固定
Sample、Profile 和关闭投影。

## 人类输出

成本组件显示 USD、Profile content identity、declared-rate-card provenance、`available` / `partial` / `unavailable` 状态、total、mean
和每条 Attempt 的 Provider 计价状态。它不会以一个 basis 标签替代 ledger。

```text
Cost · partial · USD
Pricing profile sha256:4a…91
Rate card https://platform.openai.com/pricing · asOf 1785542400000
Known total       USD 4.28 · 18 / 20 attempts
Mean per attempt  USD 0.237777…
openai · Attempt #12  observed  USD 0.24
openai · Attempt #13  estimated USD 0.18
openai · Attempt #14  unavailable · pricing information unavailable
```

`partial` 与 `unavailable` 不是颜色、空白或零的别名。非 USD observed cost、Usage 问题和不适用 rate 都显示各自的有限 reason。

默认 Report 总有随包 Profile。目录没有相应 model 或 bucket 时，Report 仍成功显示非成本内容，并以 unavailable 呈现成本缺口；它不读取 Runner estimate。

## machine、view 与静态输出

内建与自定义 `show --json` 都使用各自的版本化 format，并且都在顶层携带相同的 `projections` 对象：
`{ format: "niceeval.report-projections/v1", pricingProfile, costs }`。

每个 cost entry 的形状为 `{ page: { pageId, route }, measureId, row: { key, dimensions }, profileIdentity, projection }`。
`projection` 包含 `{ kind: "declared-rate-card", source, asOf }`、slot-provider ledger、exact aggregate、rational mean 和有限 reasons。

成本数组的 canonical key 是 `route`→`pageId`→`measureId`→`row.key`→`profileIdentity`。它只按这五项的 UTF-8 顺序排序；
`dimensions` 与 `projection` 都不是额外排序键。

同一 key 的 entry 只有 `row.dimensions` 和 `projection` 都为 byte-identical canonical JSON 时才去重。任一字段不同都以
`report-cost-projection-conflict` typed conflict 失败。

`pricingProfile` 是 Report 顶层已关闭的最终 `PricingProfile`；未声明时是 `builtInPricingProfile`。每个 cost entry 的 `profileIdentity` 与
`projection.profile.contentIdentity` 都必须等于顶层 `pricingProfile.contentIdentity`。不会内联
Usage payload、Runner estimate 或任何当前价格。

`show` 只放入目标 Page 已关闭的 projections。`view` 与静态导出闭合所有已声明 Page 的 projections，并在
`_niceeval/data/projections.json` 写出 canonical 全站集合。该文件属于 revision identity；静态页面、view HTTP body 与 projection
data 都从同一 revision 读取。

`partial` 和 `unavailable` 是可呈现的数据状态，命令成功时退出码仍为 `0`。非法 Profile、目标 Page 执行失败、全站构建失败或无法形成
Sample 时，沿用对应 Report 命令的错误与退出语义。
