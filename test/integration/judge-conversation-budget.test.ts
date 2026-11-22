import { rm } from "node:fs/promises";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  OpenAIProvider,
  createJudgeProject,
  planAndRunExperiment,
  readAssertionsList,
  readFullAssertionEntry,
  startModelEmulator,
} from "./fixtures/judge-harness/harness.ts";

describe("Judge conversation material budgeting", () => {
  let server: Awaited<ReturnType<typeof startModelEmulator>>;
  let cwd = "";
  let locator = "";

  beforeAll(async () => {
    server = await startModelEmulator([
      {
        id: "budget-score",
        match: { model: "budget-model", tool: "record_score_match" },
        reply: [
          {
            type: "tool_call",
            name: "record_score_match",
            arguments: { measurement: 1, rationale: "Checked budgeted conversation" },
          },
        ],
      },
    ]);

    const unicodeOutput = "首".repeat(2000) + "尾";
    const earlierAssistant = "assistant".repeat(200);
    const toolInput = "input".repeat(400);
    const toolOutput = "output".repeat(400);

    cwd = await createJudgeProject("niceeval-conv-budget-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({
            model: "budget-model",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKey: "fixture-key",
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({
          name: "conv-agent",
          evidenceCoverage: completeEvidenceCoverage,
          async send(input) {
            if (input.text === "original-input") {
              return {
                status: "completed",
                events: [
                  { type: "message", role: "assistant", text: "earlier-message" },
                  {
                    type: "operation.started",
                    operationId: "call-1",
                    operation: { kind: "tool", name: "read", input: { path: "file" } },
                  },
                  {
                    type: "operation.finished",
                    operationId: "call-1",
                    kind: "tool",
                    status: "completed",
                    output: ${JSON.stringify(unicodeOutput)},
                  },
                  { type: "message", role: "assistant", text: "done" },
                ],
              };
            }
            return {
              status: "completed",
              events: [
                { type: "message", role: "assistant", text: ${JSON.stringify(earlierAssistant)} },
                {
                  type: "operation.started",
                  operationId: "call-2",
                  operation: { kind: "tool", name: "read", input: ${JSON.stringify(toolInput)} },
                },
                {
                  type: "operation.finished",
                  operationId: "call-2",
                  kind: "tool",
                  status: "completed",
                  output: ${JSON.stringify(toolOutput)},
                },
                { type: "message", role: "assistant", text: "done" },
              ],
            };
          },
        });
      `,
      evals: {
        "budget.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              const turn1 = await t.send("original-input");
              t.judge({ nested: [turn1] }, defineJudge({ rubric: "Check unicode", maxMaterialBytes: 913 }))
                .score(1)
                .label("unicode-budget");

              t.judge({ plain: "x".repeat(2000) }, defineJudge({ rubric: "Check plain", maxMaterialBytes: 113 }))
                .score(1)
                .label("plain-untrimmed");

              const s2 = t.newSession();
              const turn2 = await s2.send("protected");
              t.judge(turn2, defineJudge({ rubric: "Check priority", maxMaterialBytes: 3013 }))
                .score(1)
                .label("priority-budget");

              t.judge(turn2, defineJudge({ rubric: "Check tiny", maxMaterialBytes: 113 }))
                .score(1)
                .label("tiny-protected");
            },
          });
        `,
      },
      experiments: {
        "budget.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          export default defineExperiment({ adapter: agent, evals: ["budget"], attempts: 1 });
        `,
      },
    });

    const result = await planAndRunExperiment(cwd, "budget", {
      config: {
        judgeProvider: OpenAIProvider({
          model: "budget-model",
          baseUrl: server.baseUrl,
          apiKey: "fixture-key",
        }),
      },
      rerun: "all",
    });
    const slot = result.run?.slots[0];
    if (slot?.publication.state !== "published") throw new Error("Expected published slot");
    locator = slot.publication.attemptLocator;
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/judge/README.md#score-audit
  test("conversation budgets preserve protected records, yield tool outputs before inputs, and account for omitted UTF-8 bytes", async () => {
    const entries = await readAssertionsList(cwd, locator);
    const fullEntries = await Promise.all(entries.map((e) => readFullAssertionEntry(cwd, locator, e.entryId)));
    const byLabel = new Map(entries.map((e, i) => [e.display.label, fullEntries[i]!.entry] as const));

    const unicodeAudit = byLabel.get("unicode-budget")!.scoreMatchAudit;
    if (unicodeAudit?.state !== "available") throw new Error("Expected unicode audit");
    const unicodeMaterial = JSON.parse(unicodeAudit.audit.input) as {
      nested: Array<{ records: Array<{ output?: string }>; omissions: Array<{ path: string; omittedBytes: number }> }>;
    };
    const unicodeText = unicodeAudit.audit.input;
    expect(Buffer.byteLength(unicodeText)).toBeLessThanOrEqual(900);
    expect(unicodeText).toContain("original-input");
    expect(unicodeText).toContain("earlier-message");
    expect(unicodeText).toContain("done");
    expect(unicodeText).not.toContain("\uFFFD");

    const proj = unicodeMaterial.nested[0]!;
    const trimmedOut = proj.records.find((r) => r.output !== undefined)!.output!;
    const omission = proj.omissions[0]!;
    const marker = `[niceeval omitted ${omission.omittedBytes} UTF-8 bytes at ${omission.path}]`;
    expect(trimmedOut).toContain(marker);
    const originalEncodedBytes = Buffer.byteLength(JSON.stringify("首".repeat(2000) + "尾"));
    expect(originalEncodedBytes - Buffer.byteLength(trimmedOut.replace(marker, ""))).toBe(omission.omittedBytes);

    // Plain author objects are never trimmed as conversation material
    const plainAudit = byLabel.get("plain-untrimmed")!.scoreMatchAudit;
    if (plainAudit?.state !== "available") throw new Error("Expected plain audit");
    expect(JSON.parse(plainAudit.audit.input)).toEqual({ plain: "x".repeat(2000) });

    // Tool output yields budget before tool input while keeping earlier assistant message
    const priorityAudit = byLabel.get("priority-budget")!.scoreMatchAudit;
    if (priorityAudit?.state !== "available") throw new Error("Expected priority audit");
    expect(Buffer.byteLength(priorityAudit.audit.input)).toBeLessThanOrEqual(3000);
    expect(priorityAudit.audit.input).toContain("assistant".repeat(200));
    const priorityMat = JSON.parse(priorityAudit.audit.input) as { omissions: Array<{ path: string }> };
    expect(priorityMat.omissions.map((o) => o.path)).toEqual(["/records/3/output", "/records/2/input"]);

    // Tiny budget still protects user input and final assistant reply
    const tinyAudit = byLabel.get("tiny-protected")!.scoreMatchAudit;
    if (tinyAudit?.state !== "available") throw new Error("Expected tiny audit");
    fc.assert(
      fc.property(fc.constantFrom("protected", "done"), (protectedText) => {
        expect(tinyAudit.audit.input).toContain(protectedText);
      }),
      { numRuns: 2 },
    );
  });
});
