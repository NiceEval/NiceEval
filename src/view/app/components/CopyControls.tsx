import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { T } from "../shared.ts";
import type { ViewResult, ViewSnapshot } from "../types.ts";
import { snapshotLabel } from "../lib/rows.ts";
import { failingAssertions, reasonFor } from "../lib/verdict.ts";

/** 修复 prompt 的一条失败条目;路径均相对 view 输入根(默认 `.niceeval/`)。 */
export interface FixPromptEntry {
  experiment: string;
  evalId: string;
  verdict: string;
  reason: string;
  artifactBase?: string;
  resultPath?: string;
}

export function toFixPromptEntry(r: ViewResult, experimentLabel: string): FixPromptEntry {
  return {
    experiment: r.experimentId ?? experimentLabel,
    evalId: r.id,
    verdict: r.verdict,
    reason: reasonFor(r, failingAssertions(r)),
    artifactBase: r.artifactBase,
    // result.json 与其它 artifact(events.json 等)同目录落盘,resultPath 因此复用同一个
    // artifactBase(不再靠 attemptRef 的 {snapshot, attempt} 两段拼——locator 是不透明的,
    // 浏览器端解不出磁盘路径)。
    resultPath: r.artifactBase ? `${r.artifactBase}/result.json` : undefined,
  };
}

/**
 * 学 Next.js 16.3 的「Copy prompt」:把失败打包成一段可直接粘给 coding agent 的修复
 * prompt——失败清单 + artifact 路径 + 先读随包文档 / 判断缺陷在哪一侧 / 重跑验证的步骤。
 * prompt 面向 agent,固定英文;按钮文案走界面 i18n。
 */
export function buildFixPrompt(entries: FixPromptEntry[]): string {
  const failures = entries
    .map((e, i) =>
      [
        `${i + 1}. eval "${e.evalId}" [experiment ${e.experiment}] — ${e.verdict}`,
        e.reason ? `   reason: ${e.reason}` : null,
        e.artifactBase ? `   artifacts: ${e.artifactBase}/` : null,
        e.resultPath ? `   result: ${e.resultPath}` : null,
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
    "5. Run `npx niceeval show` and confirm these failures are gone.",
  ].join("\n");
}

/**
 * 报告槽同款口径的失败清单:每个 experiment 最新一次快照(latest 标记;快照明细已在
 * server 侧跨快照去重)里的 failed / errored attempt,从 viewData.snapshots 现算——
 * 默认报告与 --report 两种填充下按钮都在,不依赖任何统计产物。
 */
export function fixPromptEntries(snapshots: ViewSnapshot[]): FixPromptEntry[] {
  return snapshots
    .filter((s) => s.latest)
    .flatMap((snapshot) =>
      snapshot.results
        .filter((r: ViewResult) => r.verdict === "failed" || r.verdict === "errored")
        .map((r: ViewResult) => toFixPromptEntry(r, snapshotLabel(snapshot))),
    );
}

export function CopyFixPrompt({ snapshots, t }: { snapshots: ViewSnapshot[]; t: T }) {
  const [copied, setCopied] = useState(false);

  const entries = fixPromptEntries(snapshots);

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
