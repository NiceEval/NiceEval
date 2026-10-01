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
        const question = user.material.question ?? "";
        const choice = system.choices.includes("satisfied")
          ? question.startsWith("ACCEPT:") ? "satisfied" : question.startsWith("REJECT:") ? "not-satisfied" : "insufficient-evidence"
          : system.choices.includes("consistent") ? "incomplete" : system.choices.includes("candidate") ? "tie" : "accepted";
        decision = { choice, rationale: "Fixture classification", ...(system.evidenceIds === undefined ? {} : { citations: [system.evidenceIds[0]] }) };
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

// @use-case docs/feature/judge/use-case/inspect-judge-score.md
test.concurrent("现成与自定义 Match 的组合分数和完整模型步骤可复核", async () => {
  const { server, requests } = providerFixture(false);
  const baseUrl = await listen(server);
  try {
    await evalE2E.case("judge-presets", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-judge-presets", "--rerun", "all", "--json"], { env: environment(baseUrl) });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt().completion).toBe("completed");
      const evaluation = only(run.expEvalEvents(), (item) => item.evalId === "assertion-judge-presets", run.diagnostic());
      const attempt = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
      expect(evaluation.verdict, JSON.stringify(attempt.document)).toBe("failed");
      const entries = attempt.document.attempt.assertions.entries;
      expect(entries).toHaveLength(23);
      const expected = [
        ["Factuality", 0.5, 1], ["Faithfulness", 2 / 3, 2], ["Instructions", 0.5, 1],
        ["Preference", 0.5, 1], ["Quality", 0.75, 1], ["Custom", 0.8, 1],
        ["Material QA accepted", 1, 1], ["Material QA rejected", 0, 1], ["Whole operations", 1, 1], ["Whole dialogue", 1, 1],
      ] as const;
      for (const [label, measurement, calls] of expected) {
        const entry = only(entries, (item) => item.display.label === label, attempt.receipt.diagnostic());
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        const detailEntry = assertionEntry(detail.document, detail.receipt.diagnostic());
        expect(detail.document.assertion.sourceSites.filter(({ role }) => role === "declaration")).toHaveLength(1);
        const audit = detailEntry.scoreMatchAudit;
        expect(audit).toMatchObject({ state: "available", audit: { result: { state: "measured", value: measurement } } });
        const serialized = JSON.stringify(audit);
        expect(serialized).not.toContain("fixture-only-key");
        expect(serialized).not.toContain("MUTATED_AFTER_CHECK");
        expect(audit).toHaveProperty("audit.calls.length", calls);
      }
      expect(requests).toHaveLength(12);
      expect(requests.every(({ body }) => JSON.parse(body).model === "judge-eval-override")).toBe(true);
      expect(requests.map((item) => item.operation).sort()).toEqual(["batchClassify", "batchClassify", "classify", "classify", "classify", "classify", "classify", "classify", "classify", "classify", "extract", "score"]);
      expect(requests.find((item) => item.body.includes("ORIGINAL_CUSTOM_MARKER"))).toBeDefined();
      for (const label of ["Material QA unknown"]) {
        const entry = only(entries, (item) => item.display.label === label, attempt.receipt.diagnostic());
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
        expect(assertionEntry(detail.document, detail.receipt.diagnostic()).scoreMatchAudit)
          .toMatchObject({ state: "available", audit: { result: { state: "unavailable" } } });
      }

      for (const label of ["Material QA tiny audit", "Material QA empty", "Material QA partial", "Material QA over capacity", "Material QA predicate unknown", "Material QA non JSON"]) {
        const entry = only(entries, (item) => item.display.label === label);
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        const serialized = JSON.stringify(detail.document);
        expect(serialized).not.toContain('"scoreMatchAudit":{"state":"invalid"}');
        if (label === "Material QA tiny audit") expect(serialized).toContain("score-match-audit-budget");
        expect(serialized).toContain(label === "Material QA empty" ? '"value":0' : '"state":"unavailable"');
      }
      const accepted = requests.find(({ body }) => body.includes("ACCEPT: do all"))!;
      const acceptedMaterial = JSON.parse(JSON.parse(accepted.body).messages[1].content).material;
      expect(acceptedMaterial.items.map((item: { id: string }) => item.id)).toEqual(["event-1", "event-3", "event-4"]);
      expect(acceptedMaterial.items.map((item: { value: { text: string } }) => item.value.text))
        .toEqual(["FIRST_ORIGINAL", "DISCARDED_ORIGINAL", "LAST_ORIGINAL"]);
      expect(acceptedMaterial.items[1].value.adopted).toBe(false);
      expect(JSON.stringify(requests)).not.toContain("MUTATED_HISTORY");
      const rejected = requests.find(({ body }) => body.includes("REJECT: is every"))!;
      const speechMaterial = JSON.parse(JSON.parse(rejected.body).messages[1].content).material;
      expect(speechMaterial.items.map((item: { id: string }) => item.id)).toEqual(["event-1", "event-4"]);
      const acceptedEntry = only(entries, (item) => item.display.label === "Material QA accepted", attempt.receipt.diagnostic());
      const acceptedDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, acceptedEntry.entryId);
      expect(JSON.stringify(acceptedDetail.document)).toContain("event-1");

      for (const [label, marker, count] of [["Whole operations", "ORIGINAL_OPERATION_", 1000], ["Whole dialogue", "ORIGINAL_DIALOGUE_", 360]] as const) {
        const request = only(requests, ({ body }) => body.includes(marker + "0:"));
        const material = JSON.parse(JSON.parse(request.body).messages[1].content).material;
        expect(material.items).toHaveLength(count);
        expect(material.items.map((item: { value: { sequence: number } }) => item.value.sequence)).toEqual(Array.from({ length: count }, (_, index) => index));
        const entry = only(entries, (item) => item.display.label === label);
        const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        const text = JSON.stringify(detail.document);
        expect(text).toContain(marker + String(count - 1));
        expect(text).not.toContain("inspection-result-byte-limit");
        expect(assertionEntry(detail.document, detail.receipt.diagnostic()).materials.coverage).toEqual({ state: "complete" });
      }
      const witness = only(entries, (item) => item.display.label === "Capacity known witness");
      const absence = only(entries, (item) => item.display.label === "Capacity unknown absence");
      const witnessDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, witness.entryId);
      const absenceDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, absence.entryId);
      expect(assertionEntry(witnessDetail.document, witnessDetail.receipt.diagnostic()).decision.result).toBe("matched");
      expect(JSON.stringify(absenceDetail.document)).toContain("source-item-limit");
      expect(JSON.stringify(absenceDetail.document)).toContain("capacity-limited");
      const scalar = only(entries, (item) => item.display.label === "Context fact score");
      const scalarDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, scalar.entryId);
      expect(JSON.stringify(scalarDetail.document)).not.toContain("ORIGINAL_OPERATION_");
      expect(JSON.stringify(scalarDetail.document)).toContain("0.6");
      const unknownScalar = only(entries, (item) => item.display.label === "Context unknown score");
      const unknownScalarDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, unknownScalar.entryId);
      expect(JSON.stringify(unknownScalarDetail.document)).toContain("business-boundary-missing");
      const exists = only(entries, (item) => item.display.label === "Material existence", attempt.receipt.diagnostic());
      const split = only(entries, (item) => item.display.label === "Same event conjunction", attempt.receipt.diagnostic());
      const existsDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, exists.entryId);
      const splitDetail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, split.entryId);
      expect(assertionEntry(existsDetail.document, existsDetail.receipt.diagnostic()).decision.result).toBe("matched");
      expect(assertionEntry(splitDetail.document, splitDetail.receipt.diagnostic()).decision.result).toBe("mismatched");

      // Preserve the Adapter's twelve requests; Agent QA owns a separate slice.
      const adapterRequests = requests.slice();
      const agentRun = await niceeval.run(["exp", "assertion-agent-qa", "--rerun", "all", "--json"], { env: environment(baseUrl) });
      expect(agentRun.exitCode, agentRun.diagnostic()).toBe(0);
      expect(agentRun.expReceipt().completion).toBe("completed");
      const agentEvaluation = only(agentRun.expEvalEvents(), (item) => item.evalId === "assertion-agent-qa", agentRun.diagnostic());
      expect(agentEvaluation).toMatchObject({ experimentId: "assertion-agent-qa", verdict: "passed", attempts: 1, passed: 1 });
      const agentAttempt = await inspectAttempt(niceeval, projectRoot, agentEvaluation.locator!, "attempt.get");
      expect(agentAttempt.receipt.exitCode, agentAttempt.receipt.diagnostic()).toBe(0);
      const agentEntries = agentAttempt.document.attempt.assertions.entries;
      const qaExpectations = [
        ["Agent QA turn", "ACCEPT: first turn history"],
        ["Agent QA session snapshot", "ACCEPT: main session before second send"],
        ["Agent QA detached turn", "ACCEPT: detached first turn history"],
        ["Agent QA session", "ACCEPT: both main session turns"],
        ["Agent QA attempt", "ACCEPT: all main and branch history"],
        ["Agent QA assistant events", "ACCEPT: all assistant messages"],
        ["Agent QA branch tools", "ACCEPT: all branch tool calls"],
      ] as const;
      const localLabels = [
        "Agent QA no tools",
        "Agent QA attempt rejects usedNoTools Match",
        "Agent QA session rejects usedNoTools Match",
        "Agent QA turn rejects usedNoTools Match",
      ] as const;
      expect(agentEntries.map((item) => item.display.label)).toEqual([
        "Agent QA empty", ...qaExpectations.map(([label]) => label), ...localLabels,
      ]);
      expect(new Set(agentEntries.map((item) => item.entryId)).size).toBe(12);
      const agentRequests = requests.slice(adapterRequests.length);
      expect(requests.slice(0, adapterRequests.length)).toEqual(adapterRequests);
      expect(adapterRequests).toHaveLength(12);
      expect(agentRequests).toHaveLength(7);
      const agentUsage = await inspectAttempt(niceeval, projectRoot, agentEvaluation.locator!, "attempt.usage");
      expect(agentUsage.receipt.exitCode, agentUsage.receipt.diagnostic()).toBe(0);
      const agentLedger = agentUsage.document.usage.judgeUsage;
      expect(agentLedger.state).toBe("complete");
      if (agentLedger.state !== "complete") throw new Error("Missing Agent Judge physical ledger");
      expect(agentLedger.calls).toHaveLength(7);
      expect(agentLedger.totals.requests).toMatchObject({ state: "available", value: 7 });
      expect(agentLedger.calls.every((call) => call.status === "succeeded" && call.operation === "classify")).toBe(true);
      expect(agentLedger.calls.map((call) => only(agentEntries, (entry) => entry.entryId === call.entryId).display.label)).toEqual(qaExpectations.map(([label]) => label));

      expect(agentRequests.every(({ operation, body }) => operation === "classify" && JSON.parse(body).model === "judge-eval-override")).toBe(true);

      for (const [label, question] of qaExpectations) {
        const entry = only(agentEntries, (item) => item.display.label === label, agentAttempt.receipt.diagnostic());
        const detail = await inspectAssertion(niceeval, projectRoot, agentEvaluation.locator!, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        expect(detail.document.assertion.sourceSites.filter(({ role }) => role === "declaration")).toHaveLength(1);
        const recorded = assertionEntry(detail.document, detail.receipt.diagnostic());
        expect(recorded.materials.coverage).toEqual({ state: "complete" });
        const retained = recorded.scoreMatchAudit;
        expect(retained).toMatchObject({ state: "available", audit: { result: { state: "measured", value: 1 } } });
        if (retained?.state !== "available") throw new Error(`Missing complete QA audit: ${label}`);
        expect(retained.audit.calls).toHaveLength(1);
        const call = retained.audit.calls[0]!;
        expect(call).toMatchObject({ operation: "classify", state: "admitted", result: { state: "completed" } });
        if (call.state !== "admitted" || call.result.state !== "completed") throw new Error(`Missing completed QA call: ${label}`);
        expect(call.attempts).toHaveLength(1);
        expect(call.attempts[0]).toMatchObject({ ordinal: 1, transport: "attempted", result: { state: "returned" } });
        const request = only(agentRequests, ({ body }) => JSON.parse(JSON.parse(body).messages[1].content).material.question === question);
        const payload = JSON.parse(request.body);
        const selected = JSON.parse(payload.messages[1].content).material;
        const recordedPayload = JSON.parse("request" in call ? call.request : call.requestTemplate);
        expect(JSON.parse(recordedPayload.messages[1].content).material).toEqual(selected);
        const ids: string[] = [];
        for (const item of selected.items) {
          expect(item.id).toEqual(expect.any(String));
          expect(item.id.length).toBeGreaterThan(0);
          ids.push(item.id);
        }
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
        expect(JSON.parse(payload.messages[0].content).evidenceIds).toEqual(ids);
        expect(JSON.parse(call.result.output)).toEqual({ choice: "satisfied", rationale: "Fixture classification", citations: [ids[0]] });
        const auditText = JSON.stringify(retained.audit);
        for (const id of ids) expect(auditText).toContain(id);
        expect(auditText).not.toContain("fixture-only-key");
        expect(auditText).not.toContain("inspection-result-byte-limit");
        expect(auditText).not.toContain("assertion-values-marker");
        const materialText = JSON.stringify(selected.items);
        const first = materialText.indexOf("context-main-first");
        const second = materialText.indexOf("context-main-second");
        const branch = materialText.indexOf("context-branch-only");
        if (label === "Agent QA branch tools") {
          expect(selected.items).toHaveLength(2);
          for (const item of selected.items) {
            const text = JSON.stringify(item.value);
            expect(text).toContain("context_branch");
            expect(text).toContain('"session":"branch"');
            expect(text).toContain('"turn":"first"');
            expect(text).toContain('"marker":"context-branch-only"');
            expect(text).toContain("completed");
          }
          expect(first).toBe(-1);
          expect(second).toBe(-1);
        } else {
          expect(first).toBeGreaterThanOrEqual(0);
          if (["Agent QA turn", "Agent QA session snapshot", "Agent QA detached turn"].includes(label)) {
            expect(second).toBe(-1);
            expect(branch).toBe(-1);
          } else {
            expect(second).toBeGreaterThan(first);
            if (label === "Agent QA session") expect(branch).toBe(-1);
            else expect(branch).toBeGreaterThan(second);
          }
          if (label === "Agent QA assistant events") {
            expect(selected.items).toHaveLength(4);
            const markers = ["context-main-first", "context-main-second", "context-branch-only", "context-branch-only"];
            for (let index = 0; index < markers.length; index++) expect(JSON.stringify(selected.items[index].value)).toContain(markers[index]);
            for (const item of selected.items) expect(JSON.stringify(item.value)).toContain('"role":"assistant"');
            expect(materialText).not.toContain('"role":"user"');
            expect(materialText).not.toContain("context/main-first");
            expect(materialText).not.toContain("context_main");
            expect(materialText).not.toContain("context_branch");
          } else {
            expect(materialText).toContain('"role":"user"');
            expect(materialText).toContain('"role":"assistant"');
            expect(materialText).toContain("context/main-first");
            expect(materialText).toContain("context_main");
            expect(materialText).toContain('"turn":"first"');
            expect(materialText).toContain('"marker":"context-main-first"');
            expect(materialText).toContain("completed");
            if (second !== -1) {
              expect(materialText).toContain("context/main-second");
              expect(materialText).toContain('"turn":"second"');
            }
            if (branch !== -1) expect(materialText).toContain("context/branch");
          }
        }
      }

      // Identity and order of the captured first turn survive later session sends.
      const firstRequest = only(agentRequests, ({ body }) => body.includes("ACCEPT: first turn history"));
      const firstItems = JSON.parse(JSON.parse(firstRequest.body).messages[1].content).material.items;
      for (const question of ["ACCEPT: main session before second send", "ACCEPT: detached first turn history"]) {
        const request = only(agentRequests, ({ body }) => body.includes(question));
        expect(JSON.parse(JSON.parse(request.body).messages[1].content).material.items).toEqual(firstItems);
      }
      const sessionRequest = only(agentRequests, ({ body }) => body.includes("ACCEPT: both main session turns"));
      const sessionItems = JSON.parse(JSON.parse(sessionRequest.body).messages[1].content).material.items;
      expect(sessionItems.slice(0, firstItems.length)).toEqual(firstItems);
      const rootRequest = only(agentRequests, ({ body }) => body.includes("ACCEPT: all main and branch history"));
      const rootItems = JSON.parse(JSON.parse(rootRequest.body).messages[1].content).material.items;
      expect(rootItems.slice(0, sessionItems.length)).toEqual(sessionItems);
      const assistantRequest = only(agentRequests, ({ body }) => body.includes("ACCEPT: all assistant messages"));
      const assistantItems = JSON.parse(JSON.parse(assistantRequest.body).messages[1].content).material.items;
      const rootIds: string[] = [];
      for (const item of rootItems) rootIds.push(item.id);
      for (const item of assistantItems) expect(rootIds).toContain(item.id);
      const toolRequest = only(agentRequests, ({ body }) => body.includes("ACCEPT: all branch tool calls"));
      const toolItems = JSON.parse(JSON.parse(toolRequest.body).messages[1].content).material.items;
      for (const item of toolItems) expect(JSON.stringify(rootItems)).toContain(item.id);

      for (const label of ["Agent QA empty", ...localLabels]) {
        const entry = only(agentEntries, (item) => item.display.label === label);
        const detail = await inspectAssertion(niceeval, projectRoot, agentEvaluation.locator!, entry.entryId);
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        const recorded = assertionEntry(detail.document, detail.receipt.diagnostic());
        expect(detail.document.assertion.sourceSites.filter(({ role }) => role === "declaration")).toHaveLength(1);
        expect(JSON.stringify(detail.document)).not.toContain('"state":"invalid"');
        if (label === "Agent QA empty") {
          expect(JSON.stringify(recorded.evaluation.observed)).toContain('"value":0');
          expect(recorded.scoreMatchAudit).toBeUndefined();
          expect(agentRequests.some(({ body }) => body.includes("ACCEPT: empty attempt history"))).toBe(false);
        } else {
          expect(recorded.decision.result).toBe("matched");
          expect(recorded.scoreMatchAudit).toBeUndefined();
        }
      }
      expect(requests).toHaveLength(19);

      const previousRequests = requests.slice();
      const boundaryRun = await niceeval.run(["exp", "assertion-agent-history-boundaries", "--rerun", "all", "--json"], { env: environment(baseUrl) });
      let boundaryDiagnostic = boundaryRun.diagnostic();
      if (boundaryRun.exitCode !== 0) {
        for (const evaluation of boundaryRun.expEvalEvents().filter(event => event.verdict === "errored" && event.locator !== undefined)) {
          const failed = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
          for (const entry of failed.document.attempt.assertions.entries.filter(item => item.display.label === "Boundary cross A")) {
            const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
            boundaryDiagnostic += `\n${JSON.stringify(detail.document)}`;
          }
        }
      }
      expect(boundaryRun.exitCode, boundaryDiagnostic).toBe(0);
      expect(boundaryRun.expReceipt().completion).toBe("completed");
      const boundaryEvaluations = boundaryRun.expEvalEvents();
      expect(boundaryEvaluations.map((item) => item.evalId).sort()).toEqual([
        "assertion-agent-history-boundaries/actions", "assertion-agent-history-boundaries/ambiguous",
        "assertion-agent-history-boundaries/crossTurn", "assertion-agent-history-boundaries/events",
        "assertion-agent-history-boundaries/failure", "assertion-agent-history-boundaries/messages",
        "assertion-agent-history-boundaries/metrics", "assertion-agent-history-boundaries/orphan",
        "assertion-agent-history-boundaries/truncated",
      ]);
      const boundaryRequests = requests.slice(previousRequests.length);
      expect(requests.slice(0, previousRequests.length)).toEqual(previousRequests);
      expect(boundaryRequests).toHaveLength(6);
      expect(boundaryRequests.every(({ operation, body }) => operation === "classify" && JSON.parse(body).model === "judge-eval-override")).toBe(true);
      const boundaryQuestions = [
        "ACCEPT: partial metrics turn history", "ACCEPT: partial metrics session history", "ACCEPT: partial metrics root history",
        "ACCEPT: cross A cut after B", "ACCEPT: cross B joined input and output", "ACCEPT: cross whole session history",
      ];
      expect(boundaryRequests.map(({ body }) => JSON.parse(JSON.parse(body).messages[1].content).material.question).sort())
        .toEqual(boundaryQuestions.slice().sort());
      let boundaryEntryCount = 0;
      let boundaryCallCount = 0;
      for (const evaluation of boundaryEvaluations) {
        expect(evaluation).toMatchObject({ experimentId: "assertion-agent-history-boundaries", verdict: "passed", attempts: 1, passed: 1 });
        const inspected = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
        expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
        const entries = inspected.document.attempt.assertions.entries;
        const scenario = evaluation.evalId.slice("assertion-agent-history-boundaries/".length);
        const labels = scenario === "crossTurn" ? ["Boundary cross A", "Boundary cross B", "Boundary cross session"]
          : scenario === "failure" ? ["Boundary SendFailure caught", "Boundary failure session", "Boundary failure root"]
          : [`Boundary ${scenario} turn`, `Boundary ${scenario} session`, `Boundary ${scenario} root`];
        expect(entries.map((item) => item.display.label)).toEqual(labels);
        expect(new Set(entries.map((item) => item.entryId)).size).toBe(3);
        boundaryEntryCount += entries.length;
        const retainedSources = new Map<string, string>();
        for (const entry of entries) {
          const detail = await inspectAssertion(niceeval, projectRoot, evaluation.locator!, entry.entryId);
          expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
          expect(detail.document.assertion.sourceSites.filter(({ role }) => role === "declaration")).toHaveLength(1);
          const recorded = assertionEntry(detail.document, detail.receipt.diagnostic());
          expect(JSON.stringify(detail.document)).not.toContain('"state":"invalid"');
          const label = entry.display.label!;
          if (label === "Boundary SendFailure caught") {
            expect(recorded.decision.result).toBe("matched");
            expect(recorded.scoreMatchAudit).toBeUndefined();
            continue;
          }
          // This is the official detail's expanded source content, not a Record
          // file or a locally reconstructed product protocol.
          const source = recorded.materials.source;
          expect(source).toMatchObject({ kind: "content", encoding: "json", content: { state: "available" } });
          if (source.kind !== "content" || !("base64" in source.content)) throw new Error(`Missing full boundary source: ${label}`);
          const sourceText = Buffer.from(source.content.base64, "base64").toString("utf8");
          retainedSources.set(label, sourceText);
          expect(sourceText).not.toContain("fixture-only-key");
          expect(sourceText).toContain('"eventId":');
          expect(sourceText).toContain('"role":"user"');
          expect(sourceText).toContain('"role":"assistant"');
          const audit = recorded.scoreMatchAudit;
          if (scenario === "metrics" || scenario === "crossTurn") {
            expect(recorded.materials.coverage).toEqual({ state: "complete" });
            expect(audit).toMatchObject({ state: "available", audit: { result: { state: "measured", value: 1 } } });
            if (audit?.state !== "available") throw new Error(`Missing boundary model audit: ${label}`);
            expect(audit.audit.calls).toHaveLength(1);
            boundaryCallCount += audit.audit.calls.length;
            const call = audit.audit.calls[0]!;
            expect(call).toMatchObject({ state: "admitted", operation: "classify", result: { state: "completed" } });
            if (call.state !== "admitted" || call.result.state !== "completed") throw new Error(`Incomplete boundary model audit: ${label}`);
            expect(call.attempts).toHaveLength(1);
            expect(call.attempts[0]).toMatchObject({ transport: "attempted", result: { state: "returned" } });
            const wireBody = JSON.parse("request" in call ? call.request : call.requestTemplate);
            const material = JSON.parse(wireBody.messages[1].content).material;
            const materialText = JSON.stringify(material.items);
            const request = only(boundaryRequests, ({ body }) => JSON.parse(JSON.parse(body).messages[1].content).material.question === material.question);
            expect(JSON.parse(JSON.parse(request.body).messages[1].content).material).toEqual(material);
            const ids: string[] = [];
            for (const item of material.items) ids.push(item.id);
            expect(new Set(ids).size).toBe(ids.length);
            expect(JSON.parse(wireBody.messages[0].content).evidenceIds).toEqual(ids);
            expect(JSON.parse(call.result.output)).toEqual({ choice: "satisfied", rationale: "Fixture classification", citations: [ids[0]] });
            for (const id of ids) expect(sourceText).toContain(id);
            expect(JSON.stringify(audit.audit)).not.toContain("fixture-only-key");
            if (scenario === "metrics") {
              expect(material.items).toHaveLength(2);
              expect(sourceText).toContain("COVERAGE_ASSISTANT:boundary/metrics");
              expect(materialText).toContain("COVERAGE_ASSISTANT:boundary/metrics");
              expect(sourceText).not.toContain("CROSS_A_INPUT");
            } else {
              expect(material.items).toHaveLength(label === "Boundary cross A" ? 7 : label === "Boundary cross B" ? 3 : 10);
              expect(sourceText).toContain("CROSS_A_INPUT");
              expect(materialText).toContain("CROSS_A_INPUT");
              if (label === "Boundary cross A") {
                expect(sourceText).not.toContain("CROSS_B_OUTPUT");
                expect(materialText).not.toContain("CROSS_B_OUTPUT");
                expect(sourceText).not.toContain("CROSS_B_ASSISTANT");
                expect(sourceText).not.toContain("boundary/cross-b");
              } else {
                expect(sourceText).toContain("CROSS_B_OUTPUT");
                expect(materialText).toContain("CROSS_B_OUTPUT");
                expect(sourceText).toContain("CROSS_B_ASSISTANT");
                expect(sourceText).toContain('"status":"completed"');
              }
              if (label !== "Boundary cross B") {
                for (const marker of ["CROSS_A_INJECTED", "CROSS_A_THINKING", "cross-a-skill", "CROSS_A_SUMMARY_REASON", "CROSS_A_ASSISTANT"]) {
                  expect(sourceText).toContain(marker);
                  expect(materialText).toContain(marker);
                }
                for (const type of ["context.injected", "thinking", "skill.loaded", "compaction"]) {
                  expect(sourceText).toContain(type);
                  expect(materialText).toContain(type);
                }
              } else {
                // A's row is outside B's scope even though B's finish retains
                // its precisely joined input from the same session prefix.
                expect(sourceText).not.toContain("CROSS_A_ASSISTANT");
                expect(sourceText).not.toContain("CROSS_A_INJECTED");
                expect(sourceText).not.toContain("boundary/cross-a");
              }
            }
          } else {
            expect(recorded.decision.result).toBe("unavailable");
            expect(recorded.materials.coverage.state).toBe("partial");
            expect(recorded.scoreMatchAudit).toBeUndefined();
            expect(recorded.contribution.state).toBe("not-scored");
            expect(recorded.decision.gate).toBe("not-gate");
            if (scenario === "events" || scenario === "messages" || scenario === "actions") {
              expect(sourceText).toContain(`COVERAGE_ASSISTANT:boundary/${scenario}`);
              expect(JSON.stringify(recorded)).toContain(`BOUNDARY_${scenario.toUpperCase()}_PARTIAL`);
            } else if (scenario === "failure") {
              for (const marker of ["FAILURE_INPUT", "FAILURE_OUTPUT", "FAILURE_ERROR_EVENT", "FAILURE_ASSISTANT", "COVERAGE_ASSISTANT:boundary/baseline"]) expect(sourceText).toContain(marker);
              expect(sourceText).toContain("operation.started");
              expect(sourceText).toContain("operation.finished");
              expect(sourceText).toContain('"status":"failed"');
              expect(sourceText.indexOf("FAILURE_INPUT")).toBeLessThan(sourceText.indexOf("FAILURE_OUTPUT"));
              expect(sourceText.indexOf("FAILURE_OUTPUT")).toBeLessThan(sourceText.indexOf("FAILURE_ASSISTANT"));
            } else if (scenario === "orphan") {
              expect(sourceText).toContain("orphan-operation");
              expect(sourceText).toContain('"summary":"ORPHAN_OUTPUT_SUMMARY"');
              expect(sourceText).not.toContain("operation.started");
            } else if (scenario === "ambiguous") {
              for (const marker of ["AMBIGUOUS_FIRST_INPUT", "AMBIGUOUS_SECOND_INPUT", "AMBIGUOUS_OUTPUT_SUMMARY", "AMBIGUOUS_ASSISTANT"]) expect(sourceText).toContain(marker);
              expect(sourceText).toContain('"summary":"AMBIGUOUS_OUTPUT_SUMMARY"');
              expect(sourceText.indexOf("AMBIGUOUS_FIRST_INPUT")).toBeLessThan(sourceText.indexOf("AMBIGUOUS_SECOND_INPUT"));
              expect(sourceText.indexOf("AMBIGUOUS_SECOND_INPUT")).toBeLessThan(sourceText.indexOf("AMBIGUOUS_OUTPUT_SUMMARY"));
            } else if (scenario === "truncated") {
              expect(sourceText).toContain("TRUNCATED_INPUT");
              expect(sourceText).toContain('"summary":"TRUNCATED_OUTPUT_SUMMARY"');
              expect(sourceText).toContain('"path":"output"');
              expect(sourceText).toContain('"originalBytes":10000');
            }
          }
        }
        if (scenario === "crossTurn") {
          const aRequest = only(boundaryRequests, ({ body }) => body.includes("ACCEPT: cross A cut after B"));
          const bRequest = only(boundaryRequests, ({ body }) => body.includes("ACCEPT: cross B joined input and output"));
          const sessionRequest = only(boundaryRequests, ({ body }) => body.includes("ACCEPT: cross whole session history"));
          const aItems = JSON.parse(JSON.parse(aRequest.body).messages[1].content).material.items;
          const bItems = JSON.parse(JSON.parse(bRequest.body).messages[1].content).material.items;
          const sessionItems = JSON.parse(JSON.parse(sessionRequest.body).messages[1].content).material.items;
          const sessionIds: string[] = [];
          for (const item of sessionItems) sessionIds.push(item.id);
          const scopedIds: string[] = [];
          for (const item of [...aItems, ...bItems]) scopedIds.push(item.id);
          expect(sessionIds).toEqual(scopedIds);
          expect(new Set(scopedIds).size).toBe(10);
        } else if (scenario !== "failure") {
          // The only populated session has one turn, so all three receivers
          // retain the same event identities, including unknown source rows.
          const sources = [...retainedSources.values()];
          const ids = sources.map((source) => [...source.matchAll(/"eventId":"([^"]+)"/g)].map((match) => match[1]));
          const expectedRows = scenario === "ambiguous" ? 5 : scenario === "orphan" ? 3 : scenario === "truncated" ? 4 : 2;
          expect(new Set(ids[0]).size).toBe(expectedRows);
          expect(ids[1]).toEqual(ids[0]);
          expect(ids[2]).toEqual(ids[0]);
        } else {
          const sessionSource = retainedSources.get("Boundary failure session")!;
          const rootSource = retainedSources.get("Boundary failure root")!;
          const sessionIds = [...sessionSource.matchAll(/"eventId":"([^"]+)"/g)].map((match) => match[1]);
          const rootIds = [...rootSource.matchAll(/"eventId":"([^"]+)"/g)].map((match) => match[1]);
          expect(new Set(sessionIds).size).toBe(7);
          expect(rootIds).toEqual(sessionIds);
        }
      }
      expect(boundaryEntryCount).toBe(27);
      expect(boundaryCallCount).toBe(6);
      expect(requests).toHaveLength(25);
    });
  } finally { await close(server); }
});

// @use-case docs/feature/judge/use-case/inspect-judge-score.md
test.concurrent("自定义 Match 捕获必要模型调用失败不能伪造正常成绩", async () => {
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
        state: "available", audit: { result: { state: "errored", code: "judge-call-failed" } },
      });
      expect(requests).toHaveLength(1);
    });
  } finally { await close(server); }
});
