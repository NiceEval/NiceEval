// rerun: pnpm e2e test --repo eval -- --run test/assertion-judge-admission.test.ts
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAttempt } from "./inspection.ts";

test.concurrent("非法 Judge 材料与伪造 Match不登记 Assertion 或读取 accessor [necase_6GBMVA7DWNRGH4HV]", async () => {
  await evalE2E.case("judge-admission", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "assertion-judge-admission", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const evaluation = only(run.expEvalEvents(), (event) => event.evalId === "assertion-judge-admission", run.diagnostic());
    expect(evaluation.verdict).toBe("passed");
    const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
    expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
    expect(attempt.document.attempt.assertions.state).toBe("available");
    expect(attempt.document.attempt.assertions.entries.map(({ display }) => display.label)).toEqual(["Judge admission is atomic"]);
  });
});
