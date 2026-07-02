import { useCallback, useEffect, useMemo, useState } from "react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { MessageKey } from "./i18n.ts";
import type { Locale, LocalizedText, SortKey, SortState, Tab, ViewData, ViewResult, ViewRow } from "./types.ts";
import { buildGroupMap, compareRows, resultFromUrl } from "./lib/rows.ts";
import { Metric } from "./components/primitives.tsx";
import { GroupSelector } from "./components/GroupSelector.tsx";
import { ExperimentTable } from "./components/ExperimentTable.tsx";
import { CopyAllErrors } from "./components/CopyControls.tsx";
import { AttemptModal } from "./components/AttemptModal.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { RunsView } from "./pages/RunsPage.tsx";
import { TracesView } from "./pages/TracesPage.tsx";

export const navItems: { id: Tab; label: MessageKey }[] = [
  { id: "experiments", label: "nav.experiments" },
  { id: "runs", label: "nav.runs" },
  { id: "traces", label: "nav.traces" },
];

/** 把 config.name 解析成当前界面语言的一条文案:字符串原样返回,多语言映射按 locale 挑,挑不到回退 en / 第一条。 */
export function localizedText(text: LocalizedText | undefined, locale: Locale): string | undefined {
  if (!text) return undefined;
  if (typeof text === "string") return text;
  return text[locale] ?? text.en ?? Object.values(text)[0];
}

export function App({ data }: { data: ViewData }) {
  const rows = data.rows ?? [];
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);
  const [tab, setTab] = useState<Tab>("experiments");
  const [sort, setSort] = useState<SortState>({ key: "passRate", dir: -1 });
  const [query, setQuery] = useState("");
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
    return groups[0] ?? null;
  });
  const [modalResult, setModalResult] = useState<ViewResult | null>(() => resultFromUrl(rows));

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

  const openModal = useCallback((result: ViewResult) => {
    setModalResult(result);
    const p = new URLSearchParams();
    p.set("modal", result.id);
    if (result.experimentId) p.set("exp", result.experimentId);
    p.set("a", String(result.attempt));
    history.replaceState(null, "", "?" + p.toString());
  }, []);

  const closeModal = useCallback(() => {
    setModalResult(null);
    history.replaceState(null, "", location.pathname);
  }, []);

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

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
      <header className="topbar">
        <a className="brand" href="https://github.com/CorrectRoadH/niceeval" target="_blank" rel="noreferrer">
          <span className="mark" />
          <span>NiceEval</span>
        </a>
        <TabsList aria-label={t("nav.label")}>
          {navItems.map((item) => (
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
              <b>{t("hero.lastRun")}</b> {data.lastRun}
            </span>
          </div>
        </section>

        <section className="summary" aria-label="Run summary">
          <Metric label={t("metric.passRate")} value={data.passRate} />
          <Metric label={t("metric.evalResults")} value={data.resultCount} />
          <Metric label={t("metric.duration")} value={data.duration} />
          <Metric label={t("metric.cost")} value={data.cost} />
        </section>

        {(data.incompatibleRuns?.length ?? 0) > 0 && (
          <section className="incompatible-banner" role="alert">
            <b>{t("banner.incompatibleTitle")}</b>
            <ul>
              {data.incompatibleRuns!.map((run) => (
                <li key={run.dir}>
                  <span className="ib-dir">{run.dir}</span>
                  <span className="ib-meta">
                    niceeval {run.producerVersion ?? "?"} · schemaVersion {run.schemaVersion}
                  </span>
                  <code>{run.command}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

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
              <CopyAllErrors rows={filtered} t={t} />
            </div>
          </div>
          {rows.length ? (
            <ExperimentTable
              rows={filtered}
              sort={sort}
              setSortKey={setSortKey}
              openRows={openRows}
              toggleRow={toggleRow}
              openModal={openModal}
              t={t}
            />
          ) : (
            <div className="empty">
              {t("empty.summary")}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs">
          <RunsView rows={rows} t={t} />
        </TabsContent>
        <TabsContent value="traces">
          <TracesView rows={rows} t={t} />
        </TabsContent>
      </main>
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} t={t} />}
    </Tabs>
  );
}
