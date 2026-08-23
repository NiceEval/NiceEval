# 准备前缀缓存

有些 Sandbox 初态必须等 Provider ready 后才能生成。Docker-in-Docker 要等 inner daemon ready 才能导入离线 image；Adapter 也可能在 Sandbox 内写入 fixture 配置。它们都是 Agent/test 前的 preparation，不形成独立的 Deployment 或额外生命周期。

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
| `.before(shell/writeText/writeBytes/uploadFile/uploadDirectory/gitCheckout)` | 每个 planning 编译出的 occurrence 都要满足；hit restore，miss replay，结果可以 promotion |
| `.before(customFamily(input, options))` | 与内置 Action 同路；封闭 steps 形成一个原子前缀节点 |
| `.before(callback)` / `.before(defineSandboxCommand(...))` | 始终真实执行，显示 opaque，并截断后续共享捕获；成功取得资源后用 `context.onCleanup()` 登记释放 |
| `.after(action)` | occurrence 无条件、幂等 finally；入口登记、始终真实执行，按实际登记栈逆序 |

所有 owner 使用同一种 before/after API。owner 负责 identity 与归因，不形成排序墙。公开 API 不暴露 scope；link 与 physical planning 依据 typed inputs 和 sharing cohort 编译 physical-instance 或 attempt occurrence，再在每个 occurrence 内按依赖和数值排队。缓存命中只把 standalone before invocation 替换为 verified state restore，不删除 satisfaction fact。

普通 fixture 配置和无密钥 `.env` 模板可以进入可缓存 before action；secret、租约、checkpoint、外部会话和实例 locator 只能进入 callback 或 after，不能进入共享 prefix、key、manifest 或日志。opaque before 之后的 action 仍执行，但因 `opaque-ancestor` 不再 capture。

`upload`、Git clone、Plugin 安装和 shell 不是四套缓存机制。它们与第三方 `defineSandboxAction()` family 都产生带稳定 steps 与输入身份的 before action。NiceEval 先固定本地内容或远端 ref，再由 Provider 恢复或执行相同的 Sandbox 状态变化。内容已经固定不等于可以提前暴露：隐藏判据可以先登记为不可变内容，但只能在 Agent 返回后的 Eval test 中传入 Sandbox，不能进入 Agent 前缀。

## 入口

- [Library](library.md) —— 统一 before/after、条件 cleanup、owner 包裹、occurrence 编译与频率。
- [Architecture](architecture.md) —— PrefixKey、Provider 捕获、DinD 与缓存库存。
- [Lifecycle](lifecycle.md) —— 线性化、最长前缀、激活、排队与失败。
- [固定 DinD runtime](use-case/固定DinD运行时.md) —— runtime、候选与 Adapter `.env` 的分层示例。
- [固定 Fixture 与隐藏判据](use-case/固定Fixture与隐藏判据.md) —— 本地上传、远端 checkout 与 Agent 后可见内容。
- [原生 Agent Plugin](use-case/原生AgentPlugin.md) —— marketplace clone、安装后脚本、secret 与 cohort 的拆分。
