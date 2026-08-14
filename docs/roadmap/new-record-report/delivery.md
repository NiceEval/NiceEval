# ④ Delivery

```text
┌────────────────────────────────────┐
│ Delivery = 同一报告的不同出口      │
└────────────────────────────────────┘
```

## 心智模型

使用与交付层回答“用户怎样找到并查看同一份报告”。用户通过 NiceEval CLI 选择运行、比较对象、Report 与输出媒介，不直接进入 `.niceeval` 目录。

terminal、Web 与 static 是同一棵 `ClosedReportTree` 的不同 face。它们不能各自查询或计算，否则同一个 Report 会产生不同分母、问题或下钻路径。

## 解决的问题

- 一次运行后定位 Run、Attempt、事件、评价与 Evidence。
- 多次运行时选择、对齐、分组和比较。
- 显示 missing、partial、unsupported 与 failed。
- 在终端、Web 与静态站保留分母、问题面和复核路径。
- 遇到旧 Record 时引导用户执行显式 migration。

## show

```console
niceeval show
niceeval show --run <run-id>
niceeval show --report ./reports/experiment.tsx
```

`show` 选择 frozen Record 与 Report，只执行请求的 Page 或 slice，再把闭合语义树渲染成 terminal face。

终端输出必须保留：

- Run、Attempt 与 grouping identity。
- `MetricValue` 的 observed/denominator。
- missing、partial、unsupported 与 failed。
- issues 与可继续执行的 Evidence 命令或 route。

## view

```console
niceeval view
niceeval view --run <run-id>
niceeval view --report ./reports/experiment.tsx
```

每个页面请求建立一份 `ReportExecution`，并只执行请求的 Page。Web 可以增强展开、筛选、焦点与 route navigation，但不能增加 terminal 与 static 无法复核的结果语义。

## 静态导出

```console
niceeval view --out ./report
niceeval view --run <run-id> --out ./report
```

host 在一次 execution 中枚举目标 Page instances，并把所有闭合页面写入 staging directory。全部页面与 assets 验证成功后才发布目标目录。

静态结果必须保留：

- frozen Sample identity 与 selection。
- Report module fingerprint 与 host version。
- 每个 Metric 的分母和状态。
- Evidence navigation 或明确的不可内联说明。
- Page failure 与 unsupported problem。

## migrate

```console
niceeval migrate
niceeval migrate --yes
```

`niceeval migrate` 执行只读 preflight，展示 source version、目标版本、converter chain、恢复点与影响范围。`--yes` 在重新验证 exact plan identity 后执行 staging migration 和原子发布。

`show`、`view` 与静态导出遇到旧 Record 时返回：

```text
error: migration-required
Record schema: v15
Required schema: v16
Next: niceeval migrate
```

它们不能静默改盘，也不能把旧版本事实送入 Analysis。

## Renderer SPI

renderer 是内部 capability：

```ts
interface ReportRenderer<Output> {
  readonly face: "terminal" | "web" | "static";
  readonly version: RendererVersion;

  render(tree: ClosedReportTree): Promise<Output>;
}
```

renderer input 只有闭合语义树。它不取得 `ReportSample`、Record、Analysis executor、领域 projection 或 migration authority。

## CLI 失败合同

所有失败必须包含 error code、失败对象、阶段与可执行下一步：

| 情况 | 是否改盘 | 下一步 |
|---|---|---|
| `migration-required` | 否 | 运行 `niceeval migrate` |
| Analysis 或 Page 失败 | 否 | 根据 field、Page 与 problem identity 修正定义 |
| renderer 失败 | 否 | 保留 closed tree 作为诊断输入 |
| migration preflight 失败 | 否 | 修复恢复点、空间、锁或 converter 问题 |
| migration apply 失败 | source 不变 | 根据 staging failure 修复后重新 plan |

## 禁止跨出的边界

- 不把 `.niceeval` 目录结构当作用户阅读界面。
- 不在 renderer 内重新计算 Analysis。
- 不让 Web、terminal 与 static 使用不同数据源。
- 不用 missing、空数组或零值掩盖 migration、producer 或 renderer failure。
