# 共享对象库

这个候选只保存一份完整 Git object database。
每条 Attempt 建立独立 refs 与 worktree，通过 alternate、只读 mount、hardlink 或 local clone 借用共享 objects。

## Library

```ts
interface CheckoutOptions {
  repository: string;
  commit: string;
  into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;
```

作者面没有对象库参数。
Runner 或 Provider 自动把共享对象库接入当前 Sandbox。

## Architecture 与生命周期

宿主或长寿命 volume 保存 repository 的全部对象。
每条 Attempt 只重建 HEAD、refs、index 与 worktree，并把 `.git/objects/info/alternates` 或等价 mount 指向共享库。

共享库可以只读，因而能防止 Agent 修改 origin objects。
只读不等于不可见；Agent 知道未来 OID 后，仍可以从共享库读取对应 commit、tree 或 blob。

## Cases

- **C1：兑现性能。** 同一对象库服务多个 commit 与 Sandbox。
- **C2：不兑现隔离。** alternate 与 mount 明确允许读取完整对象库。
- **C3：部分兑现。** 每题 metadata 可重建，但共享对象仍扩大可见集合。
- **C4：兑现。** 并行消费者可以共享只读 objects。
- **C5：不兑现。** 工作树依赖共享对象库持续存在。
- **C6：部分兑现。** 只读库不被污染，但交付中断仍需处理挂载与 metadata。
- **C7：难以独立兑现。** 删除共享库会同时破坏所有依赖它的 repository。
- **C8：可拒绝。** 输入校验与存储方案无关。

## 代价

这个候选优化了磁盘与传输，却把性能共享面直接变成 Agent 可见面，因此不采用。
