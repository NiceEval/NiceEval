# 已迁移：证据切片 Roundtrip

该旧用例的稳定目标仍保留：真实运行得到的 locator 能继续交给 `show --execution/--timing/--diff`，且各出口保持同一身份。
实现形态改为 Report / Adapter 场景 Repo 的短 Result，以及一条跨域 Journey，见
[E2E](../README.md)与 [Journey Example](../../example/README.md#journey从运行到定位再到报告)。

Behavior / Recipe / World / DSL 版本只作为未采用候选保留在
[Design · PLAN-2](../../../../design/user-readable-testing/PLAN-2/README.md)。
