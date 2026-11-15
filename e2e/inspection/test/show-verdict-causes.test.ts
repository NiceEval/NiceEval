import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { judgeUsageHttp } from "../fixtures/judge-usage-http.ts";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("errored Attempt explains required Judge failures separately from advisory diagnostics", async () => {
  await inspectionE2E.case(
    "show-verdict-causes",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(
        join(projectRoot, "evals/verdict-causes.eval.ts"),
        `
import { defineAdapter } from "niceeval";
import { defineMaterialMatch, defineValueMatch } from "niceeval/expect";
export const app = defineAdapter({ name: "verdict-causes", behaviorRevision: "1", create(ctx) {
  ctx.diagnostic({ code: "inspection-advisory", level: "warning", message: "Optional telemetry unavailable" });
  return { history: () => [{ id: "answer", value: "Paris" }] };
} });
const history = defineMaterialMatch({ name: "history", read: (ctx: { history(): readonly { id: string; value: string }[] }) => ({ state: "complete" as const, items: ctx.history() }), match: defineValueMatch<string>({ name: "present", evaluate: () => true }) });
export default app.defineScoreEval({ test(t) {
  t.closeQA(history, "Is this Paris?").score(1).label("First required review");
  t.closeQA(history, "Is this France?").score(1).label("Second required review");
} });`,
      );
      await writeFile(
        join(projectRoot, "experiments/verdict-causes.ts"),
        `
import { defineExperiment } from "niceeval";
import { OpenRouterProvider } from "niceeval/judge";
import { app } from "../evals/verdict-causes.eval.ts";
export default defineExperiment({ adapter: app, evals: ["verdict-causes"], judge: OpenRouterProvider({ model: "offline", apiKey: "offline", baseUrl: process.env.NICEEVAL_E2E_JUDGE_USAGE_URL!, timeoutMs: 1000 }) });`,
      );
      const fixture = judgeUsageHttp(
        Array.from({ length: 8 }, () => ({ status: 502, body: { error: { message: "Offline Judge unavailable" } } })),
      );
      try {
        const run = await niceeval.run(["exp", "verdict-causes", "--json"], {
          env: { NICEEVAL_E2E_JUDGE_USAGE_URL: await fixture.listen() },
        });
        expect(run.exitCode, run.diagnostic()).toBe(1);
        const event = only(run.expEvalEvents(), (item) => item.evalId === "verdict-causes", run.diagnostic());
        expect(event.verdict).toBe("errored");
        const json = await niceeval.run(["show", event.locator, "--json"]);
        expect(json.exitCode, json.diagnostic()).toBe(0);
        const attempt = json.inspectionSuccess("attempt.get").attempt;
        expect(attempt.assertions.entries, json.stdout + run.stdout).toHaveLength(2);
        const first = only(attempt.assertions.entries, (entry) => entry.display.label === "First required review");
        expect(attempt).toMatchObject({
          verdict: "errored",
          verdictCauses: {
            total: 2,
            hasMore: false,
            omittedCount: 0,
            items: [
              {
                entryId: first.entryId,
                label: "First required review",
                result: "unavailable",
                reason: "source-unavailable",
                failureDetail: "judge-call-failed",
              },
              {
                label: "Second required review",
                result: "unavailable",
                reason: "source-unavailable",
                failureDetail: "judge-call-failed",
              },
            ],
            groups: [
              { result: "unavailable", reason: "source-unavailable", failureDetail: "judge-call-failed", count: 2 },
            ],
          },
        });
        const human = await niceeval.run(["show", event.locator]);
        expect(human.exitCode, human.diagnostic()).toBe(0);
        expect(human.stdout.replace(/\s+/gu, " ")).toContain(
          "Errored because 2 required assertions are unavailable: judge-call-failed ×2",
        );
        expect(human.stdout).toContain(`niceeval show ${event.locator} ${first.entryId} --full`);
        expect(human.stdout).toContain("Advisories");
        expect(human.stdout.split("Advisories")[1]).toContain("inspection-advisory");
        expect(human.stdout.split("Advisories")[0]).not.toContain("inspection-advisory");
        const detail = await niceeval.run(["show", event.locator, first.entryId, "--full", "--json"]);
        expect(detail.exitCode, detail.diagnostic()).toBe(0);
        expect(detail.inspectionSuccess("attempt.assertion.detail").assertion.entryId).toBe(first.entryId);
      } finally {
        expect(await fixture.close()).toEqual({ listening: false, openConnections: 0 });
      }
    },
  );
});
