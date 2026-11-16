// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import * as Schema from "effect/Schema";
import {
  AssertionDecisionResultSchema,
  AssertionEntryIdSchema,
  EarnedScoreContributionSchema,
  NoScoreContributionSchema,
  UnavailableScoreContributionSchema,
} from "../assertions/record/codec.ts";
import type { AssertionsAttachment } from "../record/family/assertions/schema.ts";
import { PlannedAttemptMemberSchema } from "./results.ts";

const EntrySchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  result: AssertionDecisionResultSchema,
  contribution: Schema.Union([
    NoScoreContributionSchema,
    EarnedScoreContributionSchema,
    UnavailableScoreContributionSchema,
  ]),
});
const CellSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({ state: Schema.Literal("available"), entries: Schema.Array(EntrySchema) }),
  Schema.Struct({ state: Schema.Literals(["not-recorded", "unsupported", "failed"]) }),
]);
export const MatrixColumnSchema = Schema.Struct({
  experimentId: Schema.String,
  attemptOrdinal: Schema.Number,
  locator: Schema.NullOr(Schema.String),
  publication: PlannedAttemptMemberSchema.fields.publication,
  verdict: PlannedAttemptMemberSchema.fields.verdict,
  score: PlannedAttemptMemberSchema.fields.score,
});
const RowSchema = Schema.Struct({
  label: Schema.String,
  groupPath: Schema.Array(Schema.String),
  cells: Schema.Array(CellSchema),
  distinct: Schema.Boolean,
});
export const AssertionMatrixSchema = Schema.Struct({
  state: Schema.Literals(["complete", "partial"]),
  experimentIds: Schema.Array(Schema.String),
  evals: Schema.Array(
    Schema.Struct({
      evalId: Schema.String,
      columns: Schema.Array(MatrixColumnSchema),
      rows: Schema.Array(RowSchema),
      unlabeled: Schema.Array(Schema.Number),
    }),
  ),
  omitted: Schema.Struct({ evals: Schema.Number, rows: Schema.Number, columns: Schema.Number }),
});
export type AssertionMatrix = typeof AssertionMatrixSchema.Type;
export type MatrixColumn = typeof MatrixColumnSchema.Type;
type Entry = AssertionsAttachment["entries"][number];
export interface MatrixInput {
  readonly evalId: string;
  readonly column: MatrixColumn;
  readonly assertions:
    | { readonly state: "available"; readonly entries: readonly Entry[] }
    | { readonly state: "not-recorded" | "unsupported" | "failed" };
}

// Bound both the structured payload and its Cartesian dimensions.
export function projectAssertionMatrix(
  experimentIds: readonly string[],
  input: readonly MatrixInput[],
): AssertionMatrix {
  const omitted = { evals: 0, rows: 0, columns: 0 };
  const evals: AssertionMatrix["evals"][number][] = [];
  let rowBudget = 1000;
  let cellBudget = 10000;
  const ids = [...new Set(input.map((item) => item.evalId))].sort();
  for (const evalId of ids) {
    const all = input.filter((item) => item.evalId === evalId);
    if (evals.length >= 100) {
      omitted.evals++;
      omitted.columns += all.length;
      continue;
    }
    const selected = all.slice(0, 100);
    omitted.columns += all.length - selected.length;
    const columns = selected.map((item) => item.column);
    const unlabeled = selected.map(() => 0);
    const rows = new Map<
      string,
      { label: string; groupPath: readonly string[]; cells: (typeof CellSchema.Type)[]; distinct: boolean }
    >();
    selected.forEach(({ assertions }, col) => {
      if (assertions.state !== "available") return;
      for (const entry of assertions.entries) {
        const { label, groupPath } = entry.display;
        if (label === undefined) {
          unlabeled[col]++;
          continue;
        }
        const identity = JSON.stringify([groupPath, label]);
        let row = rows.get(identity);
        if (row === undefined) {
          row = {
            label,
            groupPath,
            distinct: false,
            cells: selected.map(({ assertions: a }) =>
              a.state === "available" ? { state: "absent" } : { state: a.state },
            ),
          };
          rows.set(identity, row);
        }
        const cell = row.cells[col]!;
        row.cells[col] = {
          state: "available",
          entries: [
            ...(cell.state === "available" ? cell.entries : []),
            { entryId: entry.entryId, result: entry.decision.result, contribution: entry.contribution },
          ],
        };
      }
    });
    const kept: (typeof RowSchema.Type)[] = [];
    for (const row of rows.values()) {
      const cost = row.cells.reduce((sum, cell) => sum + (cell.state === "available" ? cell.entries.length : 1), 0);
      if (rowBudget <= 0 || cost > cellBudget) {
        omitted.rows++;
        continue;
      }
      const signature = (cell: typeof CellSchema.Type) =>
        JSON.stringify(
          cell.state === "available"
            ? cell.entries.map(({ result, contribution }) => ({ result, contribution }))
            : cell,
        );
      row.distinct = row.cells.some((cell) => signature(cell) !== signature(row.cells[0]!));
      const candidate = { evalId, columns, rows: [...kept, row], unlabeled };
      if (new TextEncoder().encode(JSON.stringify([...evals, candidate])).length > 450000) {
        omitted.rows++;
        continue;
      }
      rowBudget--;
      cellBudget -= cost;
      kept.push(row);
    }
    const evaluation = { evalId, columns, rows: kept, unlabeled };
    if (new TextEncoder().encode(JSON.stringify([...evals, evaluation])).length > 450000) {
      omitted.evals++;
      omitted.columns += selected.length;
      omitted.rows += kept.length;
    } else evals.push(evaluation);
  }
  return { state: Object.values(omitted).some((n) => n > 0) ? "partial" : "complete", experimentIds, evals, omitted };
}
