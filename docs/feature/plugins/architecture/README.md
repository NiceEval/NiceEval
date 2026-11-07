# Plugins —— Architecture

## 职责边界

Plugin 定义保存稳定条件身份与声明；挂载点校验字段权限，完整 selection 的 linker 检查 requires 和跨层重复实例，再生成 owner layer 与生命周期执行列表。
内建 Agent factory 登记配置合并能力。Linker 把扩展交回同一 factory 重建实际 Agent，不按 Agent kind 复制运行实现，不提前求值凭据。
自定义 Adapter 可使用宿主生命周期，但不接受 agent 扩展。

## 身份与投影

Plugin 身份包含挂载层级与数组位置、name、key、identity、requires、字段形状及 before / after 元素数量。
Sandbox 受管 Action 使用既有 canonical identity；回调身份仅包含形状与数量。
Agent 扩展投影包含 Skill 规格与内容摘要、MCP 的 name / command / args / url、原生插件规格及配置文件内容摘要；MCP headers 与 env 不落入投影。

同一 Attempt 生效集合的 `(name, key)` 必须唯一。错误列出冲突的两处挂载声明。
Experiment 模块中的 Plugin 回调函数体不改变该投影；Eval sourceClosure 仍独立生效。没有 Plugin 时保留原有 config identity 编码。

## SandboxLayer 组合

Plugin sandbox 字段转换为 command-only layer，并追加到 Experiment、EvalGroup 或 Eval 的作者 layer。它不拥有 template，不产生额外物理生命周期。
受管 Action 进入同一个 occurrence DAG，排序依次按依赖、changeFrequency、owner 与声明序号；Plugin 声明排在同 owner 作者元素之后。
回调每条 fresh Attempt 在 reset 后执行。Eval-owned 字段影响 reuse 身份；Group 成员不兼容时创建前拒绝。

## 生命周期与可观察结果

宿主执行表与挂载表分开：Experiment 的 group 与 attempt 字段会展开到每条匹配 lane 或 Attempt，而 occurrence 身份仍只登记一次。
激活前缀在 before 调用前推进。宿主 after 按逆序逐项执行，每项使用独立 cleanup signal 与预算；失败写入 warning。
Agent 扩展沿工厂已有 before / after 执行，因此失败会影响 Attempt，剩余 after 与 finalizer 继续运行。

`show`、`query` 与 `view` 展示 name、key、identity；`debug` 展开声明、实际 Action 顺序与配置声明位置。身份值不自动写入 flags。
