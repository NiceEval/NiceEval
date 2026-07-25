// CopyFixPrompt:批量修复 prompt 的 web 面。prompt 在 resolve 阶段算好、烘进静态 HTML;
// 无 JS 时 prompt 全文在原生 <details> 折叠块里完整可读,「复制到剪贴板」是 enhance.js 的
// 增强行为(data-nre-copy),增强只加浏览行为、不改内容。failures 为 0 时零输出
// (docs/feature/reports/components/site/copy-fix-prompt.md)。

import type { ReactElement } from "react";
import type { CopyFixPromptData } from "../../model/types.ts";
import { DEFAULT_REPORT_LOCALE, countText, localeText, type ReportLocale } from "../../model/locale.ts";
import { cx } from "../shared.ts";

/**
 * 批量修复 prompt(纯 web 渲染面):折叠块内完整 prompt 文本 + 复制按钮(增强层)。
 * 嵌入自有 React 页面时配合 `copyFixPromptData()` 使用;failures 为 0 返回 null。
 */
export function CopyFixPrompt({
  data,
  className,
  locale = DEFAULT_REPORT_LOCALE,
}: {
  data: CopyFixPromptData;
  className?: string;
  locale?: ReportLocale;
}): ReactElement | null {
  if (data.failures === 0) return null;
  return (
    <details className={cx("nre", "nre-copy-fix-prompt", className)}>
      <summary className="nre-copy-fix-prompt-summary">
        {countText(locale, "copyFixPrompt.summary", data.failures)}
      </summary>
      {/* 无 JS 时按钮静默无功能(与过滤框同一约定);prompt 文本本身始终完整可读 */}
      <button type="button" className="nre-copy-fix-prompt-copy" data-nre-copy={data.prompt}>
        {localeText(locale, "copyFixPrompt.copy")}
      </button>
      <pre className="nre-copy-fix-prompt-text">{data.prompt}</pre>
    </details>
  );
}
