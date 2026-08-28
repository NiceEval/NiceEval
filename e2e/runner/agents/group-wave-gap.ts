import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const NEXT_MEMBERS = new Set(["group-wave-alpha/03-after", "group-wave-beta/03-after"]);
const arrivals = new Set<string>();
let releaseHolder: () => void = () => undefined;
const nextMembersArrived = new Promise<void>((resolve) => {
  releaseHolder = resolve;
});

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("group-wave fixture aborted");
}

async function waitForFastLaneSuccessors(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(abortError(signal)));
    const timer = setTimeout(
      () => finish(() => reject(new Error("fast Group successors were starved behind the slow lane's next wave"))),
      10_000,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void nextMembersArrived.then(() => finish(resolve));
  });
}

export const groupWaveSandbox = dockerSandbox({
  source: {
    type: "image",
    image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f",
  },
  user: "node",
  lifetimeMs: 5 * 60_000,
  resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
});

export const groupWaveAgent = defineSandboxAgent({
  name: "runner-group-wave-gap",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic fixture" },
  },
  ensure: {
    identity: { agent: "runner-group-wave-gap", version: "1", revision: "1" },
    probe: shell("true"),
  },
  send: (_input, ctx) => Effect.tryPromise({
    try: async () => {
      const evalId = ctx.evalId;
      if (evalId === undefined) throw new Error("group-wave fixture requires an Eval identity");
      if (NEXT_MEMBERS.has(evalId)) {
        arrivals.add(evalId);
        if (arrivals.size === NEXT_MEMBERS.size) releaseHolder();
      } else if (evalId === "group-wave-gamma/01-first") {
        await waitForFastLaneSuccessors(ctx.signal);
      }
      return {
        status: "completed",
        events: [{ type: "message", role: "assistant", text: `${evalId}:arrived` }],
      };
    },
    catch: (cause) => cause,
  }),
});
