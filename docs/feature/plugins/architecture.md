# Plugins —— Architecture

## 纯生命周期边界

Plugin 的公共能力只有稳定身份、host setup/teardown 与 SandboxLayer 组合。Agent 原生配置继续直接传给 Agent factory；Sandbox action 使用同一套 SandboxLayer API；物理资源由 Provider 管理。Core 不再定义 `AgentExtension`、`defineSandboxResource`、resource demand/envelope 或 receiver composition。

Plugin family 调用生成可复用、冻结的 attachment specification。`PluginStack` 只组合 attachment；Experiment、Eval Group 或 Eval 消费最终序列时才生成 occurrence。Link 在 Provider planning 前验证 attachment fragment，并将同一 occurrence 可选的 `sandbox` fragment自动投影到物理 Sandbox plan。

## 身份

每个 lifecycle 投影包含：

```ts
{
  scope,
  name,
  instanceKey,
  behaviorRevision,
  identity,
  attachmentOrdinal,
  hasSetup,
  hasTeardown,
}
```

最终 attachment 顺序属于行为身份。`attachmentOrdinal` 只在 owner 消费、扁平枚举后按 `0..n-1` 分配；Stack 对象身份、分叉历史和 concat 分段不进入身份。相同 `(name, instanceKey)` 在同一个实际 scope 中重复是 link 错误；同一个 family/key 出现在不同 scope 合法。Sandbox fragment 进入物理 plan fingerprint，因此改变它会使旧结果失去精确 carry 资格。

普通 `--dry` 只展示 credential-free lifecycle occurrence。`niceeval debug` 可以用 opaque lifecycle step 表示 host callback，但不检查函数体或虚构命令。Sandbox fragment 中的声明式 action 按统一结构展开，显示 owner、依赖、changeFrequency、内容或远端完成态身份与缓存资格。

## 自动 Sandbox 投影

一次 attachment 先激活其实际 owner fragment；如果 occurrence 还声明 `sandbox`，该 command-only layer 沿 owner provenance 加入实际物理 Sandbox。它不是第二次 attachment，也不允许用户从 SandboxLayer 再挂一次。

物理 action 与其它 SandboxLayer action 一起进入 occurrence DAG；template owner 只决定 Provider 起点。Plugin declaration key 保留 `attachmentOrdinal`，changeFrequency 相同时参与稳定 tie-break，after 对已激活登记栈整体逆序。带 Sandbox fragment 的 attachment 保留原 ordinal，不能只对投影子集重新编号。

`PluginStack<EligibleOwners>` 的泛型表示所有 attachment 共同支持的 owner 集合。空栈支持 `experiment | group | eval`；`.use()` 与 `.concat()` 取集合交集，无交集在调用处产生 TypeScript 错误。`sandbox` 只表示自动投影，不是独立挂载 owner；只声明 sandbox fragment 的 Plugin 在 `definePlugin()` 调用处拒绝。

Stack 是运行时冻结的组合值，不是 JSON 持久格式，也不提供 `toJSON()`。Debug、fingerprint 与 Record 只序列化 owner 已知后的 credential-free occurrence projection。
