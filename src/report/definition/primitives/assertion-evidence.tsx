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

function label(locale: string, english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}

function scalarText(value: null | boolean | number | string): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function valueText(value: ClosedAssertionFactValue): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "value":
      return scalarText(value.value);
    case "unavailable":
      return value.reason;
    case "fields":
      return value.fields.map((field) => `${field.label}: ${valueText(field.value)}`).join("; ");
    case "list":
      return value.items.map(valueText).join("; ");
  }
}

function Value({ value }: { readonly value: ClosedAssertionFactValue }): ReactElement {
  switch (value.kind) {
    case "text":
      return <p>{value.text}</p>;
    case "value":
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
              <dd><Value value={field.value} /></dd>
            </div>
          ))}
        </dl>
      );
    case "list":
      return (
        <ul className="niceeval-assertion-evidence-list">
          {value.items.map((item, index) => <li key={index}><Value value={item} /></li>)}
        </ul>
      );
  }
}

function Section({ heading, value }: { readonly heading: string; readonly value: ClosedAssertionFactValue }): ReactElement {
  return (
    <section className="niceeval-assertion-evidence-section">
      <h5>{heading}</h5>
      <Value value={value} />
    </section>
  );
}

function web(content: AssertionEvidenceContent, locale: string): ReactElement {
  return (
    <div className="niceeval-assertion-evidence">
      <Section heading={label(locale, "Source", "来源")} value={content.source} />
      <Section heading={label(locale, "Check", "检查条件")} value={content.check} />
      <Section heading={label(locale, "Observed", "实际结果")} value={content.observed} />
      <Section heading={label(locale, "Expected", "预期结果")} value={content.expected} />
      <Section heading={label(locale, "Explanation", "解释")} value={content.explanation} />
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
