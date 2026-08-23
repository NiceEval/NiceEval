**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Limits

- **L1 — Analysis 已有闭合值。** `SemanticFrame`、`MetricValue` 与 `DomainView` 不含 reader、Scope、callback 或 Record path，但这不自动决定它们是否成为网页公共 wire format。
- **L2 — 非平表材料存在。** Trace、diff、source、artifact 与 Evidence 可能很大，也可能需要按需读取。
- **L3 — Static browser 没有 Record。** 静态部署必须在受信任 build / server 边界完成所需读取；浏览器只能取得关闭后的内容。
- **L4 — Dynamic 页面有自己的权限模型。** 用户 server 可能按 tenant、route 或 request 控制查询，NiceEval 不能默认公开本地 Record。
- **L5 — Framework 生命周期不同。** React component、Astro build、SSR、island hydration 与非 React 图表库不能由一个 framework 的 props 假装等价。
- **L6 — 组件也依赖数据。** Components-first 可以把 transport 保持为私有实现，但必须说明组件如何在 static / dynamic 宿主运行条件下取得一致输入。
- **L7 — 数据 API 也有 UI 成本。** Data-first 不能用“用户自由”掩盖 loading、revision、a11y、i18n 与 Evidence 状态的重复工作。
- **L8 — Layered 承担两层兼容。** 同时发布 data 与 components 会增加版本矩阵和测试义务，不是自动优于单层方案。
- **L9 — NiceEval 处于 beta。** 可以选择理想公共面，但一旦进入 Feature，用户网页保存的数据或 import 的组件就成为真实 ABI。

## 候选清单

- [PLAN-1](PLAN-1/README.md)：只承诺 framework-neutral closed data API。
- [PLAN-2](PLAN-2/README.md)：主要承诺可 import component API，数据 transport 保持组件内部。
- [PLAN-3](PLAN-3/README.md)：稳定 data core 与可选 component layer 同时发布。
