**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md)

# Decision

## 定案

暂缓选择外部 benchmark 网页的公开接入面。

[PLAN-1 data-first](PLAN-1/README.md)、[PLAN-2 components-first](PLAN-2/README.md) 与 [PLAN-3 layered](PLAN-3/README.md) 都不是当前产品承诺。NiceEval 当前只定稿 CLI 与本地 [Insight](../cli-insight/DECISION.md)；Insight transport、machine query 和旧 Report runtime 都不能被外部网页当作临时 API。

这是一个明确的产品裁决。在下列证据门完成前，不发布 `niceeval/benchmark/**`、公共 Benchmark data schema、公共网页组件、Astro integration、公共 Bundle / snapshot transport 或 NiceEval-hosted web query server。

## 依据

三个候选真正拉开差距的不是调用行数，而是 NiceEval 要长期稳定哪一种 ABI：

- Data-first 稳定 schema、identity、reader、budget 与恢复语义，换取 framework 和样式自由。
- Components-first 稳定 props、DOM、ARIA、SSR / hydration 与样式 extension，换取较短接入路径。
- Layered 同时承担两层兼容，并要机械证明组件没有偷偷成为第二个数据 owner。

当前材料没有真实外部网站的代码、浏览器资源体积、DOM / CSS 控制度、a11y、SSR、升级或恢复证据。直接选择 layered 只是在证据不足时把两份成本都接受，不能视为稳妥默认。

## 证据门

最终选型前，使用同一个真实 benchmark 分别完成三个最小 dogfood，并保留可复查代码与构建文件：

1. 完全自定义的非 React 页面，使用任意图表库与自有 DOM / CSS。
2. Astro 静态页面，证明 build、Evidence detail 与无 Record 浏览器边界。
3. React 动态页面，证明用户 server 鉴权、更新、缓存与 revision coherence。
4. 每个候选都包含 partial、missing、unsupported、大型材料、a11y、en / zh-CN、SSR / hydration 与损坏输入。
5. 对比作者代码、依赖与浏览器体积、DOM / CSS 控制度、框架迁移、版本升级、恢复路径和 NiceEval 测试矩阵。

证据必须足以逐项验收 [W1–W9](CASES.md)。只做漂亮 demo、只测一个 framework 或复用 Insight 私有接口都不能通过。

## 候选状态

| 候选 | 当前状态 | 缺少的决定性证据 |
|---|---|---|
| [PLAN-1](PLAN-1/README.md) | 保留 | React / Astro 是否重复大量 revision、Evidence 与 a11y glue。 |
| [PLAN-2](PLAN-2/README.md) | 保留 | 完全自定义与非主 framework 是否仍能满足产品目标。 |
| [PLAN-3](PLAN-3/README.md) | 保留 | 两层 ABI 的实际收益是否大于维护与兼容成本。 |

## 遗留风险

- 暂缓意味着 NiceEval 暂时没有承诺用户网站作者面；公开文档必须明确这一点。
- 外部项目可能尝试调用 Insight RPC 或 machine query 作为网页 backend；这些接口的 trust 与生命周期不适合作为隐式支持面。
- dogfood 可能暴露第四个候选，例如 server SDK 而不是 data snapshot 或 component library。出现结构性新候选时新增 PLAN，不把它并入现有三案。
