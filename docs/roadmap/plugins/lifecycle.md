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

Runner 在调用 setup 前先把 occurrence 计入已激活前缀，因此 setup 自身失败也会得到对应 teardown。任一 setup 失败会跳过其后业务阶段；teardown 失败只追加 warning diagnostic，不能跳过剩余 teardown 或底层 finalizer。
