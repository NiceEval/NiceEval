/** The stability product composition over Analysis-issued per-eval rows. */

import type { Sample } from "../../../analysis/index.ts";
import { defineComponent } from "../../definition/tree.ts";
import {
  Chart,
  Col,
  Grid,
  Series,
  Stat,
  Table,
} from "../../definition/primitives.tsx";
import {
  DEFAULT_REPORT_LOCALE,
  localeText,
  type ReportLocale,
} from "../../model/locale.ts";
import {
  stabilityOverviewData,
  type SummarySeries,
} from "./compute.ts";

export interface StabilityOverviewProps {
  /** Explicit fixed Sample; omitted means the resolving component's `ctx.scope`. */
  readonly input?: Sample;
  /** Condition dimension; the stable default is the Experiment identity. */
  readonly columns?: SummarySeries;
  /** Restricts the fixed Sample before Analysis groups its per-eval rows. */
  readonly evals?: string | readonly string[];
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/**
 * Stability's text and web faces are the same closed Chart/Table primitives.
 * This component only obtains current Analysis rows while `ctx.scope` is live.
 */
export const StabilityOverview = defineComponent<StabilityOverviewProps>(async (props, ctx) => {
  const data = await stabilityOverviewData(props.input ?? ctx.scope, {
    columns: props.columns,
    evals: props.evals,
  });
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;

  return (
    <Col className={props.className}>
      <Grid>
        <Stat label={localeText(locale, "stabilityOverview.executions")} value={data.executions} />
        <Stat label={localeText(locale, "stabilityOverview.neverPassed")} value={data.neverPassed} />
        <Stat label={localeText(locale, "stabilityOverview.flaky")} value={data.flaky} />
      </Grid>
      <Chart data={data.dataset} x="executions" y="passRate" legend locale={props.locale}>
        <Series id="stability" mark="scatter" points="evalId" by="condition" />
      </Chart>
      <Table
        rows={data.points}
        columns={[
          { field: "evalId", label: "Eval" },
          { field: "condition", label: "Condition" },
          { field: "executions", label: "Executions" },
          { field: "passRate", label: "Pass rate" },
        ]}
        locale={props.locale}
        className="niceeval-stability-overview-table"
      />
    </Col>
  );
});
StabilityOverview.displayName = "StabilityOverview";
