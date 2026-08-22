**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Limits

- **L1 — Record 是 opaque portable 事实集。** 浏览器与普通组件不能直接读取 Record；只有 Host 打开 reader，再由 Analysis 形成闭合值。
- **L2 — Analysis descriptor 可以含函数。** 自定义 Measure 与 Relation 必须先作为受信任 TypeScript 定义注册。JSON 请求只能引用已发现的 descriptor，不能安全承载任意函数。
- **L3 — Analysis 输出有非平表内容。** `SemanticFrame` 适合比较，trace、diff、source 与 artifact 继续使用 `DomainView` 或显式 blob。
- **L4 — 大材料必须按需。** Insight 可以在 pinned revision 内惰性读取详情；公开 Bundle 只纳入 Definition 明确声明并通过预算的资源。
- **L5 — 静态站没有 Record。** 静态构建必须先闭合全部 Bundle bytes。动态读取则需要用户自己的私有服务器能够访问 Record 或等价 Host 能力。
- **L6 — Astro 默认预渲染。** Astro 页面默认在 build time 形成静态 HTML；按请求渲染需要 adapter 和 route 选择。参见 [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)。
- **L7 — Astro hydration 属于页面源码。** `client:*` 只能用于 `.astro` 直接导入的 framework component。参见 [Astro template directives](https://docs.astro.build/en/reference/directives-reference/#client-directives)。
- **L8 — React 只是 Astro 的一种 integration。** Astro 可以同时使用多个 framework，React package 不能代表所有网站消费者。参见 [Astro islands](https://docs.astro.build/en/concepts/islands/) 与 [framework components](https://docs.astro.build/en/guides/framework-components/)。
- **L9 — NiceEval 仍处于 beta。** 本决策可以删除 `niceeval/report` 与相关 CLI，但必须迁移仍有领域价值的正确性职责。
- **L10 — Bundle 是公开 transport。** 一旦用户网站或 CI 保存它，identity、schema、canonical bytes 与失败语义必须独立于 Insight 私有实现。
- **L11 — 用户代码仍可误用数据。** NiceEval 能拒绝非法 materialization 并保留 comparability，不能阻止用户拿 side-by-side scalar 自行画误导排名。
- **L12 — BundleHandle 是能力值。** 它包含用户注入的 reader，不能序列化成 Astro hydration prop 或持久 JSON。

## 候选清单

- [PLAN-1](PLAN-1/README.md)：以 Astro integration 和 island 为公共作者面。
- [PLAN-2](PLAN-2/README.md)：以 React component library 为公共作者面。
- [PLAN-3](PLAN-3/README.md)：只发布 framework-neutral BenchmarkBundle。
- [PLAN-4](PLAN-4/README.md)：以 Bundle 为核心，另发布有界的无样式 React adapter。
