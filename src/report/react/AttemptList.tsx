// AttemptList:实体列表的叶子层——每项一个 Attempt,固定展示判定、断言、error、Judge 评语
// (assertions 的 detail/evidence)与证据引用(locator)。它不预设只看失败,
// 报告作者过滤 items、用 .slice() 限量,total 让渲染面如实报告剩余数量,不静默截断。
// ExperimentList / EvalList 的下钻数组是同一个 AttemptListItem[],这里的渲染逻辑因此
// 也是它们展开区里"逐条 attempt"那一层的唯一实现(通过 AttemptRow 导出复用,不重写一遍)。

import type { ReactElement } from "react";
import type { AttemptListItem } from "../types.ts";
import type { AttemptLocator } from "../../results/locator.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../locale.ts";
import { colorClassForKey } from "./colors.ts";
import { cx, formatDurationMs, formatUSD, verdictMark } from "./format.ts";

/** locator + 判定符的普通 <a>,AttemptList/EvalList/ExperimentList 共用。 */
export function AttemptLocatorBadge({
  item,
  attemptHref,
}: {
  item: Pick<AttemptListItem, "locator" | "verdict">;
  attemptHref: (locator: AttemptLocator) => string;
}): ReactElement {
  return (
    <a
      className={cx("nre-locator", `nre-verdict-${item.verdict}`)}
      href={attemptHref(item.locator)}
    >
      {item.locator}
      <span className="nre-locator-mark">{verdictMark(item.verdict)}</span>
    </a>
  );
}

function AssertionRow({ assertion, locale }: { assertion: AttemptListItem["assertions"][number]; locale: ReportLocale }): ReactElement {
  const unavailable = assertion.outcome === "unavailable";
  return (
    <li
      className={cx(
        "nre-assertion",
        `nre-assertion-${assertion.severity}`,
        assertion.outcome === "failed" && "nre-assertion-failed",
        unavailable && "nre-assertion-unavailable",
      )}
    >
      <span className="nre-assertion-severity">{assertion.severity}</span>
      <span className="nre-assertion-name">{assertion.name}</span>
      <span className="nre-assertion-score">
        {unavailable
          ? localeText(locale, "attemptList.unavailable")
          : localeText(locale, "attemptList.score", { score: assertion.score })}
      </span>
      {unavailable && assertion.outcome === "unavailable" && (
        <p className="nre-assertion-detail">{assertion.reason}</p>
      )}
      {(assertion.detail || (assertion.outcome !== "unavailable" && assertion.evidence)) && (
        <details className="nre-assertion-more">
          <summary>{localeText(locale, "attemptList.details")}</summary>
          {assertion.detail && <p className="nre-assertion-detail">{assertion.detail}</p>}
          {assertion.outcome !== "unavailable" && assertion.evidence && (
            <blockquote className="nre-assertion-evidence">{assertion.evidence}</blockquote>
          )}
        </details>
      )}
    </li>
  );
}

/** 一条 Attempt 的完整卡片:AttemptList 自己的一项,也是 EvalList 展开区里的一行。 */
export function AttemptRow({
  item,
  attemptHref,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  item: AttemptListItem;
  attemptHref: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
}): ReactElement {
  return (
    <li className={cx("nre-attempt", `nre-attempt-${item.verdict}`)}>
      <div className="nre-attempt-head">
        <AttemptLocatorBadge item={item} attemptHref={attemptHref} />
        <span className="nre-attempt-eval">{item.evalId}</span>
        <span className="nre-attempt-experiment">{item.experimentId}</span>
        {/* agent 键:稳定散列上色,与其它块(MetricMatrix 列头、DeltaTable 行…)同键同色 */}
        <span className={cx("nre-attempt-agent", "nre-key", colorClassForKey(item.agent))}>{item.agent}</span>
        <span className="nre-attempt-duration">{formatDurationMs(item.durationMs)}</span>
        {item.costUSD !== undefined && <span className="nre-attempt-cost">{formatUSD(item.costUSD)}</span>}
      </div>
      {/* 结构化 error 只显示一层摘要;cause/stack/diagnostics 属于 locator 下钻详情,不塞进列表 */}
      {item.error && <p className="nre-attempt-error">{item.error.message}</p>}
      {item.assertions.length > 0 && (
        <ul className="nre-assertions">
          {item.assertions.map((a, i) => (
            <AssertionRow key={i} assertion={a} locale={locale} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AttemptList({
  items,
  total,
  attemptHref,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  items: AttemptListItem[];
  /** items 被 slice 时的原始数量;如实显示还剩多少条没展示。 */
  total?: number;
  attemptHref: (locator: AttemptLocator) => string;
  className?: string;
  locale?: ReportLocale;
}): ReactElement {
  const remaining = (total ?? items.length) - items.length;
  return (
    <section className={cx("nre", "nre-attempt-list", className)}>
      {items.length === 0 && <p className="nre-attempt-list-empty">{localeText(locale, "attemptList.empty")}</p>}
      <ul className="nre-attempts">
        {items.map((item) => (
          <AttemptRow key={item.locator} item={item} attemptHref={attemptHref} locale={locale} />
        ))}
      </ul>
      {remaining > 0 && (
        <p className="nre-truncated">{localeText(locale, "attemptList.truncated", { n: remaining })}</p>
      )}
    </section>
  );
}
