# Limits

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md)

- **L1 — Durable Record 固定。** Run、Attempt、Member、exact reference、complete marker 与 owner-local Attachment bytes 不因候选改变。
- **L2 — Frozen view。** 一次分析只观察同一个 frozen Record snapshot；并发发布的新 Run 不混入当前结果。
- **L3 — 两种 Run 关系。** Reference Member 所在的 selected Run 与 Attempt 的 origin Run 可以不同。
- **L4 — Slot universe。** 每个 selected Run 的 expected slots 先于 Attachment 状态存在，分母不能从成功读取数反推。
- **L5 — Attachment 六态。** Missing、旧 schema、不可迁移、unknown schema 与 invalid bytes 不能折成 `undefined`。
- **L6 — Owner-local migration。** Converter 只迁移自己的 Attachment closure；跨 owner subject identity 不是现有 migration 的能力。
- **L7 — 完整 blob snapshot。** 当前 reader 在 `available` 前验证并把整份 blob closure 读入内存，不支持选择性 chunk read。
- **L8 — Trusted module。** Report module 可以直接 import Node API；callback 参数收窄不是安全沙箱。
- **L9 — Closed output。** Page 产生 package-defined semantic tree，不能返回任意 HTML、React DOM 或浏览器 fetch。
- **L10 — Effect boundary。** Record open/read 的实现使用 Effect Scope；候选可以隐藏或暴露 Effect，但必须保证 scope 与 interruption 正确。

## 共同的 grading claim selection

```ts
interface GradingClaimSelection {
  readonly kind: "explicit-grading-runs";
  readonly runIds: readonly [RunId, ...RunId[]];
}

declare const explicitGradingRuns: (input: {
  readonly runIds: readonly [RunId, ...RunId[]];
}) => GradingClaimSelection;
```

三套候选共用这份语义。Selection 绑定同一个 frozen Record view，只选择 claim-producing Runs，不改变
Analysis 的 base population；API 不提供 latest 默认值。

## 候选清单

- [PLAN-1](PLAN-1/README.md)：consumer-local opaque query graph。
- [PLAN-2](PLAN-2/README.md)：scoped loader 与普通 TypeScript 数据模型。
- [PLAN-3](PLAN-3/README.md)：typed semantic relations 与 measures。
