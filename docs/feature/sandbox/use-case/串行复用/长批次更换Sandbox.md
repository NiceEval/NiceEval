# `--reuse-sandbox`：长批次在派发前更换 Sandbox

一批短 Attempt 的总时长可能超过云 Sandbox 的连续运行上限。等待实例在 Agent 执行中途消失，
会浪费本条成本，也会留下证据不完整的 `errored`。

## 运行

```bash
niceeval exp memory --reuse-sandbox=2
```

Runner 为每个 Sandbox 确认 Sandbox 复用寿命。
下一条 Attempt 派发前，它请求足以覆盖 Attempt deadline 与收尾的时间。

寿命足够或 Provider 成功续期时，Attempt 进入原 Sandbox。
Provider 无法满足时，原 Sandbox 停止领取新任务，完成 SandboxSpec `teardown` 并销毁。
Runner 创建替代 Sandbox，完成 SandboxSpec `setup` 和题间重置点后再派发。

```text
Sandbox reuse: replacing sandbox 1 before memory/commit-18
  remaining lifetime cannot cover 30m attempt and cleanup
  replacement sandbox ready in 18.4s
```

更换 Sandbox 是 Run 级开销，不伪装成某条 Attempt 的 `sandbox.create` 阶段耗时。
结束反馈汇总更换次数。

## 边界

- 实例在 Attempt 已开始后异常消失时，本条仍记 `errored`，不会静默重跑。
- reset、续期或替代 Sandbox 的 SandboxSpec `setup` 失败时，该 Sandbox 不再承接 Attempt。
- Provider 没有`SandboxReuseCapability`时，命令在创建前报错，并提示改用默认全新 Sandbox。
- 复用结果仍不进入结果沿用或 CI；轮换只能管理寿命，不能消除题间污染。

## 什么时候改用默认模式

需要正式成绩、跨题隔离或保留失败现场时，去掉 `--reuse-sandbox`。稳定依赖应先进入
[预制环境](../../library/prebuilt-environments.md)，避免每个全新实例重复安装。
