import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Clock, Duration, Effect, Random } from "effect";
import fc from "fast-check";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { beforeAll, expect, test, vi } from "vitest";
import { selectInspectionOperation, withOperational } from "./fixtures/adapter-trace-usage-harness/harness.ts";
import { createLifecycleProject } from "./fixtures/lifecycle-sandbox/harness.ts";

type Stage = "snapshot" | "allocate" | "poll" | "ready" | "grant";
type Fault = "connect" | "timeout" | "503" | "429" | "403" | "lost" | "body";
function failure(fault: Fault) {
  if (fault === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  if (fault === "connect")
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
  if (fault === "body")
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      }),
    );
  if (fault === "lost") throw new TypeError("fetch failed");
  return Response.json({ error: { code: "fixture-fault" } }, { status: Number(fault) });
}

function controlPlane(snapshotId: string, stage: Stage, fault: Fault, failures: number, confirmDeletion: boolean) {
  const events: string[] = [];
  const machines = new Map<string, string>();
  const absent = new Set<string>();
  const deleting = new Set<string>();
  let injected = 0;
  function inject(request: Stage) {
    return stage === request && injected++ < failures;
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.instabox.sh");
    const [, , resource, id, subresource] = url.pathname.split("/");
    if (resource === "snapshots") {
      events.push("snapshot");
      if (inject("snapshot")) return failure(fault);
      return Response.json({ id, status: "ready" });
    }
    if (resource === "machines" && !id && init?.method === "POST") {
      const key = new Headers(init.headers).get("Idempotency-Key");
      expect(key).toBeTruthy();
      const machine = machines.get(key!) ?? `${snapshotId}.m${machines.size + 1}`;
      events.push(`allocate:${machine}`);
      const fail = inject("allocate");
      if (fail && ["connect", "429", "403"].includes(fault)) return failure(fault);
      machines.set(key!, machine);
      if (fail) return failure(fault);
      return Response.json({ id: machine, machineId: machine, state: "running", error: null });
    }
    if (resource === "operations") {
      events.push(`poll:${id}`);
      if (inject("poll")) return failure(fault);
      return Response.json({ id, machineId: id, state: "succeeded", error: null });
    }
    if (resource !== "machines" || !id || ![...machines.values()].includes(id))
      throw new Error(`Unexpected fixture request ${url.pathname}`);
    if (init?.method === "DELETE") {
      expect(new Headers(init.headers).get("X-Confirm-Delete")).toBe(id);
      events.push(`delete:${id}`);
      deleting.add(id);
      return Response.json({ id: `delete-${id}`, machineId: id, state: "running", error: null });
    }
    if (deleting.has(id)) {
      events.push(`confirm:${id}`);
      if (!confirmDeletion) return failure("503");
      absent.add(id);
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    if (subresource === "ssh-tokens") {
      events.push(`grant:${id}`);
      if (inject("grant")) return failure(fault);
      return Response.json({ error: { code: "end-of-fixture" } }, { status: 403 });
    }
    events.push(`ready:${id}`);
    if (inject("ready")) return failure(fault);
    return Response.json({ id, state: "running", operationId: null, runtime: { ready: true } });
  };
  return { stage, snapshotId, fetch, events, machines, absent };
}

const allCases: ReturnType<typeof controlPlane>[] = [];
function scenario(stage: Stage, fault: Fault, failures = 1, confirmDeletion = true) {
  const snapshotId = `sn_e${allCases.length}`;
  const fixture = controlPlane(snapshotId, stage, fault, failures, confirmDeletion);
  allCases.push(fixture);
  return fixture;
}

const singleFaults = [
  scenario("snapshot", "timeout"),
  scenario("poll", "503"),
  scenario("ready", "lost"),
  scenario("ready", "body"),
  scenario("grant", "connect"),
  scenario("grant", "429"),
  scenario("allocate", "lost"),
  ...fc
    .sample(
      fc.tuple(fc.constantFrom("snapshot", "poll", "ready"), fc.constantFrom("connect", "timeout", "503", "lost")),
      { seed: 451506, numRuns: 4 },
    )
    .map(([stage, fault]) => scenario(stage, fault)),
];
const rebuilds = [
  { fixture: scenario("ready", "503", 3), machines: 2, firstRequests: 3 },
  { fixture: scenario("grant", "timeout"), machines: 2, firstRequests: 1 },
  { fixture: scenario("grant", "503", 8), machines: 4, firstRequests: 1 },
];
const cleanup = scenario("grant", "timeout", 1, false);
const allocation = scenario("allocate", "lost", 2);
const denied = scenario("ready", "403");
const cancelled = controlPlane("sn_e0", "ready", "403", 0, true);
const summaries = new Map<string, string[]>();

beforeAll(async () => {
  const project = await createLifecycleProject({
    scripts: allCases.map(() => ({ cleanups: 0, beforeFails: false, test: "pass" })),
    attempts: 1,
    maxConcurrency: 1,
    failCreates: [],
  });
  try {
    // Each Eval owns its snapshot. Run all scenarios together, using IDs to
    // route requests independently of their order or the number of Machines.
    await writeFile(
      join(project.cwd, "experiments/lifecycle.ts"),
      'import {defineExperiment} from "niceeval"; import agent from "../agent.ts"; export default defineExperiment({adapter:agent, evals:"*"});',
    );
    await Promise.all(
      allCases.map(({ snapshotId }, i) =>
        writeFile(
          join(project.cwd, "evals", `e${i}.eval.ts`),
          `import {defineEval} from "niceeval"; import {instaboxSandbox} from "niceeval/sandbox"; export default defineEval({sandbox:instaboxSandbox({snapshotId:${JSON.stringify(snapshotId)}}), async test(){ throw new Error("unexpected successful provisioning"); }});`,
        ),
      ),
    );
    const fixtures = new Map(allCases.map((fixture) => [fixture.snapshotId, fixture]));
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const id =
        new URL(String(input)).pathname.split("/")[3]?.split(".")[0] ?? JSON.parse(String(init?.body)).snapshotId;
      const fixture = fixtures.get(id);
      if (!fixture) throw new Error(`Unexpected request to ${String(input)}`);
      return fixture.fetch(input, init);
    });
    vi.stubEnv("INSTABOX_API_KEY", "fixture");
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentSelector: "lifecycle",
        config: { maxConcurrency: 1, sandboxCache: { before: "bypass" } },
        overrides: { rerun: "all", earlyExit: false },
      }),
    );
    if (planned.status !== "ready") throw new Error(JSON.stringify(planned));
    const run = experimentHost.invocation.run({ plan: planned.plan });
    const result = await Effect.runPromise(
      Clock.clockWith((clock) =>
        run.pipe(
          Effect.provideService(Clock.Clock, {
            currentTimeMillis: clock.currentTimeMillis,
            currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
            currentTimeNanos: clock.currentTimeNanos,
            currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
            monotonicTimeNanos: clock.monotonicTimeNanos,
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            sleep: (duration) =>
              [125, 250, 500, 1000, 2000].includes(Duration.toMillis(duration)) ? Effect.void : clock.sleep(duration),
          }),
          Effect.provideService(Random.Random, { nextDoubleUnsafe: () => 0, nextIntUnsafe: () => 0 }),
        ),
      ),
    );
    expect(result.summary.errored).toBe(allCases.length);
    const { run: record } = await Effect.runPromise(
      runHost.get({ cwd: project.cwd, runId: result.receipt.createdRunIds[0]! }),
    );
    await withOperational(project.cwd, (facts) => {
      for (const slot of record.slots) {
        if (slot.publication.state !== "published") throw new Error("Expected a published fixture Attempt");
        const { trace } = selectInspectionOperation(facts, {
          kind: "attempt.trace",
          locator: slot.publication.attemptLocator,
        });
        summaries.set(
          `sn_${slot.evalId}`,
          trace.diagnostics.items.map((entry) => entry.summary),
        );
      }
    });
    // Cancel a separate Invocation while the first operation GET is outstanding.
    const abort = new AbortController();
    const polling = Promise.withResolvers<void>();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname.includes("/operations/")) {
        cancelled.events.push("poll");
        const signal = init?.signal;
        if (!signal) throw new Error("Missing request signal");
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          polling.resolve();
        });
      }
      return cancelled.fetch(input, init);
    });
    const cancelPlan = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd: project.cwd,
        experimentSelector: "lifecycle",
        evalSelectors: ["e0"],
        config: { maxConcurrency: 1, sandboxCache: { before: "bypass" } },
        overrides: { rerun: "all" },
      }),
    );
    if (cancelPlan.status !== "ready") throw new Error("Could not plan cancelled Invocation");
    const running = Effect.runPromise(experimentHost.invocation.run({ plan: cancelPlan.plan, signal: abort.signal }));
    await Promise.race([polling.promise, running]);
    abort.abort();
    await running;
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await project.dispose();
  }
});

function calls(entry: ReturnType<typeof controlPlane>, machine: number, stage: Stage) {
  return entry.events.filter(
    (event) => event === (stage === "snapshot" ? "snapshot" : `${stage}:${entry.snapshotId}.m${machine}`),
  ).length;
}

// @feature docs/feature/sandbox/architecture/providers/instabox.md#provisioning-对账与重试
test("transient reads, rejected grants and lost allocation responses recover on their original resource", () => {
  for (const entry of singleFaults) {
    expect(calls(entry, 1, entry.stage), JSON.stringify(entry.events)).toBe(2);
    expect(entry.machines.size).toBe(1);
    expect(entry.absent.size).toBe(1);
    expect(summaries.get(entry.snapshotId)?.join(" ")).toContain("end-of-fixture");
  }
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("provisioning can rebuild only after confirmed deletion, with bounded read and allocation counts", () => {
  for (const { fixture: entry, machines: expected, firstRequests } of rebuilds) {
    expect(entry.machines.size, JSON.stringify(entry.events)).toBe(expected);
    expect(entry.absent.size).toBe(expected);
    for (let machine = 1; machine <= expected; machine++) {
      expect(calls(entry, machine, entry.stage)).toBe(machine === 1 ? firstRequests : 1);
      const confirmed = entry.events.indexOf(`confirm:${entry.snapshotId}.m${machine}`);
      expect(confirmed).toBeGreaterThan(-1);
      if (machine < expected)
        expect(entry.events.indexOf(`allocate:${entry.snapshotId}.m${machine + 1}`)).toBeGreaterThan(confirmed);
    }
  }
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("unconfirmed cleanup, unknown allocation and deterministic request failure preserve the original failure", () => {
  expect(cleanup.machines.size).toBe(1);
  expect(cleanup.absent.size).toBe(0);
  expect(cleanup.events).toContain(`confirm:${cleanup.snapshotId}.m1`);
  expect(summaries.get(cleanup.snapshotId)?.join(" ")).toMatch(/SSH grant failed: .*timeout/i);
  expect(calls(allocation, 1, "allocate")).toBe(2);
  expect(allocation.machines.size).toBe(1);
  expect(allocation.absent.size).toBe(0);
  expect(summaries.get(allocation.snapshotId)?.join(" ")).toContain("deletion deadline");
  expect(calls(denied, 1, "ready")).toBe(1);
  expect(denied.machines.size).toBe(1);
  expect(denied.absent.size).toBe(1);
  expect(summaries.get(denied.snapshotId)?.join(" ")).toContain("HTTP 403");
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("cancelling an outstanding operation GET confirms cleanup without another allocation", () => {
  expect(cancelled.events).toEqual(["snapshot", "allocate:sn_e0.m1", "poll", "delete:sn_e0.m1", "confirm:sn_e0.m1"]);
  expect(cancelled.absent.size).toBe(1);
});
