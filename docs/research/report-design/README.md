# Report design 产品研究

本方向研究已经得到语义结果之后，表格、图表和报告网站怎样组织信息、控制交互状态并投影到具体媒介。
它不研究实验怎样运行、结果怎样持久保存、历史运行怎样重开，也不把 renderer 的瞬态对象当成 Record schema。

> 主要观察日期：2026-08-13 至 2026-08-14
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究对象

| 对象 | 它回答的问题 | 研究入口 |
|---|---|---|
| TanStack Table / Charts | 当前数据怎样成为 headless row model、chart scene 与最终 renderer 输出 | [TanStack Table / Charts](tanstack/README.md) |
| Vercel `design.md` | 报告网站怎样从读者任务、证据关系进入页面结构与视觉验收 | [Vercel `design.md`](vercel/README.md) |

两者都不具备 Run、durable result store、历史 reader 或结果 migration 闭环。
具体不适格证据分别见 [TanStack 适格性审查](tanstack/eligibility.md) 与 [Vercel 适格性审查](vercel/eligibility.md)。

## 与 Record → Report 的边界

[Record → Report](../record-to-report/README.md) 先研究运行事实怎样保存、重新打开、比较并进入报告。
本方向只接手其最后一段呈现问题：同一份已完成语义结果怎样成为 Table、Chart、Page、静态站或其它媒介，而不改变上游事实、分母与复核路径。
