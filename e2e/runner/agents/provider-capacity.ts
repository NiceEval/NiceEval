import { Effect } from "effect";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { completeEvidenceCoverage, defineAgent, defineSandboxAgent } from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

const PROFILE_EVAL_PREFIX = "provider-capacity-profile/";
const INDEPENDENT_EVAL = "provider-capacity-independent";
const EDGE_EVAL = "provider-capacity-edge";
const CANCEL_WAITER_EVAL = "provider-capacity-cancel-waiter";
const CANCEL_BLOCKER_EVAL = "provider-capacity-cancel-blocker";
const CAPACITY_EVAL_PREFIX = "provider-capacity-capacity/";

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("provider-capacity fixture aborted");
}

async function waitForFile(path: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) throw aborted(signal);
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }
}

async function claimFirstProfileAttempt(controlRoot: string): Promise<boolean> {
  try {
    await writeFile(join(controlRoot, "profile-first-entered"), "", { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export const providerCapacityAgent = defineSandboxAgent({
  name: "runner-provider-capacity",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  ensure: {
    identity: { agent: "runner-provider-capacity", version: "1", revision: "1" },
    probe: shell("node --version >/dev/null"),
  },
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    const controlRoot = ctx.flags.controlRoot;
    const scenario = ctx.flags.scenario;
    const evalId = ctx.evalId;
    if (typeof controlRoot !== "string" || evalId === undefined) {
      throw new Error("provider-capacity fixture requires an Eval identity and control root");
    }
    await mkdir(controlRoot, { recursive: true });

    if (evalId.startsWith(PROFILE_EVAL_PREFIX)) {
      if (await claimFirstProfileAttempt(controlRoot)) {
        await waitForFile(join(controlRoot, "release-profile-first"), ctx.signal);
      } else {
        await writeFile(join(controlRoot, "profile-second-entered"), "");
      }
    } else if (evalId === INDEPENDENT_EVAL) {
      await writeFile(join(controlRoot, "independent-entered"), "");
    } else if (evalId === EDGE_EVAL) {
      if (typeof scenario !== "string") {
        throw new Error("provider-capacity edge fixture requires a scenario flag");
      }
      await writeFile(join(controlRoot, `${scenario}-agent-entered`), "");
    } else if (evalId === CANCEL_WAITER_EVAL) {
      await writeFile(join(controlRoot, "cancel-waiter-agent-entered"), "");
    } else if (evalId === CANCEL_BLOCKER_EVAL) {
      await writeFile(join(controlRoot, "cancel-blocker-entered"), "");
      await waitForFile(join(controlRoot, "release-cancel-blocker"), ctx.signal);
    } else if (evalId.startsWith(CAPACITY_EVAL_PREFIX)) {
      if (evalId.endsWith("01-first")) {
        await writeFile(join(controlRoot, "capacity-first-entered"), "");
        await waitForFile(join(controlRoot, "release-capacity-first"), ctx.signal);
      } else {
        await writeFile(join(controlRoot, "capacity-second-entered"), "");
      }
    } else {
      throw new Error(`unexpected provider-capacity Eval: ${evalId}`);
    }

    await ctx.sandbox.runCommandOrThrow("node", ["--version"], { signal: ctx.signal });
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "provider-capacity-fixture-ok" }],
    };

      },
      catch: (cause) => cause,
    }),
});

export const providerCapacityBlockerAgent = defineAgent({
  name: "runner-provider-capacity-blocker",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture has no token usage" },
  },
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    const controlRoot = ctx.flags.controlRoot;
    if (typeof controlRoot !== "string") {
      throw new Error("provider-capacity blocker requires a control root");
    }
    await mkdir(controlRoot, { recursive: true });
    await writeFile(join(controlRoot, "cancel-blocker-entered"), "");
    await waitForFile(join(controlRoot, "release-cancel-blocker"), ctx.signal);
    return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "provider-capacity-fixture-ok" }],
    };

      },
      catch: (cause) => cause,
    }),
});
