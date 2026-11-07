# Staged Agent 版本 probe 的 typed failure 被 FiberFailure 包装

## 现象

2026-08-13，PR #47 把配置 Plugin 的 Codex CLI 从镜像预装 0.144.1 升到 0.146.0 后，
Docker/live E2E 在 `agent.ensure` 直接报错：期望 0.146.0、实际 0.144.1。宿主制品缓存里没有
0.146.0，日志也没有进入 staged installer；看起来像 installer 或 Blacksmith cache 没生效。

## 根因

`createNpmCliInstaller()` 的稳定 probe 用 `Effect.runPromise()` 把 Effect 返回给 Promise 形状的
`SandboxCommand`。版本不匹配本来是 typed `SandboxCommandExitError`，但 `runPromise()` reject
的是 `FiberFailure` 包装；`runAgentEnsure()` 的 `instanceof SandboxCommandExitError` 因此永远
不成立，把正常的 probe miss 误判成 probe 基础设施故障，安装分支根本没有机会运行。

## 修法与验收

probe 边界改为 `Effect.runPromiseExit()`，失败时用 `Cause.squash(exit.cause)` 把原始 typed
failure 交还 Promise 调用方。不要靠解析错误文案、放宽版本检查或在 Adapter setup 里另装一次。

本地用预装 0.144.1 的官方 Codex Docker 镜像验证：首轮 probe miss 后宿主成功缓存
`@openai/codex@0.146.0-linux-x64`（约 137 MB），沙箱安装后 recheck 读回
`codex-cli 0.146.0`。修法落在 `src/agents/npm-staged.ts`。
