import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { Locale, LocalizedText, ReportSlotHtml, Tab, ViewData, ViewReportPageMeta, ViewResult } from "./types.ts";
import { flattenAttempts, resultFromUrl } from "./lib/rows.ts";
import { parseAttemptHash, resolveAttemptLocator, unresolvedAttemptWarning } from "./lib/attempt-route.ts";
import { formatDateTime } from "./lib/format.ts";
import { CopyFixPrompt } from "./components/CopyControls.tsx";
import { SkippedRunsBanner } from "./components/SkippedRunsBanner.tsx";
import { AttemptModal } from "./components/AttemptModal.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";
import { AttemptsView } from "./pages/AttemptsPage.tsx";
import { TracesView } from "./pages/TracesPage.tsx";

// 导航组成固定(docs/feature/reports/view.md「页面构成」):报告页按声明顺序在前
// (路由 `#/page/<id>`,`--page <id>` 定初始页),内置的 Attempts、Traces 证据页恒排在
// 报告页之后——证据页由宿主拥有,报告定义不能移除或重排它们。
// 报告页的 tab 值带 `page:` 前缀,避免与证据页 id(attempts / traces)撞名。
const EVIDENCE_TABS: { id: Tab; label: "nav.attempts" | "nav.traces" }[] = [
  { id: "attempts", label: "nav.attempts" },
  { id: "traces", label: "nav.traces" },
];

/** niceeval 官网;web 面页脚恒含指向它的 `Powered by niceeval` 一行,无关闭配置。 */
const NICEEVAL_SITE_URL = "https://niceeval.com";

/**
 * LocalizedText 的确定回退(docs/feature/reports/library/shell.md):当前 locale → en →
 * 按 locale 键字典序的第一个非空值。字符串原样返回。
 */
export function localizedText(text: LocalizedText | undefined, locale: Locale): string | undefined {
  if (!text) return undefined;
  if (typeof text === "string") return text;
  if (text[locale]) return text[locale];
  if (text.en) return text.en;
  for (const key of Object.keys(text).sort()) {
    if (text[key]) return text[key];
  }
  return undefined;
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

/** `#/page/<id>` / `#/attempts` / `#/traces` → tab 值;认不出返回 null(交给初始页兜底)。 */
function tabFromHash(hash: string, pages: ViewReportPageMeta[]): Tab | null {
  const pageMatch = /^#\/page\/([a-z0-9-]+)$/.exec(hash);
  if (pageMatch && pages.some((p) => p.id === pageMatch[1])) return `page:${pageMatch[1]}`;
  if (hash === "#/attempts") return "attempts";
  if (hash === "#/traces") return "traces";
  return null;
}

/** tab 值 → hash 路由(报告页 `#/page/<id>`,证据页 `#/attempts` / `#/traces`)。 */
function hashForTab(tab: Tab): string {
  return tab.startsWith("page:") ? `#/page/${tab.slice("page:".length)}` : `#/${tab}`;
}

export function App({ data, reportPages }: { data: ViewData; reportPages: Record<string, ReportSlotHtml> }) {
  const snapshots = data.snapshots ?? [];
  const attempts = useMemo(() => flattenAttempts(snapshots), [snapshots]);
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);

  // 报告声明缺省(旧数据 / 空烘焙)时按单页 `report` 兜底,页名用内置页名。
  const pages: ViewReportPageMeta[] = data.report?.pages?.length
    ? data.report.pages
    : [{ id: "report", title: { en: "Report", "zh-CN": "报告" } }];
  const initialPageId = data.report?.initialPageId ?? pages[0]!.id;

  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash, pages) ?? `page:${initialPageId}`);
  const [modalResult, setModalResult] = useState<ViewResult | null>(() => modalResultFromLocation(snapshots));
  // 当前 modal 的 hash 历史条目前面是否还有本页条目(本页 push 的 / 前进键回到的):
  // true → UI 关闭走 history.back(),前进键还能重新打开;false(深链直接落地)→ 原地抹 hash,
  // 免得 back 把用户弹出站外。
  const modalOwnsHistory = useRef(false);

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

  // 浏览器标题跟随外壳标题(回退链在 server 侧走完:def.title → 唯一快照 name → NiceEval)。
  const shellTitle = localizedText(data.report?.title, locale) ?? "NiceEval";
  useEffect(() => {
    document.title = shellTitle;
  }, [shellTitle]);

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

  // 浏览器前进/后退、手改 hash、页内链接(attempt 深链与 `#/page/<id>` 页路由)统一从
  // hashchange 分发:attempt hash 开证据室弹窗,页/证据室 hash 切当前 tab。
  useEffect(() => {
    const onHashChange = () => {
      const locator = parseAttemptHash(location.hash);
      if (locator) {
        const found = resolveAttemptLocator(snapshots, locator);
        if (!found) {
          console.warn(unresolvedAttemptWarning(location.hash));
          setModalResult(null);
          return;
        }
        // 经浏览器导航打开:前一条历史仍是本页,UI 关闭可以安全 back()。
        modalOwnsHistory.current = true;
        setModalResult(found);
        return;
      }
      modalOwnsHistory.current = false;
      setModalResult(null);
      const routed = tabFromHash(location.hash, pages);
      if (routed) setTab(routed);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [snapshots, pages]);

  const selectTab = useCallback((value: Tab) => {
    setTab(value);
    try {
      history.replaceState(null, "", hashForTab(value));
    } catch {
      // 更新路由失败不影响切页。
    }
  }, []);

  const footerText = localizedText(data.report?.footer, locale);

  return (
    <Tabs value={tab} onValueChange={(v) => selectTab(v as Tab)}>
      <header className="topbar">
        <a className="brand" href={hashForTab(`page:${initialPageId}`)}>
          <span className="mark" />
          <span>{shellTitle}</span>
        </a>
        <TabsList aria-label={t("nav.label")}>
          {pages.map((page) => (
            <TabsTrigger key={`page:${page.id}`} value={`page:${page.id}`}>
              {localizedText(page.title, locale) ?? page.id}
            </TabsTrigger>
          ))}
          {EVIDENCE_TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {t(item.label)}
            </TabsTrigger>
          ))}
        </TabsList>
        {data.report?.links?.length ? (
          <nav className="shell-links" aria-label="Links">
            {data.report.links.map((link, i) => (
              <a key={i} href={link.href} target="_blank" rel="noreferrer">
                {localizedText(link.label, locale) ?? link.href}
              </a>
            ))}
          </nav>
        ) : null}
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

        {pages.map((page) => (
          <TabsContent key={`page:${page.id}`} value={`page:${page.id}`} id={`tab-page-${page.id}`}>
            {/* 壳区:报告槽上方靠右的批量修复 prompt 按钮。失败清单从 viewData.snapshots
                现算(latest 口径),默认报告与 --report 两种填充下都在。 */}
            <div className="section-sub-head">
              <span className="group-detail-label" />
              <div className="controls">
                <CopyFixPrompt snapshots={snapshots} t={t} />
              </div>
            </div>
            {/* 报告槽:server 侧逐页渲染好的静态 HTML(含 <Style> 产物),按当前页与界面语言
                摆放对应块;Scope 警告由报告页内呈现,壳不设第二条通道。
                attempt 深链是普通 <a href="#/attempt/…">,经 hashchange 打开证据室弹窗。 */}
            <div
              className="report-slot"
              dangerouslySetInnerHTML={{ __html: reportPages[page.id]?.[locale] || reportPages[page.id]?.en || "" }}
            />
          </TabsContent>
        ))}

        <TabsContent value="attempts">
          <AttemptsView attempts={attempts} t={t} />
        </TabsContent>
        <TabsContent value="traces">
          <TracesView attempts={attempts} t={t} />
        </TabsContent>
      </main>
      <footer className="site-footer">
        {footerText ? <span className="site-footer-text">{footerText}</span> : null}
        {/* 品牌行:恒在、恒带官网链接,不占 footer 的语义位、没有关闭配置(shell.md「行为约束」)。 */}
        <span className="powered-by">
          <a href={NICEEVAL_SITE_URL} target="_blank" rel="noreferrer">
            Powered by niceeval
          </a>
        </span>
      </footer>
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} t={t} />}
    </Tabs>
  );
}
