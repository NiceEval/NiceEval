// rerun: pnpm e2e test --repo eval -- --run test/assertion-judge-presets.test.ts
import { only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

// This fixture speaks only at the external model boundary. Scores, aggregation,
// gate policy, persistence and public readback are all executed by the candidate.
function providerFixture(fail: boolean) {
  const requests: Array<{ operation: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (part: string) => { body += part; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const precheck = payload.messages.some((message: { content: string }) => message.content === "Precheck.");
      const system = precheck ? {} : JSON.parse(payload.messages[0].content);
      const user = precheck ? {} : JSON.parse(payload.messages[1].content);
      const operation: string = system.operation ?? "score";
      if (!precheck) requests.push({ operation, body });
      if (fail && !precheck) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Fixture rejects model access", type: "permission_error" } }));
        return;
      }
      let decision: unknown;
      if (operation === "score") decision = { measurement: precheck ? 1 : 0.75, rationale: "Fixture clarity judgment" };
      else if (operation === "extract") decision = {
        items: ["Paris is the capital of France.", "Paris has museums.", "Paris is on Mars."],
        complete: true,
        rationale: "Three distinct claims",
      };
      else if (operation === "classify") {
        const choice = system.choices.includes("consistent") ? "incomplete" : system.choices.includes("candidate") ? "tie" : "accepted";
        decision = { choice, rationale: "Fixture classification" };
      } else if (operation === "batchClassify") {
        const supported = system.choices.includes("supported");
        decision = { items: user.items.map((item: { id: string }, index: number) => ({
          id: item.id,
          choice: supported ? (index < 2 ? "supported" : "unsupported") : (index === 0 ? "followed" : "not-followed"),
          rationale: "Fixture per-item judgment",
        })) };
      } else throw new Error(`Unexpected primitive ${operation}`);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "fixture-response", object: "chat.completion", created: 0, model: "judge-fixture",
        choices: [{ index: 0, finish_reason: "tool_calls", message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "fixture-call", type: "function", function: {
            name: payload.tool_choice.function.name, arguments: JSON.stringify(decision),
          } }],
        } }],
      }));
    });
  });
  return { server, requests };
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture has no TCP address");
  return `http://127.0.0.1:${address.port}/v1`;
}
async function close(server: ReturnType<typeof createServer>) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function environment(baseUrl: string) {
  return {
    ...process.env,
    NICEEVAL_E2E_JUDGE_BASE_URL: baseUrl,
    NICEEVAL_E2E_JUDGE_KEY: "fixture-only-key",
  };
}

test.concurrent("现成与自定义 Match 的组合分数和完整模型步骤可复核 [necase_5XSA6N7CC3VXT291]", async () => {
  const { server, requests } = providerFixture(false);
  const baseUrl = await listen(server);
  try {
    await evalE2E.case("judge-presets", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-judge-presets", "--rerun", "all", "--json"], { env: environment(baseUrl) });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt().completion).toBe("completed");
      const evaluation = only(run.expEvalEvents(), (item) => item.evalId === "assertion-judge-presets", run.diagnostic());
      expect(evaluation.verdict).toBe("failed");
      const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
      const entries = attempt.document.attempt.assertions.entries;
      expect(entries).toHaveLength(6);
      const expected = [
        ["Factuality", 0.5, 1], ["Faithfulness", 2 / 3, 2], ["Instructions", 0.5, 1],
        ["Preference", 0.5, 1], ["Quality", 0.75, 1], ["Custom", 0.8, 1],
      ] as const;
      for (const [label, measurement, calls] of expected) {
        const entry = only(entries, (item) => item.display.label === label, attempt.receipt.diagnostic());
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        const audit = assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit;
        expect(audit).toMatchObject({ state: "available", audit: { result: { state: "measured", value: measurement } } });
        const serialized = JSON.stringify(audit);
        expect(serialized).not.toContain("fixture-only-key");
        expect(serialized).not.toContain("MUTATED_AFTER_CHECK");
        expect(audit).toHaveProperty("audit.calls.length", calls);
      }
      expect(requests).toHaveLength(7);
      expect(requests.map((item) => item.operation).sort()).toEqual(["batchClassify", "batchClassify", "classify", "classify", "classify", "extract", "score"]);
      expect(requests.find((item) => item.body.includes("ORIGINAL_CUSTOM_MARKER"))).toBeDefined();
    });
  } finally { await close(server); }
});

test.concurrent("自定义 Match 捕获必要模型调用失败不能伪造正常成绩 [necase_Z0M6G2QTCQAW4BGN]", async () => {
  const { server, requests } = providerFixture(true);
  const baseUrl = await listen(server);
  try {
    await evalE2E.case("managed-match-failure", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-managed-failure", "--rerun", "all", "--json"], { env: environment(baseUrl) });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      const evaluation = only(run.expEvalEvents(), (item) => item.evalId === "assertion-managed-failure", run.diagnostic());
      expect(evaluation.verdict).toBe("errored");
      const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      const entry = only(attempt.document.attempt.assertions.entries, () => true, attempt.receipt.diagnostic());
      const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
      expect(assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit).toMatchObject({
        state: "available", audit: { result: { state: "unavailable" } },
      });
      expect(requests).toHaveLength(1);
    });
  } finally { await close(server); }
});
