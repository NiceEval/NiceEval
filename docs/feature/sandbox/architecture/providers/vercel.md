# Vercel Sandbox Provider —— 架构

Vercel Sandbox Provider 的实现。公开用法见 [Vercel Sandbox](../../library/providers/vercel/README.md)；所有 Provider 共用的契约见 [Architecture](../README.md)。

## 实例与命令

需要 Vercel Sandbox 凭据;显式 env 变量路径是 `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`。适合 CI 里大并发、不想本地起 Docker 的场景。要点:

- `VercelSandbox.create({ runtime, timeout })` 起一台微 VM。
- 处理云沙箱的 session 生命周期,必要时 snapshot + rotate,避免长命令被 session 上限截断。
- provider 内部可以批量传输，但对外兑现同一组 `writeText` / `writeBytes` 语义，不暴露另一套批量命名。

接口与 Docker 完全一致,所以 Adapter 代码一字不改就能在两种 provider 间切换。

## Provisioning 对账与重试

通用分类与两道防线见 [Architecture · Provisioning 失败与重试](../README.md#provisioning-失败与重试)。

- **Vercel Sandbox** —— create 是单个 SDK 调用、没有初始化尾巴。SDK 对 429 已内建多次退避重试(读 `Retry-After`),外层对拒绝类的封顶次数相应收窄,避免「外层次数 × 内层次数」在请求量和退避时长两个维度同时放大;SDK 没有按元数据检索实例的通道,歧义类第一次抛出。
