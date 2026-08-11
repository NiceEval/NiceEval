# Sandbox 内完整 mirror

这个候选让 `checkout()` 在每台 Sandbox 的 workdir 外执行 `git clone --mirror`。
后续 Attempt 从 mirror 向 workdir fetch 指定 commit，以减少同一 Sandbox 内的网络访问。

## Library

```ts
interface CheckoutOptions {
  repository: string;
  commit: string;
  into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;
```

作者写法与其它候选相同。
实现把 mirror 放在 Sandbox 私有路径，并按 repository 与 commit 键控。

## Architecture 与生命周期

每台 Sandbox 的首条 Attempt clone 完整 mirror，随后从 mirror 建立 workdir repository。
Sandbox 复用时 mirror 跨 Attempt 保留；fresh Sandbox 各自重新 clone。

这个候选无法把“私有路径”变成 Agent 权限边界。
Agent 可以遍历 `/tmp`、`$HOME` 或其它已知路径，也可以污染 mirror 与下一题沿用的 `.git`。

## Cases

- **C1：部分兑现。** 同一 Sandbox 可减少下载，但不同 commit 使用不同键时仍可能重复 mirror；fresh Sandbox 不共享。
- **C2：不兑现。** 完整 mirror 含未来对象，删除 refs 不阻止按已知 OID 读取。
- **C3：不兑现。** workdir reset 与 mirror 探测不能证明旧 hook、config 与 objects 已丢弃。
- **C4：部分兑现。** 同一实例可串行复用，并行 Sandbox 仍重复 clone。
- **C5：不适用。** mirror 与 Sandbox 同寿命。
- **C6：不兑现。** prepare 失败后 workdir reset 不清除 workdir 外残留。
- **C7：不兑现。** Sandbox 销毁以外没有独立库存与 GC。
- **C8：可拒绝。** 输入校验与存储方案无关。

## 代价

这个候选实现最少，却同时破坏对象级隔离和跨 fresh Sandbox 复用目标，因此不采用。
