# Vercel Sandbox 已知问题

## session 寿命约 360-390s

**现象**：eval 跑到 360-390s 时出现 `StreamError: Stream ended before command finished` 或 `TypeError: terminated`。

**根因**：Vercel 免费计划有 session 硬上限。`extendTimeout` 返回 HTTP 400，`snapshot()` 返回 HTTP 402，均不支持续期。并发跑多个 eval 时，多路 LLM API 同时竞争，每个 agent 耗时被拉长到 280-400s，逼近上限。

**修法**（两者都需要）：
1. 实验配置里加 `maxConcurrency: 1` 串行跑，把每个 agent 耗时压到 50-200s
2. `VercelSandbox.readSourceFiles` 改两阶段：`find`-only shell（约 1s）+ 并行 `readFileToBuffer` HTTP GET（约 2s），避免 30s 的 NDJSON 流在 session 快到期时 StreamError

注意：`SESSION_TIMEOUT_MS` 必须是固定常量（1_200_000），不能从 `commandTimeoutMs` 推导——透传给 Vercel API 的 `timeout` 越大，实际拿到的 session 反而更短。

已修复：`src/sandbox/vercel.ts`（2026-06-29）

## ExperimentDef 的 maxConcurrency 字段曾无效

**现象**：实验文件里写 `maxConcurrency: 1` 不起作用，仍以默认并发 4 跑。

**根因**：`ExperimentDef` 类型里没有 `maxConcurrency` 字段，CLI 只读全局 `config.maxConcurrency`，实验级别的值被 TypeScript 静默忽略。

**修法**：在 `src/types.ts` 的 `ExperimentDef` 里加 `maxConcurrency?: number`，在 `src/cli.ts` 的 `exp` 命令里取所有选中实验的 `Math.min(...maxConcurrency)` 作为实际并发上限。

已修复：`src/types.ts` + `src/cli.ts`（2026-06-30）

## Ctrl+C 后沙箱残留（孤儿容器）

**现象**：Ctrl+C 中断后，`sandbox list` 里沙箱仍 `running`，要手动 `sandbox stop && rm`。终端只打印「收到中断,正在清理沙箱容器…」，没有任何清理失败的痕迹。

**根因**（三处叠加）：
1. `Effect.runPromise(effect, { signal })` 在 signal abort 时**直接 reject** —— 内层 `catchAllCause` 咽不住 signal 级中断（整个 Exit 被标记为 interrupted）。于是 `runEvals` 抛栈、走 `main().catch()` 打「niceeval 出错」，原计划的「中断→部分汇总」成了死代码。
2. `createSandbox` 的 release 里 `sb.stop().catch(() => {})` **静默吞**异常，孤儿无痕。
3. graceful 清理无超时、无兜底：`vsb.stop()` 是远端调用，慢/挂时用户二次 Ctrl+C 触发裸 `process.exit(130)`，把在飞的 stop 一起杀掉 —— 这才是真正漏孤儿的根因。

**关键教训**：不能只靠 Effect Scope finalizer 来停远端沙箱。`runPromise({signal})` 中断即 reject，要用 `runPromiseExit` 按 Exit 收尾；远端 `stop()` 必须带超时；并维护一份独立于 Effect 的登记表做兜底强清。

**修法**：
1. 新增 `src/sandbox/registry.ts`：活动沙箱登记表 + 带超时、失败打 stderr（不再静默）的 `stopSandbox` / `stopAllSandboxes`。
2. `resolve.ts`：创建即 `registerSandbox`，release 走带超时的 `stopSandbox`。
3. `run.ts`：`runPromise` → `runPromiseExit`，中断走部分汇总，仅真·非中断缺陷才 `throw Cause.squash`。
4. `cli.ts`：三级信号响应（1 次 graceful + 12s 看门狗 / 2 次兜底强清再退 / 3 次硬退），正常返回与 `main().catch()` 都再兜一刀 `stopAllSandboxes()`。

已修复：`src/sandbox/registry.ts`(新) + `resolve.ts` + `run.ts` + `cli.ts`（2026-06-30，commit 82ff836）
