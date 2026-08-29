
import {
  assertExpEvalOutcomes,
  command,
  only,
  type ExpEvalOutcomeExpectation,
} from "@niceeval/testkit";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { OMP_MARKER } from "../evals/message.eval.ts";
import { withInspectionRequest } from "@niceeval/testkit";

const EXPECTED_MESSAGE_OUTCOMES = [
  { experimentId: "ci", evalId: "message", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const EXPECTED_EVENT_OUTCOMES = [
  { experimentId: "events", evalId: "events", verdict: "passed", attempts: 1, passed: 1 },
] as const satisfies readonly ExpEvalOutcomeExpectation[];

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

it("OMP adapter 从公开工厂完成 Eval 并公开读回结果 [necase_SHYVRJF4F2QQABGF]", async () => {
  await rm(".niceeval", { recursive: true, force: true });

  const messageRun = await niceeval.run(["exp", "ci", "--rerun", "all", "--json"], {
    timeoutMs: 6 * 60_000,
  });
  expect(messageRun.exitCode, messageRun.diagnostic()).toBe(0);

  const messageEvents = assertExpEvalOutcomes(
    messageRun.expEvalEvents(),
    EXPECTED_MESSAGE_OUTCOMES,
    () => messageRun.diagnostic(),
  );
  const event = only(messageEvents, (candidate) => candidate.evalId === "message");

  const eventRun = await niceeval.run(["exp", "events", "--rerun", "all", "--json"], {
    timeoutMs: 6 * 60_000,
  });
  expect(eventRun.exitCode, eventRun.diagnostic()).toBe(0);
  assertExpEvalOutcomes(eventRun.expEvalEvents(), EXPECTED_EVENT_OUTCOMES, () => eventRun.diagnostic());

  const queried = await withInspectionRequest({
    kind: "attempt.trace",
    locator: event.locator,
  }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
  expect(queried.exitCode, queried.diagnostic()).toBe(0);
  const document = queried.attemptTrace();
  expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
  expect(JSON.stringify(document.trace)).toContain(OMP_MARKER);

}, 8 * 60_000);
