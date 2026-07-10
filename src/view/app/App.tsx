import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { MessageKey } from "./i18n.ts";
import type { Locale, LocalizedText, SortKey, SortState, Tab, ViewData, ViewResult, ViewRow } from "./types.ts";
import { CELL_KEYS, buildGroupMap, buildRows, compareRows, flattenAttempts, resultFromUrl } from "./lib/rows.ts";
import { formatAttemptHash, parseAttemptHash, resolveAttemptRef, unresolvedAttemptWarning } from "./lib/attempt-route.ts";
import { formatCost, formatDateTime, formatDuration } from "./lib/format.ts";
import { Metric } from "./components/primitives.tsx";
import { GroupSelector } from "./components/GroupSelector.tsx";
import { CostScoreChart } from "./components/CostScoreChart.tsx";
import { ExperimentTable } from "./components/ExperimentTable.tsx";
import { CopyFixPrompt } from "./components/CopyControls.tsx";
import { AttemptModal } from "./components/AttemptModal.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { RunsView } from "./pages/RunsPage.tsx";
import { TracesView } from "./pages/TracesPage.tsx";

// 首页报告只有一份:不传 --report 时是默认报告(Experiments tab),传了整页替换成用户报告。
// 证据室(Runs / Traces / AttemptModal)是 view 本体,两种模式下原样保留。
export const navItems: { id: Tab; label: MessageKey }[] = [
  { id: "experiments", label: "nav.experiments" },
  { id: "runs", label: "nav.runs" },
  { id: "traces", label: "nav.traces" },
];

export const reportNavItems: { id: Tab; label: MessageKey }[] = [
  { id: "report", label: "nav.report" },
  { id: "runs", label: "nav.runs" },
  { id: "traces", label: "nav.traces" },
];

/** 把 config.name 解析成当前界面语言的一条文案:字符串原样返回,多语言映射按 locale 挑,挑不到回退 en / 第一条。 */
export function localizedText(text: LocalizedText | undefined, locale: Locale): string | undefined {
  if (!text) return undefined;
  if (typeof text === "string") return text;
  return text[locale] ?? text.en ?? Object.values(text)[0];
}

/** 初始 URL → 直接打开的 attempt:先认 #/attempt/<run>/<result> 深链,回退旧版 ?modal= 参数。 */
function modalResultFromLocation(snapshots: ViewData["snapshots"]): ViewResult | null {
  const ref = parseAttemptHash(location.hash);
  if (ref) {
    const found = resolveAttemptRef(snapshots, ref);
    if (found) return found;
    // 定位不到(run 不在、下标越界、旧格式数据):不开空 modal,页面照常渲染。
    console.warn(unresolvedAttemptWarning(location.hash));
    return null;
  }
  return resultFromUrl(snapshots);
}

export function App({ data, reportHtml }: { data: ViewData; reportHtml?: string }) {
  const snapshots = data.snapshots ?? [];
  const hasReport = reportHtml !== undefined;
  const rows = useMemo(() => buildRows(data), [data]);
  const attempts = useMemo(() => flattenAttempts(snapshots), [snapshots]);
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);
  const [tab, setTab] = useState<Tab>(hasReport ? "report" : "experiments");
  const [sort, setSort] = useState<SortState>({ key: "passRate", dir: -1 });
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
    return groups[0] ?? null;
  });
  const [modalResult, setModalResult] = useState<ViewResult | null>(() => modalResultFromLocation(snapshots));
  // 当前 modal 的 hash 历史条目前面是否还有本页条目(本页 push 的 / 前进键回到的):
  // true → UI 关闭走 history.back(),前进键还能重新打开;false(深链直接落地)→ 原地抹 hash,
  // 免得 back 把用户弹出站外。
  const modalOwnsHistory = useRef(false);

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

  const openModal = useCallback((result: ViewResult) => {
    setModalResult(result);
    const ref = result.attemptRef;
    // 旧格式烘焙的数据没有 attemptRef:modal 照常打开,只是这条 attempt 产不出可分享链接。
    if (!ref) return;
    try {
      // pushState/replaceState 不触发 hashchange,不会和下面的监听器重复开合。
      if (parseAttemptHash(location.hash)) {
        // 已经在某条 attempt 深链上(防御浏览器导航竞态):替换当前条目,不叠历史。
        history.replaceState(null, "", formatAttemptHash(ref));
      } else {
        history.pushState(null, "", formatAttemptHash(ref));
        modalOwnsHistory.current = true;
      }
    } catch {
      // file:// 等受限环境可能拒绝写 history;URL 同步失败不影响打开 modal。
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalResult(null);
    if (modalOwnsHistory.current) {
      modalOwnsHistory.current = false;
      history.back();
      return;
    }
    try {
      // 深链直接落地 / 旧版 ?modal= 链接:没有可回退的本页条目,原地还原成无 modal 的 URL。
      history.replaceState(null, "", location.pathname);
    } catch {
      // 还原 URL 失败不影响关闭。
    }
  }, []);

  // 浏览器前进/后退、手改 hash、页内 attempt 链接统一从 hashchange 开合 modal。
  useEffect(() => {
    const onHashChange = () => {
      const ref = parseAttemptHash(location.hash);
      if (!ref) {
        modalOwnsHistory.current = false;
        setModalResult(null);
        return;
      }
      const found = resolveAttemptRef(snapshots, ref);
      if (!found) {
        console.warn(unresolvedAttemptWarning(location.hash));
        setModalResult(null);
        return;
      }
      // 经浏览器导航打开:前一条历史仍是本页,UI 关闭可以安全 back()。
      modalOwnsHistory.current = true;
      setModalResult(found);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [snapshots]);

  const groupMap = useMemo<Map<string, ViewRow[]>>(() => buildGroupMap(rows), [rows]);
  const pool = selectedGroup ? groupMap.get(selectedGroup) ?? [] : rows;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((row: ViewRow) => {
        if (!q) return true;
        return [
          row.label,
          row.group || "",
          row.experimentId || "",
          row.agent,
          row.model || "",
          ...(row.results ?? []).map((r: ViewResult) => r.id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a: ViewRow, b: ViewRow) => compareRows(a, b, sort.key) * sort.dir);
  }, [pool, query, sort]);

  const setSortKey = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: key === "experiment" || key === "agent" ? 1 : -1 },
    );
  };

  const toggleRow = (key: string) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // hero 的官方数字:整体通过率是 MetricTable.data 常量维度的单行格子,其余来自 RunOverview.data。
  const overallPassRate = data.overall?.rows[0]?.cells[CELL_KEYS.passRate];
  const totals = data.overview?.totals;
  const warnings = data.overview?.warnings ?? [];

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <header className="topbar">
        <a className="brand" href="https://github.com/CorrectRoadH/niceeval" target="_blank" rel="noreferrer">
          <span className="mark" />
          <span>NiceEval</span>
        </a>
        <TabsList aria-label={t("nav.label")}>
          {(hasReport ? reportNavItems : navItems).map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {t(item.label)}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="lang-switch" aria-label="Language">
          {(["en", "zh-CN"] satisfies Locale[]).map((item) => (
            <button
              key={item}
              className={locale === item ? "is-active" : ""}
              type="button"
              onClick={() => setLocale(item)}
              aria-pressed={locale === item}
            >
              {item === "zh-CN" ? "中文" : "EN"}
            </button>
          ))}
        </div>
      </header>
      <main>
        <section className="hero">
          <h1>{localizedText(data.name, locale) || t("hero.title")}</h1>
          <div className="meta">
            <span>
              {/* viewData 只带原始值(ISO / number),这里按当前界面 locale 格式化。 */}
              <b>{t("hero.lastRun")}</b> {data.lastRunAt ? formatDateTime(data.lastRunAt, locale) : t("hero.noRuns")}
            </span>
            {data.composedRuns > 0 ? (
              // 榜单是跨 run 合成的现刻水位,表头如实标注合成来源(几个 run)。
              <span>{t("hero.composedFrom", { count: data.composedRuns })}</span>
            ) : null}
          </div>
        </section>

        {/* 官方水位 KPI 与挑选警告属于报告槽:--report 整槽替换后由用户报告自己决定
            摆不摆(<DefaultReport /> / <RunOverview /> 都能把它们摆回来)。 */}
        {!hasReport && (
          <section className="summary" aria-label="Run summary">
            <Metric label={t("metric.passRate")} value={overallPassRate?.display ?? "—"} />
            <Metric label={t("metric.evalResults")} value={String(totals?.evals ?? 0)} />
            <Metric label={t("metric.duration")} value={formatDuration(totals?.durationMs ?? 0)} />
            <Metric label={t("metric.cost")} value={formatCost(totals?.costUSD ?? undefined)} />
          </section>
        )}

        {!hasReport && warnings.length > 0 && (
          // 选集警告(partial-coverage / stale-snapshot / synthetic-experiment-id):
          // message 是挑选器渲染好的英文句子,原样打;data-kind 供样式与测试定位。
          <section className="incompatible-banner selection-warnings" role="alert">
            <b>{t("banner.warningsTitle")}</b>
            <ul>
              {warnings.map((w, i) => (
                <li key={`${w.kind}-${i}`} data-kind={w.kind}>
                  <span className="ib-meta">{w.message}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(data.skippedRuns?.length ?? 0) > 0 && (
          <section className="incompatible-banner" role="alert">
            <b>{t("banner.skippedTitle")}</b>
            <ul>
              {data.skippedRuns!.map((run) => (
                <li key={run.dir} data-reason={run.reason}>
                  <span className="ib-dir">{run.dir}</span>
                  <span className="ib-meta">
                    {run.reason === "malformed"
                      ? t("banner.skipped.malformed", { detail: run.detail ?? "?" })
                      : run.reason === "incomplete"
                        ? t("banner.skipped.incomplete")
                        : run.producerName && run.producerName !== "niceeval"
                          ? // 第三方 harness 写的落盘:如实报名字和版本,不拼 npx 命令。
                            t("banner.skipped.incompatibleForeign", {
                              name: run.producerName,
                              version: run.producerVersion ?? "?",
                              schemaVersion: run.schemaVersion,
                            })
                          : t("banner.skipped.incompatible", {
                              producer: run.producerVersion ?? "?",
                              schemaVersion: run.schemaVersion,
                            })}
                  </span>
                  {run.command ? <code>{run.command}</code> : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        {hasReport && (
          <TabsContent value="report" id="tab-report">
            {/* 报告槽:server 侧渲染好的静态 HTML(含 <Style> 产物),这里只摆放。
                attempt 深链是普通 <a href="#/attempt/…">,经 hashchange 打开证据室弹窗。 */}
            <div className="report-slot" dangerouslySetInnerHTML={{ __html: reportHtml }} />
          </TabsContent>
        )}

        {!hasReport && (
        <TabsContent value="experiments" id="tab-experiments">
          <div className="section-head">
            <h2>{t("section.experiments")}</h2>
          </div>
          <GroupSelector groupMap={groupMap} selectedGroup={selectedGroup} onSelect={setSelectedGroup} t={t} />
          <div className="section-sub-head">
            <span className="group-detail-label">{selectedGroup ?? ""}</span>
            <div className="controls">
              <input
                className="search"
                type="search"
                placeholder={t("search.experiments")}
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <CopyFixPrompt rows={filtered} t={t} />
            </div>
          </div>
          {rows.length ? (
            <>
              <CostScoreChart rows={filtered} t={t} />
              <ExperimentTable
                rows={filtered}
                sort={sort}
                setSortKey={setSortKey}
                openRows={openRows}
                toggleRow={toggleRow}
                openModal={openModal}
                t={t}
              />
            </>
          ) : (
            <div className="empty">
              {t("empty.summary")}
            </div>
          )}
        </TabsContent>
        )}

        <TabsContent value="runs">
          <RunsView attempts={attempts} t={t} />
        </TabsContent>
        <TabsContent value="traces">
          <TracesView attempts={attempts} t={t} />
        </TabsContent>
      </main>
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} t={t} />}
    </Tabs>
  );
}
