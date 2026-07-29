# 发现(未修):VercelSandbox.create 不消费 lifetimeMs

- **现象**:vercel provider 创建实例时忽略 `lifetimeMs`,固定 ~20 分钟 session + 快照轮换;
  复用场景靠 `ensureLifetime` 内逐派发 `extendTimeout(duration)` 维持,但作者声明 4 小时
  lifetime 时实例拿到的并不是 4 小时。
- **为什么没顺手修**:仓库既有实测结论「timeout 传 >1200s 反而拿到更短的 session」
  (见 [vercel-sandbox-issues](vercel-sandbox-issues.md)),把 `lifetimeMs` 直接接进
  create 可能触发同一坑;需要真实账号验证该行为是否仍在,再决定接法。
- **下一步**:真机实验 create 传长 timeout 的实际 session 寿命;成立则保持
  「短 session + extendTimeout 续期」并把这条差异写进 reuse.md 的 provider 差异段,
  不成立则把 `lifetimeMs` 接进 create。
