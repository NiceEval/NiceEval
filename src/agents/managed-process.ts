import type { ManagedProcess, ManagedProcessStart, SandboxAgentContext } from "../types.ts";
import { requireManagedProcessCapability } from "../sandbox/backend.ts";
import { attemptResources } from "../context/attempt-resources.ts";

function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`managed process cleanup exceeded ${milliseconds}ms`)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Adapter-facing neutral capability. It is deliberately absent from Eval's t.sandbox facade. */
export async function acquireManagedProcess(
  ctx: SandboxAgentContext,
  agent: string,
  input: ManagedProcessStart,
): Promise<ManagedProcess> {
  const resources = attemptResources(ctx);
  if (!resources) throw new Error(`${agent} managed process requires an Attempt resource registry`);
  const start = requireManagedProcessCapability(ctx.sandbox, agent);
  return resources.acquire(() => start(input), {
    shutdown: async (process) => { await process.closeStdin(); },
    release: async (process) => {
      try { await bounded(process.wait(), 2_000); }
      catch {
        await process.terminate();
        await bounded(process.wait(), 2_000);
      }
    },
  });
}
