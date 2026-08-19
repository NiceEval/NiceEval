import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const barrierRoot = process.env.NICEEVAL_SHARED_STATE_BARRIER;

async function waitFor(path: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("shared state fixture aborted");
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

export function sharedStateHooks(role: "first" | "second") {
  return {
    async setup() {
      if (barrierRoot === undefined) return;
      await mkdir(barrierRoot, { recursive: true });
      if (role === "second") await writeFile(join(barrierRoot, "second-setup-attempted"), "");
      await writeFile(join(barrierRoot, "external-state-owner"), role, { flag: "wx" });
      await writeFile(join(barrierRoot, `${role}-setup-complete`), "");
    },
    async teardown() {
      if (barrierRoot === undefined) return;
      if (role === "first") {
        await rm(join(barrierRoot, "external-state-owner"), { force: true });
        await writeFile(join(barrierRoot, "first-teardown-complete"), "");
        return;
      }
      await rm(join(barrierRoot, "external-state-owner"), { force: true });
    },
  };
}

export const sharedStateAgent = defineAgent({
  name: "runner-shared-state",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  async send(_input, ctx) {
    if (barrierRoot !== undefined && ctx.flags.role === "first") {
      await mkdir(barrierRoot, { recursive: true });
      await writeFile(join(barrierRoot, "first-agent-started"), "");
      await waitFor(join(barrierRoot, "release-first-agent"), ctx.signal);
    }
    if (barrierRoot !== undefined && ctx.flags.role === "second") {
      await mkdir(barrierRoot, { recursive: true });
      await writeFile(join(barrierRoot, "second-agent-started"), "");
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "shared-state-ok" }] };
  },
});
