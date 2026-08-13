// factory 的 postSetup / preTeardown 钩子执行器 —— Claude Code / Codex / Bub 共用。
// 契约见 docs/feature/adapters/library/coding-agent-extensions.md「安装后运行脚本」:
// postSetup 在 adapter 全部安装步骤(含 manifest)之后按数组顺序执行;preTeardown 与它成对,
// 按逆序、先于 agent 自己的 teardown 步骤执行(LIFO 镜像 —— postSetup 跑在 agent 安装之后,
// preTeardown 跑在 agent 收尾之前)。两者复用 SandboxCommand 的窄上下文,不消费钩子返回值。
// 钩子抛错直接传播:postSetup 处于 setup 阶段(attempt errored);preTeardown 处于 teardown
// 阶段,由 runner 的 teardown 段按 teardown-failed 诊断收束。

import { createSandboxCommandTarget } from "../sandbox/operations.ts";
import type {
  SandboxCleanupCommand,
  SandboxCommand,
  SandboxCommandContext,
} from "../sandbox/commands.ts";
import type { Sandbox } from "../sandbox/types.ts";
import type { AgentContext, SandboxAgent } from "./types.ts";

export interface AgentLifecycleHookCommands {
  readonly postSetup: readonly SandboxCommand[];
  readonly preTeardown: readonly SandboxCommand[];
}

// Adapter factory 构造时就能知道的用户 hook 声明。用 WeakMap 挂在实际 Agent
// 实例上，不把这份纯预览元数据扩成第二个公开 Agent 执行协议。
const lifecycleHookCommands = new WeakMap<SandboxAgent, AgentLifecycleHookCommands>();

/** @internal 为内置 Adapter 登记与实际执行共用的 hook 数组。 */
export function registerAgentLifecycleHookCommands<T extends SandboxAgent>(
  agent: T,
  postSetup: readonly SandboxCommand[] | undefined,
  preTeardown: readonly SandboxCommand[] | undefined,
): T {
  lifecycleHookCommands.set(agent, {
    postSetup: Object.freeze([...(postSetup ?? [])]),
    preTeardown: Object.freeze([...(preTeardown ?? [])]),
  });
  return agent;
}

/** @internal `--dry --commands` 只读取已登记的声明，不执行 hook。 */
export function agentLifecycleHookCommandsOf(agent: SandboxAgent): AgentLifecycleHookCommands | undefined {
  return lifecycleHookCommands.get(agent);
}

const registeredCleanups = new WeakMap<Sandbox, SandboxCleanupCommand[]>();

/** Throwable 边界立即收窄；收尾队列不长期保存 `unknown`。 */
function teardownError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** 窄上下文与 layer command 同款:不把 session / model / telemetry 借给过程钩子。 */
function commandContext(
  ctx: AgentContext,
  agentName: string,
  phase: "agent.post-setup" | "agent.pre-teardown",
  onCleanup: SandboxCommandContext["onCleanup"],
): SandboxCommandContext {
  return {
    phase,
    ...(ctx.evalGroup === undefined ? {} : { evalGroup: ctx.evalGroup }),
    owner: { kind: "agent", id: agentName },
    attempt: ctx.attempt ?? { id: ctx.evalId ?? "unknown", index: 0 },
    signal: ctx.signal,
    progress: (update) => ctx.progress(update),
    diagnostic: (input) => ctx.diagnostic(input),
    facts: (key, value) => ctx.fact(key, value),
    onCleanup,
  };
}

/**
 * postSetup 时点已走到的沙箱集合——preTeardown 的触发条件(成对触发规则:当且仅当同层 setup
 * 时点走到过)。按 sandbox 实例作键:并发 attempt 共享同一 factory 配置,沙箱是天然的
 * per-attempt 键;WeakSet 随沙箱对象回收,不泄漏。
 */
const postSetupPointReached = new WeakSet<Sandbox>();

/** 按数组顺序执行 postSetup 钩子。调用方在 adapter 全部安装步骤(含 manifest)之后调用一次;
 *  即使数组为空也要调——它同时标记「postSetup 时点走到过」(preTeardown 的触发条件)。 */
export async function runPostSetupHooks(
  sb: Sandbox,
  ctx: AgentContext,
  agentName: string,
  hooks: readonly SandboxCommand[] | undefined,
): Promise<void> {
  postSetupPointReached.add(sb);
  if (!hooks?.length) return;
  const cleanups = registeredCleanups.get(sb) ?? [];
  registeredCleanups.set(sb, cleanups);
  const hookCtx = commandContext(ctx, agentName, "agent.post-setup", (cleanup) => cleanups.push(cleanup));
  const target = createSandboxCommandTarget(sb);
  for (const hook of hooks) await hook(target, hookCtx);
}

/**
 * 按逆序执行 preTeardown 钩子(LIFO 镜像 postSetup)。调用方在各自 `teardown` 方法的最前面
 * 调用一次,先于 agent 自己的收尾步骤。当且仅当本沙箱的 postSetup 时点走到过才执行——
 * adapter setup 在安装步骤中途抛错时,preTeardown 的成对前提不存在,静默跳过。
 */
export async function runPreTeardownHooks(
  sb: Sandbox,
  ctx: AgentContext,
  agentName: string,
  hooks: readonly SandboxCommand[] | undefined,
): Promise<void> {
  if (!postSetupPointReached.has(sb)) return;
  const target = createSandboxCommandTarget(sb);
  const nestedCleanups: SandboxCleanupCommand[] = [];
  const hookCtx = commandContext(ctx, agentName, "agent.pre-teardown", (cleanup) => nestedCleanups.push(cleanup));
  const cleanupContext: Omit<SandboxCommandContext, "onCleanup"> = {
    phase: "agent.pre-teardown",
    ...(hookCtx.evalGroup === undefined ? {} : { evalGroup: hookCtx.evalGroup }),
    owner: { kind: "agent", id: agentName },
    attempt: hookCtx.attempt,
    signal: hookCtx.signal,
    progress: hookCtx.progress,
    diagnostic: hookCtx.diagnostic,
    facts: hookCtx.facts,
  };
  const failures: Error[] = [];
  try {
    // 收尾链里的单点失败不能剥夺其余 hook 与已登记 cleanup 的执行机会。顺序仍然是
    // preTeardown 声明的逆序，随后是截至当时所有 onCleanup 的全局逆序。
    for (const hook of [...(hooks ?? [])].reverse()) {
      try {
        await hook(target, hookCtx);
      } catch (error) {
        failures.push(teardownError(error));
      }
    }
    for (const cleanup of [...(registeredCleanups.get(sb) ?? []), ...nestedCleanups].reverse()) {
      try {
        await cleanup(target, cleanupContext);
      } catch (error) {
        failures.push(teardownError(error));
      }
    }
  } finally {
    registeredCleanups.delete(sb);
    postSetupPointReached.delete(sb);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${agentName} preTeardown failed`);
}
