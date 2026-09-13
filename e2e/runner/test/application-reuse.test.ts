// rerun: pnpm e2e test --repo runner -- --run test/application-reuse.test.ts
import { only } from "@niceeval/testkit";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @concord-case necase_8J57CW0JYVWA8NZ4
// @concord-owner docs/engineering/testing/e2e/runner.md#runner-carry-partial-reuse
// @concord-test-file e2e/runner/test/application-reuse.test.ts
test.concurrent("Adapter 未声明行为版本时重新执行，版本稳定才允许 carry [necase_8J57CW0JYVWA8NZ4]", async () => {
  await runnerE2E.case("application-reuse", {
    artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }],
  }, async ({ commands: { niceeval } }) => {
    const unversioned = { env: { NICEEVAL_E2E_ADAPTER_REVISION: "" } };
    const first = await niceeval.run(["exp", "native-reuse", "--json"], unversioned);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    const firstEvaluation = only(first.expEvalEvents(), (event) => event.evalId === "native-reuse", first.diagnostic());
    expect(firstEvaluation).toMatchObject({ verdict: "passed", passed: 1 });

    const noRevisionPlan = await niceeval.run(["exp", "native-reuse", "--dry", "--json"], unversioned);
    expect(noRevisionPlan.exitCode, noRevisionPlan.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(noRevisionPlan.json<unknown>())).toMatchObject({ total: 1, reused: 0 });
    const second = await niceeval.run(["exp", "native-reuse", "--json"], unversioned);
    expect(second.exitCode, second.diagnostic()).toBe(0);
    const secondEvaluation = only(second.expEvalEvents(), (event) => event.evalId === "native-reuse", second.diagnostic());
    expect(secondEvaluation).toMatchObject({ verdict: "passed", passed: 1 });
    expect(secondEvaluation.locator).not.toBe(firstEvaluation.locator);
    expect(only(second.expEvents(), (event) => event.event === "start", second.diagnostic())).toMatchObject({ reused: 0 });

    const versionOne = { env: { NICEEVAL_E2E_ADAPTER_REVISION: "1" } };
    const versioned = await niceeval.run(["exp", "native-reuse", "--json"], versionOne);
    expect(versioned.exitCode, versioned.diagnostic()).toBe(0);
    const stable = await niceeval.run(["exp", "native-reuse", "--dry", "--json"], versionOne);
    expect(stable.exitCode, stable.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(stable.json<unknown>())).toMatchObject({ total: 1, reused: 1 });
    const carried = await niceeval.run(["exp", "native-reuse", "--json"], versionOne);
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    expect(only(carried.expEvents(), (event) => event.event === "start", carried.diagnostic())).toMatchObject({ reused: 1 });

    // Only the declared remote-behavior revision changes; project source stays identical.
    const revised = await niceeval.run(["exp", "native-reuse", "--dry", "--json"], {
      env: { NICEEVAL_E2E_ADAPTER_REVISION: "2" },
    });
    expect(revised.exitCode, revised.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(revised.json<unknown>())).toMatchObject({ total: 1, reused: 0 });
  });
});
