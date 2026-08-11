# SourcePool 与 SourceProjection（推荐）

宿主以 SourcePool 复用 origin acquisition，再为每个 immutable commit 发布独立 SourceProjection。
SourcePool 永不进入 Sandbox；SourceProjection 是 Agent 唯一能收到的 Git repository 材料。

## 核心心智

- `checkout()` 声明题目起点。
- SourcePool 回答宿主已经从 origin 取得哪些对象。
- SourceProjection 回答一条 Attempt 可以安全看见哪些对象。
- Host Materialization Demand 把纯声明连接到 Run 级准备，不向作者或 Agent暴露宿主能力。

## Library

```ts
interface CheckoutOptions {
  repository: string;
  commit: string;
  into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;
```

V1 只接受匿名公共 HTTPS repository 与完整 40 位 SHA-1 commit OID。
省略 `into` 时在 Sandbox workdir 根建立 repository；给出时必须是 workdir 内的相对路径。

## Architecture

```text
checkout declaration
  → GitSourceProjectionDemand
  → host SourcePool acquisition
  → immutable SourceProjection publish
  → scoped transfer
  → fresh .git + detached checkout
```

SourcePool 是 host-materialization Domain 中的 mutable auxiliary resource。
SourceProjection 是带精确 DemandKey、manifest、resource identity、lease 和 GC 状态的 immutable entry。

Projection 的合法对象集合固定为声明 commit、全部祖先及它们的 tree/blob。
materializer 在全新对象库中比较实际全部对象与预期集合；bundle verify 或 fsck 不能替代这项比较。

## Lifecycle

planning 收集命令携带的私有 demand，不执行网络 I/O。
Run 级准备先命中或扩充 SourcePool，再生成缺失 Projection；相同 demand single-flight。

Sandbox 创建后，每 Attempt 在原 prepare 顺序消费 Projection。
consumer 分块传输、校验、删除旧 `.git`、导入全新对象库、复验对象集合与 worktree，最后删除临时材料并释放 lease。

获取失败发生在 Sandbox 创建前，不产生 Sandbox 污染。
交付开始后的失败会 taint 当前实例；复用池必须退休它，不能只 reset workdir。

## Cases

- **C1：兑现。** SourcePool 按 repository 增长，Projection 按 commit 隔离。
- **C2：兑现。** Sandbox 只收到精确 ancestor closure，不存在通向 SourcePool 的引用。
- **C3：兑现。** consumer 在任何目标仓库 Git 命令前丢弃旧 metadata。
- **C4：兑现。** DemandKey 级 reservation 和 single-flight 合并并行准备。
- **C5：兑现。** 发布后的 Projection 不依赖 SourcePool。
- **C6：兑现。** 未发布资源 reconcile；交付失败退休 Sandbox。
- **C7：兑现。** pool 与 projection 分开盘点、lease 与回收。
- **C8：兑现。** pure link 在 origin 与 Sandbox I/O 前拒绝不支持输入。

## 范围

不支持 branch、tag、短 SHA、private、SSH、local、SHA-256、submodule hydration、Git LFS、history policy、自定义 cache handle 或跨 host SourcePool。

完整目标契约见 [Provider Cache 生命周期](../../../roadmap/materialization-cache/README.md)。
