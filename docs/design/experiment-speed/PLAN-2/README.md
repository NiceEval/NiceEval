# 方案 2：一个 Sandbox 串行执行整批

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) ·[LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) ·[PLAN-3](../PLAN-3/README.md) · [DECISION](../DECISION.md)

---

## 方案

同一 sandbox spec 与 environment profile 的 Attempt 共用一个 Sandbox。
Sandbox 创建与 SandboxSpec `setup` 执行一次；每条 Attempt 结束后，workdir 重置到复用 Sandbox 的题间重置点。

## 适用情况

- Experiment 本来就要求 `maxConcurrency: 1`。
- 本机或 Provider 只能支持一个同时执行的 Attempt。
- 少量短 Attempt 的 Sandbox 创建与 SandboxSpec `setup` 占比较高。

## 优势

- Sandbox 创建与 SandboxSpec `setup` 只支付一次。
- 同一 workdir 不会出现并发写入。
- `sandboxReuse: true` 与 `maxConcurrency: 1` 可以直接表达本 Invocation 的单 Sandbox 池。

## 缺点

- 对可以并行的 Attempt，整批串行可能显著增加总耗时。
- 整批依赖一个 Sandbox，批次可能超过 Sandbox 复用寿命。
- workdir reset 不触及用户目录、后台进程和排除目录。
- Agent 与 Eval Hook 仍须逐 Attempt 执行，不能借此省掉 Agent setup。

## 数据流

```text
创建一个 Sandbox
  → SandboxSpec.setup
  → 建立题间重置点
  → Attempt 1 → reset → Attempt 2 → reset → …
  → SandboxSpec.teardown → stop
```

## 验收

1. Attempt 开始前，被跟踪的 workdir 内容回到题间重置点。
2. 结果登记 `sandbox.reused`，按普通携带判据进入结果沿用；CI 使用签入的 Experiment 配置。
3. 派发前确认 Sandbox 复用寿命，不能等待 Sandbox 在 Attempt 中途到期。
4. Agent 与 Eval Hook 每 Attempt 成对执行。

## 裁决

本方案是[方案 4](../PLAN-4/README.md)在单 Invocation 内最多维护一个 Sandbox 时的行为，不单独建立 Feature 或调度规则。
