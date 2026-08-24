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

type MatchState = "matched" | "mismatched" | "unavailable";

interface MatchDiagnosticView {
  readonly code?: string;
  readonly expected?: string;
  readonly received?: string;
  readonly reason?: string;
  readonly locator?: string;
  readonly children: readonly MatchChildView[];
}

interface MatchChildView {
  readonly label: string;
  readonly state: MatchState;
  readonly diagnostic: MatchDiagnosticView | null;
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

function field(value: ClosedAssertionFactValue | undefined, name: string): ClosedAssertionFactValue | undefined {
  return value?.kind === "fields"
    ? value.fields.find((entry) => entry.label === name)?.value
    : undefined;
}

function stringValue(value: ClosedAssertionFactValue | undefined): string | undefined {
  return value?.kind === "value" && typeof value.value === "string" ? value.value : undefined;
}

function numberValue(value: ClosedAssertionFactValue | undefined): number | undefined {
  return value?.kind === "value" && typeof value.value === "number" ? value.value : undefined;
}

function matcherName(check: ClosedAssertionFactValue): string | undefined {
  const data = field(check, "data");
  const valueMatcher = stringValue(field(field(data, "matcher"), "name"));
  if (valueMatcher !== undefined) return valueMatcher;
  if (criterionId(check) !== "occurrence/v1" || stringValue(field(data, "occurrence")) !== "tool") {
    return undefined;
  }
  const toolMatcher = stringValue(field(data, "matcher"));
  if (toolMatcher === undefined) return undefined;
  return stringValue(field(data, "assertion")) === "absent"
    ? `notCalledTool(${toolMatcher})`
    : `calledTool(${toolMatcher})`;
}

function matchState(value: ClosedAssertionFactValue | undefined): MatchState | undefined {
  const state = stringValue(value);
  return state === "matched" || state === "mismatched" || state === "unavailable" ? state : undefined;
}

function diagnosticView(value: ClosedAssertionFactValue | undefined): MatchDiagnosticView | null {
  if (value?.kind !== "fields") return null;
  const childrenValue = field(value, "children");
  const children = childrenValue?.kind === "list"
    ? childrenValue.items.flatMap((item, index): MatchChildView[] => {
        const state = matchState(field(item, "state"));
        if (state === undefined) return [];
        return [{
          label: stringValue(field(item, "label")) ?? `matcher ${index + 1}`,
          state,
          diagnostic: diagnosticView(field(item, "diagnostic")),
        }];
      })
    : [];
  return {
    code: stringValue(field(value, "code")),
    expected: stringValue(field(value, "expected")),
    received: stringValue(field(value, "received")),
    reason: stringValue(field(value, "reason")),
    locator: stringValue(field(field(value, "locator"), "id")),
    children,
  };
}

function criterionId(check: ClosedAssertionFactValue): string | undefined {
  return stringValue(field(check, "id"));
}

function isToolCriterion(check: ClosedAssertionFactValue): boolean {
  return criterionId(check) === "occurrence/v1" &&
    stringValue(field(field(check, "data"), "occurrence")) === "tool";
}

function semanticExpected(expected: ClosedAssertionFactValue): ClosedAssertionFactValue | undefined {
  const kind = stringValue(field(expected, "kind"));
  if (kind === "at-least") {
    const threshold = numberValue(field(expected, "threshold"));
    return threshold === undefined ? undefined : { kind: "text", text: `≥ ${threshold}` };
  }
  return kind === undefined ? expected : undefined;
}

function semanticObserved(observed: ClosedAssertionFactValue): ClosedAssertionFactValue | undefined {
  return field(observed, "value");
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
        <details className="niceeval-assertion-evidence-collection">
          <summary><code>{`Array(${value.items.length})`}</code></summary>
          <ol className="niceeval-assertion-evidence-list">
            {value.items.map((item, index) => <li key={index}><Value value={item} locale={locale} /></li>)}
          </ol>
        </details>
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

function SemanticFacts({ rows }: {
  readonly rows: readonly { readonly label: string; readonly value: string }[];
}): ReactElement {
  return (
    <dl className="niceeval-match-facts">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DiagnosticFacts({ diagnostic, locale }: {
  readonly diagnostic: MatchDiagnosticView;
  readonly locale: string;
}): ReactElement | null {
  const rows = [
    ...(diagnostic.expected === undefined ? [] : [{
      label: label(locale, "Expected", "预期"),
      value: diagnostic.expected,
    }]),
    ...(diagnostic.received === undefined ? [] : [{
      label: label(locale, "Observed", "实际"),
      value: diagnostic.received,
    }]),
    ...(diagnostic.locator === undefined ? [] : [{
      label: label(locale, "Call", "调用"),
      value: diagnostic.locator,
    }]),
    ...(diagnostic.reason === undefined ? [] : [{
      label: label(locale, "Reason", "原因"),
      value: diagnostic.reason,
    }]),
  ];
  return rows.length === 0 ? null : <SemanticFacts rows={rows} />;
}

function CommandEvidence({ input, diagnostic, locale }: {
  readonly input: ClosedAssertionFactValue;
  readonly diagnostic: MatchDiagnosticView | null;
  readonly locale: string;
}): ReactElement {
  const command = stringValue(field(input, "command"));
  const exitCode = numberValue(field(input, "exitCode"));
  const rows = [
    ...(command === undefined ? [] : [{ label: label(locale, "Command", "命令"), value: command }]),
    ...(exitCode === undefined ? [] : [{
      label: label(locale, "Result", "结果"),
      value: label(locale, `Exit code ${exitCode}`, `退出码 ${exitCode}`),
    }]),
    ...(diagnostic?.expected === undefined ? [] : [{
      label: label(locale, "Expected", "预期"),
      value: diagnostic.expected,
    }]),
  ];
  return (
    <section className="niceeval-assertion-evidence-section">
      <h5>{label(locale, "Command result", "命令结果")}</h5>
      <SemanticFacts rows={rows} />
    </section>
  );
}

function ToolEvidence({ observed, diagnostic, locale }: {
  readonly observed: ClosedAssertionFactValue;
  readonly diagnostic: MatchDiagnosticView | null;
  readonly locale: string;
}): ReactElement {
  const receipt = field(observed, "receipt");
  const examined = numberValue(field(receipt, "examined"));
  const rows = [
    ...(diagnostic?.expected === undefined ? [] : [{
      label: label(locale, "Expected", "预期"),
      value: diagnostic.expected,
    }]),
    ...(diagnostic?.received === undefined ? [] : [{
      label: label(locale, "Observed", "实际"),
      value: diagnostic.received,
    }]),
    ...(examined === undefined ? [] : [{
      label: label(locale, "Examined", "已检查"),
      value: label(locale, `${examined} tool call${examined === 1 ? "" : "s"}`, `${examined} 次工具调用`),
    }]),
  ];
  return (
    <section className="niceeval-assertion-evidence-section">
      <h5>{label(locale, "Tool calls", "工具调用")}</h5>
      <SemanticFacts rows={rows} />
    </section>
  );
}

function GenericEvidence({ content, input, diagnostic, locale }: {
  readonly content: AssertionEvidenceContent;
  readonly input: ClosedAssertionFactValue;
  readonly diagnostic: MatchDiagnosticView | null;
  readonly locale: string;
}): ReactElement {
  const expected = diagnostic?.expected === undefined
    ? semanticExpected(content.expected)
    : { kind: "text" as const, text: diagnostic.expected };
  const received = diagnostic?.received === undefined
    ? semanticObserved(content.observed)
    : { kind: "text" as const, text: diagnostic.received };
  return (
    <div className="niceeval-match-evidence-grid">
      <Section heading={label(locale, "Input", "输入")} value={input} locale={locale} />
      {received === undefined ? null : (
        <Section heading={label(locale, "Observed", "实际结果")} value={received} locale={locale} />
      )}
      {expected === undefined ? null : (
        <Section heading={label(locale, "Expected", "预期结果")} value={expected} locale={locale} />
      )}
    </div>
  );
}

function CoverageNotice({ source, locale }: {
  readonly source: ClosedAssertionFactValue;
  readonly locale: string;
}): ReactElement | null {
  const coverage = field(source, "coverage");
  const state = stringValue(field(coverage, "state"));
  if (state === undefined || state === "complete") return null;
  const reason = stringValue(field(coverage, "reason"));
  const limitations = field(source, "limitations");
  const omitted = limitations?.kind === "list"
    ? limitations.items.map((item) => numberValue(field(item, "omittedBytes"))).find((value) => value !== undefined)
    : undefined;
  const detail = [
    reason,
    omitted === undefined
      ? undefined
      : label(locale, `${omitted} bytes omitted`, `省略 ${omitted} 字节`),
  ].filter((part): part is string => part !== undefined).join(" · ");
  return (
    <p className="niceeval-match-coverage">
      {label(locale, `Input evidence ${state}`, `输入证据${state === "partial" ? "不完整" : "不可用"}`)}
      {detail.length === 0 ? "" : ` · ${detail}`}
    </p>
  );
}

function stateLabel(state: MatchState, locale: string): string {
  if (locale === "zh-CN") {
    if (state === "matched") return "命中";
    if (state === "mismatched") return "未命中";
    return "无法判断";
  }
  return state;
}

function MatchNode({ label: nodeLabel, state, diagnostic, locale, root = false, children }: {
  readonly label: string;
  readonly state: MatchState;
  readonly diagnostic: MatchDiagnosticView | null;
  readonly locale: string;
  readonly root?: boolean;
  readonly children?: ReactElement;
}): ReactElement {
  const accessibleLabel = `${nodeLabel}: ${stateLabel(state, locale)}`;
  const summary = (
    <span className={`niceeval-match-summary niceeval-match-summary--${state}`}>
      <code>{nodeLabel}</code>
    </span>
  );
  const nested = diagnostic?.children ?? [];
  const body = diagnostic !== null || children !== undefined
    ? (
        <div className="niceeval-match-detail">
          {nested.length > 0 ? (
            <div className="niceeval-match-children">
              {nested.map((child, index) => (
                <MatchNode
                  key={`${child.label}:${index}`}
                  label={child.label}
                  state={child.state}
                  diagnostic={child.diagnostic}
                  locale={locale}
                />
              ))}
            </div>
          ) : null}
          {root || diagnostic === null ? null : <DiagnosticFacts diagnostic={diagnostic} locale={locale} />}
          {children}
        </div>
      )
    : null;
  if (body === null) return <div className="niceeval-match-node" aria-label={accessibleLabel}>{summary}</div>;
  return (
    <details className={`niceeval-match-node${root ? " niceeval-match-node--root" : ""}`}>
      <summary aria-label={accessibleLabel}>{summary}</summary>
      {body}
    </details>
  );
}

function web(
  content: AssertionEvidenceContent,
  locale: string,
  labelText: string | undefined,
  state: MatchState,
): ReactElement {
  const diagnostic = diagnosticView(content.explanation);
  const name = matcherName(content.check) ?? labelText ?? label(locale, "Match", "检查");
  const input = field(content.source, "input") ?? content.source;
  const code = diagnostic?.code;
  const primary = code === "command-succeeded" || code === "command-failed"
    ? <CommandEvidence input={input} diagnostic={diagnostic} locale={locale} />
    : isToolCriterion(content.check)
      ? <ToolEvidence observed={content.observed} diagnostic={diagnostic} locale={locale} />
      : <GenericEvidence content={content} input={input} diagnostic={diagnostic} locale={locale} />;
  return (
    <div className="niceeval-assertion-evidence">
      <MatchNode label={name} state={state} diagnostic={diagnostic} locale={locale} root>
        <div className="niceeval-match-body">
          {primary}
          <CoverageNotice source={content.source} locale={locale} />
          <details className="niceeval-match-raw">
            <summary>{label(locale, "Raw assertion data", "原始断言数据")}</summary>
            <div>
              <Section heading={label(locale, "Source", "来源")} value={content.source} locale={locale} />
              <Section heading={label(locale, "Check", "检查条件")} value={content.check} locale={locale} />
              <Section heading={label(locale, "Explanation", "解释")} value={content.explanation} locale={locale} />
            </div>
          </details>
        </div>
      </MatchNode>
    </div>
  );
}

export const AssertionEvidence = defineComponent<{
  readonly content: AssertionEvidenceContent;
  readonly label?: string;
  readonly state?: MatchState;
}>({
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
  web({ content, label: labelText, state }, ctx) {
    return web(content, ctx.locale, labelText, state ?? "unavailable");
  },
});

AssertionEvidence.displayName = "AssertionEvidence";
