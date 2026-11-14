import { createHash } from "node:crypto";
import { readScoreMatchAudit } from "niceeval/inspection";
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
  const models: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      if (!payload.messages.some((message: { content: string }) => message.content === "Precheck.")) materials.push(payload.messages[1].content);
      models.push(payload.model);
      if (payload.model === "unknown-overflow-model") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "context_length_exceeded", message: "Maximum context length exceeded" } }));
        return;
      }
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
import { OpenAIProvider } from "niceeval/judge";
const rule = defineJudge({ rubric: "Check the retained final reply", maxMaterialBytes: 16000 });
export default defineScoreEval({ judge: OpenAIProvider({ model: "explicit-context-model", contextWindow: 1800, maxOutputTokens: 128, baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL, apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY" }), async test(t) {
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
        const call = audit.audit.calls[0]!;
        if (call.state !== "admitted" || !("request" in call)) throw new Error("Missing model call");
        expect(call.request).toContain("omittedBytes");
        expect(audit.audit.input).toContain("TAIL");
        expect(audit.audit.definition.limits).toMatchObject({ maxCalls: 4, contextWindow: 1800 });
        expect(audit.audit.input).toContain("FINAL_FIRST_INPUT");
        expect(JSON.parse(audit.audit.definition.config)).toHaveProperty("conversationMaterialRevision", 1);
      }
      expect(materials).toHaveLength(3);
      expect(materials[0]).toBe(materials[1]);
      expect(materials[2]).toContain("SECOND_INPUT");
      expect(materials[2]).toContain("FINAL_SECOND_INPUT");
      for (const material of materials) expect(Buffer.byteLength(material)).toBeLessThan(5400);

      await writeFile(join(projectRoot, "evals/context-budget.eval.ts"), `
import { Effect } from "effect";
import { defineScoreEval } from "niceeval";
import { defineJudge, defineScoreMatch } from "niceeval/expect";
import { OpenAIProvider } from "niceeval/judge";
const provider = (model: string, contextWindow?: number) => OpenAIProvider({ model, ...(contextWindow === undefined ? {} : { contextWindow }), maxOutputTokens: 128, baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL, apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY" });
const rule = defineJudge({ rubric: "Check the complete material" });
const fits = defineScoreEval({ judge: provider("explicit-large-model", 1000000), test(t) {
  t.judge({ text: "LARGE_HEAD" + "x".repeat(40000) + "LARGE_TAIL" }, rule).score(1).label("Fits");
  const audit = defineScoreMatch<string>({ name: "complete-audit", version: "1", config: {}, llm: {}, score: (material, ctx) => Effect.gen(function* () {
    for (let call = 0; call < 4; call++) yield* ctx.llm.score({ rubric: "Read all material", anchors: [{ measurement: 0, description: "no" }, { measurement: 1, description: "yes" }], material });
    return 1;
  }) });
  t.check("AUDIT_HEAD" + "x".repeat(1800000) + "AUDIT_TAIL", audit).score(1).label("Large audit");
} });
const exceeds = defineScoreEval({ judge: provider("tiny-context-model", 1000), test(t) {
  t.judge({ text: "UNSENT" + "x".repeat(40000) }, rule).score(1).label("Exceeds");
} });
const authorLimit = defineScoreEval({ judge: provider("explicit-large-model", 1000000), test(t) {
  t.judge("x".repeat(4000), defineJudge({ rubric: "Bounded", maxMaterialBytes: 1024 })).score(1).label("Author limit");
} });
const unknown = defineScoreEval({ judge: provider("unknown-overflow-model"), test(t) {
  t.judge("UNKNOWN_SENTINEL" + "x".repeat(40000), rule).score(1).label("Overflow");
} });
const catalog = defineScoreEval({ judge: provider("gpt-4o"), test(t) { t.judge("CATALOG_HEAD" + "x".repeat(40000) + "CATALOG_TAIL", rule).score(1).label("Catalog"); } });
export default { fits, exceeds, authorLimit, unknown, catalog };
`);
      await writeFile(join(projectRoot, "experiments/context-budget.ts"), `
import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";
export default defineExperiment({ evals: ["context-budget"], adapter: deterministicAgent });
`);
      const budgetRun = await niceeval.run(["exp", "context-budget", "--json"], { env: {
        ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_JUDGE_KEY: "local-fixture",
      } });
      expect(budgetRun.expReceipt().completion, budgetRun.diagnostic()).toBe("completed");
      const observed = new Set<string>();
      for (const event of budgetRun.expEvalEvents()) {
        const attempt = await inspectAttempt(niceeval, projectRoot, event.locator, "attempt.get");
        for (const entry of attempt.document.attempt.assertions.entries) {
          const label = entry.display.label!;
          observed.add(label);
          const detail = await inspectAssertion(niceeval, projectRoot, event.locator, entry.entryId);
          expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
          const audit = assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit;
          expect(audit?.state, detail.receipt.diagnostic()).toBe("available");
          if (audit?.state !== "available") throw new Error("Missing complete context budget audit");
          if (label === "Fits" || label === "Large audit" || label === "Catalog") {
            expect(audit.audit.result).toEqual({ state: "measured", value: 1 });
            expect(audit.audit.input).toContain(label === "Fits" ? "LARGE_TAIL" : label === "Catalog" ? "CATALOG_TAIL" : "AUDIT_TAIL");
            if (label === "Catalog") expect(audit.audit.definition.limits.contextWindow).toBe(128000);
            if (label === "Large audit") {
              expect(Buffer.byteLength(JSON.stringify(audit.audit))).toBeGreaterThan(8 * 1024 * 1024);
              expect(audit.audit.calls).toHaveLength(4);
              for (const call of audit.audit.calls) {
                if (call.state !== "admitted" || !("request" in call)) throw new Error("Missing large audit step");
                expect(call.request).toContain("AUDIT_TAIL");
                expect(call.attempts).toHaveLength(1);
              }
            }
          } else {
            expect(audit.audit.result).toMatchObject({ state: "unavailable", code: label === "Exceeds" ? "judge-material-exceeds-context" : label === "Overflow" ? "judge-context-overflow" : "score-match-material-budget" });
            if (label === "Exceeds") expect(JSON.stringify(audit.audit.result)).toContain("1000");
          }
        }
      }
      expect([...observed].sort()).toEqual(["Author limit", "Catalog", "Exceeds", "Fits", "Large audit", "Overflow"]);
      expect(models).not.toContain("tiny-context-model");
      expect(models.filter(model => model === "unknown-overflow-model")).toHaveLength(1);
      expect(materials.some(material => material.includes("LARGE_TAIL"))).toBe(true);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

// @feature docs/feature/judge/README.md
test.concurrent("普通 Judge 的大审计返回稳定引用并可公开分页完整读回", async () => {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "paged-audit", object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: "tool_calls", message: {
        role: "assistant", content: null, tool_calls: [{ id: "decision", type: "function", function: { name: payload.tool_choice.function.name, arguments: JSON.stringify({ measurement: 1, rationale: "Complete" }) } }],
      } }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing fixture address");
  try {
    await evalE2E.case("judge-paged-audit", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(join(projectRoot, "evals/paged-audit.eval.ts"), `
import { Effect } from "effect";
import { defineScoreEval } from "niceeval";
import { defineScoreMatch } from "niceeval/expect";
import { OpenAIProvider } from "niceeval/judge";
const audit = defineScoreMatch<string>({ name: "paged-audit", version: "1", config: {}, llm: {}, score: (material, ctx) => Effect.gen(function* () {
  for (let i = 0; i < 4; i++) yield* ctx.llm.score({ rubric: "Read all material", anchors: [{ measurement: 0, description: "no" }, { measurement: 1, description: "yes" }], material });
  return 1;
}) });
export default defineScoreEval({ judge: OpenAIProvider({ model: "large-fixture", contextWindow: 4000000, maxOutputTokens: 128, baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL, apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY" }), test(t) {
  t.check("PAGED_HEAD" + "x".repeat(7000000) + "PAGED_TAIL", audit).score(1);
} });
`);
      await writeFile(join(projectRoot, "experiments/paged-audit.ts"), `
import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";
export default defineExperiment({ evals: ["paged-audit"], adapter: deterministicAgent });
`);
      const run = await niceeval.run(["exp", "paged-audit", "--json"], { timeoutMs: 120000, env: {
        ...process.env, NICEEVAL_E2E_JUDGE_BASE_URL: `http://127.0.0.1:${address.port}/v1`, NICEEVAL_E2E_JUDGE_KEY: "fixture",
      } });
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      const event = only(run.expEvalEvents(), item => item.evalId === "paged-audit", run.diagnostic());
      const attempt = await inspectAttempt(niceeval, projectRoot, event.locator, "attempt.get");
      const detail = await inspectAssertion(niceeval, projectRoot, event.locator, only(attempt.document.attempt.assertions.entries, () => true).entryId);
      const audit = assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit;
      expect(audit?.state, detail.receipt.diagnostic()).toBe("paged");
      if (audit?.state !== "paged") throw new Error("Missing paged audit");
      expect(JSON.stringify(detail.document).length).toBeLessThan(128 * 1024);
      const reference = audit.content;
      expect(reference.byteLength).toBeGreaterThan(32 * 1024 * 1024);
      const chunks: Buffer[] = [];

      let offset = 0;
      while (true) {

        const read = await niceeval.run(["show", event.locator, reference.id, "--json"]);
        const page = read.inspectionSuccess("attempt.trace.detail").detail;
        if (page.kind !== "execution-evidence") throw new Error("Missing Assertion Content page");
        expect(page.offset).toBe(offset);
        expect(page.targetByteLength).toBe(reference.byteLength);
        expect(page.targetSha256).toBe(reference.sha256);
        const chunk = Buffer.from(page.base64, "base64");
        chunks.push(chunk);
        offset += chunk.byteLength;
        if (page.nextOffset === null) break;
        expect(page.nextOffset).toBe(offset);
      }
      const bytes = Buffer.concat(chunks);
      expect(bytes.byteLength).toBe(reference.byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(reference.sha256);
      const decoded = readScoreMatchAudit(JSON.parse(bytes.toString("utf8")), 1);
      expect(decoded.state).toBe("available");
      if (decoded.state !== "available") throw new Error("Invalid complete audit");
      expect(decoded.audit.input).toContain("PAGED_TAIL");
      expect(decoded.audit.calls).toHaveLength(4);
      for (const call of decoded.audit.calls) {
        if (call.state !== "admitted" || !("request" in call)) throw new Error("Missing admitted call");
        expect(call.request).toContain("PAGED_TAIL");
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
