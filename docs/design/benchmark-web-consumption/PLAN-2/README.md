# PLAN-2：Components-first

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [DECISION](../DECISION.md)

## 稳定公共面

NiceEval 发布一个主要 framework 的 component library。用户 import 具名组件或 headless primitives，传入 selection / query props 与 render slots；数据取得、revision 与 closed value 适配属于组件 runtime 的私有实现。

```tsx
<BenchmarkProvider source={source} selection={selection}>
  <Comparison
    measures={[passRate, cost]}
    renderRow={(row) => <MyRow row={row} />}
    renderIssue={(issue) => <MyIssue issue={issue} />}
  />
</BenchmarkProvider>
```

组件 props、context、loading / error 状态、SSR 行为、DOM / ARIA contract 与样式 extension points 都是长期 ABI。内部 transport 不作为任意 framework 可依赖的稳定 data API。

## Static / dynamic

Static 通过支持的 framework SSR / build lifecycle 关闭数据与 markup。Dynamic 由 Provider 的 server / client loader 取得数据，并维护 revision coherence。

Astro 项目需要对应 framework integration 与 island / SSR 决策。非支持 framework 不能绕过组件读取内部 transport。

## Cases 与代价

- W2、W5、W7 最强：官方组件统一 loading、missing、Evidence、revision、a11y 与 i18n。
- W1 较弱：Render slots 可以替换局部 DOM，但完全自定义非 React 页面没有稳定 data API。
- W3、W4 需要组件 runtime 同时适应 build、SSR、鉴权与 browser hydration。
- W8 成本最高：迁出主 framework 等于迁出 NiceEval 公共面。
- Props 一旦吸收 route、fetch、cache、theme 与 chart，很容易重新长成旧 Report 平台。

## 重新裁决触发器

若完全自定义 DOM / CSS 或非 React dogfood 必须复制、反射或依赖内部 transport，本候选不能满足用户拥有网页的目标。
