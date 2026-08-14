# Vercel `design.md`：报告网站设计指令

> 观察日期：2026-08-14
>
> 观察对象：Vercel `design.md` 与公开的 VBG CSS
>
> 文档性质：外部产品研究与目录适格性审查，不是 NiceEval 目标契约

## 它是什么

[Vercel `design.md`](https://vercel.com/design.md) 是一份面向 coding agent 的报告网站设计与实现指令。
它的 frontmatter 名称是 `vercel-brand-guidelines`，目标网页是“official Vercel-authored report website”。
它不是独立的实验平台或报告数据产品。

这份指令让 agent 把调用者已有的事实、公式和约束组织进宿主 Web 项目。
它定义读者任务、证据构图、VBG 视觉基础、响应式、可访问性和真实渲染复查。
运行结果、历史查询与持久数据 migration 不属于它的公开产品边界，完整证据见 [适格性审查](eligibility.md)。

## 用户心智模型

用户不是在 `design.md` 中创建一次 Run。
用户把已有材料和宿主项目交给 agent，agent 再把材料变成一个可运行、可复核的 Vercel 风格报告网站。

```text
调用者材料 + 宿主项目
        ↓
vercel-brand-guidelines
        ↓
读者任务 + 证据构图
        ↓
VBG foundation + 页面专属实现
        ↓
真实渲染并复查的报告网站
```

[`design.md`](https://vercel.com/design.md) 要求保留宿主 framework、routes、component conventions、build system 和 output form。
没有宿主项目时，才选择最小可运行 Web 实现。
因此，最终 artifact 由调用者项目拥有，而不是保存在 `design.md` 的远端 Report resource 中。

## 原生对象总图

| 原生对象或 component | 角色 | 与其它对象的关系 |
|---|---|---|
| `vercel-brand-guidelines` | agent 指令 | 读取调用者材料，约束页面设计与实现 |
| caller's project | 宿主代码库 | 拥有 route、component、build 与最终 artifact |
| executive path | 快速阅读路径 | 用身份、标题、决定性数值、图注和判断传达主线 |
| audit path | 页面内复核路径 | 用精确表格、假设、方法、限制和引用出处支持复查 |
| VBG foundation | 品牌与报告呈现基础 | 由 [`vercel-brand.css`](https://vercel.com/geist/vercel-brand.css) 提供 token、control 和 primitive |
| published CSS API | 公共呈现接口 | 使用 `vbg-*` class、`--vbg-*` token 与规定的 DOM child relationship |
| page-owned CSS | 页面专属扩展 | 只以 `vbg-custom-*` 与 `vbg-viz-*` 表达局部几何和 mark |
| calculator state model | 页内交互模型 | 从 variables、formula、precision 与 dependency 计算显示值 |
| rendered website | 最终用户入口 | 经宿主 route、preview 或 deployment 在浏览器显示 |

这些对象构成一套报告网站的创作与呈现模型。
它们没有组成实验运行、持久结果和历史读取的独立产品层。

## 研究页导航

- [适格性审查](eligibility.md)：逐项核对运行顺序、持久对象、写入边界、历史读取、derived value 与 migration，并说明为什么应移出 Record → Report 研究。

本对象不适格，所以本目录不伪造 `layers.md`、`execution.md`、`storage.md`、`reading-and-comparison.md` 或 `schema-and-migration.md`。

## 与 NiceEval 的相似与差异

| 维度 | Vercel `design.md` | NiceEval |
|---|---|---|
| 共同关注 | 让读者快速理解证据，同时保留精确复核路径 | [Reports](../../../feature/reports/README.md) 也要兼顾判断与复查 |
| 起点 | 调用者已经准备好材料 | [Record](../../../feature/record/README.md) 先保存运行及评价事实 |
| 比较 | 在一张页面内对齐已提供的 alternatives | 还要选择和对齐多次运行，并显式处理 missing、partial 与 denominator |
| 持久边界 | 宿主网页源码与样式资产 | 具有 durable identity 的运行事实 |
| 可吸收约束 | 读者任务、双阅读路径、证据就近限定、诚实图形和真实渲染复查 | 吸收为 Report 信息架构与验收规则 |
| 不可吸收先例 | 没有历史 query、兼容 reader 或 migration | 这些能力必须由 NiceEval 自己或真正的实验产品提供先例 |

NiceEval 不应复制 Geist、Vercel shell、固定 grid、`vbg-*` 或 browser calculator。
更不能把 audit path、table、chart 或 VBG shell 改名为 Record、Analysis 或 Report 数据层。
