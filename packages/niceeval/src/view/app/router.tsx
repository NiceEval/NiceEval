import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  createHashRouter,
  isRouteErrorResponse,
  Link,
  Navigate,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
  useRouteLoaderData,
} from "react-router-dom";
import { useTranslation } from "react-i18next";

import type {
  ArtifactsResult,
  AssertionResult,
  AttemptQueryResult,
  AttemptResult,
  CatalogResult,
  CompareResult,
  FileChangeResult,
  OverviewResult,
  RunResult,
  SourcesResult,
  TrajectoryItemResult,
  TurnResult,
} from "../query.ts";
import { viewRepository } from "./sqlite/repository.ts";

export const router = createHashRouter([{
  id: "snapshot",
  path: "/",
  loader: () => viewRepository.catalog(),
  element: <ViewShell />,
  errorElement: <ViewError />,
  children: [
    { index: true, loader: () => viewRepository.overview(), element: <OverviewRoute /> },
    { path: "experiment/:experimentId", loader: ({ params }) => viewRepository.overview(requiredParam(params.experimentId, "experimentId")), element: <OverviewRoute /> },
    { path: "run/:runId", loader: ({ params }) => viewRepository.run(requiredParam(params.runId, "runId")), element: <RunRoute /> },
    { path: "attempt/:locator", loader: ({ params }) => viewRepository.attempt(requiredParam(params.locator, "locator")), element: <AttemptRoute /> },
    { path: "attempt/:locator/sources", loader: ({ params }) => viewRepository.sources(requiredParam(params.locator, "locator")), element: <SourcesRoute /> },
    { path: "attempt/:locator/artifacts", loader: ({ params }) => viewRepository.artifacts(requiredParam(params.locator, "locator")), element: <ArtifactsRoute /> },
    { path: "compare", loader: () => viewRepository.compare(), element: <CompareRoute /> },
    { path: "*", element: <Navigate to="/" replace /> },
  ],
}]);

type StatusTone = "positive" | "negative" | "warning" | "neutral";
type TrajectoryLane = "input" | "model" | "tools";

const STATUS_CLASS: Record<StatusTone, string> = {
  positive: "border border-emerald-300/40 bg-emerald-300/10 px-2 py-0.5 text-xs font-medium text-emerald-200",
  negative: "border border-rose-300/40 bg-rose-300/10 px-2 py-0.5 text-xs font-medium text-rose-200",
  warning: "border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs font-medium text-amber-100",
  neutral: "border border-[#3a3a3a] bg-[#151515] px-2 py-0.5 text-xs font-medium text-[#bdbdbd]",
};

const LANE_CLASS: Record<TrajectoryLane, string> = {
  input: "border border-sky-300/25 bg-sky-300/10 px-2 py-1 text-sky-100",
  model: "border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-emerald-100",
  tools: "border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-amber-100",
};

function catalogData(): CatalogResult {
  return useRouteLoaderData("snapshot") as CatalogResult;
}

function ViewShell() {
  const catalog = useLoaderData() as CatalogResult;
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const selectedExperiment = experimentForLocation(catalog, location.pathname);
  const refresh = useRevisionRefresh();
  return <div className="min-h-screen bg-[#050505] text-[#ededed] antialiased">
    <header className="sticky top-0 z-20 h-16 border-b border-[#262626] bg-[#050505]/95 px-5 backdrop-blur md:px-20">
      <div className="mx-auto grid h-full max-w-[1280px] grid-cols-[1fr_auto_1fr] items-center gap-4">
        <Link className="inline-flex w-fit items-center gap-2 text-sm font-semibold tracking-tight text-[#ededed] no-underline" to="/" aria-label={t("nav.brand")}><span aria-hidden="true" className="text-base leading-none">◇</span>{t("nav.brand")}</Link>
        <nav aria-label={t("nav.pages")}><Link className="border-b border-[#ededed] pb-1 text-sm font-medium text-[#ededed] no-underline" to="/">{t("nav.overview")}</Link></nav>
        <div className="flex items-center justify-end gap-3">
          <label className="hidden items-center gap-2 text-xs text-[#a3a3a3] sm:flex"><span>{t("nav.experiments")}</span><select className="h-8 max-w-40 border border-[#262626] bg-[#0b0b0b] px-2 text-xs text-[#ededed] outline-none focus:border-[#ededed]" aria-label={t("nav.experiments")} value={selectedExperiment ?? ""} onChange={(event) => void navigate(`/experiment/${encodeURIComponent(event.target.value)}`)}>{catalog.experiments.map((experimentId) => <option key={experimentId} value={experimentId}>{experimentId}</option>)}</select></label>
          <label className="flex items-center gap-2 text-xs text-[#a3a3a3]"><span className="hidden sm:inline">{t("nav.language")}</span><select className="h-8 border border-[#262626] bg-[#0b0b0b] px-2 text-xs text-[#ededed] outline-none focus:border-[#ededed]" aria-label={t("nav.language")} value={i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en"} onChange={(event) => void i18n.changeLanguage(event.target.value)}><option value="en">English</option><option value="zh-CN">中文</option></select></label>
        </div>
      </div>
    </header>
    {refresh.available ? <aside className="mx-auto max-w-[1120px] border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-sm text-amber-100" role="status"><div className="flex items-center justify-between gap-4"><span>{t("refresh.available")}</span><button className="border border-amber-200/40 px-3 py-1 text-xs font-medium text-amber-50 disabled:cursor-wait disabled:opacity-50" type="button" disabled={refresh.working} onClick={refresh.apply}>{refresh.working ? t("refresh.working") : t("refresh.action")}</button></div></aside> : null}
    <main className="mx-auto w-full max-w-[1120px] px-5 pb-20 pt-[82px] md:px-0"><Outlet /></main>
  </div>;
}

function OverviewRoute() {
  const catalog = catalogData();
  const overview = useLoaderData() as OverviewResult;
  const { t } = useTranslation();
  const requestedRunIds = useRequestedRunIds();
  const selection = selectRuns(overview, requestedRunIds);
  const filteredOverview: OverviewResult = { ...overview, runs: selection.runs };
  const rate = overview.attempts === 0 ? 0 : overview.passed / overview.attempts;
  return <div className="space-y-14">
    <section className="border-b border-[#262626] pb-12"><p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-[#a3a3a3]">NiceEval / RecordSnapshot</p><h1 className="m-0 text-[44px] font-medium leading-[0.98] tracking-[-0.055em] text-[#ededed] md:text-[60px]">{t("overview.title")}</h1></section>
    {requestedRunIds.length === 0 ? null : <RunSelectionNotice selected={selection.runs.length} missing={selection.missing} />}
    <section aria-labelledby="summary-heading"><SectionHeading id="summary-heading" eyebrow={t("overview.summary")} title={t("overview.summary")} /><div className="grid grid-cols-2 border-l border-t border-[#262626] sm:grid-cols-3 lg:grid-cols-6"><Metric label={t("overview.passRate")} value={`${formatNumber(rate * 100)}%`} /><Metric label={t("overview.experiments")} value={catalog.experiments.length} /><Metric label={t("overview.evals")} value={overview.evalIds.length} /><Metric label={t("overview.attempts")} value={overview.attempts} /><Metric label={t("overview.results")} value={overview.passed} /><Metric label={t("overview.totalCost")} value={formatMoney(overview.totalCost)} /></div></section>
    <section aria-labelledby="comparison-heading"><SectionHeading id="comparison-heading" eyebrow={t("overview.comparison")} title={t("overview.comparison")} /><div className="border border-[#262626] bg-[#0b0b0b] p-4" role="img" aria-label={t("overview.comparison")}>{overview.experiments.length === 0 ? <EmptyState label={t("overview.noExperiments")} /> : <div className="space-y-4">{overview.experiments.map((candidate) => <ComparisonRow candidate={candidate} key={candidate.experimentId} />)}</div>}</div></section>
    <section aria-labelledby="results-heading"><SectionHeading id="results-heading" eyebrow={t("overview.experimentResults")} title={t("overview.experimentResults")} />{filteredOverview.runs.length === 0 ? <EmptyState label={requestedRunIds.length === 0 ? t("overview.noRuns") : t("overview.noSelectedRuns")} /> : <ExperimentTable overview={filteredOverview} />}</section>
    <IssuesEvidence issues={filteredOverview.runs.flatMap((run) => run.members.flatMap((member) => member.attempt?.issues ?? []))} />
  </div>;
}

function RunSelectionNotice({ selected, missing }: { selected: number; missing: readonly string[] }) {
  const { t } = useTranslation();
  return <aside className="border border-[#262626] bg-[#0b0b0b] px-4 py-3 text-sm text-[#d4d4d4]" role={missing.length === 0 ? "status" : "alert"}><span>{t("overview.selectedRuns", { count: selected })}</span>{missing.length === 0 ? null : <p className="mb-0 mt-2 border-l-2 border-rose-300 bg-rose-300/10 px-3 py-2 text-rose-100">{t("overview.missingRuns", { runIds: missing.join(", ") })}</p>}</aside>;
}

function ComparisonRow({ candidate }: { candidate: OverviewResult["experiments"][number] }) {
  const rate = candidate.attempts === 0 ? 0 : candidate.passed / candidate.attempts;
  const chartStyle = { width: `${rate * 100}%` };
  return <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"><strong className="truncate font-medium text-[#ededed]">{candidate.experimentId}</strong><span className="block h-2 overflow-hidden bg-[#1b1b1b]"><span className="block h-full bg-[#ededed]" style={chartStyle} /></span><span className="font-mono text-xs text-[#a3a3a3]">{candidate.passed}/{candidate.attempts}</span></div>;
}

function ExperimentTable({ overview }: { overview: OverviewResult }) {
  const { t } = useTranslation();
  return <div className="overflow-x-auto border border-[#262626] bg-[#0b0b0b]"><table className="min-w-[860px] w-full border-collapse text-left text-sm" aria-label={t("overview.experimentResults")}><thead className="border-b border-[#262626] text-xs uppercase tracking-[0.14em] text-[#a3a3a3]"><tr><th className="px-4 py-3 font-medium">{t("table.experiment")}</th><th className="px-4 py-3 font-medium">{t("table.eval")}</th><th className="px-4 py-3 font-medium">{t("table.run")}</th><th className="px-4 py-3 font-medium">{t("table.started")}</th><th className="px-4 py-3 font-medium">{t("table.attempt")}</th><th className="px-4 py-3 font-medium">{t("table.verdict")}</th></tr></thead><tbody>{overview.runs.flatMap((run) => {
    const group = <tr className="border-y border-[#262626] bg-[#111111]" key={`${run.runId}:group`}><th className="px-4 py-2 text-xs font-medium text-[#ededed]" colSpan={6} scope="rowgroup">{run.experimentId} <span className="px-1 text-[#6f6f6f]">/</span> <Link className="font-mono text-[#d4d4d4] underline decoration-[#404040] underline-offset-4" to={`/run/${encodeURIComponent(run.runId)}`}>{run.runId}</Link></th></tr>;
    const rows = run.members.length === 0 ? [<tr className="border-b border-[#262626]" key={`${run.runId}:empty`}><td className="px-4 py-3 text-[#a3a3a3]">{run.experimentId}</td><td className="px-4 py-3 text-[#777777]" colSpan={5}>{t("run.noMembers")}</td></tr>] : run.members.map((member) => {
      const attempt = member.attempt;
      return <tr className="border-b border-[#262626] last:border-b-0 hover:bg-[#101010]" key={`${run.runId}:${member.slotId}`}><td className="px-4 py-3 text-[#a3a3a3]">↳</td><td className="px-4 py-3 font-medium text-[#ededed]">{member.evalId}</td><td className="px-4 py-3 font-mono text-xs text-[#a3a3a3]">{run.runId}</td><td className="px-4 py-3 text-xs text-[#a3a3a3]">{run.startedAt}</td><td className="px-4 py-3">{attempt === undefined ? <span className="text-[#a3a3a3]">{member.action}</span> : <Link className="font-mono text-xs text-[#ededed] underline decoration-[#404040] underline-offset-4" to={`/attempt/${encodeURIComponent(attempt.locator)}`}>{attempt.locator}</Link>}</td><td className="px-4 py-3"><Status value={attempt?.verdict ?? member.action} /></td></tr>;
    });
    return [group, ...rows];
  })}</tbody></table></div>;
}

function RunRoute() {
  const result = useLoaderData() as RunResult;
  const { t } = useTranslation();
  const run = result.run;
  if (run === undefined) return <Missing />;
  const observed = run.members.filter((member) => member.attempt !== undefined).length;
  return <div className="space-y-8"><PageNavigation /><section className="border border-[#262626] bg-[#0b0b0b] p-5 md:p-8"><p className="mb-3 text-xs uppercase tracking-[0.15em] text-[#a3a3a3]">{t("run.overlay")}</p><h1 className="m-0 break-all text-3xl font-medium tracking-[-0.04em] md:text-5xl">{t("run.title", { runId: run.runId })}</h1><div className="mt-8 grid grid-cols-2 border-l border-t border-[#262626] sm:max-w-md"><Metric label={t("run.denominator")} value={run.members.length} /><Metric label={t("run.observed")} value={observed} /></div></section><div className="overflow-x-auto border border-[#262626] bg-[#0b0b0b]"><table className="min-w-[900px] w-full border-collapse text-left text-sm" aria-label={t("run.title", { runId: run.runId })}><thead className="border-b border-[#262626] text-xs uppercase tracking-[0.12em] text-[#a3a3a3]"><tr><th className="px-4 py-3">{t("table.eval")}</th><th className="px-4 py-3">{t("table.attempt")}</th><th className="px-4 py-3">{t("table.action")}</th><th className="px-4 py-3">{t("table.verdict")}</th><th className="px-4 py-3">{t("table.score")}</th><th className="px-4 py-3">{t("table.coverage")}</th></tr></thead><tbody>{run.members.map((member) => {
    const attempt = member.attempt;
    return <tr className="border-b border-[#262626] last:border-b-0" key={member.slotId}><td className="px-4 py-3 font-medium">{member.evalId}</td><td className="px-4 py-3">{attempt === undefined ? "—" : <Link className="font-mono text-xs underline decoration-[#404040] underline-offset-4" to={`/attempt/${encodeURIComponent(attempt.locator)}`}>{attempt.locator}</Link>}</td><td className="px-4 py-3 text-[#a3a3a3]">{member.action}</td><td className="px-4 py-3"><Status value={attempt?.verdict ?? "unavailable"} /></td><td className="px-4 py-3">{attempt === undefined ? "—" : `${formatNumber(attempt.scoreEarned)} pts`}</td><td className="px-4 py-3 text-xs text-[#a3a3a3]">{attempt?.coverage.map((entry) => `${entry.channel} ${entry.status}`).join(", ") || t("state.notRecorded")}</td></tr>;
  })}</tbody></table></div><IssuesEvidence issues={run.members.flatMap((member) => member.attempt?.issues ?? [])} /></div>;
}

function AttemptRoute() {
  const attempt = (useLoaderData() as AttemptQueryResult).attempt;
  const { t } = useTranslation();
  if (attempt === undefined) return <Missing />;
  return <div className="space-y-8"><AttemptNavigation locator={attempt.locator} /><section className="border border-[#262626] bg-[#0b0b0b] p-5 md:p-8"><p className="mb-3 text-xs uppercase tracking-[0.15em] text-[#a3a3a3]">{t("attempt.overlay")}</p><h1 className="m-0 break-all text-3xl font-medium tracking-[-0.04em] md:text-5xl">{t("attempt.title", { locator: attempt.locator })}</h1><div className="mt-8 grid grid-cols-2 border-l border-t border-[#262626] sm:max-w-md"><Metric label={t("attempt.verdict")} value={<Status value={attempt.verdict} />} /><Metric label={t("attempt.score")} value={<span className="flex flex-col gap-1"><strong className="text-lg font-medium text-[#ededed]">{attempt.scoreState}</strong><span className="text-sm text-[#a3a3a3]">{formatNumber(attempt.scoreEarned)} / {formatNumber(attempt.scorePossible)} pts</span></span>} /></div></section><SourceAssertions attempt={attempt} /><Trajectory attempt={attempt} /><Execution attempt={attempt} /><ArtifactsPanel attempt={attempt} /><IssuesEvidence issues={attempt.issues} /></div>;
}

function SourceAssertions({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  return <DebugSection eyebrow={t("attempt.sealedOrigin")} title={t("attempt.sourceAssertions")}>
    {attempt.sources.length === 0 ? <EmptyState label={t("attempt.noSources")} /> : <div className="space-y-4">{attempt.sources.map((source) => <article className="border border-[#262626] bg-[#050505]" key={source.id} aria-label={t("attempt.sourceCode", { path: source.path })}><header className="flex items-center justify-between gap-3 border-b border-[#262626] bg-[#111111] px-4 py-3"><h3 className="m-0 break-all font-mono text-sm font-medium text-[#ededed]">{source.path}</h3><Status value={source.state} /></header><p className="border-b border-[#262626] px-4 py-2 text-xs text-[#a3a3a3]"><span>{t("attempt.sealedSource")}</span><span className="px-2 text-[#5f5f5f]">·</span><code>{source.sha256}</code></p><pre className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-6 text-[#d4d4d4]" aria-label={t("attempt.sourceCode", { path: source.path })}><code>{source.text}</code></pre></article>)}</div>}
    <section className="mt-6 border border-[#262626] bg-[#0b0b0b] p-4" role="region" aria-label={t("attempt.matcherRegions")}><h3 className="m-0 text-sm font-medium text-[#ededed]">{t("attempt.matcherRegions")}</h3>{attempt.assertions.length === 0 ? <EmptyState label={t("attempt.noAssertions")} /> : <ol className="mt-4 space-y-3">{attempt.assertions.map((assertion) => <Assertion assertion={assertion} key={assertion.id} />)}</ol>}</section>
  </DebugSection>;
}

function Assertion({ assertion }: { assertion: AssertionResult }) {
  const { t } = useTranslation();
  return <li className="border-l-2 border-[#606060] bg-[#111111] px-4 py-3" aria-label={t("attempt.assertionState", { label: assertion.label, state: assertion.state })}><div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm font-medium text-[#ededed]">{assertion.label}</strong><Status value={assertion.state} /></div><dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"><dt className="text-[#a3a3a3]">{t("table.state")}</dt><dd className="m-0">{assertion.state}</dd>{assertion.points === undefined ? null : <><dt className="text-[#a3a3a3]">{t("attempt.weight")}</dt><dd className="m-0">{formatNumber(assertion.points)} pts</dd><dt className="text-[#a3a3a3]">{t("attempt.earned")}</dt><dd className="m-0">{formatNumber(assertion.earned ?? 0)} pts</dd></>}{assertion.observed === undefined ? null : <><dt className="text-[#a3a3a3]">{t("attempt.observed")}</dt><dd className="m-0 break-words font-mono text-xs">{assertion.observed}</dd></>}{assertion.threshold === undefined ? null : <><dt className="text-[#a3a3a3]">{t("attempt.threshold")}</dt><dd className="m-0">≥ {formatNumber(assertion.threshold)}</dd></>}</dl></li>;
}

function Trajectory({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [openTurns, setOpenTurns] = useState(() => new Set(attempt.turns.map((turn) => turn.id)));
  const [openTools, setOpenTools] = useState(() => new Set<string>());
  const query = search.trim().toLocaleLowerCase();
  const visibleTurns = useMemo(() => attempt.turns.filter((turn) => query === "" || turn.items.some((item) => trajectoryText(item).includes(query))), [attempt.turns, query]);
  return <DebugSection eyebrow={t("attempt.turnLedger")} title={t("attempt.sessionLog")}><div className="flex flex-wrap items-end gap-2 border border-[#262626] bg-[#111111] p-3" role="toolbar" aria-label={t("attempt.trajectoryControls")}><label className="grid min-w-[14rem] flex-1 gap-1 text-xs text-[#a3a3a3]">{t("attempt.search")}<input className="h-9 border border-[#3a3a3a] bg-[#050505] px-3 text-sm text-[#ededed] outline-none placeholder:text-[#606060] focus:border-[#ededed]" type="search" aria-label={t("attempt.search")} placeholder={t("attempt.searchPlaceholder")} value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="h-9 border border-[#3a3a3a] bg-[#0b0b0b] px-3 text-xs font-medium text-[#ededed] hover:border-[#ededed] focus:outline-none focus:ring-1 focus:ring-[#ededed]" type="button" onClick={() => setOpenTurns(new Set())}>{t("attempt.collapseTurns")}</button><button className="h-9 border border-[#3a3a3a] bg-[#0b0b0b] px-3 text-xs font-medium text-[#ededed] hover:border-[#ededed] focus:outline-none focus:ring-1 focus:ring-[#ededed]" type="button" onClick={() => setOpenTools(new Set())}>{t("attempt.collapseTools")}</button></div><TrajectoryPlot turns={attempt.turns} /><div className="mt-5 border-l border-[#3a3a3a] pl-4" role="region" aria-label={t("attempt.trajectory")}>{visibleTurns.length === 0 ? <EmptyState label={t("attempt.noTrajectory")} /> : <div className="space-y-3">{visibleTurns.map((turn) => <TrajectoryTurn turn={turn} open={query !== "" || openTurns.has(turn.id)} openTools={openTools} onTurnToggle={() => setOpenTurns((current) => toggled(current, turn.id))} onToolToggle={(item) => setOpenTools((current) => toggled(current, item.id))} query={query} key={turn.id} />)}</div>}</div></DebugSection>;
}

function TrajectoryPlot({ turns }: { turns: readonly TurnResult[] }) {
  const { t } = useTranslation();
  const entries = turns.flatMap((turn) => turn.items);
  if (entries.length === 0) return null;
  return <div className="mt-5 overflow-x-auto border border-[#262626] bg-[#050505] p-3" role="region" aria-label={t("attempt.sequencePlot")}><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><strong className="text-sm font-medium text-[#ededed]">{t("attempt.sequencePlot")}</strong><span className="text-xs text-[#a3a3a3]">{t("attempt.sequencePlotHelp")}</span></div><div className="min-w-[620px]"><div className="grid grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] text-[11px] font-medium uppercase tracking-[0.12em] text-[#a3a3a3]"><span>#</span><span>{t("attempt.laneInput")}</span><span>{t("attempt.laneModel")}</span><span>{t("attempt.laneTools")}</span></div><ol className="mt-2 space-y-1">{entries.map((item, index) => <TrajectoryPlotRow item={item} index={index} key={item.id} />)}</ol></div></div>;
}

function TrajectoryPlotRow({ item, index }: { item: TrajectoryItemResult; index: number }) {
  const lane = trajectoryLane(item);
  return <li className="grid min-h-8 grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] gap-px text-xs"><span className="flex items-center justify-end pr-2 font-mono text-[#737373]">{String(index + 1).padStart(2, "0")}</span>{(["input", "model", "tools"] as const).map((candidate) => candidate === lane ? <span className={LANE_CLASS[candidate]} key={candidate}>{compactTrajectoryLabel(item)}</span> : <span className="border border-[#202020]" aria-hidden="true" key={candidate} />)}</li>;
}

function TrajectoryTurn({ turn, open, openTools, onTurnToggle, onToolToggle, query }: { turn: TurnResult; open: boolean; openTools: ReadonlySet<string>; onTurnToggle: () => void; onToolToggle: (item: TrajectoryItemResult) => void; query: string }) {
  const { t } = useTranslation();
  return <section className="border border-[#262626] bg-[#0b0b0b]"><button className="flex w-full items-center justify-between gap-3 bg-[#111111] px-4 py-3 text-left text-sm font-medium text-[#ededed] hover:bg-[#151515] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#ededed]" type="button" aria-expanded={open} onClick={onTurnToggle}><span>{t("attempt.turn", { sequence: turn.sequence })}</span><span className="font-mono text-xs font-normal text-[#a3a3a3]">{turn.outcome}</span></button>{open ? <div className="space-y-3 p-4">{turn.items.filter((item) => query === "" || trajectoryText(item).includes(query)).map((item) => item.kind === "tool" ? <ToolCall item={item} open={openTools.has(item.id)} onToggle={() => onToolToggle(item)} key={item.id} /> : <TrajectoryEvent item={item} key={item.id} />)}</div> : null}</section>;
}

function ToolCall({ item, open, onToggle }: { item: TrajectoryItemResult; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return <article className="border border-[#262626] bg-[#050505]" aria-label={t("attempt.toolCall", { callId: item.id })}><button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-[#ededed] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#ededed]" type="button" aria-expanded={open} onClick={onToggle}><span className="font-medium">{t("attempt.tool", { tool: item.tool ?? t("state.unavailable") })}</span><code className="text-xs text-[#a3a3a3]">{item.id}</code></button>{open ? <div className="grid gap-px border-t border-[#262626] bg-[#262626] md:grid-cols-2"><ToolValue label={t("attempt.toolInput")} value={item.input} /><ToolValue label={t("attempt.toolOutput")} value={item.output} /></div> : null}</article>;
}

function ToolValue({ label, value }: { label: string; value: string | undefined }) {
  return <section className="bg-[#0b0b0b] p-4"><h4 className="m-0 text-xs font-medium uppercase tracking-[0.12em] text-[#a3a3a3]">{label}</h4>{value === undefined || value.length === 0 ? <RecordWarning state="not-recorded" /> : <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-[#d4d4d4]">{value}</pre>}</section>;
}

function TrajectoryEvent({ item }: { item: TrajectoryItemResult }) {
  const lane = trajectoryLane(item);
  return <article className="border border-[#262626] bg-[#050505] px-4 py-3"><header className="flex flex-wrap items-center gap-2"><span className={LANE_CLASS[lane]}>{item.kind}</span>{item.role === undefined ? null : <strong className="text-xs font-medium text-[#ededed]">{item.role}</strong>}<code className="ml-auto text-xs text-[#737373]">{item.id}</code></header><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-[#d4d4d4]">{item.text || "not-recorded"}</pre></article>;
}

function Execution({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  const maximum = Math.max(1, ...attempt.activities.map((activity) => activity.startOffsetMs + activity.durationMs));
  return <div className="space-y-8"><DebugSection eyebrow={t("attempt.runnerActivities")} title={t("attempt.executionTimeline")}>{attempt.activities.length === 0 ? <RecordWarning state="not-recorded" /> : <div className="space-y-3">{attempt.activities.map((activity) => <WaterfallRow activity={activity} maximum={maximum} key={activity.id} />)}</div>}</DebugSection><DebugSection eyebrow={t("attempt.observedConsumption")} title={t("attempt.usage")}>{attempt.usage.length === 0 ? <RecordWarning state="not-recorded" /> : <div className="grid gap-px border border-[#262626] bg-[#262626] sm:grid-cols-2 lg:grid-cols-3">{attempt.usage.map((usage) => <article className="bg-[#0b0b0b] p-4" key={usage.id}><strong className="block text-sm font-medium text-[#ededed]">{usage.label}</strong><span className="mt-2 block text-xl tracking-[-0.03em] text-[#ededed]">{usage.value}</span><small className="mt-2 block font-mono text-xs text-[#a3a3a3]">{usage.kind}</small></article>)}</div>}</DebugSection><EvidenceCoverage attempt={attempt} /><CommandPanel attempt={attempt} /><DiagnosticPanel attempt={attempt} /><DiffPanel attempt={attempt} /></div>;
}

function EvidenceCoverage({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  return <DebugSection title={t("attempt.evidenceCoverage")}>{attempt.coverage.length === 0 ? <RecordWarning state="not-recorded" /> : <ul className="m-0 grid list-none gap-px border border-[#262626] bg-[#262626] p-0 sm:grid-cols-2 lg:grid-cols-3">{attempt.coverage.map((entry) => <li className="bg-[#0b0b0b] p-4" key={entry.channel}><div className="flex flex-wrap items-center justify-between gap-3"><strong className="font-mono text-sm font-medium text-[#ededed]">{entry.channel}</strong><Status value={entry.status} /></div>{entry.reason === undefined ? null : <p className="mb-0 mt-3 text-sm leading-6 text-[#a3a3a3]">{entry.reason}</p>}</li>)}</ul>}</DebugSection>;
}

function WaterfallRow({ activity, maximum }: { activity: AttemptResult["activities"][number]; maximum: number }) {
  const barStyle = { marginLeft: `${activity.startOffsetMs / maximum * 100}%`, width: `${Math.max(1, activity.durationMs / maximum * 100)}%` };
  return <article className="grid gap-3 border-b border-[#262626] pb-3 last:border-b-0 md:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)] md:items-center"><div><strong className="block text-sm font-medium text-[#ededed]">{activity.label}</strong><span className="mt-1 block text-xs text-[#a3a3a3]">{activity.phase} <span className="px-1 text-[#5f5f5f]">·</span> {activity.outcome} <span className="px-1 text-[#5f5f5f]">·</span> {formatMilliseconds(activity.durationMs)}</span></div><div className="h-3 border border-[#262626] bg-[#050505] p-px"><span className="block h-full bg-[#ededed]" style={barStyle} /></div></article>;
}

function CommandPanel({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  return <DebugSection eyebrow={t("attempt.commandLog")} title={t("attempt.commands")}>{attempt.commands.length === 0 ? <RecordWarning state="not-recorded" /> : <div className="space-y-3">{attempt.commands.map((command) => <details className="border border-[#262626] bg-[#050505]" key={command.id}><summary className="cursor-pointer list-none px-4 py-3 text-sm text-[#ededed]"><span className="mr-3 font-mono text-xs text-[#d4d4d4]">{command.invocation}</span><Status value={command.outcome} /></summary><div className="grid gap-px border-t border-[#262626] bg-[#262626] md:grid-cols-2"><CommandStream label="stdout" value={command.stdout} state={command.state} /><CommandStream label="stderr" value={command.stderr} state={command.state} /></div></details>)}</div>}</DebugSection>;
}

function CommandStream({ label, value, state }: { label: string; value: string; state: string }) {
  return <section className="bg-[#0b0b0b] p-4"><div className="flex items-center justify-between gap-3"><h4 className="m-0 text-xs font-medium uppercase tracking-[0.12em] text-[#a3a3a3]">{label}</h4><Status value={state} /></div>{value.length === 0 ? <RecordWarning state="not-recorded" /> : <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-[#d4d4d4]">{value}</pre>}</section>;
}

function DiagnosticPanel({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  return <DebugSection eyebrow={t("attempt.recordedSignals")} title={t("attempt.diagnostics")}>{attempt.diagnostics.length === 0 ? <RecordWarning state="not-recorded" /> : <div className="space-y-3">{attempt.diagnostics.map((diagnostic) => <article className="border border-[#262626] bg-[#050505] p-4" key={diagnostic.id}><header className="flex flex-wrap items-center gap-2"><Status value={diagnostic.kind} /><code className="text-xs text-[#d4d4d4]">{diagnostic.code}</code></header><p className="mb-0 mt-3 text-sm leading-6 text-[#d4d4d4]">{diagnostic.summary}</p></article>)}</div>}</DebugSection>;
}

function DiffPanel({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  return <DebugSection eyebrow={t("attempt.recordedChanges")} title={t("attempt.diff")}>{attempt.fileChanges.length === 0 ? <RecordWarning state="not-recorded" /> : <div className="space-y-3">{attempt.fileChanges.map((change) => <DiffChange change={change} key={change.id} />)}</div>}</DebugSection>;
}

function DiffChange({ change }: { change: FileChangeResult }) {
  const { t } = useTranslation();
  return <article className="border border-[#262626] bg-[#050505]"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] bg-[#111111] px-4 py-3"><div className="min-w-0"><p className="m-0 text-xs uppercase tracking-[0.12em] text-[#a3a3a3]">{t("attempt.directory")}: <code className="normal-case tracking-normal text-[#d4d4d4]">{directoryFor(change.path)}</code></p><h3 className="mt-1 break-all font-mono text-sm font-medium text-[#ededed]">{change.path}</h3></div><Status value={`${change.kind} ${change.state}`} /></header><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-[#d4d4d4]" aria-label={t("attempt.patch", { path: change.path })}>{patchFor(change, t("state.notRecorded"))}</pre></article>;
}

function ArtifactsPanel({ attempt }: { attempt: AttemptResult }) {
  const { t } = useTranslation();
  return <DebugSection eyebrow={t("attempt.sealedOutput")} title={t("nav.artifacts")}><RecordWarning state={attempt.artifactsState} />{attempt.artifacts.length === 0 ? <EmptyState label={t("attempt.noArtifacts")} /> : <ArtifactTable artifacts={attempt.artifacts} />}</DebugSection>;
}

function SourcesRoute() {
  const result = useLoaderData() as SourcesResult;
  const { t } = useTranslation();
  return <div className="space-y-8"><AttemptNavigation locator={result.locator} /><OverlayTitle eyebrow={t("attempt.overlay")} title={t("sources.title", { locator: result.locator })} /><SourceList sources={result.sources} /></div>;
}

function SourceList({ sources }: { sources: SourcesResult["sources"] }) {
  const { t } = useTranslation();
  return <div className="space-y-4">{sources.map((source) => <article className="border border-[#262626] bg-[#0b0b0b]" key={source.id} aria-label={t("attempt.sourceCode", { path: source.path })}><header className="flex items-center justify-between gap-3 border-b border-[#262626] bg-[#111111] px-4 py-3"><h2 className="m-0 font-mono text-sm font-medium">{source.path}</h2><Status value={source.state} /></header><p className="border-b border-[#262626] px-4 py-2 font-mono text-xs text-[#a3a3a3]">{source.sha256}</p><pre className="max-h-[38rem] overflow-auto p-4 font-mono text-xs leading-6 text-[#d4d4d4]">{source.text}</pre></article>)}</div>;
}

function ArtifactsRoute() {
  const result = useLoaderData() as ArtifactsResult;
  const { t } = useTranslation();
  return <div className="space-y-8"><AttemptNavigation locator={result.locator} /><OverlayTitle eyebrow={t("attempt.overlay")} title={t("artifacts.title", { locator: result.locator })} /><DebugSection title={t("nav.artifacts")}><RecordWarning state={result.state} />{result.artifacts.length === 0 ? <EmptyState label={t("attempt.noArtifacts")} /> : <ArtifactTable artifacts={result.artifacts} />}</DebugSection></div>;
}

function ArtifactTable({ artifacts }: { artifacts: ArtifactsResult["artifacts"] }) {
  const { t } = useTranslation();
  return <div className="mt-4 overflow-x-auto border border-[#262626]"><table className="min-w-[620px] w-full border-collapse text-left text-sm" aria-label={t("nav.artifacts")}><thead className="border-b border-[#262626] bg-[#111111] text-xs uppercase tracking-[0.12em] text-[#a3a3a3]"><tr><th className="px-4 py-3">{t("table.label")}</th><th className="px-4 py-3">{t("table.mediaType")}</th><th className="px-4 py-3">{t("table.bytes")}</th><th className="px-4 py-3">{t("table.state")}</th></tr></thead><tbody>{artifacts.map((artifact) => <tr className="border-b border-[#262626] last:border-b-0" key={artifact.id}><td className="px-4 py-3">{artifact.label}</td><td className="px-4 py-3 font-mono text-xs text-[#a3a3a3]">{artifact.mediaType}</td><td className="px-4 py-3">{artifact.byteLength}</td><td className="px-4 py-3"><Status value={artifact.state} /></td></tr>)}</tbody></table></div>;
}

function CompareRoute() {
  const result = useLoaderData() as CompareResult;
  const { t } = useTranslation();
  return <div className="space-y-8"><PageNavigation /><OverlayTitle eyebrow={t("compare.help")} title={t("compare.title")} /><div className="grid gap-4 md:grid-cols-2">{result.experiments.map((experiment) => <section className="border border-[#262626] bg-[#0b0b0b] p-5" key={experiment.experimentId}><h2 className="m-0 text-lg font-medium">{experiment.experimentId}</h2><ul className="mt-4 space-y-2">{experiment.runs.map((run) => <li key={run.runId}><Link className="font-mono text-xs text-[#d4d4d4] underline decoration-[#404040] underline-offset-4" to={`/run/${encodeURIComponent(run.runId)}`}>{run.runId}</Link></li>)}</ul></section>)}</div></div>;
}

function AttemptNavigation({ locator }: { locator: string }) {
  const { t } = useTranslation();
  return <nav className="flex flex-wrap gap-x-5 gap-y-2 border-b border-[#262626] pb-3 text-xs font-medium text-[#a3a3a3]" aria-label={t("nav.attemptPages")}><Link className="text-[#a3a3a3] hover:text-[#ededed]" to="/">{t("nav.overview")}</Link><Link className="text-[#a3a3a3] hover:text-[#ededed]" to="/compare">{t("nav.compare")}</Link><Link className="text-[#a3a3a3] hover:text-[#ededed]" to={`/attempt/${encodeURIComponent(locator)}`}>{t("nav.attempt")}</Link><Link className="text-[#a3a3a3] hover:text-[#ededed]" to={`/attempt/${encodeURIComponent(locator)}/sources`}>{t("nav.sources")}</Link><Link className="text-[#a3a3a3] hover:text-[#ededed]" to={`/attempt/${encodeURIComponent(locator)}/artifacts`}>{t("nav.artifacts")}</Link></nav>;
}

function PageNavigation() {
  const { t } = useTranslation();
  return <nav className="flex gap-5 border-b border-[#262626] pb-3 text-xs font-medium" aria-label={t("nav.pages")}><Link className="text-[#a3a3a3] hover:text-[#ededed]" to="/">{t("nav.overview")}</Link><Link className="text-[#a3a3a3] hover:text-[#ededed]" to="/compare">{t("nav.compare")}</Link></nav>;
}

function OverlayTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <section className="border border-[#262626] bg-[#0b0b0b] p-5 md:p-8"><p className="mb-3 text-xs uppercase tracking-[0.15em] text-[#a3a3a3]">{eyebrow}</p><h1 className="m-0 break-all text-3xl font-medium tracking-[-0.04em] md:text-5xl">{title}</h1></section>;
}

function DebugSection({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return <section className="border border-[#262626] bg-[#0b0b0b] p-4 md:p-5"><header className="mb-5 border-b border-[#262626] pb-4">{eyebrow === undefined ? null : <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#a3a3a3]">{eyebrow}</p>}<h2 className="m-0 text-xl font-medium tracking-[-0.025em] text-[#ededed]">{title}</h2></header>{children}</section>;
}

function SectionHeading({ eyebrow, id, title }: { eyebrow: string; id: string; title: string }) {
  return <header className="mb-5"><p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-[#a3a3a3]">{eyebrow}</p><h2 className="m-0 text-2xl font-medium tracking-[-0.035em] text-[#ededed]" id={id}>{title}</h2></header>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <article className="flex min-h-28 flex-col justify-between border-b border-r border-[#262626] bg-[#0b0b0b] p-4"><span className="text-xs font-medium uppercase tracking-[0.12em] text-[#a3a3a3]">{label}</span><div className="mt-5 text-2xl font-medium tracking-[-0.04em] text-[#ededed]">{value}</div></article>;
}

function Status({ value }: { value: string }) {
  const { t } = useTranslation();
  const className = STATUS_CLASS[toneForState(value)];
  return <span className={className} aria-label={t("state.label", { value })}>{value}</span>;
}

function RecordWarning({ state }: { state: string }) {
  const { t } = useTranslation();
  if (!needsWarning(state)) return <Status value={state} />;
  return <p className="mt-4 border-l-2 border-amber-200 bg-amber-300/10 px-3 py-2 text-sm text-amber-100" role="status"><strong>{state}</strong><span className="px-2 text-amber-200/70">—</span>{t("state.limited")}</p>;
}

function EmptyState({ label }: { label: string }) {
  return <p className="m-0 border border-dashed border-[#3a3a3a] bg-[#080808] px-4 py-5 text-sm text-[#a3a3a3]">{label}</p>;
}

function IssuesEvidence({ issues }: { issues: readonly string[] }) {
  const { t } = useTranslation();
  return <section className="grid border border-[#262626] bg-[#0b0b0b] md:grid-cols-2"><div className="border-b border-[#262626] p-5 md:border-b-0 md:border-r"><h2 className="m-0 text-sm font-medium text-[#ededed]">{t("overview.issues")}</h2>{issues.length === 0 ? <p className="mb-0 mt-3 text-sm text-[#a3a3a3]">{t("overview.noIssues")}</p> : <ul className="mb-0 mt-3 space-y-2 text-sm text-[#d4d4d4]">{[...new Set(issues)].map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div><div className="p-5"><h2 className="m-0 text-sm font-medium text-[#ededed]">{t("overview.evidence")}</h2><p className="mb-0 mt-3 text-sm leading-6 text-[#a3a3a3]">{t("overview.evidenceHelp")}</p></div></section>;
}

function Missing() {
  const { t } = useTranslation();
  return <div className="space-y-8"><PageNavigation /><section className="border border-[#262626] bg-[#0b0b0b] p-8"><h1 className="m-0 text-3xl font-medium">{t("state.unavailable")}</h1></section></div>;
}

function ViewError() {
  const error = useRouteError();
  const { t } = useTranslation();
  const reason = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error);
  return <main className="min-h-screen bg-[#050505] px-5 pt-[82px] text-[#ededed]"><section className="mx-auto max-w-[1120px] border border-rose-300/40 bg-[#0b0b0b] p-6"><h1 className="m-0 text-3xl font-medium">{t("app.failed")}</h1><pre className="mt-5 max-h-80 overflow-auto border border-[#262626] bg-[#050505] p-4 text-xs text-[#d4d4d4]">{reason}</pre><button className="mt-5 border border-[#3a3a3a] bg-[#111111] px-4 py-2 text-sm hover:border-[#ededed]" type="button" onClick={() => { viewRepository.reset(); location.reload(); }}>{t("app.retry")}</button></section></main>;
}

function useRevisionRefresh(): { readonly available: boolean; readonly working: boolean; readonly apply: () => void } {
  const [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const probe = async (): Promise<void> => {
      try {
        const response = await fetch(new URL("record.sqlite", document.baseURI), { method: "HEAD", cache: "no-store", credentials: "same-origin" });
        if (!active) return;
        setAvailable(response.headers.get("x-niceeval-view-stale") === "1");
        if (response.headers.get("x-niceeval-view-refresh") === "supported") timer = window.setTimeout(() => void probe(), 500);
      } catch { /* A fixed snapshot remains usable when the watcher stops. */ }
    };
    void probe();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, []);
  const apply = (): void => {
    setWorking(true);
    void fetch(new URL("record.sqlite", document.baseURI), { method: "POST", credentials: "same-origin", headers: { "x-niceeval-view-action": "refresh" } })
      .then((response) => { if (!response.ok) throw new Error("refresh failed"); viewRepository.reset(); location.reload(); })
      .catch(() => setWorking(false));
  };
  return { available, working, apply };
}

function useRequestedRunIds(): readonly string[] {
  const [query, setQuery] = useState(() => window.location.search);
  useEffect(() => {
    const update = (): void => setQuery(window.location.search);
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => { window.removeEventListener("popstate", update); window.removeEventListener("hashchange", update); };
  }, []);
  return useMemo(() => [...new Set(new URLSearchParams(query).getAll("run").filter((runId) => runId.length > 0))], [query]);
}

function selectRuns(overview: OverviewResult, runIds: readonly string[]): { readonly runs: OverviewResult["runs"]; readonly missing: readonly string[] } {
  if (runIds.length === 0) return { runs: overview.runs, missing: [] };
  const byId = new Map(overview.runs.map((run) => [run.runId, run]));
  return { runs: runIds.flatMap((runId) => byId.get(runId) === undefined ? [] : [byId.get(runId) as OverviewResult["runs"][number]]), missing: runIds.filter((runId) => !byId.has(runId)) };
}

function experimentForLocation(catalog: CatalogResult, pathname: string): string | undefined {
  const experimentMatch = /^\/experiment\/([^/]+)$/u.exec(pathname);
  if (experimentMatch?.[1] !== undefined) return decodeURIComponent(experimentMatch[1]);
  const runMatch = /^\/run\/([^/]+)$/u.exec(pathname);
  if (runMatch?.[1] !== undefined) return catalog.runExperiments.find((run) => run.runId === decodeURIComponent(runMatch[1]))?.experimentId;
  const attemptMatch = /^\/attempt\/([^/]+)/u.exec(pathname);
  if (attemptMatch?.[1] !== undefined) return catalog.attemptExperiments.find((candidate) => candidate.locator === decodeURIComponent(attemptMatch[1]))?.experimentId;
  return catalog.defaultExperimentId ?? catalog.experiments[0];
}

function trajectoryText(item: TrajectoryItemResult): string {
  return [item.id, item.kind, item.role, item.text, item.tool, item.input, item.output].filter(Boolean).join(" ").toLocaleLowerCase();
}

function trajectoryLane(item: TrajectoryItemResult): TrajectoryLane {
  if (item.kind === "tool" || item.tool !== undefined) return "tools";
  if (item.role === "user" || item.kind === "input-request" || item.kind === "context-injection") return "input";
  return "model";
}

function compactTrajectoryLabel(item: TrajectoryItemResult): string {
  const value = item.tool ?? item.role ?? item.kind;
  const compact = (item.text || item.input || item.output || "").replaceAll(/\s+/gu, " ").trim();
  return compact.length === 0 ? value : `${value} · ${compact.length > 42 ? `${compact.slice(0, 41)}…` : compact}`;
}

function toneForState(value: string): StatusTone {
  const normalized = value.toLocaleLowerCase();
  if (["passed", "pass", "available", "complete", "recorded", "success", "succeeded", "created", "modified"].includes(normalized)) return "positive";
  if (["failed", "fail", "errored", "error", "invalid", "deleted", "mismatched"].includes(normalized)) return "negative";
  if (needsWarning(normalized)) return "warning";
  return "neutral";
}

function needsWarning(value: string): boolean {
  const normalized = value.toLocaleLowerCase();
  return normalized.includes("partial") || normalized.includes("not-recorded") || normalized.includes("truncated") || normalized.includes("omitted") || normalized.includes("unavailable") || normalized.includes("pending");
}

function directoryFor(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator) || "/";
}

function patchFor(change: FileChangeResult, notRecorded: string): string {
  if (change.beforeText === undefined && change.afterText === undefined) return notRecorded;
  const before = change.beforeText === undefined ? "" : change.beforeText.split("\n").map((line) => `-${line}`).join("\n");
  const after = change.afterText === undefined ? "" : change.afterText.split("\n").map((line) => `+${line}`).join("\n");
  return [`--- a/${change.path}`, `+++ b/${change.path}`, before, after].filter((line) => line.length > 0).join("\n");
}

function toggled(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  next.has(key) ? next.delete(key) : next.add(key);
  return next;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number): string {
  return value === 0 ? "$0" : `$${formatNumber(value)}`;
}

function formatMilliseconds(value: number): string {
  return value < 1_000 ? `${formatNumber(value)} ms` : `${formatNumber(value / 1_000)} s`;
}

function requiredParam(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) throw new Error(`Route parameter ${name} is required.`);
  return decodeURIComponent(value);
}
