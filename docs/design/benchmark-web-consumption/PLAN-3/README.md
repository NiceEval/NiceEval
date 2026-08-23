# PLAN-3：Layered data + components

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 稳定公共面

NiceEval 同时发布 framework-neutral closed data core 与可选 component layer。组件只能消费稳定 data reader / handle，不拥有 selection、统计计算或另一条 transport。

```text
NiceEval data definition/materialization/reader
  ├─ user framework / chart / DOM
  └─ NiceEval optional components
         └─ user page, route, theme and composition
```

候选 API 同时包含 data-first 的 definition / reader，以及 component-first 的 Provider / hooks / primitives。组件接收已经打开的数据 handle；更换 revision 时只能原子切换一个 identity。

## Static / dynamic

Static 与 dynamic 都先满足 data core 的关闭与权限边界，再由用户选择直接渲染数据或使用组件。Framework-specific hydration 留在用户项目；NiceEval 组件不接管 route、build adapter 或部署。

## Cases 与代价

- W1、W2、W8 都有明确路径：需要自由时用 data，需要最短接入时用 components。
- W5、W7 的通用状态可以由组件复用，同时不阻止非组件消费者。
- NiceEval 必须同时版本化 data schema、reader、component props、DOM / ARIA 与两层兼容矩阵。
- 组件若开始 fetch、选择或聚合，就会形成第二套 owner；机械边界需要长期 lint、测试与 review。
- 组件能力不足时，用户可能仍同时写两份呈现逻辑，layered 并不会自动降低总成本。

## 重新裁决触发器

若 dogfood 证明 component layer 只是极薄包装或长期落后于 data 能力，应退回 data-first。若绝大多数用户只使用组件且 data ABI 无独立消费者，应重新比较 components-first。
