import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createSimulatedUserProject,
  loadPi,
  openAIConfigSource,
  openAIProvider,
  planAndRunExperiment,
  respondStream,
  startHttpServer,
  type Scenario,
} from "./fixtures/simulated-user-harness/harness.ts";

type Stage = "completed" | "rejected" | "abort-in-request" | "abort-in-drive";
type Fault = "abort" | "unsubscribe" | "dispose";

interface Action {
  readonly stage: Stage;
  readonly faults: readonly Fault[];
}

const actionArbitrary: fc.Arbitrary<Action> = fc.record({
  stage: fc.constantFrom<Stage>("completed", "rejected", "abort-in-request", "abort-in-drive"),
  faults: fc.subarray<Fault>(["abort", "unsubscribe", "dispose"]),
});
const actions = fc.sample(actionArbitrary, { numRuns: 18, seed: 7 });

interface Observation {
  readonly sessions: readonly {
    readonly disposeCalls: number;
    readonly unsubscribeCalls: number;
    readonly liveSubscriptions: number;
    readonly idle: boolean;
    readonly streaming: boolean;
  }[];
  readonly calls: readonly string[];
  readonly completion: string | undefined;
}

async function waitFor(condition: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("Simulated user session release", () => {
  const observations: Observation[] = [];
  let root: string;
  let cwd: string;
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  const restore: (() => void)[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "niceeval-su-cleanup-"));
    await mkdir(join(root, "results"));
    const { piCoding } = await loadPi();
    const proto = piCoding.AgentSession.prototype;

    // The probe wraps only the public SDK surface: it counts what the owner calls and,
    // when asked, makes that call fail after the real operation has run.
    let faults: ReadonlySet<Fault> = new Set();
    let calls: string[] = [];
    let sessions = new Map<object, { disposeCalls: number; unsubscribeCalls: number; live: number; subscriptions: number }>();
    const track = (session: object) => {
      let state = sessions.get(session);
      if (state === undefined) sessions.set(session, (state = { disposeCalls: 0, unsubscribeCalls: 0, live: 0, subscriptions: 0 }));
      return state;
    };
    const { abort, dispose, subscribe } = proto;
    proto.abort = async function (this: typeof proto) {
      track(this);
      calls.push("abort");
      await abort.call(this);
      if (faults.has("abort")) throw new Error("sdk-fixture-abort");
    };
    proto.subscribe = function (this: typeof proto, listener: Parameters<typeof subscribe>[0]) {
      const state = track(this);
      // The simulated user subscribes once, before its first prompt; the per-prompt
      // listeners that follow belong to the shared pi runtime and are only counted.
      const owner = state.subscriptions++ === 0;
      const unsubscribe = subscribe.call(this, listener);
      state.live++;
      let released = false;
      return () => {
        if (owner) {
          calls.push("unsubscribe");
          state.unsubscribeCalls++;
        }
        unsubscribe();
        if (!released) state.live--;
        released = true;
        if (owner && faults.has("unsubscribe")) throw new Error("sdk-fixture-unsubscribe");
      };
    };
    proto.dispose = function (this: typeof proto) {
      const state = track(this);
      calls.push("dispose");
      state.disposeCalls++;
      dispose.call(this);
      if (faults.has("dispose")) throw new Error("sdk-fixture-dispose");
    };
    restore.push(() => {
      proto.abort = abort;
      proto.subscribe = subscribe;
      proto.dispose = dispose;
    });

    let stage: Stage = "completed";
    let requestSeen = false;
    server = await startHttpServer((_req, body, res) => {
      requestSeen = true;
      if (stage === "abort-in-request") return; // held open until the Attempt is cancelled
      respondStream(res, JSON.parse(body), {
        id: "r",
        ...(stage === "rejected" ? {} : { toolArguments: { message: "message-sc0" } }),
      });
    });

    const scenario: Scenario = { id: "sc0", requests: [] };
    const drivesPath = join(root, "drives.jsonl");
    cwd = await createSimulatedUserProject("niceeval-su-cleanup-project-", {
      scenarios: [scenario],
      drivesPath,
      resultDir: join(root, "results"),
      config: openAIConfigSource(server.baseUrl),
    });
    const evalPath = join(cwd, "evals", "sc0.eval.ts");
    const evalSource = await readFile(evalPath, "utf8");
    const agentPath = join(cwd, "agent.ts");
    const agentSource = await readFile(agentPath, "utf8");

    for (const action of actions) {
      stage = action.stage;
      requestSeen = false;
      faults = new Set(action.faults);
      calls = [];
      sessions = new Map();
      await writeFile(drivesPath, "");
      await rm(join(root, "results", "sc0.json"), { force: true });
      const hang = action.stage === "abort-in-drive";
      await writeFile(evalPath, evalSource.replace(/const S = .*;/u, `const S = ${JSON.stringify({ ...scenario, timeoutMs: 20000 })};`));
      await writeFile(agentPath, agentSource.replace(/const SCENARIOS = .*;/u, `const SCENARIOS = ${JSON.stringify({ sc0: { ...scenario, hangDrive: hang } })};`));
      const abortController = new AbortController();
      const running = planAndRunExperiment(cwd, "su", {
        config: { judgeProvider: openAIProvider(server.baseUrl) },
        rerun: "all",
        signal: abortController.signal,
      });
      if (action.stage === "abort-in-request") {
        await waitFor(() => requestSeen, "the model request");
        abortController.abort();
      } else if (action.stage === "abort-in-drive") {
        await waitFor(
          async () => (await readFile(drivesPath, "utf8")).split("\n").some((line) => line.includes("message-sc0")),
          "the answer Turn to start",
        );
        abortController.abort();
      }
      const result = await running;
      observations.push({
        sessions: [...sessions].map(([session, state]) => ({
          disposeCalls: state.disposeCalls,
          unsubscribeCalls: state.unsubscribeCalls,
          liveSubscriptions: state.live,
          idle: (session as { isIdle: boolean }).isIdle,
          streaming: (session as { isStreaming: boolean }).isStreaming,
        })),
        calls,
        completion: result.receipt?.completion,
      });
    }
  }, 180_000);

  afterAll(async () => {
    for (const undo of restore.reverse()) undo();
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
    if (root) await rm(root, { recursive: true, force: true });
  });

  // @feature docs/feature/eval/README.md#simulated-user-cleanup
  test("the generated actions cover every ending and every release fault", () => {
    expect(new Set(actions.map((action) => action.stage))).toEqual(
      new Set(["completed", "rejected", "abort-in-request", "abort-in-drive"]),
    );
    for (const fault of ["abort", "unsubscribe", "dispose"] as const)
      expect(actions.some((action) => action.faults.includes(fault)), fault).toBe(true);
    expect(actions.some((action) => action.faults.length === 3)).toBe(true);
    expect(actions.some((action) => action.faults.length === 0)).toBe(true);
  });

  // @feature docs/feature/eval/README.md#simulated-user-cleanup
  test.each(actions.map((action, index) => ({ ...action, index, name: `${action.stage} with ${action.faults.join("+") || "no faults"}` })))(
    "$name releases the session exactly once and leaves no subscription",
    ({ index, stage }) => {
      const observation = observations[index]!;
      const context = JSON.stringify({ action: actions[index], observation });
      if (stage.startsWith("abort")) expect(observation.completion, context).toBe("interrupted");
      expect(observation.sessions, context).toHaveLength(1);
      expect(observation.sessions[0], context).toEqual({
        disposeCalls: 1,
        unsubscribeCalls: 1,
        liveSubscriptions: 0,
        idle: true,
        streaming: false,
      });
      // The owner stops generation first, then drops the listener, then disposes; nothing runs after.
      const unsubscribed = observation.calls.indexOf("unsubscribe");
      const disposed = observation.calls.indexOf("dispose");
      expect(unsubscribed, context).toBeLessThan(disposed);
      expect(observation.calls.lastIndexOf("abort"), context).toBeLessThan(unsubscribed);
      expect(observation.calls.length - 1, context).toBe(disposed);
    },
  );
});
