import type { ReactElement } from "react";

import type { InspectionDocument } from "../../../../inspection/codec.ts";
import type { Cell, TableContent } from "../report/definition/cell.tsx";
import { TableContentView } from "../report/definition/primitives.tsx";
import type { Locale } from "../client/types.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

export function RunPage({
  runDocument,
  summaryDocument,
  locale,
}: {
  readonly runDocument: InspectionDocument;
  readonly summaryDocument: InspectionDocument;
  readonly locale: Locale;
}): ReactElement {
  const run = recordField(recordField(runDocument, "run"), "value");
  const summary = recordField(summaryDocument, "summary");
  const runId = stringField(run, "runId");
  const experimentId = stringField(run, "experimentId");
  const rows = arrayField(summary, "members").map((value, index) => {
    const member = record(value, `summary.members[${index}]`);
    const locator = nullableString(member.locator, `summary.members[${index}].locator`);
    const verdict = nullableString(member.verdict, `summary.members[${index}].verdict`);
    const cells: Record<string, Cell> = {
      experiment: { kind: "text", text: experimentId },
      eval: { kind: "text", text: stringField(member, "evalId") },
      attempt: { kind: "text", text: String(numberField(member, "attemptOrdinal") + 1) },
      membership: { kind: "text", text: stringField(member, "state") },
      outcome: textOrMissing(member.outcome),
      verdict: verdict === null || !isVerdict(verdict)
        ? { kind: "notApplicable" }
        : { kind: "verdict", verdict },
      locator: locator === null
        ? { kind: "notApplicable" }
        : { kind: "locator", locator, ...(isVerdict(verdict) ? { verdict } : {}) },
      selectedRun: { kind: "text", text: runId },
      slot: { kind: "text", text: stringField(member, "slotId") },
      relation: textOrMissing(member.relation),
    };
    return Object.freeze({
      key: `${stringField(member, "slotId")}:${index}`,
      cells: Object.freeze(cells),
    });
  });
  const table: TableContent = Object.freeze({
    columns: Object.freeze([
      { key: "experiment", header: { en: "Experiment", "zh-CN": "实验" } },
      { key: "eval", header: { en: "Eval", "zh-CN": "评估" } },
      { key: "attempt", header: { en: "Attempt", "zh-CN": "尝试" } },
      { key: "membership", header: { en: "Membership", "zh-CN": "成员关系" } },
      { key: "outcome", header: { en: "Outcome", "zh-CN": "执行结果" } },
      { key: "verdict", header: { en: "Verdict", "zh-CN": "判定" } },
      { key: "locator", header: { en: "Attempt locator", "zh-CN": "Attempt 定位符" } },
      { key: "selectedRun", header: { en: "Selected run", "zh-CN": "所选 Run" } },
      { key: "slot", header: { en: "Slot", "zh-CN": "槽位" } },
      { key: "relation", header: { en: "Relation", "zh-CN": "关系" } },
    ]),
    rows: Object.freeze(rows),
  });
  return (
    <section className="niceeval-report niceeval-section">
      <h2 className="niceeval-section-title">
        {locale === "zh-CN" ? `Run 成员 · ${runId}` : `Run membership · ${runId}`}
      </h2>
      <TableContentView data={table} searchable locale={locale} />
    </section>
  );
}

function textOrMissing(value: unknown): Cell {
  return typeof value === "string" && value.length > 0
    ? { kind: "text", text: value }
    : { kind: "notApplicable" };
}

function isVerdict(value: unknown): value is "passed" | "failed" | "errored" | "skipped" {
  return value === "passed" || value === "failed" || value === "errored" || value === "skipped";
}

function recordField(value: object, key: string): JsonRecord {
  return record(Reflect.get(value, key), key);
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as JsonRecord;
}

function arrayField(value: JsonRecord, key: string): readonly unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new Error(`${key} must be an array.`);
  return field;
}

function stringField(value: JsonRecord, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${key} must be a string.`);
  return field;
}

function numberField(value: JsonRecord, key: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field)) {
    throw new Error(`${key} must be an integer.`);
  }
  return field;
}

function nullableString(value: unknown, path: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${path} must be a string or null.`);
  }
  return value;
}
