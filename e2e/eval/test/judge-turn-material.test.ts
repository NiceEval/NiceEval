import { only } from "@niceeval/testkit";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertion, inspectAttempt } from "./inspection.ts";

// @feature docs/feature/judge/README.md
test.concurrent("Turn 和 Session 材料保留 partial 与回复，确定性裁剪大工具输出后仍可评分", async () => {
  const materials: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      if (!payload.messages.some((message: { content: string }) => message.content === "Precheck.")) materials.push(payload.messages[1].content);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "turn-material", object: "chat.completion", created: 0, model: "judge-fixture", choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null, tool_calls: [{ id: "decision", type: "function", function: { name: payload.tool_choice.function.name, arguments: JSON.stringify({ measurement: 1, rationale: "Observed retained final reply" }) } }],
      } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing fixture address");
  try {
    await evalE2E.case("judge-turn-material", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(join(projectRoot, "evals/turn-material.eval.ts"), `
import { defineScoreEval } from "niceeval";
import { defineJudge } from "niceeval/expect";
const rule = defineJudge({ name: "turn-material", rubric: "Check the retained final reply", maxMaterialBytes: 1800 });
export default defineScoreEval({ async test(t) {
  const session = t.newSession();
  const first = await session.send("FIRST_INPUT");
  t.judge({ nested: [first] }, rule).score(1).label("First");
  t.judge({ nested: [first] }, rule).score(1).label("Same");
  await session.send("SECOND_INPUT");
  t.judge(session, rule).score(1).label("Session");
} });
`);
      await writeFile(join(projectRoot, "experiments/turn-material.ts"), `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ["turn-material"], adapter: defineAgent({ name: "conversation-fixture", evidenceCoverage: completeEvidenceCoverage, send: async (input) => ({
  status: "completed", evidenceCoverage: { messages: { status: "partial", reason: "adapter-history-partial" } }, events: [
    { type: "message", role: "assistant", text: "I will read the source" },
    { type: "operation.started", operationId: input.text, operation: { kind: "tool", name: "read", input: { path: "source" } } },
    { type: "operation.finished", operationId: input.text, kind: "tool", status: "completed", output: "HEAD" + "字".repeat(30000) + "TAIL" },
    { type: "message", role: "assistant", text: "FINAL_" + input.text },
  ]
}) }) });
`);
      const run = await niceeval.run(["exp", "turn-material", "--json"], { env: {
        ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_JUDGE_KEY: "local-fixture",
      } });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const event = only(run.expEvalEvents(), item => item.evalId === "turn-material", run.diagnostic());
      const attempt = await inspectAttempt(niceeval, projectRoot, event.locator, "attempt.get");
      expect(attempt.document.attempt.assertions.entries).toHaveLength(3);
      for (const entry of attempt.document.attempt.assertions.entries) {
        const detail = await inspectAssertion(niceeval, projectRoot, event.locator, entry.entryId);
        const recorded = assertionEntry(detail.document, detail.receipt.diagnostic());
        const audit = recorded.scoreMatchAudit;
        expect(audit?.state, detail.receipt.diagnostic()).toBe("available");
        if (audit?.state !== "available") throw new Error("Missing audit");
        expect(audit.audit.result).toEqual({ state: "measured", value: 1 });
        expect(audit.audit.input).toContain("adapter-history-partial");
        expect(audit.audit.input).toContain("omittedBytes");
        expect(audit.audit.input).toContain("FINAL_FIRST_INPUT");
        expect(JSON.parse(audit.audit.definition.config)).toHaveProperty("conversationMaterialRevision", 1);
      }
      expect(materials).toHaveLength(3);
      expect(materials[0]).toBe(materials[1]);
      expect(materials[2]).toContain("SECOND_INPUT");
      expect(materials[2]).toContain("FINAL_SECOND_INPUT");
      for (const material of materials) expect(Buffer.byteLength(material)).toBeLessThanOrEqual(1800);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
