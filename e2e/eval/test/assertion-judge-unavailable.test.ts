// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-judge-unavailable
// rerun: pnpm e2e --repo eval -- --run test/assertion-judge-unavailable.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

test("未配置 Judge 的 Eval 以 errored 终态完成", async () => {
  await evalE2E.case(
    "judge-unavailable",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-judge", "--rerun", "all", "--json"], {
        env: { ...process.env, OPENAI_API_KEY: "adapter-key-must-not-be-borrowed" },
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-judge-unavailable" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-judge-unavailable",
        verdict: "errored",
      });
    },
  );
});
