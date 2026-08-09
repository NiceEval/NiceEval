# `niceeval show` —— 在终端读固定结果

`niceeval show` 打开一个固定 `RecordGraphRef`，materialize 一份 `sources` 恰含该项的 Sample，并把已计划的 ReportData 渲染到终端。
它不运行 Eval，也不在 text renderer 中读取事实。

## 一次调用 = 图版本 × 范围 × target × 形态

- **图版本**由 `--record` 或当前项目配置的 Record Store 决定。打开后 Graph 固定；writer 的后续更新需要下一次调用才能看见。
- **范围**由 eval 前缀、`--exp` 和 `--run <run-ref>` 形成 Sample selection。范围先生成固定 Sample，再进入 Reports。
- **target**选择内建诊断切片或 `--report` 的已计划 page instance。
- **形态**选择 text 或 `--json`。两者读取同一个 ReportData；JSON 不是另一套取数路径。

```sh
niceeval show
niceeval show security/
niceeval show --exp compare/candidate
niceeval show --run compare/candidate@r17
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --report ./reports/security.tsx
niceeval show --report ./reports/security.tsx --page overview
niceeval show --exp compare/baseline --exp compare/candidate --json
```

`@<locator>` 识别为当前固定 Graph 中的完整 AttemptRef，不是数组下标或文件路径。
相同 locator 指向不同 graph 或 adopted revision 时，show 会显示完整 identity，不把它们混成一次执行。

## 默认 target

不带显式 target 时，show 选择以下稳定内建读面：

| 输入 | 默认 target |
|---|---|
| 单个 `@<locator>` | Attempt 诊断详情 |
| 多个 `--exp` | 已计划的比较矩阵 |
| 其它 Sample 范围 | 标准概览 |

内建 target 同样先声明 Projector 与 Calculation，再由 executor 交付数据。
`--source`、`--execution`、`--timing`、`--usage`、`--diff`、`--history` 与 `--stats` 仍是任务入口；它们各自声明所需 Projector，不通过 renderer 按事件名临时读取。

## 自定义报告

`--report <名称|文件>` 装载一个冻结的 ReportDefinition。
报告参数经 schema 校验和 JCS 规范化后进入 plan；没有参数化页面或 instance 的 target 必须报错。

```sh
niceeval show --report ./reports/site.tsx
niceeval show --report ./reports/site.tsx --page overview
niceeval show @01J4C6N8PQRS2TVWXY9ZABCD3E --report ./reports/site.tsx --page attempt/01J4C6N8PQRS2TVWXY9ZABCD3E
```

显式自定义 report 与 `--json` 互斥。
报告树表达「怎样呈现」，内建 JSON 表达「已计划数据的结构化结果」；show 不序列化任意组件树，也不从树反推数据。

## unavailable、verification 与错误

EvidenceValue 的判别分支原样进入 text：available 保存 verification 与全部 issues，unavailable 保存
全部 causes 与 basedOn，不把任一分支折叠为 null。
终端可以折叠长 evidence，但不会把 limited 当作 full，或把导出故障解释为 `not-recorded`。

无法打开 Graph、识别 locator、验证参数、生成 Plan 或复制必需 evidence 时，命令非零退出并指出 Graph、target、参数或 EvidenceRef。
源 Record 本来没有该事实时，由对应 Projector runtime 根据 tracked read 形成有依据的 unavailable
结果；author function 不返回 availability wrapper。

## 相关阅读

- [Library](library.md) —— ReportDefinition、target 与 ReportData。
- [View](view.md) —— 同一份报告的 web 与静态交付路径。
- [Sample](../sample/library.md) —— 固定范围、membership proof 与 Sample Bundle。
