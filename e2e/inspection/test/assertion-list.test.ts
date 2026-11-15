import { decodeInspectionDocument, narrowInspectionSuccess, only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/bulk-assertion-show-deadline.md
// @issue docs/issues/assertion-detail-payload-projection.md
test.concurrent("大材料 Attempt 的断言列表完整交付紧凑判定，单项超期给出精确下钻诊断", async () => {
  await inspectionE2E.case(
    "assertion-list",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      await writeFile(
        join(projectRoot, "evals/inspection.eval.ts"),
        `import { defineScoreEval } from "niceeval";
import { includes, toolMatch } from "niceeval/expect";
export default defineScoreEval({ async test(t) {
  const turn = await t.send("produce assertion list evidence");
  for (let index = 0; index < 80; index++) {
    t.check("large-material-marker" + "x".repeat(128 * 1024), includes("large-material-marker"))
      .score(1).label("Entry " + index);
  }
  turn.check(turn.toolCalls, toolMatch("inspection_fixture").exactly(1)).label("Collection entry");
} });
`,
      );
      // The ambient wall clock is the only substituted boundary. Advancing on
      // reads makes a long list exceed a session budget without wall-time sleeps;
      // a larger stride makes one operation exceed its own budget. Product code,
      // SQLite, published facts and CLI are all real.
      await writeFile(
        join(projectRoot, "read-clock.mjs"),
        `const now = Date.now.bind(Date); let elapsed = 0;
Date.now = () => now() + (elapsed += Number(process.env.READ_CLOCK_STEP_MS));
`,
      );
      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      const locator = only(produced.expEvalEvents(), (item) => item.evalId === "inspection").locator;
      const outline = await niceeval.run(["show", locator, "--json"]);
      expect(outline.exitCode, outline.diagnostic()).toBe(0);
      const entryIds = outline
        .inspectionSuccess("attempt.get")
        .attempt.assertions.entries.map((entry) => entry.entryId);
      expect(entryIds).toHaveLength(81);
      const clock = {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${join(projectRoot, "read-clock.mjs")}`,
      };
      const listed = await niceeval.run(["show", locator, "assertions", "--json"], {
        env: { ...clock, READ_CLOCK_STEP_MS: "100" },
      });
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      const documents = listed.ndjson<unknown>().map((line) => {
        const decoded = decodeInspectionDocument(line);
        if (!decoded.success) throw new Error(decoded.reason);
        const narrowed = narrowInspectionSuccess(decoded.value, "attempt.assertion.detail");
        if (!narrowed.success) throw new Error(narrowed.reason);
        return narrowed.value;
      });
      expect(documents.map((document) => document.assertion.entryId)).toEqual(entryIds);
      expect(new Set(documents.map((document) => JSON.stringify(document.publicationCutoff))).size).toBe(1);
      for (const document of documents) {
        expect(document.assertion).not.toHaveProperty("entry.materials");
        expect(document.assertion).not.toHaveProperty("entry.evaluation.artifact");
        expect(document.assertion).not.toHaveProperty("matcher.debugger");
        expect(JSON.stringify(document)).not.toContain("retainedRows");
        expect(JSON.stringify(document)).not.toContain("large-material-markerxxx");
      }
      const shown = await niceeval.run(["show", locator, "assertions"], {
        env: { ...clock, READ_CLOCK_STEP_MS: "100" },
      });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("Entry 79");
      expect(shown.stdout).toContain("Collection entry");
      const entryId = entryIds[0]!;
      const expired = await niceeval.run(["show", locator, entryId, "--full", "--json"], {
        env: { ...clock, READ_CLOCK_STEP_MS: "5000" },
      });
      expect(expired.exitCode, expired.diagnostic()).not.toBe(0);
      const failure = expired.inspectionFailure().failure;
      expect(failure.code).toBe("inspection-read-deadline-exceeded");
      expect(failure.reason).toContain(entryId);
      expect(failure.reason).toMatch(/elapsed.*\d+.*ms.*deadline.*30000.*ms/iu);
      expect(failure.correction).toBe(`niceeval show ${locator} ${entryId}`);
      const text = await niceeval.run(["show", locator, entryId, "--full"], {
        env: { ...clock, READ_CLOCK_STEP_MS: "5000" },
      });
      expect(text.exitCode, text.diagnostic()).not.toBe(0);
      expect(text.stdout).toBe("");
      expect(text.stderr).toContain("inspection-read-deadline-exceeded");
      expect(text.stderr).toContain(entryId);
      expect(text.stderr).toContain(`niceeval show ${locator} ${entryId}`);
    },
  );
});
