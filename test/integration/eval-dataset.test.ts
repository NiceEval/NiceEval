import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import fc from "fast-check";
import { expect, test } from "vitest";
import { Effect } from "effect";
import { defineDataset, defineScoreDataset } from "niceeval";
import { experimentHost } from "niceeval/experiment/host";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

const ids = fc.uniqueArray(fc.nat(999), { minLength: 1, maxLength: 5 });

// @feature docs/feature/eval/README.md#dataset-fanout
test("array and asynchronous datasets discover one correctly typed Eval per row", async () => {
  const cwd = await createRecordProject("niceeval-datasets-", { held: false });
  try {
    await fc.assert(
      fc.asyncProperty(ids, fc.boolean(), async (rows, useKeys) => {
        const declaration = (kind: "defineDataset" | "defineScoreDataset", data: string) => `
          import { ${kind} } from "niceeval";
          export default ${kind}({
            description: "rows", tags: ["generated"], data: ${data},
            ${useKeys ? "key: (row) => `row-${row}`," : ""}
            test() {},
          });
        `;
        await Promise.all([
          writeFile(join(cwd, "evals", "pass.eval.ts"), declaration("defineDataset", JSON.stringify(rows))),
          writeFile(
            join(cwd, "evals", "score.eval.ts"),
            declaration("defineScoreDataset", `async () => ${JSON.stringify(rows)}`),
          ),
        ]);
        const { evals } = await Effect.runPromise(experimentHost.catalog({ cwd }));
        const observed = evals.filter(({ id }) => /^(pass|score)\//u.test(id));
        const expected = (["pass", "score"] as const).flatMap((evaluationKind) =>
          rows.map((row, index) => ({
            id: `${evaluationKind}/${useKeys ? `row-${row}` : String(index).padStart(4, "0")}`,
            evaluationKind,
            description: "rows",
            tags: ["generated"],
          })),
        );
        expect(observed).toEqual(expected.sort((a, b) => a.id.localeCompare(b.id)));
      }),
      {
        numRuns: 2,
        examples: [
          [[17, 4], true],
          [[4, 17], false],
        ],
      },
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// @feature docs/feature/eval/README.md#dataset-fanout
test("dataset declarations reject missing or wrongly typed test functions and data sources", () => {
  fc.assert(
    fc.property(fc.constantFrom(undefined, null, 0, "invalid", {}), fc.boolean(), (invalid, brokenData) => {
      for (const define of [defineDataset, defineScoreDataset]) {
        const input = { data: [], test() {} };
        Object.assign(input, brokenData ? { data: invalid } : { test: invalid });
        expect(() => define(input)).toThrow(TypeError);
      }
    }),
  );
});
