# 证据切片保持同一身份

真实运行得到的 locator 能继续交给 `show --execution/--timing/--diff`，且各出口保持同一身份。
Report / Adapter 场景 Repo 的单边界 E2E 与跨域 Journey E2E 共同证明这条契约，见
[E2E](../README.md)与 [Journey Example](../../example/README.md#三种可读代码形状)。

未采用模型的比较依据见[Design · PLAN-2](../../../../design/user-readable-testing/PLAN-2/README.md)。
