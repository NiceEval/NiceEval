// CopyBlock:一整块可复制的文本(docs/feature/reports/README.md)。

import type { ReactNode } from "react";
import { defineComponent } from "../tree.ts";
import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import {
  dataShapeError,
  isLocalizedText,
  isObject,
} from "../../components/shared.ts";

export interface CopyBlockContent {
  text: string;
  title: LocalizedText;
}

export type CopyBlockProps = {
  title: LocalizedText;
  text: string;
  locale?: ReportLocale;
  className?: string;
} | {
  /** 无可复制文本时传 null，两面零输出。 */
  content: CopyBlockContent | null;
  title?: never;
  text?: never;
  locale?: ReportLocale;
  className?: string;
};

function cx(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function validateCopyBlockContent(data: unknown): string | null {
  if (data === null) return null;
  if (!isObject(data)) return '"content" must be a CopyBlockContent object or null';
  if (!isLocalizedText(data.title)) return '"content.title" must be a LocalizedText';
  if (typeof data.text !== "string") return '"content.text" must be a string';
  return null;
}

function resolveCopyBlock(props: CopyBlockProps): CopyBlockContent | null {
  if ("content" in props) {
    const problem = validateCopyBlockContent(props.content);
    if (problem !== null) throw dataShapeError("CopyBlock", "toSampleFixPrompt", "CopyBlockContent", problem);
    return props.content;
  }
  if (!isLocalizedText(props.title)) {
    throw dataShapeError("CopyBlock", "toSampleFixPrompt", "CopyBlockContent", '"title" must be a LocalizedText');
  }
  if (typeof props.text !== "string") {
    throw dataShapeError("CopyBlock", "toSampleFixPrompt", "CopyBlockContent", '"text" must be a string');
  }
  return { title: props.title, text: props.text };
}

function copyBlockWeb(
  data: CopyBlockContent,
  locale: ReportLocale,
  className?: string,
): ReactNode {
  return (
    <details className={cx("niceeval-report", "niceeval-copy-block", className)}>
      <summary className="niceeval-copy-block-summary">{resolveLocalizedText(data.title, locale)}</summary>
      <button type="button" className="niceeval-copy-block-copy" data-niceeval-copy={data.text}>
        Copy
      </button>
      <pre className="niceeval-copy-block-text">{data.text}</pre>
    </details>
  );
}

export const CopyBlock = defineComponent<CopyBlockProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const data = resolveCopyBlock(props);
    if (data === null) return null;
    const locale = props.locale ?? ctx.locale;
    return copyBlockWeb(data, locale, props.className);
  },
  text(props) {
    resolveCopyBlock(props);
    return "";
  },
});
CopyBlock.displayName = "CopyBlock";
