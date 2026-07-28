// 实体列表组合件:FailureList;数据源在 compute.ts / content.ts;列表本体是 Table 原语。

import { defineComposition } from "../../source.ts";
import { Table } from "../../definition/primitives.tsx";
import type { ReportInput } from "../../model/types.ts";
import type { AttemptLocator } from "../../../record/locator.ts";
import { collectItems, locatorOf, resolveInput } from "../../model/aggregate.ts";
import type { ReportLocale } from "../../model/locale.ts";
import { attemptListData } from "./compute.ts";
import { attemptListContent } from "./content.ts";

export { validateAttemptListData, validateEvalListData, validateExperimentListData } from "./validate.ts";

export interface FailureListProps {
  limit?: number;
  input?: ReportInput;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

export const FailureList = defineComposition<FailureListProps>(async (props, ctx) => {
  const input = props.input ?? ctx.input;
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
