# 单一 repository cache entry

这个候选把一个 repository 建模为单个受管 Cache Manifest entry。
entry 随新 commit 增长，并直接作为 Sandbox 交付材料。

## Library

```ts
interface CheckoutOptions {
  repository: string;
  commit: string;
  into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;
```

每个 repository 对应一个 cache key；commit 只作为 entry 内部的已取得对象事实。

## Architecture 与生命周期

第一次需求创建 repository entry，后续需求在同一 entry 中 fetch 新对象。
消费者从 entry 导出或读取目标 commit，再生成 worktree。

这个模型让同一 entry 的 immutable identity 与实际内容随 fetch 改变。
读 lease、写 lease、发布 generation、内容摘要与 GC evidence 因而不能继续使用现有不可变 entry 语义。

如果 entry 直接交付，仍会暴露未来对象；如果每次另行导出安全包，导出物实际上已经成为第二种实体。

## Cases

- **C1：兑现获取复用。** repository entry 可以增量增长。
- **C2：取决于额外导出。** 直接交付失败；安全导出会引入未建模的第二实体。
- **C3：可以重建 metadata。** 但对象可见集合仍需第二层保证。
- **C4：需要复杂读写 fencing。** fetch 会改变所有读者共享的 entry。
- **C5：不兑现。** 导出结果没有独立身份，pool 删除后无法独立复用。
- **C6：难以证明。** mutable entry 的半次 fetch 与旧 manifest 可能同时存在。
- **C7：不兑现现有 GC 不变量。** 删除、命中与增长引用同一 resource identity。
- **C8：可拒绝。** 输入校验与存储方案无关。

## 代价

这个候选表面只有一个实体，实际仍需要区分 acquisition 状态与不可变交付物。
继续坚持单一 entry 会重写整个 immutable publish、lease 和 GC 模型，因此不采用。
