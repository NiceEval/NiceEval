# ensureLifetime 通用本地时钟记账把「没实现」伪装成「实现了」

- **现象**(2026-07-29 下游 dogfooding):`sandboxReuse` 实验在 E2B 上跑到 ~30 分钟,
  实例被 provider 按默认寿命回收,而 runner 的派发前确认一路答 `ready: true`,
  attempt 以中途消失的形态 errored。
- **根因**:`src/sandbox/resolve.ts` 给所有内置 provider 套通用 `ensureLifetime`:
  `expiresAt = Date.now() + lifetimeMs`,拿本地时钟对比。该记账只有 provider 真把寿命
  设进后端才成立,但 `e2b.ts` / `vercel.ts` 对 `lifetimeMs` 零引用,e2b 写死
  `timeoutMs: SESSION_TIMEOUT_MS`。`Partial<SandboxReuseCapability>` + 兜底让「没接上」
  在类型与运行时都不可见。reuse.md 早已声明正确行为(不支持时派发前报错),代码没落。
- **修法**:删通用包装;能力只能由 provider 自己实现,`ready: true` 的唯一合法依据是寿命
  已真实写进后端;未实现 + `sandboxReuse: true` → 第一条 Attempt 派发前硬失败。
  契约句已补进 `docs/feature/sandbox/reuse.md`「派发前确认」,覆盖类别已登
  `docs/engineering/testing/unit/sandbox.md`。附带:`sandbox-stop-failed` 文案里
  「provider TTL 会兜底清理」的说法同批核查——TTL 与作者声明的 lifetime 不是一回事。
