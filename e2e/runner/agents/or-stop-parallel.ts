import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

const READY_EVALS = new Set([
  "group-stop-alpha/next",
  "group-stop-beta/next",
  "group-stop-gamma/hold",
]);
const arrivals = new Set<string>();
let releaseArrivals: () => void = () => undefined;
const allArrived = new Promise<void>((resolve) => {
  releaseArrivals = resolve;
});

async function waitForAllLanes(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("parallel fixture aborted");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(new Error("parallel fixture aborted")));
    const timer = setTimeout(
      () => finish(() => reject(new Error("orStop blocked a Group lane from dispatching"))),
      10_000,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    void allArrived.then(() => finish(resolve));
  });
}

export const orStopParallelSandbox = dockerSandbox({
  source: { type: "image", image: "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f" },
  user: "node",
  lifetimeMs: 5 * 60_000,
  resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
});

export const orStopParallelAgent = defineSandboxAgent({
  name: "runner-or-stop-parallel",
  evidenceCoverage: { ...completeEvidenceCoverage, usage: { status: "unavailable", reason: "deterministic fixture" } },
  ensure: {
    identity: { agent: "runner-or-stop-parallel", version: "1", revision: "1" },
    probe: shell("true"),
  },
  send: (_input, ctx) => Effect.tryPromise({
    try: async () => {
      const evalId = ctx.evalId;
      if (evalId === undefined || !READY_EVALS.has(evalId)) {
        throw new Error(`unexpected Eval Group member: ${String(evalId)}`);
      }
      arrivals.add(evalId);
      if (arrivals.size === READY_EVALS.size) releaseArrivals();
      await waitForAllLanes(ctx.signal);
      return { status: "completed", events: [{ type: "message", role: "assistant", text: "ok" }] };
    },
    catch: (cause) => cause,
  }),
});
