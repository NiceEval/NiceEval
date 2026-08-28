import { Effect } from "effect";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const barrierRoot = process.env.NICEEVAL_SHARED_STATE_STARTUP_AUTHORITY_BARRIER;

async function mark(name: string): Promise<void> {
  if (barrierRoot === undefined) return;
  await mkdir(barrierRoot, { recursive: true });
  await writeFile(join(barrierRoot, name), "");
}

async function waitFor(path: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("startup authority fixture aborted");
    }
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function sharedStateStartupAuthorityHooks() {
  return {
    setup: () => Effect.tryPromise({
      try: async () => {
        if (barrierRoot === undefined) return;
        await mark("startup-authority-setup-attempted");
        await writeFile(join(barrierRoot, "startup-authority-external-state"), "owned", { flag: "wx" });
        await mark("startup-authority-setup-complete");
      },
      catch: (cause) => cause,
    }),
    teardown: () => Effect.tryPromise({
      try: async () => {
        if (barrierRoot === undefined) return;
        await mark("startup-authority-recovery-teardown-started");
        await rm(join(barrierRoot, "startup-authority-external-state"), { force: true });
        await mark("startup-authority-recovery-teardown-complete");
      },
      catch: (cause) => cause,
    }),
  };
}

export const sharedStateStartupAuthorityAgent = defineAgent({
  name: "runner-shared-state-startup-authority",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic startup authority fixture has no token usage" },
  },
  send: (_input, ctx) => Effect.tryPromise({
    try: async () => {
      await mark("startup-authority-agent-started");
      if (barrierRoot !== undefined) {
        await waitFor(join(barrierRoot, "release-startup-authority-agent"), ctx.signal);
      }
      return { status: "completed", events: [{ type: "message", role: "assistant", text: "startup-authority-ok" }] };
    },
    catch: (cause) => cause,
  }),
});
