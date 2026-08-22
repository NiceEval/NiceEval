# Eval Group —— Lifecycle

Group 的物理 Sandbox 在第一条真实 Attempt 前按需取得，并由整条 Group lane 持有：

```text
provider acquire
  -> physical SandboxLayer before / around.before
  -> selected resource materialize
  -> verified reset baseline
  -> each real Attempt
       -> reset
       -> Group resource prepare
       -> current Eval resource prepare
       -> occurrence DAG schedules attempt before
       -> agent ensure / setup / test / teardown
       -> attempt after in reverse registration order
  -> resource release in reverse order
  -> physical SandboxLayer after / around.after
  -> provider finalizer
```

Sandbox create、reset、健康检查或故障退休可能建立替代实例。因此 physical occurrence、resource
materialize、release、after 与 finalizer 都是“每台实际实例一次”，不是“每个 Group
文件恰好一次”。同一时刻仍只有一台实例服务 Group 的一条 Attempt。

Group author 与 Plugin lifecycle 围住所选 slots，只执行 selected slice，不要求 CLI 选择自动扩回全组。`niceeval debug` 的 human 和 JSON 都在 `beforeSlots` / `afterSlots` 显示这层包裹；`physicalLifecycleTemplate` 则是每台实际实例一次，不能读成整个 Group lane 只 acquire / finalize 一次。

创建 Group 前，Runner 比较每个所选成员的 provider plan、Agent install 与 owner-aware physical lifecycle identity。任何 Eval-owned Sandbox Plugin fragment 差异都会得到点名两个成员与差异 facet 的 `eval-group-incompatible`，并保持零 Sandbox create。只精确选择一个成员时没有跨成员兼容性问题，仍以 Group lane 运行。

## carry 与选择

全量 carry 不建立 Sandbox，也不 materialize resource。部分 carry 在规划期冻结 Group demand
与所有 selected Eval demand，但只有真实派发的 Attempt 调用 Group demand 和当前 Eval demand
的 `prepare`。CLI 过滤、预算、首过即停与取消都可能让后续成员不进入本轮 Sandbox；Group
不补造前缀完成状态。

## 不可用策略

`stop-group` 在物理不可用后停止该 Group 尚未开始的 slot。已经开始的 Attempt 保留真实
errored 结果；其他 Group 继续运行。

`replace-sandbox` 退休失败 lease，下一条 slot 才建立替代实例。同一失败阶段在替代实例上
再次发生时停止 Group，避免无限创建资源。上一条 Attempt 完成后的 reset 失败不会改写上一条结果。

Run 保留失败阶段、实例退休和停止原因的诊断，并以非零状态结束。`keepSandbox` 不得绕过
Group 的资源 release 与作者 teardown；不支持安全复用的 Provider 在运行前报能力错误。
