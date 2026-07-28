// CopyBlock:一整块可复制的文本(docs/feature/reports/components/primitives/copy-block.md)。

import type { ReactNode } from "react";
import type { SourceInput } from "../../source.ts";
import { defineComponent } from "../tree.ts";
import { resolveLocalizedText, type LocalizedText, type ReportLocale } from "../../model/locale.ts";
import {
  dataShapeError,
  isLocalizedText,
  isObject,
  type DataProps,
} from "../../components/shared.ts";

export interface CopyBlockContent {
  text: string;
  title: LocalizedText;
}

export type CopyBlockProps<Input extends SourceInput = SourceInput> = DataProps<
  CopyBlockContent | null,
  globalThis.Record<never, never>,
  { locale?: ReportLocale; className?: string },
  Input
>;

function cx(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function validateCopyBlockContent(data: unknown): string | null {
  if (data === null) return null;
  if (!isObject(data)) return '"data" must be a CopyBlockContent object or null';
  if (!isLocalizedText(data.title)) return '"data.title" must be a LocalizedText';
  if (typeof data.text !== "string") return '"data.text" must be a string';
  return null;
}

function assertCopyBlockContent(data: unknown): CopyBlockContent | null {
  const problem = validateCopyBlockContent(data);
  if (problem !== null) throw dataShapeError("CopyBlock", "copyBlockData", "CopyBlockContent", problem);
  return data as CopyBlockContent | null;
}

function copyBlockWeb(
  data: CopyBlockContent,
  locale: ReportLocale,
  className?: string,
): ReactNode {
  return (
    <details className={cx("nre", "nre-copy-block", className)}>
      <summary className="nre-copy-block-summary">{resolveLocalizedText(data.title, locale)}</summary>
      <button type="button" className="nre-copy-block-copy" data-nre-copy={data.text}>
        Copy
      </button>
      <pre className="nre-copy-block-text">{data.text}</pre>
    </details>
  );
}

export const CopyBlock = defineComponent<CopyBlockProps>({
  dimensions: () => ({}),
  web(props, ctx) {
    const data = assertCopyBlockContent(props.data ?? null);
    if (data === null) return null;
    const locale = props.locale ?? ctx.locale;
    return copyBlockWeb(data, locale, props.className);
  },
  text(props) {
    const data = assertCopyBlockContent(props.data ?? null);
    if (data === null) return "";
    return "";
  },
});
CopyBlock.displayName = "CopyBlock";
