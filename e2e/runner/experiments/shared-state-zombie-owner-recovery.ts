import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const barrierRoot = process.env.NICEEVAL_SHARED_STATE_ZOMBIE_BARRIER;

async function waitFor(path: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("zombie sharedState fixture aborted");
    }
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

const zombieOwnerAgent = defineAgent({
  name: "runner-shared-state-zombie-owner",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic zombie-owner fixture has no token usage" },
  },
  async send(_input, ctx) {
    if (barrierRoot !== undefined) {
      await mkdir(barrierRoot, { recursive: true });
      await writeFile(join(barrierRoot, "zombie-owner-agent-started"), "");
      await waitFor(join(barrierRoot, "release-zombie-owner"), ctx.signal);
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "zombie-owner-ok" }] };
  },
});

export default defineExperiment({
  agent: zombieOwnerAgent,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-zombie-owner" },
  async setup() {
    if (barrierRoot === undefined) return;
    await mkdir(barrierRoot, { recursive: true });
    await writeFile(join(barrierRoot, "zombie-owner-external-state"), "owned", { flag: "wx" });
    await writeFile(join(barrierRoot, "zombie-owner-setup-complete"), "");
  },
  async teardown() {
    if (barrierRoot === undefined) return;
    await rm(join(barrierRoot, "zombie-owner-external-state"), { force: true });
    await writeFile(join(barrierRoot, "zombie-owner-recovery-teardown-complete"), "");
  },
});
