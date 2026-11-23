import { assertExpEvalOutcomes, command, only, type ExpEvalOutcomeExpectation } from "@niceeval/testkit";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEEPSEEK_HARNESS_MARKER } from "../evals/message.eval.ts";

const EXPECTED_OUTCOMES = [
  { experimentId: "ci", evalId: "message", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
// @feature docs/feature/adapters/README.md

it(
  "DeepSeek Harness adapter 从公开工厂完成 Eval 并公开读回结果",
  async () => {
    await rm(".niceeval", { recursive: true, force: true });

    const run = await niceeval.run(["exp", "ci", "--rerun", "all", "--json"], {
      timeoutMs: 6 * 60_000,
    });
    if (run.exitCode === 1) {
      const error = run.expErrorEvents().find((event) => event.experimentId === "ci" && event.evalId === "message");
      if (error) {
        const queried = await niceeval.run(["show", error.locator, "--json"]);
        if (queried.exitCode === 0) {
          const { diagnostics } = queried.attempt().attempt;
          const details = await Promise.all(
            diagnostics.items.map(async ({ evidenceId }) => {
              const evidence = await niceeval.run(["show", error.locator, evidenceId, "--json"]);
              return evidence.exitCode === 0
                ? evidence.attemptTraceDetail()
                : { evidenceId, exitCode: evidence.exitCode };
            }),
          );
          await writeFile(
            "deepseek-attempt-diagnostics.json",
            JSON.stringify({ error, diagnostics, details }, null, 2),
          );
        }
      }
    }
    expect(run.exitCode, run.diagnostic()).toBe(0);

    const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED_OUTCOMES, () => run.diagnostic());
    const event = only(events, (candidate) => candidate.evalId === "message");

    const queried = await niceeval.run(["show", event.locator, "execution", "--json"]);
    expect(queried.exitCode, queried.diagnostic()).toBe(0);
    const document = queried.attemptTrace();
    expect(document).toMatchObject({ operation: "attempt.trace" });
    expect(JSON.stringify(document.trace)).toContain(DEEPSEEK_HARNESS_MARKER);
  },
  8 * 60_000,
);
