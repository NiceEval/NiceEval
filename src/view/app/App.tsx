import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { MessageKey } from "./i18n.ts";
import type { Locale, LocalizedText, ReportSlotHtml, Tab, ViewData, ViewResult } from "./types.ts";
import { flattenAttempts, resultFromUrl } from "./lib/rows.ts";
import { parseAttemptHash, resolveAttemptLocator, unresolvedAttemptWarning } from "./lib/attempt-route.ts";
import { formatDateTime } from "./lib/format.ts";
import { CopyFixPrompt } from "./components/CopyControls.tsx";
import { SkippedRunsBanner } from "./components/SkippedRunsBanner.tsx";
import { AttemptModal } from "./components/AttemptModal.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { RunsView } from "./pages/RunsPage.tsx";
import { TracesView } from "./pages/TracesPage.tsx";

// 首页 = 报告槽:恒在恒默认,裸跑填充内置默认报告,--report 整槽替换(两种填充走同一个 tab)。
// 证据室(Runs / Traces / AttemptModal)是 view 本体,任何填充下原样保留。
export const navItems: { id: Tab; label: MessageKey }[] = [
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

/** 初始 URL → 直接打开的 attempt:先认 #/attempt/@<locator> 深链,回退旧版 ?modal= 参数。 */
function modalResultFromLocation(snapshots: ViewData["snapshots"]): ViewResult | null {
  const locator = parseAttemptHash(location.hash);
  if (locator) {
    const found = resolveAttemptLocator(snapshots, locator);
    if (found) return found;
    // 定位不到(locator 不在、快照未加载、旧格式数据):不开空 modal,页面照常渲染。
    console.warn(unresolvedAttemptWarning(location.hash));
    return null;
  }
  return resultFromUrl(snapshots);
}

export function App({ data, reportHtml }: { data: ViewData; reportHtml: ReportSlotHtml }) {
  const snapshots = data.snapshots ?? [];
  const attempts = useMemo(() => flattenAttempts(snapshots), [snapshots]);
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);
  const [tab, setTab] = useState<Tab>("report");
  const [modalResult, setModalResult] = useState<ViewResult | null>(() => modalResultFromLocation(snapshots));
  // 当前 modal 的 hash 历史条目前面是否还有本页条目(本页 push 的 / 前进键回到的):
  // true → UI 关闭走 history.back(),前进键还能重新打开;false(深链直接落地)→ 原地抹 hash,
  // 免得 back 把用户弹出站外。
  const modalOwnsHistory = useRef(false);

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

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

  // 浏览器前进/后退、手改 hash、页内 attempt 链接(含报告槽里的深链)统一从 hashchange 开合 modal。
  useEffect(() => {
    const onHashChange = () => {
      const locator = parseAttemptHash(location.hash);
      if (!locator) {
        modalOwnsHistory.current = false;
        setModalResult(null);
        return;
      }
      const found = resolveAttemptLocator(snapshots, locator);
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
              {/* viewData 只带原始值(ISO / number),这里按当前界面 locale 格式化。 */}
              <b>{t("hero.lastRun")}</b> {data.lastRunAt ? formatDateTime(data.lastRunAt, locale) : t("hero.noRuns")}
            </span>
            {data.composedRuns > 0 ? (
              // 报告槽是跨 run 合成的现刻水位,hero 如实标注合成来源(几个 run)。
              <span>{t("hero.composedFrom", { count: data.composedRuns })}</span>
            ) : null}
          </div>
        </section>

        <SkippedRunsBanner skippedRuns={data.skippedRuns ?? []} t={t} />

        <TabsContent value="report" id="tab-report">
          {/* 壳区:报告槽上方靠右的批量修复 prompt 按钮。失败清单从 viewData.snapshots
              现算(latest 口径),默认报告与 --report 两种填充下都在。 */}
          <div className="section-sub-head">
            <span className="group-detail-label" />
            <div className="controls">
              <CopyFixPrompt snapshots={snapshots} t={t} />
            </div>
          </div>
          {/* 报告槽:server 侧渲染好的静态 HTML(含 <Style> 产物),按当前界面语言摆放
              对应语言的块;Selection 警告由报告槽内的 RunOverview 呈现,壳不设第二条通道。
              attempt 深链是普通 <a href="#/attempt/…">,经 hashchange 打开证据室弹窗。 */}
          <div
            className="report-slot"
            dangerouslySetInnerHTML={{ __html: reportHtml[locale] || reportHtml.en }}
          />
        </TabsContent>

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
