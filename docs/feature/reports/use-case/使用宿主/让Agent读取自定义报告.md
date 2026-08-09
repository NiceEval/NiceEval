# 让人和 Agent 读取同一份自定义报告

项目把报告设为默认后，人用 `view`，Agent 用 `show`：

```bash
niceeval view
niceeval show
niceeval show memory/retention --page failures
```

两个宿主形成同一类固定 Sample，并执行同一个 ReportDefinition 的一次 `plan()`。每个 page instance 的 `render(data)` 只运行一次；text 与 web renderer 分别呈现同一棵不可变树。

web 可以提供排序、tooltip、折叠与 dialog；text 使用声明过的降级形状显示相同的已定值与 evidence
refs，并保留 available verification / issues 或 unavailable causes / basedOn。几何不必相同，事实
不能静默减少。

需要稳定机器形状时，使用内建 show target 的 `--json`。任意自定义组件树不序列化成 JSON；机器交付使用公开 `exportReport()` 或内建 ReportData target。

报告用 `attemptDetailPages(sample, …)` 枚举详情 instance 后，浏览器深链与 `niceeval show @<locator> --report …` 才能指向同一 instance。没有枚举时，宿主明确报错；不会回落到另一张页面或在 render 时读取 Attempt。
