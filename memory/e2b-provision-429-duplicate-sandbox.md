---
name: e2b-provision-429-duplicate-sandbox
description: E2B 创建成功后的初始化请求撞 429 被归「拒绝类」盲重试,同一 provision token 开出两台实例,第一台泄漏计费——修为 create 内 kill-on-failure + 有对账通道时任何重试前都对账
metadata:
  type: project
---

**现象**(2026-07-15,coding-agent-memory-evals 实跑 `niceeval exp dev-e2b/codex-e2b`):10 evals × 1 config 却在 E2B dashboard 看到 14 台实例;4 个 `niceeval-provision-token` 各对应两台,每对里一台 ~220MB / 0% CPU 闲置(从未被使用的泄漏首次 attempt)。终端可见限流退避重试消息。泄漏实例只能等 30 分钟 `SESSION_TIMEOUT_MS` 自动回收,期间计费。

**根因**:「拒绝类(429/连接建立失败)⇒ 请求没被受理 ⇒ 远端没有实例 ⇒ 可盲重试」这个推理只对**单个请求**成立,而 `withProvisionRetry` 重试的单元是 provider 整个 `create()` 闭包。`E2BSandbox.create` 在 SDK create 成功之后还要发 `mkdir -p workspace` 初始化请求;19 并发下它撞 429,e2b SDK 抛 `RateLimitError`,`classifyProvisionError` 归 `rate_limit`(拒绝类)→ 跳过对账直接重试 → 同一 token 再开一台,第一台无人持有 id、不进注册表。次级漏洞:歧义类的对账 `reconcileProvision` 整体吞错 + 调用侧 `.catch(() => {})`,账号被限流时 `list()` 也 429,「必须对账」实际退化成「尝试对账、失败照样盲重试」。

**修法**(2026-07-15,契约见 `docs/feature/sandbox/architecture.md`「Provisioning 失败与重试」;裁决记录见 [[sandbox-provision-ratelimit-retry]]):两道独立防线——

1. **kill-on-failure**:`src/sandbox/e2b.ts` create 拿到句柄后的失败先 `sbx.kill()` 再抛;`src/sandbox/docker.ts` initialize(start + 装工具 + chown)失败先 force remove 再抛。与分类、是否重试无关,不可重试失败同样适用。
2. **重试前对账**:`src/sandbox/retry.ts` 有对账通道时**任何重试前都对账**(不分拒绝/歧义类),对账排在退避睡眠之后(睡醒再查,检索自己被限流的概率低得多,也给刚受理的实例出现在列表里留时间);对账抛错即放弃重试、抛原始 create 错误并留 diagnostic。`reconcileProvision`(e2b/docker)不再吞错,唯一例外是实例已不存在(e2b `NotFoundError` / docker 404)视作对账完成。

**残余风险**:create 请求已受理但实例尚未出现在 list 结果里的可见性竞态仍可能漏杀,退避睡眠(1s/2s/4s + 抖动)是缓解不是消除;vercel 无检索通道,依赖其 create 单请求形态。
