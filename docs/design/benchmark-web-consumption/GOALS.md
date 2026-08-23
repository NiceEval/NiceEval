**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Goals

## 目的与范围

本决策比较外部用户怎样把 NiceEval Analysis 结果接进完全自有的网站。用户拥有页面、DOM、路由、样式、图表、交互、鉴权、缓存和部署；候选只比较 NiceEval 应稳定提供哪一层能力。

本决策不改变 Record 或 Analysis 的统计语义，也不把本地 Insight 变成 public host。

## 设计原则

- **G1 — 用户拥有最终网页。** NiceEval 不能要求网站采用第一方 shell、route、theme 或部署平台。
- **G2 — 统计事实不漂移。** Population、Measure、denominator、missing、comparability、issues 与 Evidence 的唯一 owner 仍是 Analysis。
- **G3 — 自定义能力可验证。** 候选必须用非 React 页面、任意图表库和完全自定义 DOM / CSS 证明边界。
- **G4 — 快速接入可验证。** 候选必须展示 React / Astro 项目的最短可维护路径，而不只比较理论自由度。
- **G5 — 静态与动态都要交代。** 每个候选分别说明无 Record 浏览器权限的静态部署，以及带鉴权的动态更新。
- **G6 — 浏览器无 Host capability。** Record reader、Sample、host path、migration 与其它 authority 不能进入浏览器。
- **G7 — Closed value 完整。** Partial、missing、Evidence 与大型材料不能因为 UI 方便而丢失或伪装。
- **G8 — 长期 ABI 成本显式。** Framework、schema、DOM、CSS、SSR / hydration、版本与恢复都进入比较。
- **G9 — 共同材料方案中立。** 不预设 transport、closed data builder、public server、组件 framework 或 static / dynamic 同义。

## 可验证要求

每个 PLAN 都必须逐项兑现或明确失败 [W1–W9](CASES.md)。最终选型前还要用同一真实 benchmark 做三份最小 dogfood，并保留可复查的代码与构建文件证据。
