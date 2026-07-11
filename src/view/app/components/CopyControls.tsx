import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { T } from "../shared.ts";
import type { ViewResult, ViewRow } from "../types.ts";
import { failingAssertions, reasonFor } from "../lib/verdict.ts";

export function CopyReason({ text, t }: { text: string; t: T }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className={`copy-reason${copied ? " is-copied" : ""}`} onClick={copy} aria-label={t("action.copyReason")} title={t("action.copyReason")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

/** 修复 prompt 的一条失败条目;路径均相对 view 输入根(默认 `.niceeval/`)。 */
export interface FixPromptEntry {
  experiment: string;
  evalId: string;
  verdict: string;
  reason: string;
  artifactBase?: string;
  summaryPath?: string;
}

export function toFixPromptEntry(r: ViewResult, experimentLabel: string): FixPromptEntry {
  return {
    experiment: r.experimentId ?? experimentLabel,
    evalId: r.id,
    verdict: r.verdict,
    reason: reasonFor(r, failingAssertions(r)),
    artifactBase: r.artifactBase,
    summaryPath: r.attemptRef ? `${r.attemptRef.run}/summary.json` : undefined,
  };
}

/**
 * 学 Next.js 16.3 的「Copy prompt」:把失败打包成一段可直接粘给 coding agent 的修复
 * prompt——失败清单 + 工件路径 + 先读随包文档 / 判断缺陷在哪一侧 / 重跑验证的步骤。
 * prompt 面向 agent,固定英文;按钮文案走界面 i18n。
 */
export function buildFixPrompt(entries: FixPromptEntry[]): string {
  const failures = entries
    .map((e, i) =>
      [
        `${i + 1}. eval "${e.evalId}" [experiment ${e.experiment}] — ${e.verdict}`,
        e.reason ? `   reason: ${e.reason}` : null,
        e.artifactBase ? `   artifacts: ${e.artifactBase}/` : null,
        e.summaryPath ? `   summary: ${e.summaryPath}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  const experiments = [...new Set(entries.map((e) => e.experiment))].join(" / ");
  return [
    "Fix the failing evals from this niceeval run.",
    "",
    "## Failures",
    failures,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. The paths above are relative to the results directory (default `.niceeval/`). For each failure, read `events.json` in its artifacts directory — the full agent transcript including tool calls — plus `trace.json` (execution trace) and `diff.json` (workspace diff) when present, to see what actually happened.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${experiments || "<experiment>"} <eval-id-prefix>\`. Already-passing evals are skipped by the fingerprint cache; pass \`--force\` to re-run everything.`,
    "5. Read the new `summary.json` path the CLI prints and confirm these failures are gone.",
  ].join("\n");
}

export function CopyFixPrompt({ rows, t }: { rows: ViewRow[]; t: T }) {
  const [copied, setCopied] = useState(false);

  const entries = rows.flatMap((row: ViewRow) =>
    (row.results ?? [])
      .filter((r: ViewResult) => r.verdict === "failed" || r.verdict === "errored")
      .map((r: ViewResult) => toFixPromptEntry(r, row.label)),
  );

  if (!entries.length) return null;

  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyText(buildFixPrompt(entries));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button className={`copy-all-errors${copied ? " is-copied" : ""}`} onClick={copy} title={t("action.copyPrompt")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? t("action.copied") : `${t("action.copyPrompt")} (${entries.length})`}</span>
    </button>
  );
}

/** attempt 弹窗里的单条版:只打包当前 attempt 的失败,供逐条转交 agent。 */
export function CopyAttemptPrompt({ result, t }: { result: ViewResult; t: T }) {
  const [copied, setCopied] = useState(false);
  if (result.verdict !== "failed" && result.verdict !== "errored") return null;

  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyText(buildFixPrompt([toFixPromptEntry(result, result.agent)]));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button className={`copy-all-errors${copied ? " is-copied" : ""}`} onClick={copy} title={t("action.copyPrompt")}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{copied ? t("action.copied") : t("action.copyPrompt")}</span>
    </button>
  );
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}
