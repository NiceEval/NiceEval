# portable Record 校验失败时 CLI 仍可能成功交付

## 观察

2026-11-24 为 Run 状态页建模时核对源码：Experiment Host 在 `packages/niceeval/src/experiment/host/operations.ts` 把 portable Record 校验放进忽略错误的 finalizer；CLI 在 `experiment/host/cli/contribution.ts` 使用 Host 的完成结果和退出值。只做了源码核对，没有向真实校验注入故障。

## 期望与影响

[生命周期](../feature/run/architecture/lifecycle.md)规定 schema、引用闭包、publication 与领域不变量全部通过后，CLI 才成功交付 receipt 与 portable Record。校验失败被忽略时，用户可能拿到成功退出与一份未通过校验的 Record。见 [Run 的状态](../feature/run/statechart.md#实现与模型的差异)。

## 复现入口

向 portable 校验注入一次失败，运行一次正常 Invocation，观察 CLI 退出码与输出。
