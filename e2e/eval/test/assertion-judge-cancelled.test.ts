// rerun: pnpm e2e test --repo eval -- --run test/assertion-judge-cancelled.test.ts
import { only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

test.concurrent("Attempt 取消终止 Judge 请求并保留尝试发送事实 [necase_2TCX4FPX8TA9NV88]", async () => {
  let measurementCalls = 0;
  let measurementConnectionClosed = false;
  const provider = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body) as { messages: Array<{ content: string }> };
      if (!payload.messages.some((message) => message.content === "Precheck.")) {
        measurementCalls += 1;
        response.on("close", () => { measurementConnectionClosed = true; });
        return; // The real HTTP boundary stays pending until NiceEval cancels it.
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "probe", object: "chat.completion", created: 0, model: "judge-e2e",
        choices: [{ index: 0, finish_reason: "tool_calls", message: {
          role: "assistant", content: null, tool_calls: [{ id: "decision", type: "function",
            function: { name: "record_judge_decision", arguments: JSON.stringify({ measurement: 1, rationale: "probe accepted" }) },
          }],
        } }],
      }));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1", resolve);
    });
    const address = provider.address();
    if (address === null || typeof address === "string") throw new Error("Judge provider did not bind");
    await evalE2E.case("judge-cancelled", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-judge-cancelled", "--rerun", "all", "--json"], {
        env: { ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_JUDGE_KEY: "controlled-key" },
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      const evaluation = only(run.expEvalEvents(), (event) => event.evalId === "assertion-judge-cancelled", run.diagnostic());
      expect(evaluation.verdict).toBe("errored");
      const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
      const entry = only(attempt.document.attempt.assertions.entries, (item) => item.display.label === "Pending Judge", attempt.receipt.diagnostic());
      const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
      expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
      expect(JSON.stringify(detail.document.assertion)).toContain("attempted");
      expect(JSON.stringify(detail.document.assertion)).toContain("pending-marker");
      expect(assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit).toMatchObject({
        state: "available", audit: { schemaVersion: 3, result: { state: "interrupted" },
          images: [{ mediaType: "image/png" }],
          calls: [{ state: "admitted", attempts: [{ transport: "attempted", result: { state: "interrupted" } }] }],
        },
      });
      expect(measurementCalls).toBe(1);
      expect(measurementConnectionClosed).toBe(true);
    });
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
});
