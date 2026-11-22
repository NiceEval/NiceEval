import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  OpenAIProvider,
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readFullAssertionEntry,
  showJsonDocuments,
  startModelEmulator,
} from "./fixtures/judge-harness/harness.ts";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { readScoreMatchAudit } =
  require("niceeval/inspection") as typeof import("../../packages/niceeval/src/inspection/public.ts");

const encoder = new TextEncoder();
const sha256Hex = (value: string) => createHash("sha256").update(encoder.encode(value)).digest("hex");

function sealedAuditEnvelope(auditJson: string) {
  const bytes = encoder.encode(auditJson).byteLength;
  return {
    manifest: {
      byteLength: bytes,
      digest: sha256Hex(auditJson),
      chunkByteLengths: [bytes],
    },
    content: [auditJson],
  };
}

describe("ScoreMatchAudit public reader", () => {
  let server: Awaited<ReturnType<typeof startModelEmulator>>;
  let cwd = "";
  let canonicalEnvelope!: ReturnType<typeof sealedAuditEnvelope>;
  let measuredValue = 0.75;

  beforeAll(async () => {
    server = await startModelEmulator([
      {
        id: "audit-score",
        match: { model: "audit-model", tool: "record_score_match" },
        reply: [
          {
            type: "tool_call",
            name: "record_score_match",
            arguments: { measurement: measuredValue, rationale: "Acceptable answer" },
          },
        ],
      },
    ]);

    cwd = await createJudgeProject("niceeval-audit-reader-", {
      config: `
        import { defineConfig } from "niceeval";
        import { OpenAIProvider } from "niceeval/judge";
        export default defineConfig({
          judgeProvider: OpenAIProvider({
            model: "audit-model",
            baseUrl: ${JSON.stringify(server.baseUrl)},
            apiKey: "fixture-key",
          }),
        });
      `,
      agent: `
        import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
        export default defineAgent({
          name: "audit-agent",
          evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({ status: "completed", events: [] }),
        });
      `,
      evals: {
        "audit.eval.ts": `
          import { defineScoreEval } from "niceeval";
          import { defineJudge } from "niceeval/expect";
          export default defineScoreEval({
            async test(t) {
              await t.send("check");
              t.judge({ answer: "maybe" }, defineJudge({ rubric: "Assess the answer." })).score(1).label("rubric");
            },
          });
        `,
      },
      experiments: {
        "audit.ts": `
          import { defineExperiment } from "niceeval";
          import agent from "../agent.ts";
          export default defineExperiment({ adapter: agent, evals: ["audit"], attempts: 1 });
        `,
      },
    });

    const result = await planAndRunExperiment(cwd, "audit", {
      config: {
        judgeProvider: OpenAIProvider({
          model: "audit-model",
          baseUrl: server.baseUrl,
          apiKey: "fixture-key",
        }),
      },
      rerun: "all",
    });
    const slot = result.run?.slots[0];
    if (slot?.publication.state !== "published") throw new Error("Expected published slot");
    const [attemptDoc] = await showJsonDocuments(cwd, [slot.publication.attemptLocator]);
    const attempt = narrowInspectionSuccess(attemptDoc!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const entryId = attempt.value.attempt.assertions.entries[0]!.entryId;
    const { entry } = await readFullAssertionEntry(cwd, slot.publication.attemptLocator, entryId);
    if (entry.scoreMatchAudit?.state !== "available") throw new Error("Expected available scoreMatchAudit");
    canonicalEnvelope = sealedAuditEnvelope(JSON.stringify(entry.scoreMatchAudit.audit));
  }, 30_000);

  afterAll(async () => {
    await server?.close();
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  // @feature docs/feature/inspection/README.md#exact-read-and-comparison
  test("strictly accepts valid canonical audit envelopes and rejects tampered, historical, or mismatched inputs", () => {
    expect(readScoreMatchAudit(canonicalEnvelope, measuredValue).state).toBe("available");

    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.double({ min: 0, max: 1, noNaN: true }).filter((value) => value !== measuredValue),
        fc.stringMatching(/^[0-9a-f]{64}$/).filter((hex) => hex !== canonicalEnvelope.manifest.digest),
        (historicalVersion, wrongMeasurement, badDigest) => {
          expect(
            readScoreMatchAudit({
              ...canonicalEnvelope,
              manifest: { ...canonicalEnvelope.manifest, digest: badDigest },
            }),
          ).toEqual({ state: "invalid" });

          expect(
            readScoreMatchAudit({
              manifest: { schemaVersion: historicalVersion, protocol: `niceeval.score-match-audit/v${historicalVersion}` },
              content: [],
            }),
          ).toEqual({ state: "invalid" });

          expect(readScoreMatchAudit(canonicalEnvelope, wrongMeasurement)).toEqual({ state: "invalid" });
        },
      ),
      { numRuns: 30 },
    );
  });
});
