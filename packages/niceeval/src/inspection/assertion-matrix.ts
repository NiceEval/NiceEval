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
import { utf8ByteLength } from "./bytes.ts";
import { collectionPage } from "./collection-page.ts";
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
      rowOffset: Schema.optional(Schema.Number),
      columnOffset: Schema.optional(Schema.Number),
    }),
  ),
  omitted: Schema.Struct({ evals: Schema.Number, rows: Schema.Number, columns: Schema.Number }),
  continuation: Schema.optional(Schema.String),
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

type MatrixEntry = typeof EntrySchema.Type;
type MatrixRow = typeof RowSchema.Type;
type MatrixEval = AssertionMatrix["evals"][number];
type MatrixCell = typeof CellSchema.Type;
type SparseRow = Omit<MatrixRow, "cells"> & { readonly cells: ReadonlyMap<number, readonly MatrixEntry[]> };
interface Evaluation {
  readonly evalId: string;
  readonly columns: readonly MatrixColumn[];
  readonly unlabeled: readonly number[];
  readonly rows: readonly SparseRow[];
  readonly emptyCells: readonly MatrixCell[];
}

const EVAL_PAGE_SIZE = 100;
const COLUMN_PAGE_SIZE = 100;
const ROW_PAGE_SIZE = 1000;
const CELL_PAGE_SIZE = 10_000;
const MATRIX_PAGE_BYTES = 450_000;

export function projectAssertionMatrix(
  experimentIds: readonly string[],
  input: readonly MatrixInput[],
  page: { readonly offset: number; readonly next: (offset: number) => string; readonly invalid: () => never },
): AssertionMatrix {
  const grouped = new Map<string, MatrixInput[]>();
  for (const item of input) {
    const existing = grouped.get(item.evalId);
    if (existing === undefined) grouped.set(item.evalId, [item]);
    else existing.push(item);
  }
  const evaluations = [...grouped.keys()].sort().map((evalId) => indexEvaluation(evalId, grouped.get(evalId)!));
  const evals: MatrixEval[] = [];
  let bytes = MATRIX_PAGE_BYTES - utf8ByteLength(JSON.stringify(experimentIds));
  let rowBudget = ROW_PAGE_SIZE;
  let cellBudget = CELL_PAGE_SIZE;
  let ordinal = 0;

  const finish = (evalIndex: number, col: number, row: number, fullRowCount = false): AssertionMatrix => {
    const omitted = { evals: evaluations.length - evalIndex, rows: 0, columns: 0 };
    for (let i = evalIndex; i < evaluations.length; i++) {
      const evaluation = evaluations[i]!;
      omitted.rows += evaluation.rows.length - (i === evalIndex && !fullRowCount ? row : 0);
      omitted.columns += evaluation.columns.length - (i === evalIndex ? col : 0);
    }
    return {
      state: omitted.evals > 0 ? "partial" : "complete",
      experimentIds,
      evals,
      omitted,
      ...(omitted.evals > 0 ? { continuation: page.next(ordinal) } : {}),
    };
  };

  for (const [evalIndex, evaluation] of evaluations.entries()) {
    const { evalId, columns, rows, emptyCells, unlabeled } = evaluation;
    for (let col = 0; col < columns.length; col += COLUMN_PAGE_SIZE) {
      const endCol = Math.min(col + COLUMN_PAGE_SIZE, columns.length);
      const columnPage = columns.slice(col, endCol);
      const base = { evalId, columns: columnPage, unlabeled: unlabeled.slice(col, endCol) };
      const baseBytes = utf8ByteLength(JSON.stringify(base)) + 64;
      const width = endCol - col;
      const rowLimit = Math.min(ROW_PAGE_SIZE, Math.floor(CELL_PAGE_SIZE / width));
      const makeRow = (row: SparseRow): MatrixRow => {
        const cells = columnPage.map((_, index): MatrixCell => {
          const entries = row.cells.get(col + index);
          return entries === undefined ? emptyCells[col + index]! : { state: "available", entries };
        });
        return { label: row.label, groupPath: row.groupPath, distinct: row.distinct, cells };
      };
      for (let row = 0; row < Math.max(1, rows.length); ) {
        // A partial evaluation owns its page. Pack small complete evaluations together.
        const partial = row > 0 || col > 0 || endCol < columns.length;
        if (
          ordinal >= page.offset &&
          evals.length > 0 &&
          (partial ||
            evals.length >= EVAL_PAGE_SIZE ||
            rows.length > rowBudget ||
            rows.length * width > cellBudget ||
            baseBytes > bytes)
        )
          return finish(evalIndex, col, row, endCol < columns.length);

        const candidates = rows.slice(row, row + rowLimit).map(makeRow);
        const pageRows = collectionPage(candidates, 0, rowLimit, MATRIX_PAGE_BYTES - baseBytes);
        const used = baseBytes + utf8ByteLength(JSON.stringify(pageRows.items));
        const nextRow = row + pageRows.items.length;
        if (ordinal >= page.offset) {
          if (evals.length > 0 && (used > bytes || nextRow < rows.length))
            return finish(evalIndex, col, row, endCol < columns.length);
          evals.push({
            ...base,
            rows: pageRows.items,
            ...(partial || nextRow < rows.length ? { rowOffset: row, columnOffset: col } : {}),
          });
          bytes -= used;
          rowBudget -= pageRows.items.length;
          cellBudget -= pageRows.items.length * width;
        }
        ordinal++;
        if (ordinal > page.offset && nextRow < rows.length)
          return finish(evalIndex, col, nextRow, endCol < columns.length);
        if (ordinal > page.offset && endCol < columns.length) return finish(evalIndex, endCol, 0);
        if (rows.length === 0) break;
        row = nextRow;
      }
    }
  }
  if (page.offset > 0 && evals.length === 0) return page.invalid();
  return finish(evaluations.length, 0, 0);
}

function indexEvaluation(evalId: string, input: readonly MatrixInput[]): Evaluation {
  const unlabeled = input.map(() => 0);
  const emptyCells = input.map(
    ({ assertions }): MatrixCell =>
      assertions.state === "available" ? { state: "absent" } : { state: assertions.state },
  );
  const index = new Map<string, Omit<SparseRow, "cells" | "distinct"> & { cells: Map<number, MatrixEntry[]> }>();
  for (const [column, { assertions }] of input.entries()) {
    if (assertions.state !== "available") continue;
    for (const entry of assertions.entries) {
      const { label, groupPath } = entry.display;
      if (label === undefined) {
        unlabeled[column]!++;
        continue;
      }
      const identity = JSON.stringify([groupPath, label]);
      let row = index.get(identity);
      if (row === undefined) {
        row = { label, groupPath, cells: new Map() };
        index.set(identity, row);
      }
      const cell = { entryId: entry.entryId, result: entry.decision.result, contribution: entry.contribution };
      const entries = row.cells.get(column);
      if (entries === undefined) row.cells.set(column, [cell]);
      else entries.push(cell);
    }
  }
  const rows = [...index.values()].map((row): SparseRow => {
    const first = row.cells.values().next().value!;
    const signature = (entries: readonly MatrixEntry[]) =>
      JSON.stringify(entries.map(({ result, contribution }) => [result, contribution]));
    const expected = signature(first);
    const distinct =
      row.cells.size < input.length || [...row.cells.values()].some((entries) => signature(entries) !== expected);
    return { ...row, distinct };
  });
  return { evalId, columns: input.map(({ column }) => column), rows, unlabeled, emptyCells };
}
