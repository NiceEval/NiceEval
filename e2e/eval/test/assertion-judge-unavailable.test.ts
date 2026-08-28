// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-judge-unavailable
// rerun: pnpm e2e test --repo eval -- --run test/assertion-judge-unavailable.test.ts

import { only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAssertion, inspectAttempt } from "./inspection.ts";


test("未配置 Judge 的 Eval 以 errored 终态完成", async () => {
  await evalE2E.case(
    "judge-unavailable",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-judge", "--rerun", "all", "--json"], {
        env: { ...process.env, OPENAI_API_KEY: "adapter-key-must-not-be-borrowed" },
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.expEvalEvents(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-judge-unavailable" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-judge-unavailable",
        verdict: "errored",
      });
      const inspected = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
      expect(inspected.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.get",
        attempt: { locator: evaluation.locator, core: { outcome: "errored" } },
      });
      expect(inspected.document.attempt.assertions.state).toBe("available");
      const judge = only(
        inspected.document.attempt.assertions.entries,
        (entry) => entry.display.label === "Judge marker",
        inspected.receipt.diagnostic(),
      );
      const assertion = await inspectAssertion(
        niceeval,
        projectRoot,
        evaluation.locator!,
        judge.entryId,
      );
      expect(assertion.receipt.exitCode, assertion.receipt.diagnostic()).toBe(0);
      expect(assertion.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.assertion.detail",
        assertion: { entryId: judge.entryId },
      });
      const detail = JSON.stringify(assertion.document.assertion);
      expect(detail).toContain("judge-model-unresolved");
      expect(detail).toContain("failureDetail");
      for (const field of ["rationale", "evidence", "detail", "citations"]) {
        expect(detail).toContain(`\"label\":\"${field}\"`);
      }
      expect(detail).toContain(
        '"label":"reason","value":{"kind":"value","value":"not-recorded"}',
      );
    },
  );
});

test("配置 Judge 后的质量门只调用一次并保留 measurement artifact", async () => {
  let measurementCalls = 0;
  const provider = createServer((request, response) => {
    expect(request.method).toBe("POST");
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body) as { tools?: unknown };
      if (Array.isArray(payload.tools)) measurementCalls += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "judge-e2e-completion",
        object: "chat.completion",
        created: 0,
        model: "judge-e2e",
        choices: [{
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "judge-e2e-call",
              type: "function",
              function: {
                name: "select_choice",
                arguments: JSON.stringify({ choice: "Y", reasons: "fixture accepts marker" }),
              },
            },
            ],
          },
        }],
      }));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => provider.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve()));
    const address = provider.address();
    if (address === null || typeof address === "string") throw new Error("fake Judge did not bind a TCP port");
    await evalE2E.case("judge-measurement", {}, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-judge-fake", "--rerun", "all", "--json"], {
        env: {
          ...process.env,
          NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          NICEEVAL_E2E_JUDGE_KEY: "controlled-e2e-key",
        },
      });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evaluation = only(
        run.expEvalEvents(),
        (event) => event.event === "eval" && event.evalId === "assertion-judge-fake" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation.verdict).toBe("passed");
      const inspected = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
      expect(inspected.document.attempt.core.outcome).toBe("completed");
      expect(inspected.document.attempt.assertions.state).toBe("available");
      const judge = only(
        inspected.document.attempt.assertions.entries,
        (entry) => entry.display.label === "Judge marker",
        inspected.receipt.diagnostic(),
      );
      const assertion = await inspectAssertion(
        niceeval,
        projectRoot,
        evaluation.locator!,
        judge.entryId,
      );
      expect(assertion.receipt.exitCode, assertion.receipt.diagnostic()).toBe(0);
      expect(assertion.document.assertionId).toBe(judge.entryId);
      expect(JSON.stringify(assertion.document.assertion)).toContain("judge-measurement/v1");
      expect(measurementCalls).toBe(1);
    });
  } finally {
    if (provider.listening) {
      await new Promise<void>((resolve, reject) => provider.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }
});
