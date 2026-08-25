# 准备前缀缓存

有些 Sandbox 初态必须等 Provider ready 后才能生成。Docker-in-Docker 要等 inner daemon ready 才能导入离线 image；Adapter 也可能在 Sandbox 内写入 fixture 配置。它们都是 Agent/test 前的 preparation，不形成独立的 Deployment 或额外生命周期。

NiceEval 把 Experiment、Eval Group、Eval 与 Agent 的 before action 编译成 occurrence-local 依赖 DAG。每次从 ready set 选择 `changeFrequency` 最小的 action，并为排序后的每个逻辑前缀计算内容身份。命中最长 verified 前缀后，只 replay 变化节点及其后缀：固定 runtime 可以在前，候选依赖居中，Agent 写普通 `.env` 的高频节点在后；只改变 `.env` 时不会重新导入 runtime。

```text
BuildKey ready
  → compile attempt occurrences
  → link dependencies and schedule ready actions by frequency
  → join each action's declared Sandbox state surface
  → Provider: longest verified SetupPrefix lookup within coverage
  → restore exact-image or Docker-data hit, then replay the barrier and suffix
  → commit and verify every eligible prefix
  → private writable container
  → Agent/test → lifecycle teardown
```

`changeFrequency` 不是缓存开关，而是 before 的语义排序字段。它接受有限非负数，`-0` 按 `0` 处理，允许小数，省略时为 `normal = 100`。数值越小越早，`rare`、`normal` 与 `frequent` 只是数字常量。改值可以改变执行顺序、前缀祖先链与 fingerprint，但不充当 retention 或 GC policy。

`verified` 只证明声明身份、Provider artifact 完整性与恢复后的写入隔离。`defineSandboxAction()` 同 Dockerfile `RUN` 一样，是作者对“只依赖已声明输入，只改变声明 state”的确定性承诺。NiceEval 会拒绝已知 secret 与 credential handle，但不声称能自动证明任意 shell、网络或时间读取的语义。

普通本地单容器 Docker 只在全部可变状态位于 outer writable rootfs 时完整保存默认 `sandboxState.all`。Docker Profile 可以在独立 fixed-image slot 上只保存 `sandboxState.dockerData`；shared loop/project-quota Profile 仍报告 `Unsupported`。Docker Compose、E2B、Vercel 与 custom Provider 未声明相应 coverage 时真实执行 action。

`cache.state` 不是缓存开关。V1 只有 `all` 与 `dockerData`；省略固定为 `all`。Provider 遇到第一个不支持的 state 后，把该 action 及全部后缀作为 lineage barrier 真实执行，不能在后缀重新制造缺少祖先状态的命中。

## 两类准备节点

| 内容 | 执行语义 |
|---|---|
| `.before(shell/writeText/writeBytes/uploadFile/uploadDirectory/gitCheckout)` | 每个 planning 编译出的 occurrence 都要满足；hit restore，miss replay，Provider 只发布包含该 state 全部结果的 artifact |
| `.before(customFamily(input, options))` | 与内置 Action 同路；封闭 steps 形成一个原子前缀节点 |
| `.before(callback)` / `.before(defineSandboxCommand(...))` | 始终真实执行，显示 opaque，并截断后续共享捕获；成功取得资源后用 `context.onCleanup()` 登记释放 |
| `.after(action)` | occurrence 无条件、幂等 finally；入口登记、始终真实执行，按实际登记栈逆序 |

所有 owner 使用同一种 before/after API。owner 负责 identity 与归因，不形成排序墙。公开 API 不暴露 scope；link 与 physical planning 依据 typed inputs 为每个 action 编译 attempt occurrence，再在每个 occurrence 内按依赖和数值排队。缓存命中只把 standalone before invocation 替换为 verified state restore，不删除 satisfaction fact。

普通 fixture 配置和无密钥 `.env` 模板可以进入可缓存 before action；secret、租约、checkpoint、外部会话和实例 locator 只能进入 callback 或 after，不能进入共享 prefix、key、manifest 或日志。opaque before 之后的 action 仍执行，但因 `opaque-ancestor` 不再 capture。

`upload`、Git clone、Plugin 安装和 shell 不是四套缓存机制。它们与第三方 `defineSandboxAction()` family 都产生带稳定 steps 与输入身份的 before action。NiceEval 先固定本地内容或远端 ref，再由 Provider 恢复或执行相同的 Sandbox 状态变化。内容已经固定不等于可以提前暴露：隐藏判据可以先登记为不可变内容，但只能在 Agent 返回后的 Eval test 中传入 Sandbox，不能进入 Agent 前缀。

## 入口

- [Library](library.md) —— 统一 before/after、条件 cleanup、owner 包裹、occurrence 编译与频率。
- [Architecture](architecture.md) —— PrefixKey、Provider 捕获、DinD 与支持边界。
- [Lifecycle](lifecycle.md) —— 线性化、最长前缀、激活、排队与失败。
- [固定 DinD runtime](use-case/固定DinD运行时.md) —— runtime、候选与 Adapter `.env` 的分层示例。
- [固定 Fixture 与隐藏判据](use-case/固定Fixture与隐藏判据.md) —— 本地上传、远端 checkout 与 Agent 后可见内容。
- [原生 Agent Plugin](use-case/原生AgentPlugin.md) —— marketplace clone、安装后脚本、secret 与 cohort 的拆分。
