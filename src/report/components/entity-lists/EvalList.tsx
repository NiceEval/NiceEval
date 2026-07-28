// EvalList:实体列表的第二级——每项固定代表一个 experimentId + evalId(同一个 Eval 跑在
// 两个 experiment 上是两条不同结果,不合并)。父行是判定、Attempt 数、分数、成本与耗时的
// 题级聚合;零 JS 用原生 <details> 展开到这道题的 Attempt 列表(AttemptRow,与 AttemptList
// 同一份渲染逻辑),失败原因只在各 Attempt 子行出现。

import type { ReactElement } from "react";
import type { AttemptLocator } from "../../../record/locator.ts";
import type { EvalListItem } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, resolveLocalizedText, type ReportLocale } from "../../model/locale.ts";
import { AttemptRow, EvalHistoricalMark } from "./AttemptList.tsx";
import { formatDurationMs, formatUSD, verdictMark } from "../../model/format.ts";
import { cx } from "../shared.ts";

const DEFAULT_ATTEMPT_HREF = (locator: AttemptLocator): string => `#/attempt/${locator}`;

function EvalRow({
  item,
  attemptHref,
  locale,
}: {
  item: EvalListItem;
  attemptHref: (locator: AttemptLocator) => string;
  locale: ReportLocale;
}): ReactElement {
  const duration = item.durationMs.value === null ? localeText(locale, "cell.missing") : formatDurationMs(item.durationMs.value);
  const cost = item.costUSD.value === null ? localeText(locale, "cell.missing") : formatUSD(item.costUSD.value);
  const summary = (
    <summary className="nre-eval-summary">
      <span className={cx("nre-eval-verdict", `nre-verdict-${item.verdict}`)}>{verdictMark(item.verdict)}</span>
      <span className="nre-eval-id">{item.evalId}</span>
      <EvalHistoricalMark attempts={item.attempts} />
      <span className="nre-eval-experiment">{item.experimentId}</span>
      <span className="nre-eval-score">{resolveLocalizedText(item.examScore.display, locale)}</span>
      <span className="nre-eval-attempts-count">
        {localeText(locale, "overview.attemptsCount", { n: item.attempts.length })}
      </span>
      <span className="nre-eval-duration">{localeText(locale, "entityList.average", { value: duration })}</span>
      <span className="nre-eval-cost">{localeText(locale, "entityList.average", { value: cost })}</span>
    </summary>
  );
  return (
    <li className={cx("nre-eval", `nre-eval-${item.verdict}`)}>
      <details className="nre-eval-details">
        {summary}
        <ul className="nre-attempts">
          {item.attempts.map((attempt) => (
            <AttemptRow key={attempt.locator} item={attempt} attemptHref={attemptHref} locale={locale} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function EvalList({
  data,
  attemptHref = DEFAULT_ATTEMPT_HREF,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: readonly EvalListItem[];
  attemptHref?: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  return (
    <section className={cx("nre", "nre-eval-list", className)}>
      {data.length === 0 && <p className="nre-eval-list-empty">{localeText(locale, "attemptList.empty")}</p>}
      <ul className="nre-evals">
        {data.map((item) => (
          <EvalRow key={`${item.experimentId}\u0000${item.evalId}`} item={item} attemptHref={attemptHref} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
