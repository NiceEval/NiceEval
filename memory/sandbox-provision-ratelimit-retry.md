---
name: sandbox-provision-ratelimit-retry
description: 设计裁决——sandbox provisioning 限流错误按 provider 归类成中性 kind,退避重试放在 resolve.ts 而不是 runner,不覆盖运行期限流
metadata:
  type: project
---

裁决(2026-07-11):`createSandbox()` 遇到 provider 侧限流(e2b `RateLimitError`、vercel `APIError{status:429}`、docker 拉镜像 429)时,由各 provider 自己的 `classifyProvisionError()` 把原生错误归类成中性 kind(`"rate_limit" | "unknown"`),`src/sandbox/resolve.ts` 的 `createProvider()` 对可重试 kind 做指数退避重试(封顶 4 次 + 全抖动),不可重试的错误(模板不存在、凭据缺失)第一次就抛出。落地:`src/sandbox/errors.ts`(kind + `isRetryableProvisionError`)、`src/sandbox/retry.ts`(`withProvisionRetry`)、各 provider 文件的 `classifyProvisionError`、`resolve.ts` 接线;文档见 `docs/sandbox.md`「Provisioning 失败与重试」。

**曾选方案**:在 `src/runner/run.ts`(调用侧/runner)做统一重试。否决理由:仓库架构边界明确「provider 名的行为分支只允许出现在 sandbox/ 内」(`docs/architecture.md`),runner 不该知道"这是 e2b 还是 vercel 限流";而 `resolve.ts` 的 `createProvider()` 本来就是 provider 分发的唯一入口,是"调用侧"里天然 provider 无关的那一层——把重试放这里,runner 完全不用感知。

**范围裁决**:这次只覆盖"创建沙箱"这一步的限流重试。沙箱创建成功后、运行期间因限流被终止(如并发过高导致的 sandbox kill,见 [[e2b-sandbox]])**不**在这个机制内——运行期问题定性为"应该靠控制并发避免",不是"重试掩盖";如果之后要做运行期重试,那是重跑整个 attempt 的更大范围决定,需要另外裁决(会牵涉 `verdict: "errored"` 目前"确定性、`earlyExit` 时跳过剩余 runs"的语义,见 `docs/sandbox.md` 与 `src/runner/run.ts` 的 errored 注释)。

**踩坑**:调研时发现 `@vercel/sandbox` SDK 自己对单次 fetch 的 429 已经有内部重试(`with-retry.js`,5 次指数退避、读 `Retry-After` header);我们在 `resolve.ts` 加的重试是外层兜底(耗尽内部重试后仍 429,或 `create()` 轮询 session 状态过程中撞限流),两层不冲突但容易被误以为重复造轮子——加之前先确认 SDK 有没有自己的重试层,再决定外层要不要包、包多重。
