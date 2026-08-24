// AssertionEvidence: neutral structured projection of one sealed assertion.

import type { ReactElement } from "react";
import type { ClosedAssertionFactValue } from "../../../analysis/index.ts";
import type { ReportLocale } from "../../model/locale.ts";
import { defineComponent } from "../tree.ts";
import {
  MatcherFilterDebugger,
  matcherFilterDebuggerText,
  type MatcherFilterDebuggerContent,
} from "./matcher-filter-debugger.tsx";

export interface AssertionEvidenceContent {
  readonly source: ClosedAssertionFactValue;
  readonly check: ClosedAssertionFactValue;
  readonly observed: ClosedAssertionFactValue;
  readonly expected: ClosedAssertionFactValue;
  readonly explanation: ClosedAssertionFactValue;
  readonly matcherDebugger?: MatcherFilterDebuggerContent;
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
  readonly index: number;
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
  if (criterionId(check) === "numeric-comparison/v1") {
    const comparator = stringValue(field(data, "comparator"));
    const threshold = numberValue(field(data, "threshold"));
    if (comparator !== undefined && threshold !== undefined) {
      const name = comparator === "less-than"
        ? "lessThan"
        : comparator === "at-most"
        ? "atMost"
        : comparator === "greater-than"
        ? "greaterThan"
        : comparator === "at-least"
        ? "atLeast"
        : undefined;
      if (name !== undefined) return `${name}(${threshold})`;
    }
  }
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
          index: numberValue(field(item, "index")) ?? index,
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

type NumericComparator = "less-than" | "at-most" | "greater-than" | "at-least";
type NumericMaterialState = "exact" | "lower-bound" | "unavailable";

interface NumericComparisonView {
  readonly comparator: NumericComparator;
  readonly threshold: number;
  readonly subject: {
    readonly kind: "explicit-value" | "scope-metric";
    readonly metric?: "tokens" | "cost";
    readonly scope?: "turn" | "session" | "attempt";
    readonly unit?: "tokens" | "usd";
  };
  readonly material: {
    readonly state: NumericMaterialState;
    readonly value?: number;
    readonly reason?: string;
    readonly derivation?: ClosedAssertionFactValue;
  };
}

interface PricingChargeView {
  readonly bucket: "input" | "output" | "cache-read" | "cache-write";
  readonly tokens: number;
  readonly rateUSDPerMTok: number;
  readonly amountUSD: number;
}

interface PricingReceiptView {
  readonly model: string;
  readonly sourceKind: "configured-override" | "builtin";
  readonly sourceSelector: string;
  readonly charges: readonly PricingChargeView[];
  readonly amountUSD: number;
}

function numericComparator(value: string | undefined): NumericComparator | undefined {
  return value === "less-than" || value === "at-most" || value === "greater-than" || value === "at-least"
    ? value
    : undefined;
}

function numericMaterialState(value: string | undefined): NumericMaterialState | undefined {
  return value === "exact" || value === "lower-bound" || value === "unavailable" ? value : undefined;
}

function numericComparisonView(
  check: ClosedAssertionFactValue,
  source: ClosedAssertionFactValue,
): NumericComparisonView | undefined {
  if (criterionId(check) !== "numeric-comparison/v1") return undefined;
  const data = field(check, "data");
  const comparator = numericComparator(stringValue(field(data, "comparator")));
  const threshold = numberValue(field(data, "threshold"));
  const subjectValue = field(data, "subject");
  const subjectKind = stringValue(field(subjectValue, "kind"));
  const input = field(source, "input");
  const materialState = numericMaterialState(stringValue(field(input, "state")));
  if (
    comparator === undefined || threshold === undefined || materialState === undefined ||
    (subjectKind !== "explicit-value" && subjectKind !== "scope-metric")
  ) return undefined;
  const metric = stringValue(field(subjectValue, "metric"));
  const scope = stringValue(field(subjectValue, "scope"));
  const unit = stringValue(field(subjectValue, "unit"));
  return {
    comparator,
    threshold,
    subject: {
      kind: subjectKind,
      ...(metric === "tokens" || metric === "cost" ? { metric } : {}),
      ...(scope === "turn" || scope === "session" || scope === "attempt" ? { scope } : {}),
      ...(unit === "tokens" || unit === "usd" ? { unit } : {}),
    },
    material: {
      state: materialState,
      ...(numberValue(field(input, "value")) === undefined
        ? {}
        : { value: numberValue(field(input, "value"))! }),
      ...(stringValue(field(input, "reason")) === undefined
        ? {}
        : { reason: stringValue(field(input, "reason"))! }),
      ...(field(input, "derivation") === undefined ? {} : { derivation: field(input, "derivation")! }),
    },
  };
}

function pricingReceiptView(derivation: ClosedAssertionFactValue | undefined): PricingReceiptView | undefined {
  if (stringValue(field(derivation, "kind")) !== "pricing-estimate") return undefined;
  const model = stringValue(field(derivation, "model"));
  const priceSource = field(derivation, "priceSource");
  const sourceKind = stringValue(field(priceSource, "kind"));
  const sourceSelector = stringValue(field(priceSource, "selector"));
  const amountUSD = numberValue(field(derivation, "amountUSD"));
  const chargesValue = field(derivation, "charges");
  if (
    model === undefined || sourceSelector === undefined || amountUSD === undefined ||
    (sourceKind !== "configured-override" && sourceKind !== "builtin") ||
    chargesValue?.kind !== "list"
  ) return undefined;
  const charges = chargesValue.items.flatMap((item): PricingChargeView[] => {
    const bucket = stringValue(field(item, "bucket"));
    const tokens = numberValue(field(item, "tokens"));
    const rateUSDPerMTok = numberValue(field(item, "rateUSDPerMTok"));
    const amount = numberValue(field(item, "amountUSD"));
    if (
      (bucket !== "input" && bucket !== "output" && bucket !== "cache-read" && bucket !== "cache-write") ||
      tokens === undefined || rateUSDPerMTok === undefined || amount === undefined
    ) return [];
    return [{ bucket, tokens, rateUSDPerMTok, amountUSD: amount }];
  });
  return { model, sourceKind, sourceSelector, charges, amountUSD };
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

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 12,
    maximumSignificantDigits: 12,
  }).format(value);
}

function formatUSD(value: number): string {
  const absolute = Math.abs(value);
  if (absolute !== 0 && absolute < 0.000000001) return `$${value.toExponential(4)}`;
  const fractionDigits = absolute === 0 || absolute >= 1
    ? 6
    : Math.min(12, Math.max(2, Math.ceil(-Math.log10(absolute)) + 5));
  const formatted = value.toFixed(fractionDigits).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
  return `$${formatted}`;
}

function comparatorSymbol(comparator: NumericComparator): "<" | "≤" | ">" | "≥" {
  if (comparator === "less-than") return "<";
  if (comparator === "at-most") return "≤";
  if (comparator === "greater-than") return ">";
  return "≥";
}

function oppositeComparatorSymbol(comparator: NumericComparator): "≥" | ">" | "≤" | "<" {
  if (comparator === "less-than") return "≥";
  if (comparator === "at-most") return ">";
  if (comparator === "greater-than") return "≤";
  return "<";
}

function scopeName(scope: NumericComparisonView["subject"]["scope"], locale: string): string {
  if (locale !== "zh-CN") {
    if (scope === "turn") return "Turn";
    if (scope === "session") return "Session";
    return "Attempt";
  }
  if (scope === "turn") return "本轮";
  if (scope === "session") return "本次会话";
  return "本次 Attempt";
}

function numericSubjectLabel(view: NumericComparisonView, locale: string): string {
  if (view.subject.kind === "explicit-value") return label(locale, "Number comparison", "数值比较");
  const scope = scopeName(view.subject.scope, locale);
  if (view.subject.metric === "cost") return label(locale, `${scope} estimated cost`, `${scope}估算费用`);
  return label(locale, `${scope} token usage`, `${scope} token 用量`);
}

function numericValueText(view: NumericComparisonView, value: number, locale: string): string {
  if (view.subject.metric === "cost") return formatUSD(value);
  const formatted = formatNumber(value, locale);
  return view.subject.metric === "tokens" ? `${formatted} tokens` : formatted;
}

function thresholdText(view: NumericComparisonView, locale: string): string {
  const value = numericValueText(view, view.threshold, locale);
  if (view.subject.metric === "tokens" || view.subject.metric === "cost") {
    return label(locale, `limit ${value}`, `上限 ${value}`);
  }
  return value;
}

function unavailableReason(reason: string | undefined, locale: string): string {
  switch (reason) {
    case "model-not-recorded":
      return label(locale, "The model was not recorded, so its price cannot be selected.", "没有记录模型，无法选择对应价格。");
    case "price-source-not-found":
      return label(locale, "No configured or built-in price was found for this model.", "没有找到该模型的配置价格或内置价格。");
    case "pricing-input-invalid":
      return label(locale, "The recorded pricing input is invalid.", "记录的计价输入无效。");
    case "usage-not-recorded":
      return label(locale, "Usage was not recorded.", "没有记录用量。");
    case "usage-input-invalid":
      return label(locale, "The recorded token usage is invalid.", "记录的 token 用量无效。");
    case "non-finite-number":
    case "numeric-value-non-finite":
      return label(locale, "The compared number is not finite.", "被比较的数值不是有限数。");
    default:
      return label(locale, "The compared value is unavailable.", "没有可用于比较的数值。");
  }
}

function numericConclusion(
  view: NumericComparisonView,
  state: MatchState,
  locale: string,
): string {
  const value = view.material.value;
  if (view.material.state === "unavailable" || value === undefined) {
    return unavailableReason(view.material.reason, locale);
  }
  const actual = numericValueText(view, value, locale);
  const expected = thresholdText(view, locale);
  if (view.material.state === "lower-bound" && state === "unavailable") {
    return label(
      locale,
      `At least ${actual} was recorded, but usage is incomplete, so NiceEval cannot determine whether it is ${comparatorSymbol(view.comparator)} ${expected}.`,
      `目前至少记录了 ${actual}，但用量记录不完整，无法判断是否 ${comparatorSymbol(view.comparator)} ${expected}。`,
    );
  }
  const relation = state === "mismatched"
    ? oppositeComparatorSymbol(view.comparator)
    : comparatorSymbol(view.comparator);
  const knownPrefix = view.material.state === "lower-bound"
    ? label(locale, "Known minimum", "已知至少")
    : view.subject.metric === "cost"
    ? label(locale, "Estimated", "估算")
    : view.subject.metric === "tokens"
    ? label(locale, "Used", "已用")
    : label(locale, "Observed", "实际");
  const outcome = state === "matched"
    ? label(locale, "so it passes.", "所以通过。")
    : state === "mismatched"
    ? label(locale, "so it does not pass.", "所以未通过。")
    : label(locale, "so the result is unavailable.", "所以无法判断。")
  return `${knownPrefix} ${actual} ${relation} ${expected}, ${outcome}`;
}

function chargeLabel(bucket: PricingChargeView["bucket"], locale: string): string {
  if (bucket === "input") return label(locale, "Input", "输入");
  if (bucket === "output") return label(locale, "Output", "输出");
  if (bucket === "cache-read") return label(locale, "Cache read", "缓存读取");
  return label(locale, "Cache write", "缓存写入");
}

function PricingReceipt({ receipt, locale }: {
  readonly receipt: PricingReceiptView;
  readonly locale: string;
}): ReactElement {
  const source = receipt.sourceKind === "builtin"
    ? label(locale, "Built-in price", "内置价格")
    : label(locale, "Configured override", "配置覆盖价格");
  return (
    <details className="niceeval-numeric-pricing">
      <summary>
        <span>{label(locale, "View estimate basis", "查看估算依据")}</span>
        <code>{receipt.model}</code>
        <small>{source} · {receipt.sourceSelector}</small>
      </summary>
      <dl>
        {receipt.charges.map((charge) => (
          <div key={charge.bucket}>
            <dt>{chargeLabel(charge.bucket, locale)}</dt>
            <dd>
              <code>{formatNumber(charge.tokens, locale)} tokens</code>
              <span>×</span>
              <code>{formatUSD(charge.rateUSDPerMTok)}/M</code>
              <span>=</span>
              <strong>{formatUSD(charge.amountUSD)}</strong>
            </dd>
          </div>
        ))}
        <div className="niceeval-numeric-pricing-total">
          <dt>{label(locale, "Estimated total", "估算合计")}</dt>
          <dd><strong>{formatUSD(receipt.amountUSD)}</strong></dd>
        </div>
      </dl>
    </details>
  );
}

function NumericEvidence({ view, state, locale }: {
  readonly view: NumericComparisonView;
  readonly state: MatchState;
  readonly locale: string;
}): ReactElement {
  const value = view.material.value;
  const formulaRelation = state === "mismatched"
    ? oppositeComparatorSymbol(view.comparator)
    : comparatorSymbol(view.comparator);
  const receipt = view.subject.metric === "cost"
    ? pricingReceiptView(view.material.derivation)
    : undefined;
  return (
    <section className="niceeval-numeric-evidence" data-state={state}>
      <span className="niceeval-numeric-evidence-label">{numericSubjectLabel(view, locale)}</span>
      {value === undefined ? (
        <p className="niceeval-numeric-evidence-unavailable">
          {label(locale, "No comparable value", "没有可比较的数值")}
        </p>
      ) : view.material.state === "lower-bound" && state === "unavailable" ? (
        <p className="niceeval-numeric-evidence-formula">
          <small>{label(locale, "Known minimum", "已知至少")}</small>
          <strong>{numericValueText(view, value, locale)}</strong>
          <span aria-hidden="true">·</span>
          <small>{thresholdText(view, locale)}</small>
        </p>
      ) : (
        <p className="niceeval-numeric-evidence-formula">
          {view.material.state === "lower-bound" ? (
            <small>{label(locale, "Known minimum", "已知至少")}</small>
          ) : null}
          <strong>{numericValueText(view, value, locale)}</strong>
          <span className="niceeval-numeric-evidence-operator">{formulaRelation}</span>
          <strong>{thresholdText(view, locale)}</strong>
        </p>
      )}
      <p className="niceeval-numeric-evidence-conclusion">
        {numericConclusion(view, state, locale)}
      </p>
      {receipt === undefined ? null : <PricingReceipt receipt={receipt} locale={locale} />}
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

function isToolCollectionDiagnostic(diagnostic: MatchDiagnosticView | null): boolean {
  return diagnostic?.code === "tool-count-match" ||
    diagnostic?.code === "tool-count-mismatch" ||
    diagnostic?.code === "tool-count-exceeded" ||
    diagnostic?.code === "tool-count-unavailable" ||
    diagnostic?.code === "tool-absence-match" ||
    diagnostic?.code === "tool-absence-mismatch" ||
    diagnostic?.code === "tool-absence-unavailable";
}

function candidateSubject(diagnostic: MatchDiagnosticView | null): string | undefined {
  if (diagnostic?.received !== undefined) return diagnostic.received;
  const name = diagnostic?.children.find((child) => child.label === "name");
  if (name?.diagnostic?.received !== undefined) return name.diagnostic.received;
  return name?.state === "matched" ? name.diagnostic?.expected : undefined;
}

function candidateLabel(
  index: number,
  nodeLabel: string,
  diagnostic: MatchDiagnosticView | null,
  locale: string,
): string {
  const kind = nodeLabel === "command-candidate"
    ? label(locale, "Command", "命令")
    : nodeLabel === "tool-candidate"
      ? label(locale, "Tool call", "工具调用")
      : label(locale, "Candidate", "候选");
  const subject = candidateSubject(diagnostic);
  const unavailable = label(locale, "invocation details not recorded", "调用详情未记录");
  return `${kind} ${index + 1} · ${subject ?? unavailable}`;
}

function toolFieldLabel(value: string, locale: string): string {
  if (locale !== "zh-CN") return value;
  if (value === "name") return "名称";
  if (value === "input") return "输入";
  if (value === "output") return "输出";
  if (value === "command") return "命令";
  if (value === "status") return "状态";
  return value;
}

function summaryFacts(diagnostic: MatchDiagnosticView | null, locale: string): readonly {
  readonly label: string;
  readonly value: string;
}[] {
  if (diagnostic === null || diagnostic.children.length > 0) return [];
  return [
    ...(diagnostic.expected === undefined ? [] : [{
      label: label(locale, "Expected", "预期"),
      value: diagnostic.expected,
    }]),
    ...(diagnostic.received === undefined ? [] : [{
      label: label(locale, "Observed", "实际"),
      value: diagnostic.received,
    }]),
    ...(diagnostic.reason === undefined ? [] : [{
      label: label(locale, "Reason", "原因"),
      value: diagnostic.reason,
    }]),
  ];
}

function MatchNode({
  label: nodeLabel,
  state,
  diagnostic,
  locale,
  root = false,
  toolCandidateIndex,
  toolField = false,
  children,
}: {
  readonly label: string;
  readonly state: MatchState;
  readonly diagnostic: MatchDiagnosticView | null;
  readonly locale: string;
  readonly root?: boolean;
  readonly toolCandidateIndex?: number;
  readonly toolField?: boolean;
  readonly children?: ReactElement;
}): ReactElement {
  const displayLabel = toolCandidateIndex === undefined
    ? toolField ? toolFieldLabel(nodeLabel, locale) : nodeLabel
    : candidateLabel(toolCandidateIndex, nodeLabel, diagnostic, locale);
  const visibleState = stateLabel(state, locale);
  const accessibleLabel = `${displayLabel}: ${visibleState}`;
  const facts = summaryFacts(diagnostic, locale);
  const summary = (
    <span className={`niceeval-match-summary niceeval-match-summary--${state}`}>
      <span className="niceeval-match-summary-main">
        <code>{displayLabel}</code>
        {facts.length === 0 ? null : (
          <span className="niceeval-match-summary-facts">
            {facts.map((fact) => (
              <span key={fact.label} className="niceeval-match-summary-fact">
                <span>{fact.label}</span>
                <code>{fact.value}</code>
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="niceeval-match-state">{visibleState}</span>
    </span>
  );
  const nested = diagnostic?.children ?? [];
  const childrenAreToolCandidates = isToolCollectionDiagnostic(diagnostic);
  const hasDiagnosticBody = nested.length > 0 || diagnostic?.locator !== undefined;
  const body = hasDiagnosticBody || children !== undefined
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
                  {...(childrenAreToolCandidates ? { toolCandidateIndex: child.index } : {})}
                  {...(toolCandidateIndex === undefined ? {} : { toolField: true })}
                />
              ))}
            </div>
          ) : null}
          {root || diagnostic === null || diagnostic.locator === undefined
            ? null
            : <DiagnosticFacts diagnostic={diagnostic} locale={locale} />}
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
  locale: ReportLocale,
  labelText: string | undefined,
  state: MatchState,
): ReactElement {
  const diagnostic = diagnosticView(content.explanation);
  const name = matcherName(content.check) ?? labelText ?? label(locale, "Match", "检查");
  const input = field(content.source, "input") ?? content.source;
  const code = diagnostic?.code;
  const numeric = numericComparisonView(content.check, content.source);
  const primary = numeric !== undefined
    ? <NumericEvidence view={numeric} state={state} locale={locale} />
    : code === "command-succeeded" || code === "command-failed"
    ? <CommandEvidence input={input} diagnostic={diagnostic} locale={locale} />
    : isToolCriterion(content.check)
      ? <ToolEvidence observed={content.observed} diagnostic={diagnostic} locale={locale} />
      : <GenericEvidence content={content} input={input} diagnostic={diagnostic} locale={locale} />;
  return (
    <div className="niceeval-assertion-evidence">
      <MatchNode label={name} state={state} diagnostic={diagnostic} locale={locale} root>
        <div className="niceeval-match-body">
          {content.matcherDebugger === undefined
            ? primary
            : <MatcherFilterDebugger content={content.matcherDebugger} locale={locale} />}
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
      ...(content.matcherDebugger === undefined
        ? []
        : [`Matcher filter:\n${matcherFilterDebuggerText(content.matcherDebugger)}`]),
    ].join("\n");
  },
  web({ content, label: labelText, state }, ctx) {
    return web(content, ctx.locale, labelText, state ?? "unavailable");
  },
});

AssertionEvidence.displayName = "AssertionEvidence";
