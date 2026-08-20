// owner: docs/engineering/testing/e2e/adapter/deepseek-harness.md#adapter-deepseek-harness-target-compatibility

import {
  assertExpEvalOutcomes,
  command,
  only,
  type ExpEvalOutcomeExpectation,
} from "@niceeval/testkit";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEEPSEEK_HARNESS_MARKER } from "../evals/message.eval.ts";

const EXPECTED_OUTCOMES = [
  { experimentId: "ci", evalId: "message", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

it("DeepSeek Harness adapter 从公开工厂完成 Eval 并公开读回结果", async () => {
  await rm(".niceeval", { recursive: true, force: true });

  const run = await niceeval.run(["exp", "ci", "--rerun", "all", "--json"], {
    timeoutMs: 6 * 60_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);

  const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED_OUTCOMES, () => run.diagnostic());
  const event = only(events, (candidate) => candidate.evalId === "message");

  const execution = await niceeval.run(["show", event.locator, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain(DEEPSEEK_HARNESS_MARKER);

}, 8 * 60_000);
