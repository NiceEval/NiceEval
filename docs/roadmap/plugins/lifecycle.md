# Plugins —— Lifecycle

```text
Experiment author setup
  -> Experiment Plugin setup (forward)
  -> Eval Group Plugin setup (forward)
  -> provider acquire
  -> SandboxLayer author setup
  -> automatically projected Sandbox Plugin setup (forward)
  -> reset anchor / attempt reset
  -> author prepare commands
  -> Eval Plugin setup (forward)
  -> agent ensure / setup / test / teardown
  -> Eval Plugin teardown (reverse)
  -> author cleanup
  -> Sandbox Plugin teardown (reverse)
  -> SandboxLayer author teardown
  -> provider finalizer
  -> Eval Group Plugin teardown (reverse)
  -> Experiment Plugin teardown (reverse)
  -> Experiment author teardown
```

Experiment lifecycle 只在本次 Run 至少有一条 fresh work 时激活。Group lifecycle 属于 Experiment × Eval Group lane，replacement Sandbox 不重新运行它。Sandbox lifecycle 属于真实物理实例，replacement 会重新运行。Eval lifecycle 属于 fresh Attempt；carried 或未派发 slot 不运行。

`niceeval exp <experiment> <eval> --dry --commands` 保留这四层包裹关系。Human 与 JSON 都在 Group lane 的 `beforeSlots` / `afterSlots` 显示 Group Plugin。Sandbox Plugin 位于 `physicalLifecycleTemplate`，Eval Plugin 位于 dispatch slot；只选 Group 内一个 Eval 时仍显示一次 Group 包裹，但不扩回其它成员。

Sandbox Plugin identity 带 attachment owner 进入物理 lifecycle identity。Eval-owned Sandbox fragment 会隔离普通 reuse pool。同一 Group 的所选成员若 fragment identity 不同，physical planning 在 create 前报 `eval-group-incompatible`，不能用第一个成员的 lifecycle 代表整组。

Runner 在调用 setup 前先把 occurrence 计入已激活前缀，因此 setup 自身失败也会得到对应 teardown。任一 setup 失败会跳过其后业务阶段；teardown 失败只追加 warning diagnostic，不能跳过剩余 teardown 或底层 finalizer。
