// AttemptError:结构化 error 明细。没有 error 时零输出(docs/feature/reports/components/attempt-detail/README.md)。
// 字段标签是低层技术标识,与终端 `niceeval show` 一样保持英文,不进 view 的 i18n 词典。

import type { ReactElement } from "react";
import { Fragment } from "react";
import type { AttemptErrorData } from "../../model/types.ts";
import { cx } from "../shared.ts";

export function AttemptError({ data, className }: { data: AttemptErrorData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const rows: [string, string][] = [
    ["phase", data.phase],
    ["code", data.code],
    ["message", data.message],
  ];
  if (data.cause) rows.push(["cause", data.cause.name ? `${data.cause.name} · ${data.cause.message}` : data.cause.message]);
  const stack = data.stack?.replace(/\n+$/, "") ?? "";
  // message 疑似只剩截断尾部时,提示失败命令证据的完整下钻入口(docs/feature/reports/show/execution.md)。
  const commandEvidenceHint = data.commandEvidenceHint ? `niceeval show ${data.locator} --execution` : undefined;
  return (
    <div className={cx("nre", "nre-attempt-error", className)}>
      <dl className="nre-attempt-error-fields">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      {stack ? <pre className="nre-attempt-error-stack">{stack}</pre> : null}
      {commandEvidenceHint ? <div className="nre-attempt-error-command-hint">failed command evidence: {commandEvidenceHint}</div> : null}
    </div>
  );
}
