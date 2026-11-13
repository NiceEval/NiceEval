import { only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

// @use-case docs/feature/judge/use-case/binary-criteria.md
test.concurrent("二值裁判只给零分或满分，非法输出与服务故障保留不可用依据", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const precheck = payload.messages.some((message: { content: string }) => message.content === "Precheck.");
      const material = precheck ? {} : JSON.parse(payload.messages[1].content).material;
      if (!precheck) requests.push(body);
      if (material.result === "provider-failure") {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Fixture access denied", type: "permission_error" } }));
        return;
      }
      const decision = precheck ? { measurement: 1, rationale: "Precheck accepted" }
        : { choice: material.result, rationale: `Fixture chose ${material.result}` };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "binary-fixture", object: "chat.completion", created: 0, model: "judge-fixture",
        choices: [{ index: 0, finish_reason: "tool_calls", message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "binary-call", type: "function", function: {
            name: payload.tool_choice.function.name, arguments: JSON.stringify(decision),
          } }],
        } }],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing fixture address");
  try {
    await evalE2E.case("binary-judge", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(join(projectRoot, "evals/binary.eval.ts"), `
import { defineScoreEval } from "niceeval";
import { binaryJudge } from "niceeval/expect";
const rule = binaryJudge({ name: "binary-rule", rubric: "Select satisfied exactly when the requirement is met." });
let anchorsRejected = false;
try { binaryJudge({ name: "bad", rubric: "Reject anchors", anchors: [] }); } catch (error) { anchorsRejected = String(error).includes("anchors"); }
if (!anchorsRejected) throw new Error("binaryJudge must reject anchors");
export default defineScoreEval({ async test(t) {
  t.judge({ result: "satisfied" }, rule).gate(1).score(2).label("Satisfied");
  t.judge({ result: "not-satisfied" }, rule).score(3).gate(1).label("Not satisfied");
  t.judge({ result: "invalid-choice" }, rule).score(5).label("Invalid output");
  t.judge({ result: "provider-failure" }, rule).score(7).label("Provider failure");
} });
`);
      await writeFile(join(projectRoot, "experiments/binary.ts"), `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ["binary"], adapter: defineAgent({ name: "binary-fixture", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });
`);
      const run = await niceeval.run(["exp", "binary", "--json"], { env: {
        ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_JUDGE_KEY: "binary-fixture-key",
      } });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const event = only(run.expEvalEvents(), (item) => item.evalId === "binary", run.diagnostic());
      const attempt = await inspectAttempt(niceeval, projectRoot, event.locator, "attempt.get");
      expect(attempt.document.attempt.score.state).not.toBe("complete");
      expect(attempt.document.attempt.assertions.entries).toHaveLength(4);
      const digests = new Set<string>();
      for (const [label, value] of [["Satisfied", 1], ["Not satisfied", 0], ["Invalid output", null], ["Provider failure", null]] as const) {
        const entry = only(attempt.document.attempt.assertions.entries, (item) => item.display.label === label);
        const detail = await inspectAssertion(niceeval, projectRoot, event.locator, entry.entryId);
        const recorded = assertionEntry(detail.document, detail.receipt.diagnostic());
        const audit = recorded.scoreMatchAudit;
        expect(audit?.state, detail.receipt.diagnostic()).toBe("available");
        if (audit?.state !== "available") throw new Error("Missing binary audit");
        digests.add(audit.audit.definition.digest);
        expect(JSON.parse(audit.audit.definition.config)).toMatchObject({ algorithm: "binary-classification", revision: 1, scores: { satisfied: 1, "not-satisfied": 0 } });
        expect(audit.audit.calls).toHaveLength(1);
        expect(audit.audit.calls[0]?.operation).toBe("classify");
        if (value === null) {
          expect(audit.audit.result.state).not.toBe("measured");
          expect(recorded).not.toMatchObject({ contribution: { earned: 0 } });
        } else {
          expect(audit.audit.result).toMatchObject({ state: "measured", value });
          expect(JSON.stringify(audit.audit.calls)).toContain(value === 1 ? "satisfied" : "not-satisfied");
          expect(JSON.stringify(recorded)).toContain(`Fixture chose ${value === 1 ? "satisfied" : "not-satisfied"}`);
        }
      }
      expect(digests.size).toBe(1);
      expect(requests).toHaveLength(4);
      for (const body of requests) {
        expect(JSON.parse(JSON.parse(body).messages[0].content)).toMatchObject({ operation: "classify", choices: ["satisfied", "not-satisfied"] });
        expect(body).not.toContain("anchors");
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
