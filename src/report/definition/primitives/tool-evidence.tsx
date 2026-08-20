// ToolEvidence: structured projection of retained tool input/result summaries.

import type { ReactElement, ReactNode } from "react";
import { defineComponent } from "../tree.ts";
import { isObject } from "./shared.ts";

export interface ToolEvidenceContent {
  readonly phase: "started" | "finished";
  readonly tool: string;
  readonly callId: string;
  readonly inputSummary: string;
  readonly outputSummary?: string;
  readonly outcome?: "completed" | "rejected" | "failed" | "cancelled";
}

function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function label(locale: string, english: string, chinese: string): string {
  return locale === "zh-CN" ? chinese : english;
}

function parseJson(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function stringField(
  record: globalThis.Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function scalarField(
  record: globalThis.Record<string, unknown>,
  keys: readonly string[],
): string | number | boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  }
  return undefined;
}

function withoutFields(
  record: globalThis.Record<string, unknown>,
  omitted: ReadonlySet<string>,
): globalThis.Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.has(key)));
}

function EvidenceCode({ children, tone }: { children: string; tone?: "error" }): ReactElement {
  return <pre className={cx("niceeval-tool-evidence-code", tone === "error" && "niceeval-tool-evidence-code--error")}>{children}</pre>;
}

function EvidenceSection({ label: heading, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section className="niceeval-tool-evidence-section">
      <h5>{heading}</h5>
      {children}
    </section>
  );
}

function commandEvidence(
  record: globalThis.Record<string, unknown>,
  locale: string,
): ReactElement | undefined {
  const command = stringField(record, ["command", "cmd", "script"]);
  if (command === undefined) return undefined;
  const cwd = stringField(record, ["cwd", "workdir"]);
  const rest = withoutFields(record, new Set(["command", "cmd", "script", "cwd", "workdir"]));
  return (
    <div className="niceeval-tool-evidence" data-tool-evidence-kind="command">
      {cwd === undefined ? null : <div className="niceeval-tool-evidence-context"><span>{label(locale, "Working directory", "工作目录")}</span><code>{cwd}</code></div>}
      <EvidenceSection label={label(locale, "Command", "命令")}><EvidenceCode>{command}</EvidenceCode></EvidenceSection>
      {Object.keys(rest).length === 0 ? null : (
        <EvidenceSection label={label(locale, "Additional input", "其他输入")}><EvidenceCode>{JSON.stringify(rest, null, 2)}</EvidenceCode></EvidenceSection>
      )}
    </div>
  );
}

function terminalEvidence(
  record: globalThis.Record<string, unknown>,
  locale: string,
): ReactElement | undefined {
  const output = stringField(record, ["output", "stdout"]);
  const stderr = stringField(record, ["stderr"]);
  const exitCode = scalarField(record, ["exit_code", "exitCode"]);
  const signal = scalarField(record, ["signal"]);
  if (output === undefined && stderr === undefined && exitCode === undefined && signal === undefined) return undefined;
  const rest = withoutFields(record, new Set(["output", "stdout", "stderr", "exit_code", "exitCode", "signal"]));
  return (
    <div className="niceeval-tool-evidence" data-tool-evidence-kind="terminal">
      <div className="niceeval-tool-evidence-context">
        {exitCode === undefined ? null : <span>{label(locale, "Exit", "退出码")} <strong data-failed={Number(exitCode) !== 0 || undefined}>{String(exitCode)}</strong></span>}
        {signal === undefined ? null : <span>{label(locale, "Signal", "信号")} <strong>{String(signal)}</strong></span>}
      </div>
      {output === undefined ? null : <EvidenceSection label={label(locale, "Output", "输出")}><EvidenceCode>{output || label(locale, "No output", "无输出")}</EvidenceCode></EvidenceSection>}
      {stderr === undefined || stderr === "" ? null : <EvidenceSection label="stderr"><EvidenceCode tone="error">{stderr}</EvidenceCode></EvidenceSection>}
      {Object.keys(rest).length === 0 ? null : (
        <EvidenceSection label={label(locale, "Additional result", "其他结果")}><EvidenceCode>{JSON.stringify(rest, null, 2)}</EvidenceCode></EvidenceSection>
      )}
    </div>
  );
}

function structuredEvidence(data: ToolEvidenceContent, locale: string): ReactElement {
  const raw = data.phase === "finished" ? data.outputSummary ?? "" : data.inputSummary;
  const parsed = parseJson(raw);
  const record = recordOf(parsed);
  const specialized = record === undefined
    ? undefined
    : data.phase === "started"
      ? commandEvidence(record, locale)
      : terminalEvidence(record, locale);
  if (specialized !== undefined) return specialized;
  const display = parsed === undefined
    ? raw
    : typeof parsed === "string"
      ? parsed
      : JSON.stringify(parsed, null, 2);
  return (
    <div className="niceeval-tool-evidence" data-tool-evidence-kind={parsed === undefined ? "text" : "json"}>
      <EvidenceSection label={parsed === undefined ? label(locale, "Text", "文本") : "JSON"}>
        <EvidenceCode tone={data.outcome === "failed" || data.outcome === "rejected" ? "error" : undefined}>{display}</EvidenceCode>
      </EvidenceSection>
    </div>
  );
}

export const ToolEvidence = defineComponent<{ content: ToolEvidenceContent }>({
  dimensions: () => ({}),
  text({ content }) {
    return content.phase === "finished" ? content.outputSummary ?? "" : content.inputSummary;
  },
  web({ content }, ctx) {
    return structuredEvidence(content, ctx.locale);
  },
});
ToolEvidence.displayName = "ToolEvidence";
