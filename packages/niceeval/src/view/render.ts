import { createHash } from "node:crypto";
import { Effect } from "effect";

import type { AttemptLocator } from "../attempt-locator.ts";
import type { InspectionDocument, OpenInspectionSource } from "../inspection/index.ts";
import { inspectionHost } from "../inspection/index.ts";
import type { RunId } from "../record/model/identifiers.ts";
import { makeViewRevision, type ViewRevision } from "./revision.ts";

export type ViewTarget =
  | { readonly kind: "overview" }
  | { readonly kind: "runs"; readonly runIds: readonly RunId[] }
  | { readonly kind: "attempt"; readonly locator: AttemptLocator };

interface ViewFacts {
  readonly primary: readonly InspectionDocument[];
}

export function buildViewRevision(
  source: OpenInspectionSource,
  target: ViewTarget,
): Effect.Effect<ViewRevision, import("../inspection/index.ts").InspectionHostError> {
  return Effect.gen(function* () {
    const primary = target.kind === "attempt"
      ? [yield* attemptDocument(source, target.locator)]
      : target.kind === "runs"
        ? yield* Effect.forEach(target.runIds, (runId) => inspectionHost.run(source, Object.freeze({
            protocol: "niceeval.query/v1" as const,
            operation: Object.freeze({ kind: "run.summary" as const, runId }),
          })), { concurrency: 1 })
        : [yield* inspectionHost.run(source, Object.freeze({
            protocol: "niceeval.query/v1" as const,
            operation: Object.freeze({ kind: "runs.list" as const }),
          }))];
    const cutoff = source.facts.cutoff();
    const facts = Object.freeze({ primary: Object.freeze(primary) });
    const html = renderView(facts, target, source.source.kind === "operational" && target.kind === "overview");
    const bytes = new TextEncoder().encode(html);
    return makeViewRevision({
      sourceCutoffIdentity: cutoff.identity,
      sourceRunCount: cutoff.runCount,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      files: Object.freeze([Object.freeze({ path: "index.html", mediaType: "text/html; charset=utf-8", bytes })]),
    });
  });
}

function attemptDocument(source: OpenInspectionSource, locator: AttemptLocator) {
  return inspectionHost.run(source, Object.freeze({
    protocol: "niceeval.query/v1" as const,
    operation: Object.freeze({ kind: "attempt.get" as const, locator }),
  }));
}

function renderView(facts: ViewFacts, target: ViewTarget, refreshEnabled: boolean): string {
  const refresh = refreshEnabled
    ? `<aside id="niceeval-update" role="status" aria-live="polite" hidden><span data-copy-locale="en">New run update available.</span><span data-copy-locale="zh-CN" hidden>有新的运行结果可用。</span> <button id="niceeval-refresh" type="button"><span data-copy-locale="en">Refresh</span><span data-copy-locale="zh-CN" hidden>刷新</span></button></aside><script>(()=>{const status=document.getElementById("niceeval-update");const button=document.getElementById("niceeval-refresh");let stopped=false;const probe=async()=>{if(stopped)return;try{const response=await fetch("/_niceeval/refresh",{cache:"no-store",credentials:"same-origin"});if(response.status===204&&response.headers.get("x-niceeval-view-stale")==="1"){status.hidden=false;return}}catch{stopped=true;return}setTimeout(probe,500)};button.addEventListener("click",async()=>{button.disabled=true;try{const response=await fetch("/_niceeval/refresh",{method:"POST",credentials:"same-origin"});if(!response.ok)throw new Error("refresh failed");location.reload()}catch{button.disabled=false}});setTimeout(probe,500)})()</script>`
    : "";
  const english = renderHuman(facts, target, "en");
  const chinese = renderHuman(facts, target, "zh-CN");
  const language = `<nav><label for="niceeval-language"><span data-copy-locale="en">Language</span><span data-copy-locale="zh-CN" hidden>语言</span></label><select id="niceeval-language"><option value="en">English</option><option value="zh-CN">中文</option></select></nav>`;
  const localeScript = `<script>(()=>{const select=document.getElementById("niceeval-language");const setLanguage=language=>{const locale=language==="zh-CN"?"zh-CN":"en";document.documentElement.lang=locale;select.value=locale;document.querySelectorAll("[data-insight-locale]").forEach(node=>{node.hidden=node.getAttribute("data-insight-locale")!==locale});document.querySelectorAll("[data-copy-locale]").forEach(node=>{node.hidden=node.getAttribute("data-copy-locale")!==locale});try{localStorage.setItem("niceeval-view-language",locale)}catch{}};select.addEventListener("change",()=>setLanguage(select.value));let preferred;try{preferred=localStorage.getItem("niceeval-view-language")}catch{}setLanguage(preferred??(navigator.language.toLowerCase().startsWith("zh")?"zh-CN":"en"))})()</script>`;
  const authenticatedProbe = `<script>fetch("/_niceeval/session-check",{cache:"no-store",credentials:"same-origin"}).catch(()=>{})</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>NiceEval View</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:90rem;padding:2rem;color:#172033;background:#fff}nav{display:flex;justify-content:flex-end;align-items:center;gap:.5rem}h1{font-size:1.7rem;margin-bottom:.25rem}h2{font-size:1.2rem;margin-top:2rem}h3{font-size:1rem;margin:1.25rem 0 .4rem}p.lead{color:#526078;margin-top:0}.metrics{display:flex;gap:1rem;flex-wrap:wrap}.metric{background:#f4f6fa;border:1px solid #d9deea;border-radius:.5rem;padding:.7rem 1rem}.metric strong{display:block;font-size:1.25rem}table{border-collapse:collapse;width:100%;display:block;overflow:auto}th,td{border-bottom:1px solid #d9deea;padding:.6rem;text-align:left;vertical-align:top}th{color:#526078;font-size:.85rem}code{font-size:.9em}.passed{color:#067647;font-weight:700}.failed,.errored{color:#b42318;font-weight:700}.assertion{border-left:3px solid #d9deea;padding:.1rem 0 .5rem 1rem;margin:1rem 0}.assertion dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem .75rem}.assertion dt{color:#526078}.assertion dd{margin:0}aside{position:sticky;top:1rem;background:#fff8d8;border:1px solid #e0bd42;border-radius:.5rem;padding:.75rem;margin-bottom:1rem}button,select{font:inherit}.empty{color:#667085;font-style:italic}</style></head><body>${language}<h1>NiceEval View</h1><p class="lead"><span data-copy-locale="en">Fixed first-party inspection of sealed Record facts.</span><span data-copy-locale="zh-CN" hidden>对已封存 Record 事实的第一方固定检视。</span></p>${refresh}<main data-insight-locale="en">${english}</main><main data-insight-locale="zh-CN" hidden>${chinese}</main>${localeScript}${authenticatedProbe}</body></html>`;
}

type ViewLocale = "en" | "zh-CN";

function renderHuman(facts: ViewFacts, target: ViewTarget, locale: ViewLocale): string {
  if (target.kind === "overview") return renderOverview(facts.primary[0], locale);
  if (target.kind === "attempt") return renderAttempt(facts.primary[0], locale);
  return facts.primary.length === 0
    ? `<section><h2>${text(locale, "runs")}</h2><p class="empty">${text(locale, "noSelectedRuns")}</p></section>`
    : facts.primary.map((document) => renderRun(document, locale)).join("");
}

function renderOverview(document: InspectionDocument | undefined, locale: ViewLocale): string {
  const runs = arrayField(document, "runs");
  const selection = objectValue(document?.selection);
  const totalRunCount = numberValue(selection?.totalRunCount) ?? runs.length;
  const truncated = selection?.truncated === true;
  const rows = runs.map((run) => {
    const value = objectValue(run);
    return `<tr><td><code>${html(value?.runId)}</code></td><td>${html(value?.startedAt)}</td><td>${html(value?.memberCount)}</td><td>${html(value?.attemptCount)}</td><td>${html(value?.attachmentCount)}</td><td>${html(value?.contentCount)}</td></tr>`;
  }).join("");
  const delivery = truncated
    ? `<p>${escapeHtml(text(locale, "runDelivery").replace("{shown}", String(runs.length)).replace("{total}", String(totalRunCount)))}</p>`
    : `<p>${escapeHtml(text(locale, "runTotal").replace("{total}", String(totalRunCount)))}</p>`;
  return `<section><h2>${text(locale, "overview")}</h2>${delivery}${runs.length === 0 ? `<p class="empty">${text(locale, "noRuns")}</p>` : `<table><thead><tr><th>${text(locale, "run")}</th><th>${text(locale, "started")}</th><th>${text(locale, "members")}</th><th>${text(locale, "attempts")}</th><th>${text(locale, "attachments")}</th><th>${text(locale, "contents")}</th></tr></thead><tbody>${rows}</tbody></table>`}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderRun(document: InspectionDocument, locale: ViewLocale): string {
  const summary = objectField(document, "summary");
  if (summary?.state === "omitted") return limited(document, locale, "runInsight");
  const denominator = objectValue(summary?.denominator);
  const members = Array.isArray(summary?.members) ? summary.members : [];
  const run = Array.isArray(summary?.runs) ? objectValue(summary.runs[0]) : undefined;
  const rows = members.map((member) => {
    const value = objectValue(member);
    const usage = objectValue(value?.usage);
    const locator = typeof value?.locator === "string" ? value.locator : undefined;
    const insight = insightFromDetail(value);
    const verdict = typeof value?.verdict === "string" ? value.verdict : insight.verdict;
    return `<tr><td>${html(value?.evalId)}</td><td><code>${html(locator)}</code></td><td>${html(value?.state)}</td><td>${html(value?.outcome)}</td><td class="${escapeHtml(verdict ?? "")}">${html(verdict)}</td><td>${html(formatScore(insight.score, locale))}</td><td>${html(coverageSummary(insight.coverage, locale))}</td><td>${html(limitationSummary(insight.limitations, locale))}</td><td>${html(usage?.inputTokens)}</td><td>${html(usage?.outputTokens)}</td></tr>`;
  }).join("");
  return `<section><h2>${text(locale, "run")} <code>${html(run?.runId)}</code></h2><div class="metrics"><div class="metric"><strong>${html(denominator?.observed)}</strong>${text(locale, "observed")}</div><div class="metric"><strong>${html(denominator?.expected)}</strong>${text(locale, "denominator")}</div></div>${members.length === 0 ? `<p class="empty">${text(locale, "noMembers")}</p>` : `<table><thead><tr><th>Eval</th><th>${text(locale, "attempt")}</th><th>${text(locale, "state")}</th><th>${text(locale, "outcome")}</th><th>${text(locale, "verdict")}</th><th>${text(locale, "score")}</th><th>${text(locale, "coverage")}</th><th>${text(locale, "limitations")}</th><th>${text(locale, "inputTokens")}</th><th>${text(locale, "outputTokens")}</th></tr></thead><tbody>${rows}</tbody></table>`}${renderIssuesEvidence(document, locale)}</section>`;
}

function renderAttempt(document: InspectionDocument | undefined, locale: ViewLocale): string {
  const detail = objectField(document, "attempt");
  if (detail?.state === "omitted") return limited(document, locale, "attemptInsight");
  const insight = attemptInsight(document);
  const core = objectValue(detail?.core);
  const origin = objectValue(detail?.originRun);
  const targets = Array.isArray(detail?.targets) ? detail.targets : [];
  const score = formatScore(insight.score, locale);
  return `<section><h2>${text(locale, "attempt")} <code>${html(detail?.locator)}</code></h2><div class="metrics"><div class="metric"><strong>${html(core?.outcome)}</strong>${text(locale, "outcome")}</div><div class="metric"><strong>${html(origin?.runId)}</strong>${text(locale, "originRun")}</div><div class="metric"><strong>${html(targets.length)}</strong>${text(locale, "targetRuns")}</div></div><h2>${text(locale, "verdict")}</h2><p class="${escapeHtml(insight.verdict ?? "")}">${html(insight.verdict)}</p><h2>${text(locale, "score")}</h2><p><strong>${html(insight.score.state)}</strong> · ${html(score)}</p>${renderAssertions(insight.assertions, locale)}<h2>${text(locale, "evidenceCoverage")}</h2>${renderCoverage(insight.coverage, locale)}<h2>${text(locale, "limitations")}</h2>${renderLimitations(insight.limitations, locale)}${renderIssuesEvidence(document, locale)}</section>`;
}

function limited(document: InspectionDocument | undefined, locale: ViewLocale, heading: "runInsight" | "attemptInsight"): string {
  return `<section><h2>${text(locale, heading)}</h2><p>${text(locale, "resultLimited")}</p>${renderIssuesEvidence(document, locale)}</section>`;
}

interface AssertionInsight {
  readonly label: string;
  readonly state?: string;
  readonly points?: number;
  readonly earned?: number;
  readonly observed?: string;
  readonly threshold?: number;
}

interface CoverageInsight {
  readonly channel: string;
  readonly status: string;
  readonly reason?: string;
}

interface LimitationInsight {
  readonly owner: string;
  readonly state: string;
  readonly reason?: string;
}

interface ScoreInsight {
  readonly state: "complete" | "unavailable" | "not-scored";
  readonly earned: number;
  readonly possible: number;
}

function attemptInsight(document: InspectionDocument | undefined): {
  readonly assertions: readonly AssertionInsight[];
  readonly coverage: readonly CoverageInsight[];
  readonly limitations: readonly LimitationInsight[];
  readonly score: ScoreInsight;
  readonly verdict?: string;
} {
  const detail = objectField(document, "attempt");
  return insightFromDetail(detail);
}

function insightFromDetail(detail: Readonly<Record<string, unknown>> | undefined): {
  readonly assertions: readonly AssertionInsight[];
  readonly coverage: readonly CoverageInsight[];
  readonly limitations: readonly LimitationInsight[];
  readonly score: ScoreInsight;
  readonly verdict?: string;
} {
  const assertions = assertionInsights(detail);
  const scoreContributions = assertions.filter(({ points }) => points !== undefined);
  const score = Object.freeze({
    state: scoreContributions.length === 0 ? "not-scored" as const : "complete" as const,
    earned: scoreContributions.reduce((total, entry) => total + (entry.earned ?? 0), 0),
    possible: scoreContributions.reduce((total, entry) => total + (entry.points ?? 0), 0),
  });
  const declared = objectValue(detail?.score);
  const closedScore: ScoreInsight = declared !== undefined && typeof declared.state === "string"
    ? Object.freeze({
        state: declared.state === "complete" ? "complete" : declared.state === "not-scored" ? "not-scored" : "unavailable",
        earned: numberValue(declared.earned) ?? score.earned,
        possible: numberValue(declared.possible) ?? score.possible,
      })
    : score;
  const declaredVerdict = typeof detail?.verdict === "string" ? detail.verdict : undefined;
  return Object.freeze({
    assertions,
    coverage: coverageInsights(detail),
    limitations: limitationInsights(detail),
    score: closedScore,
    verdict: declaredVerdict ?? inferVerdict(detail, assertions),
  });
}

function limitationInsights(detail: Readonly<Record<string, unknown>> | undefined): readonly LimitationInsight[] {
  const found = new Map<string, LimitationInsight>();
  const visit = (value: unknown, inheritedOwner = "limitation"): void => {
    if (Array.isArray(value)) { value.forEach((entry) => visit(entry, inheritedOwner)); return; }
    const record = objectValue(value);
    if (record === undefined) return;
    const owner = typeof record.owner === "string"
      ? record.owner
      : typeof record.channel === "string"
        ? record.channel
        : typeof record.code === "string"
          ? record.code
          : inheritedOwner;
    const state = typeof record.state === "string"
      ? record.state
      : typeof record.status === "string"
        ? record.status
        : typeof record.code === "string"
          ? record.code
          : undefined;
    const reason = typeof record.reason === "string" ? record.reason : undefined;
    if (state !== undefined && state !== "complete") {
      found.set(`${owner}\u0000${state}\u0000${reason ?? ""}`, Object.freeze({
        owner,
        state,
        ...(reason === undefined ? {} : { reason }),
      }));
    }
    if (Array.isArray(record.limitations)) visit(record.limitations, owner);
  };
  visit(detail?.limitations);
  return Object.freeze([...found.values()]);
}

function assertionInsights(detail: Readonly<Record<string, unknown>> | undefined): readonly AssertionInsight[] {
  const evidence = objectValue(detail?.evidence);
  const value = objectValue(evidence?.value);
  const entries = Array.isArray(value?.entries) ? value.entries : Array.isArray(value?.["entries-data"]) ? value["entries-data"] : [];
  return Object.freeze(entries.flatMap((candidate) => {
    const entry = objectValue(candidate);
    if (entry === undefined) return [];
    const display = objectValue(entry.display);
    const contribution = objectValue(entry.contribution);
    const evaluation = objectValue(entry.evaluation);
    const policy = objectValue(entry.policy);
    const condition = objectValue(objectValue(policy?.condition)?.value);
    const observed = objectValue(evaluation?.observed);
    const observedDisplay = observed === undefined ? undefined : observedFactValue(observed);
    return [Object.freeze({
      label: typeof display?.label === "string" ? display.label : typeof display?.key === "string" ? display.key : "Assertion",
      ...(typeof objectValue(entry.decision)?.result === "string" ? { state: objectValue(entry.decision)!.result as string } : {}),
      ...(typeof contribution?.points === "number" ? { points: contribution.points } : {}),
      ...(typeof contribution?.earned === "number" ? { earned: contribution.earned } : {}),
      ...(observedDisplay === undefined ? {} : { observed: observedDisplay }),
      ...(typeof condition?.threshold === "number" ? { threshold: condition.threshold } : {}),
    })];
  }));
}

function observedFactValue(value: Readonly<Record<string, unknown>>): string | undefined {
  if (value.kind !== "fields") return factValue(value);
  const kind = factFieldValue(value, "kind");
  if (kind === "boolean") return undefined;
  if (kind === "measurement" || kind === "direct-score") {
    const state = factFieldValue(value, "state");
    if (state !== "available") return state ?? "unavailable";
    return factFieldValue(value, "value") ?? "unavailable";
  }
  return factValue(value);
}

function factFieldValue(value: Readonly<Record<string, unknown>>, label: string): string | undefined {
  const fields = Array.isArray(value.fields) ? value.fields : [];
  const field = fields.find((candidate) => objectValue(candidate)?.label === label);
  const fact = objectValue(objectValue(field)?.value);
  return fact === undefined ? undefined : factValue(fact);
}

function factValue(value: Readonly<Record<string, unknown>>): string {
  if (value.kind === "value") return String(value.value);
  if (value.kind === "text") return String(value.text);
  if (value.kind === "list") return `Array(${Array.isArray(value.items) ? value.items.length : 0})`;
  if (value.kind === "fields") return `Object(${Array.isArray(value.fields) ? value.fields.length : 0})`;
  return String(value.reason ?? "unavailable");
}

function coverageInsights(detail: Readonly<Record<string, unknown>> | undefined): readonly CoverageInsight[] {
  const found = new Map<string, CoverageInsight>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = objectValue(value);
    if (record === undefined) return;
    const coverageValue = record.evidenceCoverage;
    const coverageItems = Array.isArray(coverageValue) ? coverageValue : [];
    for (const raw of coverageItems) {
      const entry = objectValue(raw);
      if (typeof entry?.channel !== "string" || typeof entry.status !== "string") continue;
      const reason = typeof entry.reason === "string" ? entry.reason : undefined;
      found.set(`${entry.channel}\u0000${entry.status}\u0000${reason ?? ""}`, Object.freeze({
        channel: entry.channel,
        status: entry.status,
        ...(reason === undefined ? {} : { reason }),
      }));
    }
    const coverage = objectValue(coverageValue);
    if (coverage !== undefined) {
      for (const [channel, raw] of Object.entries(coverage)) {
        const entry = objectValue(raw);
        const status = typeof raw === "string" ? raw : typeof entry?.status === "string" ? entry.status : typeof entry?.state === "string" ? entry.state : undefined;
        if (status === undefined) continue;
        const reason = typeof entry?.reason === "string" ? entry.reason : undefined;
        found.set(`${channel}\u0000${status}\u0000${reason ?? ""}`, Object.freeze({ channel, status, ...(reason === undefined ? {} : { reason }) }));
      }
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(detail);
  return Object.freeze([...found.values()]);
}

function inferVerdict(detail: Readonly<Record<string, unknown>> | undefined, assertions: readonly AssertionInsight[]): string | undefined {
  const outcome = objectValue(detail?.core)?.outcome;
  if (outcome === "errored" || outcome === "interrupted") return "errored";
  if (outcome === "cancelled") return "skipped";
  return assertions.some(({ state }) => state === "mismatched" || state === "errored" || state === "unavailable") ? "failed" : "passed";
}

function renderAssertions(assertions: readonly AssertionInsight[], locale: ViewLocale): string {
  if (assertions.length === 0) return `<p class="empty">${text(locale, "noAssertions")}</p>`;
  return assertions.map((entry) => `<article class="assertion"><h3>${escapeHtml(entry.label)}</h3><dl><dt>${text(locale, "state")}</dt><dd>${html(entry.state)}</dd>${entry.points === undefined ? "" : `<dt>${text(locale, "weight")}</dt><dd>${html(round(entry.points))} pts</dd><dt>${text(locale, "earned")}</dt><dd>${html(round(entry.earned ?? 0))} pts</dd>`}${entry.observed === undefined ? "" : `<dt>${text(locale, "observedValue")}</dt><dd>${escapeHtml(entry.observed)}</dd>`}${entry.threshold === undefined ? "" : `<dt>${text(locale, "threshold")}</dt><dd>≥ ${html(round(entry.threshold))}</dd>`}</dl></article>`).join("");
}

function renderCoverage(coverage: readonly CoverageInsight[], locale: ViewLocale): string {
  if (coverage.length === 0) return `<p class="empty">${text(locale, "noCoverage")}</p>`;
  return `<ul>${coverage.map((entry) => `<li><strong>${escapeHtml(entry.channel)}</strong> ${escapeHtml(entry.status)}${entry.reason === undefined ? "" : ` — ${escapeHtml(entry.reason)}`}</li>`).join("")}</ul>`;
}

function coverageSummary(coverage: readonly CoverageInsight[], locale: ViewLocale): string {
  const partial = coverage.find(({ status }) => status === "partial") ?? coverage.find(({ status }) => status !== "complete");
  if (partial !== undefined) return `${partial.channel} ${partial.status}${partial.reason === undefined ? "" : ` — ${partial.reason}`}`;
  return coverage.length === 0 ? text(locale, "noCoverage") : text(locale, "complete");
}

function renderLimitations(limitations: readonly LimitationInsight[], locale: ViewLocale): string {
  if (limitations.length === 0) return `<p class="empty">${text(locale, "noLimitations")}</p>`;
  return `<ul>${limitations.map((entry) => `<li><strong>${escapeHtml(entry.owner)}</strong> ${escapeHtml(entry.state)}${entry.reason === undefined ? "" : ` — ${escapeHtml(entry.reason)}`}</li>`).join("")}</ul>`;
}

function limitationSummary(limitations: readonly LimitationInsight[], locale: ViewLocale): string {
  const entry = limitations[0];
  return entry === undefined
    ? text(locale, "noLimitations")
    : `${entry.owner} ${entry.state}${entry.reason === undefined ? "" : ` — ${entry.reason}`}`;
}

function formatScore(score: ScoreInsight, locale: ViewLocale): string {
  if (score.state === "not-scored") return text(locale, "notScored");
  if (score.state === "unavailable") return text(locale, "unavailable");
  return `${round(score.earned)} pts`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

function renderIssuesEvidence(document: InspectionDocument | undefined, locale: ViewLocale): string {
  if (document === undefined) return "";
  const issues = Array.isArray(document.issues) ? document.issues : [];
  const refs = Array.isArray(objectValue(document.evidence)?.refs) ? objectValue(document.evidence)!.refs as readonly unknown[] : [];
  return `<h2>${text(locale, "issues")}</h2>${issues.length === 0 ? `<p class="empty">${text(locale, "noIssues")}</p>` : `<ul>${issues.map((issue) => `<li>${html(objectValue(issue)?.code ?? issue)}</li>`).join("")}</ul>`}<h2>${text(locale, "evidence")}</h2>${refs.length === 0 ? `<p class="empty">${text(locale, "noEvidence")}</p>` : `<ul>${refs.map((ref) => `<li><code>${html(ref)}</code></li>`).join("")}</ul>`}`;
}

const TEXT = Object.freeze({
  en: Object.freeze({ overview: "Overview", runs: "Runs", noRuns: "No sealed Runs.", runTotal: "{total} sealed Runs.", runDelivery: "Showing the first {shown} of {total} sealed Runs at this fixed delivery limit.", noSelectedRuns: "No sealed Runs selected.", run: "Run", started: "Started", members: "Members", attempts: "Attempts", attachments: "Attachments", contents: "Contents", runInsight: "Run insight", resultLimited: "Result exceeds the fixed Inspection delivery limit.", observed: "Observed", denominator: "Expected denominator", noMembers: "No expected members.", attempt: "Attempt", state: "State", outcome: "Outcome", verdict: "Verdict", score: "Score", coverage: "Evidence coverage", limitations: "Limitations", inputTokens: "Input tokens", outputTokens: "Output tokens", attemptInsight: "Attempt insight", originRun: "Origin Run", targetRuns: "Target Runs", evidenceCoverage: "Evidence coverage", issues: "Issues", noIssues: "No Inspection issues.", evidence: "Evidence", noEvidence: "No Attempt evidence references.", weight: "Weight", earned: "Earned", observedValue: "Observed", threshold: "Threshold", noAssertions: "No assertion details.", noCoverage: "No evidence coverage facts.", noLimitations: "No partial limitations.", complete: "complete", notScored: "not scored", unavailable: "unavailable" }),
  "zh-CN": Object.freeze({ overview: "总览", runs: "运行", noRuns: "没有已封存的运行。", runTotal: "共有 {total} 个已封存运行。", runDelivery: "固定交付上限内显示前 {shown} 个，共 {total} 个已封存运行。", noSelectedRuns: "未选择已封存的运行。", run: "运行", started: "开始时间", members: "成员", attempts: "尝试", attachments: "附件", contents: "内容", runInsight: "运行检视", resultLimited: "结果超过固定 Inspection 交付上限。", observed: "已观察", denominator: "预期分母", noMembers: "没有预期成员。", attempt: "尝试", state: "状态", outcome: "结果", verdict: "裁决", score: "分数", coverage: "证据覆盖", limitations: "局限", inputTokens: "输入 token", outputTokens: "输出 token", attemptInsight: "尝试检视", originRun: "来源运行", targetRuns: "目标运行", evidenceCoverage: "证据覆盖", issues: "问题", noIssues: "没有 Inspection 问题。", evidence: "证据", noEvidence: "没有尝试证据引用。", weight: "权重", earned: "获得", observedValue: "观察值", threshold: "阈值", noAssertions: "没有断言详情。", noCoverage: "没有证据覆盖事实。", noLimitations: "没有部分局限。", complete: "完整", notScored: "未计分", unavailable: "不可用" }),
});

function text(locale: ViewLocale, key: keyof typeof TEXT.en): string { return TEXT[locale][key]; }
function objectField(document: InspectionDocument | undefined, key: string) { return document === undefined ? undefined : objectValue(Reflect.get(document, key)); }
function arrayField(document: InspectionDocument | undefined, key: string): readonly unknown[] { const value = document === undefined ? undefined : Reflect.get(document, key); return Array.isArray(value) ? value : []; }
function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function html(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return `Object(${Object.keys(value).length})`;
  return escapeHtml(String(value));
}
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
