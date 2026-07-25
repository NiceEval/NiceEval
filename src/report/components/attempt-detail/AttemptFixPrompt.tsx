// AttemptFixPrompt:单条 attempt 的复制修复 prompt。passed 或没有可操作失败时零输出
// (docs/feature/reports/components/attempt-detail.md)。与 CopyFixPrompt 同一套增强约定:
// prompt 在 resolve 阶段算好、烘进静态 HTML,复制按钮是 enhance.js 的增强行为。

import type { ReactElement } from "react";
import type { AttemptFixPromptData } from "../../model/types.ts";
import { cx } from "../shared.ts";

export function AttemptFixPrompt({
  data,
  className,
}: {
  data: AttemptFixPromptData | null;
  className?: string;
}): ReactElement | null {
  if (data === null) return null;
  return (
    <details className={cx("nre", "nre-attempt-fix-prompt", className)}>
      <summary className="nre-attempt-fix-prompt-summary">Fix prompt</summary>
      <button type="button" className="nre-attempt-fix-prompt-copy" data-nre-copy={data.prompt}>
        Copy fix prompt
      </button>
      <pre className="nre-attempt-fix-prompt-text">{data.prompt}</pre>
    </details>
  );
}
