import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { beforeAll, expect, test } from "vitest";
import {
  createJudgeProject,
  invokeCli,
  narrowInspectionSuccess,
  planAndRunExperiment,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

const repeat = 100_000;
type MachineDocument = Awaited<ReturnType<typeof showJsonDocuments>>[number];
const documents: MachineDocument[] = [];
let humanPage: Awaited<ReturnType<typeof invokeCli>>;

beforeAll(async () => {
  const cwd = await createJudgeProject("niceeval-assertion-pages-", {
    agent: `
      import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
      export default defineAgent({
        name: "page-fixture",
        evidenceCoverage: completeEvidenceCoverage,
        send: async () => ({
          status: "completed",
          events: [{ type: "message", role: "assistant", text: "é\\u0001".repeat(${repeat}) }],
        }),
      });
    `,
    evals: {
      "paged.eval.ts": `
        import { defineEval } from "niceeval";
        import { eventMatch, includes } from "niceeval/expect";
        export default defineEval({ async test(t) {
          const turn = await t.send("test");
          turn.notEvent(eventMatch("message", { text: includes("missing") })).label("complete source");
        } });
      `,
    },
    experiments: {
      "paged.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        export default defineExperiment({ adapter: agent, evals: ["paged"], attempts: 1 });
      `,
    },
  });
  try {
    const { run } = await planAndRunExperiment(cwd, "paged");
    const publication = run?.slots[0]?.publication;
    if (publication?.state !== "published") throw new Error("Expected published Attempt");
    const locator = publication.attemptLocator;
    const [outline] = await showJsonDocuments(cwd, [locator]);
    const attempt = narrowInspectionSuccess(outline!, "attempt.get");
    if (!attempt.success) throw new Error(attempt.reason);
    const entryId = attempt.value.attempt.assertions.entries[0]!.entryId;

    humanPage = await invokeCli(cwd, ["show", locator, entryId, "--full"]);
    let continuation: string | undefined;
    do {
      const [doc] = await showJsonDocuments(cwd, [
        locator,
        entryId,
        "--full",
        ...(continuation === undefined ? [] : ["--continuation", continuation]),
      ]);
      const detail = narrowInspectionSuccess(doc!, "attempt.assertion.detail");
      if (!detail.success) throw new Error(detail.reason);
      const page = detail.value.assertion;
      if (!("fields" in page)) throw new Error("Expected paged assertion detail");
      documents.push(doc!);
      continuation = page.continuation;
    } while (continuation !== undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 240_000);

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("full assertion pages reconstruct the sealed UTF-8 source facts", () => {
  expect(humanPage.code).toBe(0);
  expect(humanPage.stdout).toMatch(/Next\n.*--full --continuation/u);

  const fields = new Map<string, {
    chunks: Buffer[];
    byteLength: number;
    sha256: string | undefined;
    end: number;
  }>();
  for (const doc of documents) {
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThanOrEqual(512 * 1024);
    const detail = narrowInspectionSuccess(doc, "attempt.assertion.detail");
    if (!detail.success || !("fields" in detail.value.assertion)) throw new Error("Expected paged assertion detail");
    const page = detail.value.assertion;
    expect(detail.value.links.find(({ rel }) => rel === "next-page")?.command.split(" ").at(-1))
      .toBe(page.continuation);
    for (const part of page.fields) {
      const sha256 = "sha256" in part ? part.sha256 : undefined;
      const field = fields.get(part.path) ?? { chunks: [] as Buffer[], byteLength: part.byteLength, sha256, end: 0 };
      expect(part.offset).toBe(field.end);
      expect(part.byteLength).toBe(field.byteLength);
      expect(sha256).toBe(field.sha256);
      const bytes = Buffer.from(part.base64, "base64");
      field.chunks.push(bytes);
      field.end += bytes.byteLength;
      expect(part.nextOffset).toBe(field.end === field.byteLength ? null : field.end);
      fields.set(part.path, field);
    }
  }

  // The producer records the removal of the unsafe control characters before sealing the source.
  const sealedText = Buffer.from(JSON.stringify("é".repeat(repeat)));
  let restoredBytes = 0;
  const sourceCopies = new Set<string>();
  for (const [path, field] of fields) {
    const bytes = Buffer.concat(field.chunks);
    expect(bytes.byteLength).toBe(field.byteLength);
    if (field.sha256 !== undefined) expect(createHash("sha256").update(bytes).digest("hex")).toBe(field.sha256);
    restoredBytes += bytes.byteLength;
    const source = /^\/matcher\/debugger\/source\/(final|atEvaluation)\/rows\//u.exec(path)?.[1];
    if (source !== undefined && bytes.includes(sealedText)) sourceCopies.add(source);
  }
  expect([...sourceCopies].sort()).toEqual(["atEvaluation", "final"]);
  expect(restoredBytes).toBeGreaterThan(512 * 1024);
});
