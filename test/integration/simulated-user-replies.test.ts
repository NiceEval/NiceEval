import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  TypesafeProvider,
  createSimulatedUserProject,
  openAIConfigSource,
  openAIProvider,
  readAttempt,
  respondStream,
  runScenarios,
  scenarioOfRequest,
  startHttpServer,
  type RequestSpec,
  type Scenario,
} from "./fixtures/simulated-user-harness/harness.ts";

// Actions the model can take on one generation. Everything except "valid" is an
// answer the simulated user must reject with a correcting retry.
const ANSWER_ACTIONS = [
  "valid",
  "wrong-option",
  "duplicate",
  "missing",
  "unknown",
  "both",
  "wrong-shape",
  "extra-field",
  "no-call",
] as const;
type AnswerAction = (typeof ANSWER_ACTIONS)[number];

interface Plan {
  readonly requestKinds: readonly ("text" | { readonly options: number })[];
  readonly choices: readonly number[];
  readonly rotation: number;
  readonly script: readonly AnswerAction[];
  readonly guard: "stale" | "foreign" | "clone" | undefined;
}

const planArbitrary: fc.Arbitrary<Plan> = fc.record({
  requestKinds: fc.array(fc.oneof(fc.constant("text" as const), fc.record({ options: fc.integer({ min: 2, max: 3 }) })), {
    maxLength: 3,
  }),
  choices: fc.array(fc.nat(5), { minLength: 3, maxLength: 3 }),
  rotation: fc.nat(2),
  // Rejected answers first, then usually a valid one, so retries are reached often.
  script: fc
    .tuple(
      fc
        .integer({ min: 0, max: 5 })
        .chain((length) =>
          fc.array(fc.constantFrom(...ANSWER_ACTIONS.filter((action) => action !== "valid")), {
            minLength: length,
            maxLength: length,
          }),
        ),
      fc.array(fc.constantFrom(...ANSWER_ACTIONS), { maxLength: 2 }),
      fc.boolean(),
    )
    .map(([rejected, rest, accepted]) => [...rejected, ...(accepted ? (["valid"] as const) : []), ...rest]),
  guard: fc.oneof(
    { weight: 6, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: fc.constantFrom("stale" as const, "foreign" as const, "clone" as const) },
  ),
});

function scenarioOf(id: string, plan: Plan): Scenario {
  const requests: RequestSpec[] = plan.requestKinds.map((kind, index) => {
    const requestId = `${id}-r${index}`;
    return kind === "text"
      ? { id: requestId, prompt: `Question ${index}` }
      : {
          id: requestId,
          prompt: `Choose ${index}`,
          options: Array.from({ length: kind.options }, (_, option) => ({ id: `${requestId}-o${option}` })),
        };
  });
  return { id, requests, guard: plan.guard };
}

/** The correct response per request, in request order. */
function expectedResponses(id: string, plan: Plan, scenario: Scenario) {
  return scenario.requests.map((request, index) =>
    request.options === undefined
      ? { requestId: request.id, text: `answer-${id}-${index}` }
      : { requestId: request.id, optionId: request.options[plan.choices[index]! % request.options.length]!.id },
  );
}

type Args = Record<string, unknown>;

/** Builds the tool arguments for one scripted action; undefined means no tool call. */
function toolArguments(action: AnswerAction, id: string, plan: Plan, scenario: Scenario): Args | undefined {
  if (action === "no-call") return undefined;
  const waiting = scenario.requests.length > 0;
  if (!waiting) {
    const message = { message: `message-${id}` };
    switch (action) {
      case "valid":
        return message;
      case "wrong-option":
      case "wrong-shape":
        return { answers: [{ requestId: `${id}-r0`, text: "x" }] };
      case "duplicate":
        return { ...message, message2: "again" };
      case "missing":
        return {};
      case "unknown":
        return { ...message, requestId: "unknown" };
      case "both":
        return { ...message, text: "x" };
      case "extra-field":
        return { ...message, extra: true };
    }
  }
  const valid = expectedResponses(id, plan, scenario);
  const rotated = valid.map((_, index) => valid[(index + plan.rotation) % valid.length]!);
  switch (action) {
    case "valid":
      return { answers: rotated };
    case "wrong-option": {
      const index = scenario.requests.findIndex((request) => request.options !== undefined);
      if (index < 0) return { message: "wrong shape" };
      return { answers: valid.map((answer, at) => (at === index ? { requestId: answer.requestId, optionId: "WRONG" } : answer)) };
    }
    case "duplicate":
      return { answers: [...valid, valid[0]] };
    case "missing":
      return { answers: valid.slice(1) };
    case "unknown":
      return { answers: valid.map((answer, at) => (at === 0 ? { ...answer, requestId: "unknown" } : answer)) };
    case "both":
      return { answers: valid.map((answer, at) => (at === 0 ? { ...answer, optionId: "x", text: "y" } : answer)) };
    case "wrong-shape":
      return { message: "wrong shape" };
    case "extra-field":
      return { answers: valid, extra: true };
  }
}

const RUNS = 20;
const MAX_MODEL_TURNS = 4;

describe("Simulated user replies", () => {
  const plans = new Map<string, Plan>();
  const scenarios = new Map<string, Scenario>();
  const modelRequests = new Map<string, number>();
  const outcomes = new Map<string, Record<string, unknown>>();
  const attempts = new Map<string, Awaited<ReturnType<typeof readAttempt>>>();
  let drives: { id: string; text: string; responses: unknown }[] = [];
  let root: string;
  let cwd: string;
  let server: Awaited<ReturnType<typeof startHttpServer>>;

  beforeAll(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "niceeval-su-replies-"));
    await mkdir(join(root, "results"));
    const sampled = fc.sample(planArbitrary, { numRuns: RUNS, seed: 20261120 });
    sampled.forEach((plan, index) => {
      const id = `sc${index}`;
      plans.set(id, plan);
      scenarios.set(id, scenarioOf(id, plan));
    });
    server = await startHttpServer((_req, body, res) => {
      const id = scenarioOfRequest(body);
      if (id === undefined || body.includes("context summarization assistant")) {
        res.writeHead(400);
        res.end("unexpected request");
        return;
      }
      const attempt = modelRequests.get(id) ?? 0;
      modelRequests.set(id, attempt + 1);
      const plan = plans.get(id)!;
      const action = plan.script[attempt] ?? "no-call";
      respondStream(res, JSON.parse(body), {
        id: `${id}-${attempt}`,
        toolArguments: toolArguments(action, id, plan, scenarios.get(id)!),
      });
    });
    cwd = await createSimulatedUserProject("niceeval-su-replies-project-", {
      scenarios: [...scenarios.values()],
      drivesPath: join(root, "drives.jsonl"),
      resultDir: join(root, "results"),
      config: openAIConfigSource(server.baseUrl),
    });
    const { locators } = await runScenarios(cwd, { judgeProvider: openAIProvider(server.baseUrl) });
    for (const id of scenarios.keys()) {
      outcomes.set(id, JSON.parse(await readFile(join(root, "results", `${id}.json`), "utf8")));
      attempts.set(id, await readAttempt(cwd, locators.get(id)!));
    }
    drives = (await readFile(join(root, "drives.jsonl"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
    if (root) await rm(root, { recursive: true, force: true });
  });

  const scenarioIds = Array.from({ length: RUNS }, (_, index) => `sc${index}`);

  // @feature docs/feature/eval/README.md#simulated-user-replies
  test("the generated actions cover waiting, plain, guarded, accepted and exhausted replies", () => {
    const all = [...plans.values()];
    expect(all.some((plan) => plan.guard !== undefined)).toBe(true);
    expect(all.some((plan) => plan.guard === undefined && plan.requestKinds.length > 0)).toBe(true);
    expect(all.some((plan) => plan.guard === undefined && plan.requestKinds.length === 0)).toBe(true);
    const guardless = all.filter((plan) => plan.guard === undefined);
    const firstValid = (plan: Plan) => plan.script.slice(0, MAX_MODEL_TURNS).indexOf("valid");
    expect(guardless.some((plan) => firstValid(plan) === 0)).toBe(true);
    expect(guardless.some((plan) => firstValid(plan) > 0)).toBe(true);
    expect(guardless.some((plan) => firstValid(plan) < 0)).toBe(true);
  });

  // @feature docs/feature/eval/README.md#simulated-user-replies
  test.each(scenarioIds)("scenario %s retries with corrections, answers atomically or fails explicitly", (id) => {
    const plan = plans.get(id)!;
    const scenario = scenarios.get(id)!;
    const outcome = outcomes.get(id)!;
    const attempt = attempts.get(id)!;
    const sends = drives.filter((drive) => drive.id === id);
    const context = JSON.stringify({ plan, outcome, sends, requests: modelRequests.get(id) });

    if (plan.guard !== undefined) {
      // Only the current waiting or completed Turn may be answered: no model request, no drive.
      expect(outcome, context).toMatchObject({ ok: false, code: "simulated-user-invalid-turn" });
      expect(modelRequests.get(id) ?? 0, context).toBe(0);
      expect(sends.filter((send) => send.responses !== null || !send.text.startsWith("START") && !send.text.startsWith("NEXT")), context).toEqual([]);
      return;
    }

    const window = plan.script.slice(0, MAX_MODEL_TURNS);
    const firstValid = window.indexOf("valid");
    if (firstValid >= 0) {
      expect(outcome, context).toEqual({ ok: true, status: "completed" });
      expect(modelRequests.get(id), context).toBe(firstValid + 1);
      expect(attempt.verdict, context).toBe("passed");
      expect(sends, context).toHaveLength(2);
      if (scenario.requests.length > 0) {
        expect(sends[1]!.responses, context).toEqual(expectedResponses(id, plan, scenario));
      } else {
        expect(sends[1], context).toMatchObject({ text: `message-${id}`, responses: null });
      }
      return;
    }

    const rejected = window.some((action) => action !== "no-call");
    expect(outcome, context).toMatchObject({
      ok: false,
      code: "simulated-user-failed",
      reason: rejected ? "invalid-answer" : "no-answer",
    });
    expect(modelRequests.get(id), context).toBe(MAX_MODEL_TURNS);
    expect(sends, context).toHaveLength(1);
    expect(attempt.verdict, context).toBe("errored");
    const diagnostic = attempt.diagnostics.find((item) => item.code === "simulated-user-failed");
    expect(diagnostic?.causes[0]?.code, context).toBe(rejected ? "invalid-answer" : "no-answer");
  });
});

describe("Simulated user with an unsupported Provider", () => {
  const ids = ["sc0", "sc1", "sc2"];
  let root: string;
  let cwd: string;
  let requests = 0;
  const outcomes = new Map<string, Record<string, unknown>>();
  const attempts = new Map<string, Awaited<ReturnType<typeof readAttempt>>>();
  let server: Awaited<ReturnType<typeof startHttpServer>>;

  beforeAll(async () => {
    root = await mkdtemp(join(await realpath(tmpdir()), "niceeval-su-typesafe-"));
    await mkdir(join(root, "results"));
    server = await startHttpServer((_req, _body, res) => {
      requests++;
      res.writeHead(500);
      res.end("must not be called");
    });
    const requestSets = fc.sample(
      fc.array(fc.constantFrom<RequestSpec | null>(null, { id: "x", prompt: "Which?" }), { maxLength: 2 }),
      { numRuns: ids.length, seed: 7 },
    );
    const scenarios: Scenario[] = ids.map((id, index) => ({
      id,
      requests: requestSets[index]!.flatMap((request, at) => (request === null ? [] : [{ ...request, id: `${id}-r${at}` }])),
    }));
    cwd = await createSimulatedUserProject("niceeval-su-typesafe-project-", {
      scenarios,
      drivesPath: join(root, "drives.jsonl"),
      resultDir: join(root, "results"),
      config: `
import { defineConfig } from "niceeval";
import { TypesafeProvider } from "niceeval/judge";
export default defineConfig({ timeoutMs: 30000, judgeProvider: TypesafeProvider({ model: "system-one", baseUrl: ${JSON.stringify(server.baseUrl)}, apiKey: "fixture-key" }) });
`,
    });
    const { locators } = await runScenarios(cwd, {
      judgeProvider: TypesafeProvider({ model: "system-one", baseUrl: server.baseUrl, apiKey: "fixture-key" }),
    });
    for (const id of ids) {
      outcomes.set(id, JSON.parse(await readFile(join(root, "results", `${id}.json`), "utf8")));
      attempts.set(id, await readAttempt(cwd, locators.get(id)!));
    }
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
    if (root) await rm(root, { recursive: true, force: true });
  });

  // @feature docs/feature/eval/README.md#simulated-user-replies
  test.each(ids)("scenario %s ends with an explicit unsupported-provider error and no model request", (id) => {
    expect(outcomes.get(id)).toMatchObject({ ok: false, code: "simulated-user-unsupported-provider", reason: "typesafe" });
    expect(requests).toBe(0);
    const attempt = attempts.get(id)!;
    expect(attempt.verdict).toBe("errored");
    const diagnostic = attempt.diagnostics.find((item) => item.code === "simulated-user-unsupported-provider");
    expect(diagnostic?.phase).toBe("eval.run");
    expect(diagnostic?.causes[0]?.code).toBe("typesafe");
  });
});
