import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Effect } from "effect";
import fc from "fast-check";
import { decodeSessionShowDocument, experimentHost } from "niceeval/experiment/host";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runCli } from "../integration/fixtures/lifecycle-sandbox/harness.ts";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

let cwd: string;
let running: Promise<unknown> | undefined;
let human: string;
let machine: ReturnType<typeof decodeSessionShowDocument>;

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-invocation-eval-phase-", { held: true });
  await Promise.all([
    writeFile(
      join(cwd, "sandbox.ts"),
      await readFile(new URL("../integration/fixtures/inspection-core/sandbox.ts.txt", import.meta.url), "utf8"),
    ),
    writeFile(
      join(cwd, "experiments", "runs.ts"),
      `
      import { defineExperiment } from "niceeval";
      import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
      import { shell } from "niceeval/sandbox";
      import sandbox from "../sandbox.ts";
      const adapter = defineSandboxAgent({
        name: "invocation-phase-agent", evidenceCoverage: completeEvidenceCoverage,
        install: { identity: { agent: "invocation-phase-agent", version: "1", revision: "1" }, probe: shell("true") },
        send: async () => ({ status: "completed", events: [] }),
      });
      export default defineExperiment({ adapter, sandbox, evals: ["held"] });
    `,
    ),
    writeFile(
      join(cwd, "evals", "held.eval.ts"),
      `
      import { existsSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { setTimeout } from "node:timers/promises";
      import { defineEval } from "niceeval";
      import { equals } from "niceeval/expect";
      const cwd = ${JSON.stringify(cwd)};
      export default defineEval({ async test(t) {
        writeFileSync(join(cwd, "gates", "entered"), "1");
        while (!existsSync(join(cwd, "gates", "release"))) await setTimeout(10);
        await t.send("fixture");
        t.check(true, equals(true));
      } });
    `,
    ),
  ]);
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({ cwd, experimentSelector: "runs", config: {} }),
  );
  if (planned.status !== "ready") throw new Error("Could not plan the Sandbox Attempt");
  running = Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  await waitForGate(cwd, "entered");
  const { sessions } = await Effect.runPromise(experimentHost.invocationStatus.list({ cwd, all: false }));
  const invocationId = sessions[0]?.sessionId;
  if (invocationId === undefined) throw new Error("Missing active Invocation");
  const args = ["invocation", "show", invocationId];
  for (const deadline = Date.now() + 8_000; ; ) {
    const result = await runCli(cwd, [...args, "--json"]);
    expect(result.code, result.stderr).toBe(0);
    machine = decodeSessionShowDocument(JSON.parse(result.stdout));
    const session = machine.session;
    const active =
      "status" in session && session.status === "active" ? session.experiments[0]?.activeAttempts[0] : undefined;
    if (active?.phase === "eval.run" && active.detail != null && active.detail.at >= active.phaseEnteredAt) break;
    if (Date.now() >= deadline) throw new Error("The held Eval did not become visible in Invocation show");
    await setTimeout(10);
  }
  const result = await runCli(cwd, args);
  expect(result.code, result.stderr).toBe(0);
  human = result.stdout;
}, 30_000);

afterAll(async () => {
  if (cwd === undefined) return;
  try {
    await openGate(cwd, "release");
    await running;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/experiments/README.md#invocation-session
test("Invocation show reports Eval execution before the first send", () => {
  fc.assert(
    fc.property(fc.boolean(), (json) => {
      if (json) {
        expect(machine.session).toMatchObject({
          status: "active",
          experiments: [
            {
              activeAttempts: [
                { evalId: "held", attemptOrdinal: 1, phase: "eval.run", detail: { text: "running eval..." } },
              ],
            },
          ],
        });
      } else {
        expect(human).toMatch(/held #1 · eval\.run since [^\n]+\n\s+\S+ running eval\.\.\./u);
      }
    }),
    { numRuns: 1, examples: [[false], [true]] },
  );
});
