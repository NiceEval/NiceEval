# 方案 3：一个或多个 Sandbox 复用

**相关文档**：[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) ·
[PLAN-2](PLAN-2.md) · [DECISION](DECISION.md)

---

## 方案

Runner 最多维护 N 个 Sandbox。每个 Sandbox 内部串行承接 Attempt，
不同 Sandbox 之间可以并行。SandboxSpec 生命周期每个 Sandbox 一次；
Agent 与 Eval 生命周期仍逐 Attempt 成对执行。

`--reuse-sandbox=<n>` 设置 N；裸 `--reuse-sandbox` 等价于 N=1。
现有并发限制仍然生效，不能被 N 放大。

派发前检查 Sandbox 复用寿命。不足时先续期；不能续期时停止旧 Sandbox，
创建并准备替代 Sandbox，再派发 Attempt。

## 优势

- 分摊 Sandbox 创建与 SandboxSpec `setup`，同时保留有限并行。
- N=1 与 N>1 使用同一套调度规则。
- Sandbox 寿命成为派发条件，不假设一个 Sandbox 能活完整批。
- 一个 Sandbox 故障不会直接停止其它 Sandbox 上的 Attempt。

## 缺点

- 跨 Attempt 状态仍可能残留，结果不能进入结果沿用或 CI。
- Runner 要管理多个 Sandbox 的状态、公平派发和 Run 级时间。
- Provider 必须提供 `SandboxReuseCapability`。
- N 越大，SandboxSpec `setup` 的分摊收益越小；N 越小，可用并行越少。

## 数据流

```text
待派发 Attempt
  ├─ Sandbox 1: create → SandboxSpec.setup → reset point → Attempt → reset → …
  ├─ Sandbox 2: create → SandboxSpec.setup → reset point → Attempt → reset → …
  └─ 最多 N 个 Sandbox

每次派发前:
  ensureLifetime(Attempt deadline + cleanup reserve)
    ├─ ready     → 派发
    ├─ extended  → 派发
    └─ rejected  → 停止旧 Sandbox → 创建替代 Sandbox → 派发
```

每个 Sandbox 的内部状态为
`starting → ready → busy → resetting → ready → draining → dead`。
这些是实现状态，不作为用户术语。

Provider 向 Runner 暴露中立能力：

```typescript
interface SandboxReuseCapability {
  ensureLifetime(minRemainingMs: number): Promise<
    | { ready: true; expiresAt?: string }
    | { ready: false; reason: string }
  >;
}
```

`ensureLifetime` 可以检查或续期。Runner 不知道 Provider 使用 Docker TTL、
E2B timeout 还是 Vercel session。缺少该能力的 Provider 在创建前拒绝 Sandbox 复用。

## 落地

1. 给内置 Provider 实现 `SandboxReuseCapability`。
2. 先让一个 Sandbox 走完整状态与 reset。
3. 加入派发前续期、寿命不足时更换 Sandbox 和故障淘汰。
4. 支持最多 N 个 Sandbox，并按有效宽度派发。
5. 用短寿命 Provider 验收长批次中的 Sandbox 更换。

## 验收

1. Sandbox 复用寿命不足时，旧 Sandbox 在派发前停止，Attempt 在替代 Sandbox 开始。
2. Sandbox 在 Attempt 中途消失时，该 Attempt 记为 `errored`，不得静默重跑。
3. SandboxSpec Hook 每个 Sandbox 成对一次；Agent 与 Eval Hook 每 Attempt 成对一次。
4. 同时 `busy` 的 Sandbox 不超过 N、全局并发位和实验并发限制的最小值。
5. 所有复用结果记录 `sandbox.reused`，不得进入结果沿用。
6. reset、续期或 SandboxSpec `setup` 失败的 Sandbox 不再承接 Attempt。

## 与其它方案的关系

需要正式结果时使用[方案 1](PLAN-1.md)。同时最多维护一个 Sandbox 时，
本方案表现为[方案 2](PLAN-2.md)，两者使用同一套 Feature。
