// AssertionEvidence: neutral structured projection of one sealed assertion.

import type { ReactElement } from "react";
import type { ClosedAssertionFactValue } from "../../../analysis/index.ts";
import { defineComponent } from "../tree.ts";

export interface AssertionEvidenceContent {
  readonly source: ClosedAssertionFactValue;
  readonly check: ClosedAssertionFactValue;
  readonly observed: ClosedAssertionFactValue;
  readonly expected: ClosedAssertionFactValue;
  readonly explanation: ClosedAssertionFactValue;
}

const INLINE_STRING_CHARACTER_LIMIT = 240;
const STRING_PREVIEW_CHARACTER_LIMIT = 120;

function label(locale: string, english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}

function scalarText(value: null | boolean | number | string): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function characters(value: string): readonly string[] {
  return Array.from(value);
}

function compactString(value: string): string {
  const content = characters(value);
  if (content.length <= INLINE_STRING_CHARACTER_LIMIT) return value;
  return `${content.slice(0, STRING_PREVIEW_CHARACTER_LIMIT).join("")}… (${content.length} characters)`;
}

function compactScalarText(value: string): string {
  const content = characters(value);
  if (content.length <= INLINE_STRING_CHARACTER_LIMIT) return JSON.stringify(value);
  const preview = content.slice(0, STRING_PREVIEW_CHARACTER_LIMIT).join("");
  return `${JSON.stringify(preview)}… (${content.length} characters)`;
}

function stringSummary(value: string, locale: string): string {
  const content = characters(value);
  const preview = content.slice(0, STRING_PREVIEW_CHARACTER_LIMIT).join("");
  const unit = label(locale, content.length === 1 ? "character" : "characters", "字符");
  return `${content.length} ${unit} · ${JSON.stringify(preview)}…`;
}

function valueText(value: ClosedAssertionFactValue): string {
  switch (value.kind) {
    case "text":
      return compactString(value.text);
    case "value":
      return typeof value.value === "string"
        ? compactScalarText(value.value)
        : scalarText(value.value);
    case "unavailable":
      return value.reason;
    case "fields":
      return value.fields.map((field) => `${field.label}: ${valueText(field.value)}`).join("; ");
    case "list":
      return value.items.map(valueText).join("; ");
  }
}

function LongString({ value, locale, quoted }: {
  readonly value: string;
  readonly locale: string;
  readonly quoted: boolean;
}): ReactElement {
  return (
    <details className="niceeval-assertion-evidence-long-value">
      <summary>{stringSummary(value, locale)}</summary>
      <pre className="niceeval-assertion-evidence-code">{quoted ? JSON.stringify(value) : value}</pre>
    </details>
  );
}

function Value({ value, locale }: {
  readonly value: ClosedAssertionFactValue;
  readonly locale: string;
}): ReactElement {
  switch (value.kind) {
    case "text":
      return characters(value.text).length > INLINE_STRING_CHARACTER_LIMIT
        ? <LongString value={value.text} locale={locale} quoted={false} />
        : <p>{value.text}</p>;
    case "value":
      if (typeof value.value === "string" && characters(value.value).length > INLINE_STRING_CHARACTER_LIMIT) {
        return <LongString value={value.value} locale={locale} quoted />;
      }
      return <pre className="niceeval-assertion-evidence-code">{scalarText(value.value)}</pre>;
    case "unavailable":
      return (
        <p className="niceeval-assertion-evidence-state">
          <code>unavailable</code>
          <span>{value.reason}</span>
        </p>
      );
    case "fields":
      return (
        <dl className="niceeval-assertion-evidence-fields">
          {value.fields.map((field, index) => (
            <div key={`${field.label}:${index}`}>
              <dt>{field.label}</dt>
              <dd><Value value={field.value} locale={locale} /></dd>
            </div>
          ))}
        </dl>
      );
    case "list":
      return (
        <ul className="niceeval-assertion-evidence-list">
          {value.items.map((item, index) => <li key={index}><Value value={item} locale={locale} /></li>)}
        </ul>
      );
  }
}

function Section({ heading, value, locale }: {
  readonly heading: string;
  readonly value: ClosedAssertionFactValue;
  readonly locale: string;
}): ReactElement {
  return (
    <section className="niceeval-assertion-evidence-section">
      <h5>{heading}</h5>
      <Value value={value} locale={locale} />
    </section>
  );
}

function web(content: AssertionEvidenceContent, locale: string): ReactElement {
  return (
    <div className="niceeval-assertion-evidence">
      <Section heading={label(locale, "Source", "来源")} value={content.source} locale={locale} />
      <Section heading={label(locale, "Check", "检查条件")} value={content.check} locale={locale} />
      <Section heading={label(locale, "Observed", "实际结果")} value={content.observed} locale={locale} />
      <Section heading={label(locale, "Expected", "预期结果")} value={content.expected} locale={locale} />
      <Section heading={label(locale, "Explanation", "解释")} value={content.explanation} locale={locale} />
    </div>
  );
}

export const AssertionEvidence = defineComponent<{ readonly content: AssertionEvidenceContent }>({
  dimensions: () => ({}),
  text({ content }) {
    return [
      `Source: ${valueText(content.source)}`,
      `Check: ${valueText(content.check)}`,
      `Observed: ${valueText(content.observed)}`,
      `Expected: ${valueText(content.expected)}`,
      `Explanation: ${valueText(content.explanation)}`,
    ].join("\n");
  },
  web({ content }, ctx) {
    return web(content, ctx.locale);
  },
});

AssertionEvidence.displayName = "AssertionEvidence";
