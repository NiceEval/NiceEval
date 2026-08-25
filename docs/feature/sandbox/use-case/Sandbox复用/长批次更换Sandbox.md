---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Sandbox 复用：长批次在派发前更换 Sandbox

一批短 Attempt 的总时长可能超过云 Sandbox 的连续运行上限。
等待实例在 Agent 执行中途消失，会浪费本条成本，也会留下证据不完整的 `errored`。

## 定义实验

```ts
export default defineExperiment({
  evals: ["memory/"],
  sandboxReuse: true,
  maxConcurrency: 2,
  timeoutMs: 1_800_000,
  sandbox: e2bSandbox({
    template: "niceeval-agents",
    lifetimeMs: 3_600_000,
  }),
  // ...
});
```

Runner 为每个 Sandbox 确认 Sandbox 复用寿命。
下一条 Attempt 派发前，它请求足以涵盖 Attempt deadline 与收尾的时间。

寿命足够或 Provider 成功续期时，Attempt 进入原 Sandbox。
Provider 无法满足时，原 Sandbox 停止领取新任务并销毁，绑定 Case 的资源由 Provider finalizer 整组关闭。
Runner 创建替代 Sandbox，Case 就绪并恢复 verified physical baseline 后再派发；每条 Attempt 继续按 occurrence schedule 满足 before action。

```text
Sandbox reuse: replacing sandbox 1 before memory/commit-18
  remaining lifetime cannot cover 30m attempt and cleanup
  replacement sandbox ready in 18.4s
```

更换 Sandbox 是 Run 级开销，不伪装成某条 Attempt 的 `sandbox.create` 阶段耗时。
结束反馈汇总更换次数。

## 边界

- 实例在 Attempt 已开始后异常消失时，本条仍形成 `errored` Verdict，不会静默重跑。
- reset 或续期失败时，该 Sandbox 不再承接 Attempt；before action 失败只让当前 Attempt 形成 `errored` Verdict，reset 成功后 Sandbox 继续承接。
- Provider 没有 `SandboxReuseCapability` 时，实验在创建前报错，并提示去掉 `sandboxReuse`。
- 复用实验可以进入 CI，结果按普通携带判据沿用；轮换只管理寿命，不能消除题间污染。

## 什么时候改用默认模式

需要每条 Attempt 都从全新 Sandbox 开始或需要保留失败现场时，去掉 `sandboxReuse`。
稳定依赖应先进入 [预制实例](../../library/prebuilt-environments.md)，避免每个全新实例重复安装。
