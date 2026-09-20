// rerun: pnpm e2e test --repo eval -- --run test/assertion-judge-unavailable.test.ts

import { only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";


test.concurrent("未配置 Judge 的 Eval 以 errored 终态完成 [necase_N9PKV5X8PPWYPXZM]", async () => {
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
      expect(detail).toContain("judge-provider-unresolved");
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

test.concurrent("Judge 与 check 共用质量门、连续计分及完整请求留存 [necase_Z1PAQPEQGDRFSCQ0]", async () => {
  let measurementCalls = 0;
  const deliveredRequests: string[] = [];
  const provider = createServer((request, response) => {
    expect(request.method).toBe("POST");
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body) as { messages?: Array<{ content?: string }>; tools?: unknown; tool_choice: { function: { name: string } } };
      const isPrecheck = payload.messages?.some((message) => message.content === "Precheck.") ?? false;
      if (Array.isArray(payload.tools) && !isPrecheck) {
        measurementCalls += 1;
        deliveredRequests.push(body);
      }
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
                name: payload.tool_choice.function.name,
                arguments: JSON.stringify({ measurement: 0.75, rationale: "fixture accepts marker" }),
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
      expect(run.exitCode, run.diagnostic()).toBe(1);
      const evaluation = only(
        run.expEvalEvents(),
        (event) => event.event === "eval" && event.evalId === "assertion-judge-fake" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation.verdict).toBe("failed");
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
      expect(assertion.document.assertion.entryId).toBe(judge.entryId);
      expect(JSON.stringify(assertion.document.assertion)).toContain("llm-measurement/v1");
      expect(JSON.stringify(assertion.document.assertion)).toContain("niceeval.e2e.marker-quality/v1");
      expect(deliveredRequests[0]).toContain("Measure whether the reply satisfies the marker criterion.");
      expect(deliveredRequests[0]).toContain("LAST_MATERIAL_SENTINEL");
      expect(deliveredRequests[0]).not.toContain("MUTATED_AFTER_REGISTRATION");
      const detail = JSON.stringify(assertion.document.assertion);
      expect(detail).toContain("LAST_MATERIAL_SENTINEL");
      expect(detail).not.toContain("MUTATED_AFTER_REGISTRATION");
      expect(detail).toContain("fixture accepts marker");
      expect(detail).toContain("attempted");
      const retained = assertionEntry(assertion.document, assertion.receipt.diagnostic()).scoreMatchAudit;
      expect(retained?.state).toBe("available");
      if (retained?.state !== "available") throw new Error("Complete Judge material was not available");
      const call = retained.audit.calls[0]!;
      if (call.state !== "admitted") throw new Error("Judge call was not admitted");
      expect(JSON.parse(call.request)).toEqual(JSON.parse(deliveredRequests[0]!));
      expect(measurementCalls).toBe(2);
      expect(deliveredRequests.map((request) => JSON.parse(request).messages)).toEqual([
        JSON.parse(call.request).messages,
        JSON.parse(call.request).messages,
      ]);
      const checked = assertionEntry(assertion.document, assertion.receipt.diagnostic());
      expect(checked).toMatchObject({
        decision: { gate: "satisfied" },
        contribution: { state: "earned", points: 20, earned: 15 },
      });
      expect(inspected.document.attempt.assertions.entries).toHaveLength(2);
      const sugar = only(inspected.document.attempt.assertions.entries, (entry) => entry.display.label === "Judge sugar", inspected.receipt.diagnostic());
      const sugared = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, sugar.entryId);
      expect(sugared.receipt.exitCode, sugared.receipt.diagnostic()).toBe(0);
      const sugarEntry = assertionEntry(sugared.document, sugared.receipt.diagnostic());
      expect(sugarEntry).toMatchObject({
        decision: { gate: "failed" },
        contribution: { state: "earned", points: 20, earned: 15 },
        scoreMatchAudit: retained,
      });
    });
  } finally {
    if (provider.listening) {
      await new Promise<void>((resolve, reject) => provider.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }
});
