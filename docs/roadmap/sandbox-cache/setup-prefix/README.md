# 准备前缀缓存

有些 Sandbox 初态必须等 Provider ready 后才能生成。Docker-in-Docker 要等 inner daemon ready 才能导入离线 image；Adapter 也可能在 Sandbox 内写入 fixture 配置。它们都是 Agent/test 前的 preparation，不形成独立的 Deployment 或 materialize 生命周期。

NiceEval 把 Experiment、Eval Group、Eval 与 Agent 的 before action 编译成 occurrence-local 依赖 DAG。每次从 ready set 选择 `changeFrequency` 最小的 action，并为排序后的每个逻辑前缀计算内容身份。命中最长 verified 前缀后，只 replay 变化节点及其后缀：固定 runtime 可以在前，候选依赖居中，Agent 写普通 `.env` 的高频节点在后；只改变 `.env` 时不会重新导入 runtime。

```text
BuildKey ready
  → compile physical-instance / attempt occurrences
  → link dependencies and schedule ready actions by frequency
  → longest verified SetupPrefix lookup
  → restore hit or replay remaining recipes
  → optional prefix promotion
  → private clone
  → Agent/test → lifecycle teardown
```

`changeFrequency` 不是缓存开关，而是 before 的语义排序字段。它接受有限非负数，省略时为 `normal = 100`；数值越小越早，`rare`、`normal` 与 `frequent` 只是数字常量。改值可以改变执行顺序、前缀祖先链与 fingerprint。它同时影响 promotion、缓存工作排队、保留和回收。

## 两类准备节点

| 内容 | 执行语义 |
|---|---|
| `.before(shell/write/copy)` | 每个 planning 编译出的 occurrence 都要满足；hit restore，miss replay，结果可以 promotion |
| `.before(callback)` | 始终真实执行，显示 opaque，并截断后续共享捕获 |
| `.around({ before, after })` | 成对取得与释放；两侧始终真实执行，配对 after 按实际登记栈逆序 |
| `.after(action)` | occurrence finally；始终真实执行，按实际登记栈逆序 |

所有 owner 使用同一种 before/after/around API。owner 负责 identity 与归因，不形成排序墙。公开 API 不暴露 scope；link 与 physical planning 依据 typed inputs 和 sharing cohort 编译 physical-instance 或 attempt occurrence，再在每个 occurrence 内按依赖和数值排队。缓存命中只把 standalone before invocation 替换为 verified state restore，不删除 satisfaction fact。

普通 fixture 配置和无密钥 `.env` 模板可以进入可缓存 before action；secret、租约、checkpoint、外部会话和实例 locator 只能进入 callback 或 after，不能进入共享 prefix、key、manifest 或日志。opaque before 之后的 action 仍执行，但因 `opaque-ancestor` 不再 capture。

## 入口

- [Library](library.md) —— 统一 before/after/around、owner 包裹、occurrence 编译与频率。
- [Architecture](architecture.md) —— PrefixKey、Provider 捕获、DinD 与缓存库存。
- [Lifecycle](lifecycle.md) —— 线性化、最长前缀、激活、排队与失败。
- [固定 DinD runtime](use-case/固定DinD运行时.md) —— runtime、候选与 Adapter `.env` 的分层示例。
