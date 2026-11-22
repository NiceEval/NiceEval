import { createRequire } from "node:module";
import fc from "fast-check";
import { expect, test } from "vitest";
import { createFixtureProject } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

// @feature docs/feature/experiments/README.md#readonly-cache-preview
test("debug reports each declared before prefix once with its selected Eval consumers", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 1, max: 3 }), async (count, attempts) => {
      const keys = Array.from({ length: count }, (_, index) => `e${index}`);
      const evalIds = keys.map((key) => `fixture/${key}`);
      const project = await createFixtureProject("niceeval-debug-cache", {
        "evals/fixture.eval.ts": `
          import { defineDataset } from "niceeval";
          export default defineDataset({ data: ${JSON.stringify(keys)}, key: (key) => key, test() {} });
        `,
        "experiments/cache.ts": `
          import { defineExperiment } from "niceeval";
          import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
          import { dockerSandbox, shell } from "niceeval/sandbox";
          const adapter = defineSandboxAgent({
            name: "offline-cache-fixture", evidenceCoverage: completeEvidenceCoverage,
            install: { identity: { agent: "fixture", version: "1", revision: "1" }, probe: shell("true") },
            async send() { return { status: "completed", events: [] }; },
          });
          const sandbox = dockerSandbox({
            source: { type: "image", image: "fixture@sha256:${"a".repeat(64)}" },
          }).before(shell({ id: "shared", command: "true" }));
          export default defineExperiment({ adapter, sandbox, evals: "*", attempts: ${attempts} });
        `,
      });
      try {
        const result = await Effect.runPromise(
          experimentHost.debug({ cwd: project.cwd, experimentSelector: "cache", config: {} }),
        );
        if (result.status !== "planned") throw new Error(JSON.stringify(result));
        expect(result.evalIds).toEqual(evalIds);
        expect(result.beforeCachePlan).toMatchObject({
          lookup: "not-probed",
          nodes: [
            {
              lookup: "not-probed",
              capability: "attempt-captured",
              eligibility: { status: "eligible" },
              consumers: evalIds.map((evalId) => ({ experimentId: "cache", evalId })),
            },
          ],
        });
      } finally {
        await project.dispose();
      }
    }),
    { numRuns: 1 },
  );
});
