import { randomUUID } from "node:crypto";
import { mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createFixtureProject, type FixtureProject } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const probe = Symbol.for(`experiment-halt-exclusive-${randomUUID()}`);
const firstSend = Promise.withResolvers<void>();
const failFirstSend = Promise.withResolvers<void>();
const abort = new AbortController();
const sends: string[] = [];
let project: FixtureProject | undefined;
let running: Promise<Effect.Success<ReturnType<typeof experimentHost.invocation.run>>> | undefined;

beforeAll(async () => {
  Reflect.set(process, probe, async (text: string) => {
    sends.push(text);
    if (sends.length !== 1) return false;
    firstSend.resolve();
    await failFirstSend.promise;
    return true;
  });

  const evalFile = (id: string) => `
    import agent from "../agent.ts";
    export default agent.defineEval({ async test(t) { await t.send(${JSON.stringify(id)}); } });
  `;
  project = await createFixtureProject("experiment-halt-exclusive", {
    "sandbox.ts": await readFile(new URL("./fixtures/inspection-core/sandbox.ts.txt", import.meta.url), "utf8"),
    "agent.ts": `
      import { completeEvidenceCoverage, defineSandboxAgent, makeSendFailure } from "niceeval/adapter";
      import { shell } from "niceeval/sandbox";
      const shouldFail = Reflect.get(process, Symbol.for(${JSON.stringify(Symbol.keyFor(probe))}));
      export default defineSandboxAgent({
        name: "experiment-halt", evidenceCoverage: completeEvidenceCoverage,
        install: { identity: { agent: "experiment-halt", version: "1", revision: "1" }, probe: shell("true") },
        classifySendFailure: () => ({ retryable: false, scope: "experiment", reason: "fixture" }),
        async send(input) {
          if (await shouldFail(input.text)) {
            throw makeSendFailure({ acceptance: "rejected", message: "shared fixture unavailable" });
          }
          return { status: "completed", events: [] };
        }
      });
    `,
    "experiments/serial.ts": `
      import { defineExperiment } from "niceeval";
      import adapter from "../agent.ts";
      import sandbox from "../sandbox.ts";
      export default defineExperiment({ adapter, sandbox, evals: ["alpha", "beta"], maxConcurrency: 2 });
    `,
    "evals/alpha.eval.ts": evalFile("alpha"),
    "evals/beta.eval.ts": evalFile("beta"),
  });
  const dependencies = join(project.cwd, "node_modules");
  await mkdir(dependencies);
  await symlink(dirname(fileURLToPath(import.meta.resolve("effect/package.json"))), join(dependencies, "effect"), "dir");
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd: project.cwd, experimentSelector: "serial", config: { maxConcurrency: 2 } }),
  );
  if (planned.status !== "ready") throw new Error(JSON.stringify(planned));
  running = Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan, signal: abort.signal }));
  await Promise.race([
    firstSend.promise,
    running.then(() => {
      throw new Error("Invocation completed before the first send");
    }),
  ]);
});

afterAll(async () => {
  failFirstSend.resolve();
  abort.abort();
  try {
    await running;
  } finally {
    Reflect.deleteProperty(process, probe);
    await project?.dispose();
  }
});

// @feature docs/feature/error-classification/README.md#止损语义
test("experiment halt stops a sibling waiting for the exclusive Sandbox", async () => {
  failFirstSend.resolve();
  const result = await running;
  expect(sends).toHaveLength(1);
  expect(result?.summary).toMatchObject({ total: 1, errored: 1 });
});
