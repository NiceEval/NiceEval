# Sandbox Prepare

本方向收拢官方 prepare 命令的数据进入、安全边界与故障恢复。所有子方向仍遵守 [Sandbox prepare commands](../../feature/sandbox/prepare-commands.md) 的固定阶段、identity 和公开收据。

## 子方向

- [Git checkout 隔离](checkout/README.md) —— 固定 commit closure、凭据和 Agent namespace 边界。
- [Fixture 内容命令](fixture-content/README.md) —— 把本地内容登记、稳定 command identity 与 Sandbox 传输收成一个 prepare 糖。
- [瞬时失败自愈](transient-retry/README.md) —— 只为官方幂等 prepare 命令提供有界内部重试。

这些能力不改变普通 `runCommand` / `runShell` 的副作用和重试纪律，也不把任意作者命令提升为平台可推断的 prepare 行为。
