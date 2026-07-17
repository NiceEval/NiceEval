// factory 的 postSetup 钩子执行器 —— Claude Code / Codex / Bub 共用。
// 契约见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」:
// 在 adapter 全部安装步骤(含 manifest)之后按数组顺序执行;复用 SandboxHook 的窄上下文;
// 返回的 cleanup 合成一个 LIFO 闭包,由 runner 与 agent teardown 一起收尾;钩子抛错
// 直接传播(attempt errored)。

import type { Cleanup } from "../shared/types.ts";
import type { Sandbox, SandboxHook, SandboxHookContext } from "../sandbox/types.ts";
import type { AgentContext } from "./types.ts";

export async function runPostSetupHooks(
  sb: Sandbox,
  ctx: AgentContext,
  hooks: readonly SandboxHook[] | undefined,
): Promise<Cleanup | void> {
  if (!hooks?.length) return;
  // 窄上下文与沙箱钩子同款:不把 session / model / telemetry 借给过程钩子。
  const hookCtx: SandboxHookContext = {
    experimentId: ctx.experimentId,
    signal: ctx.signal,
    progress: (update) => ctx.progress(update),
    diagnostic: (input) => ctx.diagnostic(input),
  };
  const cleanups: Cleanup[] = [];
  for (const hook of hooks) {
    const cleanup = await hook(sb, hookCtx);
    if (typeof cleanup === "function") cleanups.push(cleanup);
  }
  if (!cleanups.length) return;
  return async () => {
    for (const cleanup of [...cleanups].reverse()) await cleanup();
  };
}
