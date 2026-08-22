**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Goals

## 目的与范围

本决策定义 CLI、第一方 Insight 与用户 benchmark 网站怎样消费同一份 Analysis。它不改变 Record 的持久事实，也不降低 Population、Measure、missing、Evidence 或 producer compatibility 的正确性要求。

它同时裁决用户网页的公共数据形态、可选 React 适配层，以及 static 与 dynamic 的发布边界。

## 设计原则

- **G1 — 三面独立。** CLI、Insight 与用户网站各自拥有呈现，不再通过双面组件追求同形。
- **G2 — CLI AI-native。** Agent 只靠 discovery、JSON Schema、版本化请求、闭合响应与 correction 就能工作，不必读源码猜参数。
- **G3 — 自由不改口径。** CLI 可以选择任意已发布 descriptor 和历史范围，但不能隐式求交集、改分母或把不可比总体做排名。
- **G4 — Insight 只做排障。** Insight 可以动态、按需、第一方优化，但不能演变成用户 Page 或 renderer 平台。
- **G5 — 用户拥有网页。** 用户决定框架、路由、CSS、图表、交互、鉴权、缓存和部署。
- **G6 — 数据先于组件。** 任意框架都能完整消费数据；React 便利层不能成为事实或统计语义的 owner。
- **G7 — 静动态同义。** 静态构建与用户服务端动态生成调用同一个 materializer，并产出相同 Bundle transport。
- **G8 — 浏览器无能力。** 浏览器不能取得 Record reader、Sample、host path、blob locator 或 migration capability。
- **G9 — 可重建派生物。** Bundle 通过 identity、digest、预算与原子发布保持一致；格式升级重新 materialize，不原地迁移。
- **G10 — 旧 Report 真正退出。** Page、双面组件、ClosedSiteRevision 与公共 renderer 不能换名后继续存在。

## 可验证要求

- **G11 — 一次请求一个 Sample。** 一个 query response、BenchmarkBundle 或 InsightRevision 内的全部数据来自同一 frozen Sample。
- **G12 — 比较资格可机器检查。** alignment、comparability、分母、unmatched、excluded 与 issues 都是闭合机器字段。
- **G13 — 失败不可伪装。** digest、预算、descriptor 冲突、schema 不支持和请求不合法各有稳定错误，不靠截断或空值成功。
- **G14 — Framework-neutral core 无 React。** 导入 Bundle definition、materializer 或 reader 不加载 React / ReactDOM。
- **G15 — Evidence 不丢失。** 每个 `MetricValue` 保留完整度与 Evidence；Bundle 明确区分已纳入与只引用的 Evidence。
- **G16 — Astro 编译权归用户。** hydration directive 留在用户 `.astro` 文件，不进入 NiceEval 数据协议或 integration。
