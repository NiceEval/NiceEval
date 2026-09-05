import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const barrierRoot = process.env.NICEEVAL_SHARED_STATE_SCHEDULER_BARRIER;

async function mark(name: string): Promise<void> {
  if (barrierRoot === undefined) return;
  await mkdir(barrierRoot, { recursive: true });
  await writeFile(join(barrierRoot, name), "");
}

async function waitFor(path: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("sharedState scheduler fixture aborted");
    }
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

function roleOf(flags: Readonly<Record<string, unknown>>): string {
  return typeof flags.role === "string" ? flags.role : "unknown";
}

export function sharedStateSchedulerHooks(role: string) {
  return {
    async setup() {
      if (barrierRoot === undefined) return;
      await mark(`${role}-setup-attempted`);
      await writeFile(join(barrierRoot, "scheduler-external-state-owner"), role, { flag: "wx" });
      await mark(`${role}-setup-complete`);
    },
    async teardown() {
      if (barrierRoot === undefined) return;
      await rm(join(barrierRoot, "scheduler-external-state-owner"), { force: true });
      await mark(`${role}-teardown-complete`);
    },
  };
}

/**
 * The first holder Attempt waits for its own second Attempt to reach the
 * public Agent boundary. A same-key waiter must therefore not consume the
 * scheduler worker that lets that successor start.
 */
export const sharedStateSchedulerAgent = defineAgent({
  name: "runner-shared-state-scheduler",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic scheduler fixture has no token usage" },
  },
  send: async (_input, ctx) => {
    const role = roleOf(ctx.flags);
    const ordinal = (ctx.attempt?.index ?? 0) + 1;
    await mark(`${role}-attempt-${ordinal}-started`);
    if (role === "holder" && ordinal === 1 && barrierRoot !== undefined) {
      await waitFor(join(barrierRoot, "holder-attempt-2-started"), ctx.signal);
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "scheduler-fixture-ok" }] };
  },
});
