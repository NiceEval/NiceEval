import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  chatToolResponse,
  createJudgeProject,
  Effect,
  experimentHost,
  OpenAIProvider,
  planAndRunExperiment,
  readAssertionsList,
  readFullAssertionEntry,
  startHttpServer,
} from "./fixtures/judge-harness/harness.ts";

const claims = Array.from({ length: 35 }, (_, i) => `Claim ${i + 1}`);
const extractMaterials: unknown[] = [];
const batches: string[][] = [];
let cwd: string | undefined;
let server: Awaited<ReturnType<typeof startHttpServer>> | undefined;
let digests: Record<string, string>;
let locator: string;

beforeAll(async () => {
  cwd = await createJudgeProject("niceeval-faithfulness-continuation-", {
    agent: `
      import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
      export default defineAgent({ name: "claims-fixture", evidenceCoverage: completeEvidenceCoverage,
        send: async () => ({ status: "completed", events: [] }) });
    `,
    evals: {
      "claims.eval.ts": `
        import { defineScoreEval } from "niceeval";
        import { faithfulness } from "niceeval/expect";
        export default defineScoreEval({
          test(t) {
            t.judge({ input: "Question", output: "Answer", context: "Reference" }, faithfulness()).score(1);
          },
        });
      `,
      "ordinary.eval.ts": `
        import { defineScoreEval } from "niceeval";
        import { defineJudge } from "niceeval/expect";
        export default defineScoreEval({ test(t) { t.judge("answer", defineJudge({ rubric: "Check" })).score(1); } });
      `,
    },
    experiments: {
      "capabilities.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        export default defineExperiment({ adapter: agent, evals: ["claims", "ordinary"], attempts: 1 });
      `,
      "claims.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        export default defineExperiment({ adapter: agent, evals: ["claims"], attempts: 1 });
      `,
    },
  });
  const baseProvider = { model: "claims-fixture-model", apiKey: "fixture-key" };
  const planned = await Effect.runPromise(experimentHost.invocation.plan({
    cwd, experimentSelector: "capabilities", preview: true,
    config: { judgeProvider: OpenAIProvider({ ...baseProvider, baseUrl: "https://judge.example.invalid/v1" }) },
  }));
  if (planned.status !== "ready" || planned.dry === undefined) throw new Error("Expected dry plan for both Evals");
  digests = Object.fromEntries(planned.dry.slots.map(({ target }) => [target.evalId, target.executionIdentityDigest]));

  server = await startHttpServer((_request, body, response) => {
    const request = JSON.parse(body) as { model: string; messages: { content: string }[] };
    const { operation } = JSON.parse(request.messages[2]!.content) as { operation: string };
    const user = JSON.parse(request.messages[1]!.content) as { material: unknown; items?: { id: string }[] };
    let args: unknown;
    if (operation === "extract") {
      extractMaterials.push(user.material);
      const complete = extractMaterials.length === 2;
      args = { rationale: "Extracted page", items: complete ? claims.slice(20) : claims.slice(0, 20), complete };
    } else {
      const ids = user.items!.map(({ id }) => id);
      batches.push(ids);
      args = { items: ids.map((id) => ({ id, choice: id === "35" ? "unsupported" : "supported", rationale: "Checked" })) };
    }
    response.setHeader("Content-Type", "application/json");
    response.end(chatToolResponse("record_score_match", args, request.model));
  });
  const run = await planAndRunExperiment(cwd, "claims", {
    config: { judgeProvider: OpenAIProvider({ ...baseProvider, baseUrl: server.baseUrl }) },
    rerun: "all",
  });
  const publication = run.run?.slots[0]?.publication;
  if (publication?.state !== "published") throw new Error("Faithfulness Attempt did not publish");
  locator = publication.attemptLocator;
}, 20_000);

afterAll(async () => {
  await server?.close();
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/judge/README.md#score-audit
test("Faithfulness continues extraction and scores all batches while ordinary Judge keeps its identity", async () => {
  expect(extractMaterials).toEqual([
    { input: "Question", output: "Answer" },
    { input: "Question", output: "Answer", alreadyExtracted: claims.slice(0, 20) },
  ]);
  expect(batches).toEqual([claims.slice(0, 32).map((_, i) => String(i + 1)), ["33", "34", "35"]]);
  const [listed] = await readAssertionsList(cwd!, locator);
  const { entry } = await readFullAssertionEntry(cwd!, locator, listed!.entryId);
  if (entry.scoreMatchAudit?.state !== "available") throw new Error("Expected a readable Faithfulness audit");
  expect(entry.scoreMatchAudit.audit.result).toEqual({ state: "measured", value: 34 / 35 });

  expect(digests["ordinary"]).toBe("9bff9eb911488c27a95619f62f21f99784d87d044e2cf293a89a342a4a6d0791");
  expect(digests["claims"]).not.toBe("e4f8d58ee09adf197edcb6ca50c69272cab2ec31317bbdcaa8157ddf5f011418");
});
