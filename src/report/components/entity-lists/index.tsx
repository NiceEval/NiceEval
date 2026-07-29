// 实体列表组合件:FailureList / AttemptList；列表本体是 Table 原语。

import { defineComponent } from "../../definition/tree.ts";
import { Table } from "../../definition/primitives.tsx";
import type { ReportInput } from "../../model/types.ts";
import type { AttemptHandle, Sample } from "../../../record/types.ts";
import type { AttemptLocator } from "../../../record/locator.ts";
import { collectItems, locatorOf, resolveInput } from "../../model/aggregate.ts";
import type { ReportLocale } from "../../model/locale.ts";
import { attemptListData, attemptRowsOf } from "./compute.ts";
import { attemptListContent } from "./content.ts";
import { toAttemptRows } from "../../model/conversions.ts";

export { validateAttemptListData, validateEvalListData, validateExperimentListData } from "./validate.ts";

export interface FailureListProps {
  limit?: number;
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

export const FailureList = defineComponent<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.scope;
  const all = await attemptListData(input);
  const startedAtByLocator = new Map<string, string>();
  const { runs, attempts } = resolveInput(input);
  for (const item of collectItems(runs, attempts)) {
    startedAtByLocator.set(locatorOf(item), item.attempt.result.startedAt ?? "");
  }
  const failures = all
    .filter((item) => item.verdict === "failed" || item.verdict === "errored")
    .sort((a, b) => {
      const ta = startedAtByLocator.get(a.locator) ?? "";
      const tb = startedAtByLocator.get(b.locator) ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
    });
  const limit = props.limit ?? 20;
  const content = attemptListContent(failures.slice(0, limit));
  return (
    <Table
      data={content}
      attemptHref={props.attemptHref}
      locale={props.locale}
      className={props.className}
    />
  );
});
FailureList.displayName = "FailureList";

export interface AttemptListProps {
  attempts: readonly AttemptHandle[];
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

/** 薄组合：toAttemptRows + Table。 */
export const AttemptList = defineComponent<AttemptListProps>(async (props) => {
  const rows = await toAttemptRows(props.attempts);
  return (
    <Table
      data={attemptListContent(rows)}
      attemptHref={props.attemptHref}
      locale={props.locale}
      className={props.className}
    />
  );
});
AttemptList.displayName = "AttemptList";

export interface ExperimentListProps {
  sample: Sample;
  sort?: string;
  filter?: boolean;
  locale?: ReportLocale;
  className?: string;
}

// re-export for callers that still import attemptRowsOf locally
export { attemptRowsOf };
