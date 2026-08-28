# Plugins E2E owner

### eval-group-plugin-lifecycle

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Plugins](../../../feature/plugins/README.md)

验证 Eval Group、Sandbox 与 Eval Plugin 在共享实例上的 lifecycle 次序与共享实例身份。

### eval-plugin-lifecycle

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Plugins](../../../feature/plugins/README.md)

验证多个 Eval Plugin 与 Sandbox Plugin 按 fresh Attempt 和物理实例执行各自 lifecycle。

### experiment-plugin-lifecycle

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Plugins](../../../feature/plugins/README.md)

验证 Experiment Plugin lifecycle 只包围一次整场实验，并由两条 Eval 共同证明。
