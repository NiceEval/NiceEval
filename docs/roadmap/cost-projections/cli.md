# 成本投影 —— CLI

成本投影不增加命令、flag 或新的运行选择规则。用户通过现有 Report 页面查看已经闭合的成本值：

```sh
niceeval show --run <run-id> --report ./reports/quality-cost.ts --page /cost
niceeval view --run <run-id> --report ./reports/quality-cost.ts --page /cost
niceeval view --run <run-id> --report ./reports/quality-cost.ts --out ./cost-report
```

价格 Profile 由受信任的 Report module 声明。CLI 不接受价格文件、URL、网络更新、重新定价或写回选项。`--run` 仍只审计已有 Run；成本投影不增加筛选条件。

## 人类输出

成本卡片始终显示 state、basis、Profile content identity、报价 currency、小数位、coverage 与 reasons。
相同 currency 的 observed 和 estimated 分量分开显示，再给出已知 total。

```text
Cost · mixed · partial
Pricing profile sha256:4a…91 · USD · 2 decimals
Provider observed   USD 3.20
Profile estimated   USD 1.08
Known total         USD 4.28 · 18 / 20 slots
Unpriced            2 slots
Observed elsewhere  EUR 0.41 · not converted
```

`partial` 与 `unavailable` 不是颜色、空白或零的别名。页面逐项说明 Usage 读取问题、collection limitation、未报价 coverage 与未换算币种。

## JSON、静态输出与退出

`show --json` 使用既有 Report JSON 外壳。成本节点保留 Profile identity、currency、小数位、coverage、state、basis、分量、其它币种和 reasons。
它不内联 Usage payload，也不读取当前价格。

`show`、`view` 与静态页从同一份 ReportExecution 读取这些字段。`partial` 和 `unavailable` 是可呈现的值，命令成功时退出码仍为 `0`。
Profile 无效、Report execution 失败或现有选择无法形成 Sample 时，沿用相应既有错误与退出语义。
