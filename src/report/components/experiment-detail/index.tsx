// Experiment 详情组合件:六区块用原语 + 公开 to* 装配(docs/feature/reports/README.md)。
// text/web 两面消费同一份 `toExperimentDetails` 转换结果,不各自取数。

import type { Sample } from "../../../record/types.ts";
import { defineComponent } from "../../definition/tree.ts";
import { Callouts, Col, CopyBlock, Grid, Stat, TableContentView } from "../../definition/primitives.tsx";
import { experimentListContent } from "../entity-lists/content.ts";
import { toExperimentDetails } from "../../model/conversions.ts";
import { DEFAULT_REPORT_LOCALE, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import { formatInstant } from "../../model/format.ts";
import { cx } from "../shared.ts";

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
  input?: Sample;
  locale?: ReportLocale;
  className?: string;
};

/** 公开 Experiment 详情组合;文档名 ExperimentDetails。 */
export const ExperimentDetails = defineComponent<ExperimentDetailsProps>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.scope;
  const data = await toExperimentDetails(input);
  const exp = data.experiment;
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;

  return (
    <Col className={cx("niceeval-experiment-details", props.className)}>
      {/* 实验身份:experiment id、agent、model、flags、题型、最近运行时间。 */}
      <Grid className="niceeval-experiment-identity">
        <Stat label={LABEL.experiment!} value={exp.experimentId} />
        <Stat label={LABEL.agent!} value={exp.agent} />
        {exp.model !== undefined ? <Stat label={LABEL.model!} value={exp.model} /> : null}
        {exp.flags !== undefined ? <Stat label={LABEL.flags!} value={JSON.stringify(exp.flags)} /> : null}
        <Stat label={LABEL.evaluationKind!} value={exp.evaluationKind} />
        <Stat label={LABEL.lastRun!} value={formatInstant(exp.lastRunAt, locale)} />
      </Grid>
      {/* 读数摘要:主读数(随题型选)、成本、tokens、耗时,以及 evals × attempts 覆盖。 */}
      <Grid className="niceeval-experiment-summary">
        {exp.evaluationKind !== "points" ? (
          <Stat label={LABEL.passRate!} value={{ kind: "metric", metric: exp.endToEndPassRate }} />
        ) : null}
        {exp.evaluationKind !== "pass" ? (
          <Stat label={LABEL.totalScore!} value={{ kind: "metric", metric: exp.totalScore }} />
        ) : null}
        <Stat label={LABEL.cost!} value={{ kind: "metric", metric: exp.costUSD }} />
        <Stat label={LABEL.tokens!} value={{ kind: "metric", metric: exp.tokens }} />
        <Stat label={LABEL.duration!} value={{ kind: "metric", metric: exp.durationMs }} />
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
      <TableContentView data={experimentListContent([exp])} locale={locale} />
      {data.catchUpCommand !== null ? <CopyBlock title={LABEL.catchUp!} text={data.catchUpCommand} locale={locale} /> : null}
      {/* 实验级 notices:experiment 收窄后的 sample notices 与 run diagnostics。 */}
      <Callouts items={data.notices} locale={locale} />
      <Callouts items={data.diagnostics} locale={locale} />
    </Col>
  );
});
ExperimentDetails.displayName = "ExperimentDetails";
