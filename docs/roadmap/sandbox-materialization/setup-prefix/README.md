# Setup 前缀缓存

有些 Sandbox 初态必须等 Provider ready 后才能生成。Docker-in-Docker 要等 inner daemon ready 才能导入离线 image；Adapter 也可能在 Sandbox 内写入 fixture 配置。它们仍是 setup，不形成独立的 Deployment 阶段。

NiceEval 把符合确定性协议的 setup 节点排成一条依赖有序的链，并为每个逻辑前缀计算内容身份。命中最长 verified 前缀后，只重新执行变化节点及其后缀的 recipe：固定 runtime 可以在前，候选依赖居中，Adapter 写普通 `.env` 的 frequent 节点在后；只改变 `.env` 时不会重新导入 runtime。

```text
BuildKey ready
  → setup DAG 线性化
  → longest verified SetupPrefix lookup
  → replay remaining materialize recipes
  → optional prefix promotion
  → private clone
  → per-instance setup → Attempt → teardown
```

`changeFrequency` 不是缓存开关。每个符合协议的 setup 操作都具有内容身份并有资格缓存；任意有限非负数只帮助 NiceEval 在依赖允许的 frontier 中排序，以及决定排队、promotion、保留和回收的积极度。数值越大表示预计变化越频繁，`rare`、`normal` 与 `frequent` 只是数字常量。它不进入 key，也不能越过显式依赖。

## 两类 setup

| setup 内容 | 执行语义 |
|---|---|
| `setup.exec()` / `setup.write()` / `setup.copy()` | 可从最长前缀跳过或重新执行；结果可以 promotion 为共享只读前缀 |
| 普通 callback | 每个物理 Sandbox 执行；不被缓存命中跳过 |

现有 `.setup(callback)` / `.teardown(callback)` 保持原语义。普通 callback 是不可跨越的逐实例顺序屏障，不能因频率排序被悄悄移动。可缓存操作在写出时直接传给 `.setup()`，不需要先定义 setup 容器，也不新增 `.deploy()`。

共享或持久 SetupPrefix 永远位于逐实例 callback 之前。普通 fixture 配置和无密钥 `.env` 模板可以进入可缓存操作；secret、租约、checkpoint、外部会话和实例 locator 只能进入逐实例 setup/teardown callback，不能进入共享 prefix、key、manifest 或日志。

## 入口

- [Library](library.md) —— `.setup()` 重载、频率、依赖与品牌化 recipe。
- [Architecture](architecture.md) —— PrefixKey、Provider 捕获、DinD 与缓存库存。
- [Lifecycle](lifecycle.md) —— 线性化、最长前缀、激活、排队与失败。
- [固定 DinD runtime](use-case/固定DinD运行时.md) —— runtime、候选与 Adapter `.env` 的分层示例。
