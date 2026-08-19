import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const barrierRoot = process.env.NICEEVAL_SHARED_STATE_BARRIER;
const lifecycleRole = process.env.NICEEVAL_SHARED_STATE_ROLE;

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

async function mark(name: string, value = ""): Promise<void> {
  if (barrierRoot === undefined) return;
  await mkdir(barrierRoot, { recursive: true });
  await writeFile(join(barrierRoot, name), value);
}

function roleOf(flags: Readonly<Record<string, unknown>>): string {
  return typeof flags.role === "string" ? flags.role : "unknown";
}

function releaseMarkerFor(role: string): string | undefined {
  switch (role) {
    case "first": return "release-first-agent";
    case "lease-holder": return "release-lease-holder";
    case "pause-holder": return "release-pause-holder";
    case "crash-holder": return "release-crash-holder";
    case "crash-waiter": return "release-crash-waiter";
    case "recovery-without-teardown": return "release-recovery-without-teardown";
    default: return undefined;
  }
}

export function sharedStateHooks(role: string) {
  return {
    async setup() {
      if (barrierRoot === undefined) return;
      await mkdir(barrierRoot, { recursive: true });
      await writeFile(join(barrierRoot, `${role}-setup-attempted`), "");
      await writeFile(join(barrierRoot, "external-state-owner"), role, { flag: "wx" });
      await writeFile(join(barrierRoot, `${role}-setup-complete`), "");
    },
    async teardown(ctx: { readonly signal: AbortSignal }) {
      if (barrierRoot === undefined) return;
      if (role === "pool-first") {
        await writeFile(join(barrierRoot, "experiment-teardown-started"), "");
        await waitFor(join(barrierRoot, "release-experiment-teardown"), ctx.signal);
      }
      if (role === "crash-holder") {
        // The normal holder is SIGKILLed before teardown. This barrier is
        // therefore reached only by the public recovery command and lets the
        // Journey prove a competing recovery cannot reuse/clear its claim.
        await writeFile(join(barrierRoot, "crash-recovery-teardown-started"), "");
        await waitFor(join(barrierRoot, "release-crash-recovery-teardown"), ctx.signal);
      }
      if (role === "cleanup-failure") {
        await writeFile(join(barrierRoot, "cleanup-failure-teardown-started"), "");
        throw new Error("deterministic sharedState cleanup failure");
      }
      if (role === "first") {
        await rm(join(barrierRoot, "external-state-owner"), { force: true });
        await writeFile(join(barrierRoot, "first-teardown-complete"), "");
        return;
      }
      await rm(join(barrierRoot, "external-state-owner"), { force: true });
      await writeFile(join(barrierRoot, `${role}-teardown-complete`), "");
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
    const role = roleOf(ctx.flags);
    await mark(`${role}-agent-started`);
    const release = releaseMarkerFor(role);
    if (release !== undefined && barrierRoot !== undefined) {
      await waitFor(join(barrierRoot, release), ctx.signal);
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "shared-state-ok" }] };
  },
});

/**
 * A local-Sandbox counterpart for the provider-lane Journey. The fixture
 * writes its externally observable marker only after the runner has entered
 * the actual Sandbox / Agent body, rather than while it is waiting for an
 * Experiment lifecycle lease.
 */
export const sharedStateExclusiveLaneAgent = defineSandboxAgent({
  name: "runner-shared-state-exclusive-lane",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  ensure: {
    identity: { agent: "runner-shared-state-exclusive-lane", version: "1", revision: "1" },
    probe: shell("true"),
  },
  async send(_input, ctx) {
    const role = roleOf(ctx.flags);
    await mark(`${role}-agent-started`);
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "shared-state-lane-ok" }] };
  },
});

/**
 * Existing Docker provider entry used only by the lifecycle Journey. Its
 * physical teardown hook is a deterministic Sandbox lifecycle/finalizer scope
 * barrier. It holds the SandboxLayer teardown boundary without inventing a new
 * public Sandbox API just for the test; provider finalizers are awaited by the
 * same Scope.close, but this fixture does not directly inject one.
 */
export const sharedStateReuseSandbox = dockerSandbox({
  source: {
    type: "image",
    image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f",
  },
  user: "node",
  lifetimeMs: 5 * 60_000,
}).teardown(async (_sandbox: { readonly sandboxId: string }, ctx: { readonly signal: AbortSignal }) => {
  if (barrierRoot === undefined) return;
  if (lifecycleRole === "pool-first") {
    await mark("sandbox-lifecycle-scope-started");
    await waitFor(join(barrierRoot, "release-sandbox-lifecycle-scope"), ctx.signal);
    await mark("sandbox-lifecycle-scope-complete");
    return;
  }
  if (lifecycleRole === "pool-retire-fails") {
    await mark("pool-retire-scope-finalizer-started");
    throw new Error("deterministic reusable Sandbox lifecycle teardown failure");
  }
  if (lifecycleRole === "fresh-cleanup-fails") {
    await mark("fresh-sandbox-lifecycle-teardown-started");
    throw new Error("deterministic fresh Sandbox lifecycle teardown failure");
  }
});

export const sharedStateReuseAgent = defineSandboxAgent({
  name: "runner-shared-state-reuse",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic lifecycle fixture" },
  },
  ensure: {
    identity: { agent: "runner-shared-state-reuse", version: "1", revision: "1" },
    probe: shell("true"),
  },
  async send(_input, ctx) {
    const role = roleOf(ctx.flags);
    await mark(`pool-${role}-attempt-${(ctx.attempt?.index ?? 0) + 1}`, ctx.sandbox.sandboxId);
    if (role === "retire-fails") {
      throw new Error("deterministic reusable Sandbox Attempt failure");
    }
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "shared-state-reuse-ok" }] };
  },
});
