// Experiment 详情组合件：六区块用原语和公开 to* 装配。
// 固定 Sample 不可变，实验身份显式传入（`experiment` 或已关闭的 `data`）。text/web
// 两面消费同一份 `experimentDetailsData` 转换结果，不各自取数。

import type { ExperimentId } from "../../../analysis/index.ts";
import { defineComponent, type AuthorComposeContext } from "../../definition/tree.ts";
import {
  Callouts,
  Col,
  CopyBlock,
  Grid,
  Stat,
  TableContentView,
} from "../../definition/primitives.tsx";
import type { TableContent, TableContentRow } from "../../definition/cell.ts";
import { cx } from "../../definition/primitives/shared.ts";
import { DEFAULT_REPORT_LOCALE, localizedMessage, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { formatInstant } from "../../model/format.ts";
import {
  experimentDetailsData,
  type ExperimentDetailsData,
  type ExperimentDetailsView,
} from "./compute.ts";

const LABEL: globalThis.Record<string, LocalizedText> = {
  experiment: { en: "Experiment", "zh-CN": "实验" },
  agent: { en: "Agent", "zh-CN": "Agent" },
  model: { en: "Model", "zh-CN": "模型" },
  flags: { en: "Flags", "zh-CN": "Flags" },
  evaluationKind: { en: "Evaluation kind", "zh-CN": "题型" },
  lastRun: { en: "Last run", "zh-CN": "最近运行" },
  passRate: { en: "Pass rate", "zh-CN": "通过率" },
  totalScore: { en: "Total score", "zh-CN": "总分" },
  cost: { en: "Cost", "zh-CN": "成本" },
  tokens: { en: "Tokens", "zh-CN": "Tokens" },
  duration: { en: "Duration", "zh-CN": "耗时" },
  coverage: { en: "Coverage", "zh-CN": "覆盖" },
  result: { en: "Result", "zh-CN": "结果构成" },
  catchUp: { en: "Catch up", "zh-CN": "补跑" },
};

export type ExperimentDetailsProps = {
  /** 显式 experiment id;与 data 二选一(都省略时按完整用户反馈报错)。 */
  experiment?: ExperimentId;
  /** 已关闭的详情数据;省略时组件在 Sample 存活期间自行装配。 */
  data?: ExperimentDetailsData;
  locale?: ReportLocale;
  className?: string;
};

/** Eval → Attempt 层级表:attempt 行的 locator 是 attempt 详情目标(library-owned route)。 */
function evalListContent(view: ExperimentDetailsView): TableContent {
  const rows: TableContentRow[] = view.evalsView.map((entry) => ({
    key: entry.evalId,
    cells: {
      eval: { kind: "text", text: entry.evalId },
      attempt: { kind: "text", text: `${entry.attempts.length}` },
      status: entry.verdict === "unknown"
        ? { kind: "notApplicable" }
        : { kind: "verdict", verdict: entry.verdict },
    },
    subRows: entry.attempts.map((attempt) => ({
      key: attempt.locator,
      cells: {
        eval: { kind: "text", text: "" },
        attempt: { kind: "text", text: `#${attempt.attemptOrdinal + 1}` },
        status: {
          kind: "locator",
          locator: attempt.locator,
          ...(attempt.verdict === "unknown" ? {} : { verdict: attempt.verdict }),
        },
      },
    })),
  }));
  return {
    columns: [
      { key: "eval", header: localizedMessage("experimentList.experiment") },
      { key: "attempt", header: localizedMessage("experimentList.evalAttempt") },
      { key: "status", header: localizedMessage("experimentList.status") },
    ],
    rows,
  };
}

/** 公开 Experiment 详情组合;文档名 ExperimentDetails。 */
export const ExperimentDetails = defineComponent<ExperimentDetailsProps>(async (props, ctx) => {
  const data = props.data ?? await experimentDetailsData(ctx.scope, experimentIdOf(props, ctx), ctx.report.pricing);
  const exp = data.experiment;
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const identity = exp.identity;

  return (
    <Col className={cx("niceeval-experiment-details", props.className)}>
      {/* 实验身份:experiment id、agent、model、flags、题型、最近运行时间。 */}
      <Grid className="niceeval-experiment-identity">
        <Stat label={LABEL.experiment!} value={identity.experimentId} />
        <Stat label={LABEL.agent!} value={identity.agent} />
        {identity.model !== undefined ? <Stat label={LABEL.model!} value={identity.model} /> : null}
        {identity.flags !== undefined ? <Stat label={LABEL.flags!} value={JSON.stringify(identity.flags)} /> : null}
        <Stat label={LABEL.evaluationKind!} value={exp.evaluationKind} />
        {exp.lastRunAt !== null
          ? <Stat label={LABEL.lastRun!} value={formatInstant(new Date(exp.lastRunAt).toISOString(), locale)} />
          : null}
      </Grid>
      {/* 读数摘要:主读数(随题型选)、成本、tokens、耗时,以及 evals × attempts 覆盖。 */}
      <Grid className="niceeval-experiment-summary">
        {exp.metrics.passRate !== undefined ? (
          <Stat label={LABEL.passRate!} value={{ kind: "metric", metric: exp.metrics.passRate }} />
        ) : null}
        {exp.metrics.totalScore !== undefined ? (
          <Stat label={LABEL.totalScore!} value={exp.metrics.totalScore} />
        ) : null}
        {exp.metrics.costUSD !== undefined ? (
          <Stat label={LABEL.cost!} value={{ kind: "metric", metric: exp.metrics.costUSD }} />
        ) : null}
        {exp.metrics.tokens !== undefined ? (
          <Stat label={LABEL.tokens!} value={{ kind: "metric", metric: exp.metrics.tokens }} />
        ) : null}
        {exp.metrics.durationMs !== undefined ? (
          <Stat label={LABEL.duration!} value={{ kind: "metric", metric: exp.metrics.durationMs }} />
        ) : null}
        <Stat label={LABEL.coverage!} value={`${exp.evals} evals · ${exp.attempts} attempts`} />
      </Grid>
      {/* 结果构成:eval verdict 计票。 */}
      <Stat
        label={LABEL.result!}
        value={{
          kind: "verdict",
          counts: {
            passed: exp.evalVerdicts.passed,
            failed: exp.evalVerdicts.failed,
            errored: exp.evalVerdicts.errored,
            skipped: exp.evalVerdicts.skipped,
          },
        }}
      />
      {/* 题目清单(Eval → Attempt)与覆盖缺口(占位行)同一张层级表;缺口非空时下面再配补跑命令。 */}
      <TableContentView data={evalListContent(exp)} locale={locale} />
      {data.catchUpCommand !== null ? <CopyBlock title={LABEL.catchUp!} text={data.catchUpCommand} locale={locale} /> : null}
      {/* 实验级 notices:sample 选择问题、实验缺口与封口警告。 */}
      <Callouts items={data.notices} locale={locale} />
      <Callouts items={data.diagnostics} locale={locale} />
    </Col>
  );
});
ExperimentDetails.displayName = "ExperimentDetails";

function experimentIdOf(props: ExperimentDetailsProps, ctx: AuthorComposeContext): ExperimentId {
  if (props.experiment !== undefined) return props.experiment;
  throw new Error(
    "ExperimentDetails requires experiment={...} or data={...}; the fixed Sample cannot be narrowed by the component itself.",
  );
}
