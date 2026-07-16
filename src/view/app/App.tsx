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

// niceeval 官网。页头品牌字标与 hero 下的 `Powered by NiceEval` 行都外链到它,
// utm_medium 区分点击来自哪个品牌位(shell.md「行为约束」)。
const BRAND_HREF = "https://niceeval.com/?utm_source=report&utm_medium=brand";
const POWERED_BY_HREF = "https://niceeval.com/?utm_source=report&utm_medium=powered-by";

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

/**
 * 报告槽:React 19 对 dangerouslySetInnerHTML 只比较对象身份,身份一变就无条件重设
 * innerHTML(不再比对 __html 字符串值)。{__html} 必须 memo 住,否则 App 任意一次重渲染
 * (开关 attempt 弹窗、切语言)都会重建槽内 DOM,丢掉用户展开的 <details>、排序和过滤状态。
 */
function ReportSlot({ html }: { html: string }) {
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div className="report-slot" dangerouslySetInnerHTML={markup} />;
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

  // 首页 hero 与浏览器标题跟随外壳标题(回退链在 server 侧走完:def.title → 唯一快照 name →
  // 内置文案「Eval 运行结果 / Eval Results」);缺声明(旧数据)时按内置文案兜底。
  // 页头品牌位不归它——那里是恒定的 NiceEval 字标。
  const shellTitle = localizedText(data.report?.title, locale) ?? t("hero.title");
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
        {/* 页头左端是恒定的 NiceEval 品牌字标(与 Powered by 行同族的产品品牌位),
            报告定义不能覆盖或移除,点击外链官网;报告 title 的落点是下方 hero 与浏览器标题,
            报告内回首页走导航里的首个报告页 tab。 */}
        {/* rel 用 noopener 而非 noreferrer:保留 Referer(默认策略只发 origin),
            官网统计由此得知点击来自哪个报告站点;utm 只负责区分品牌位。 */}
        <a className="brand" href={BRAND_HREF} target="_blank" rel="noopener">
          <span className="mark" />
          <span>NiceEval</span>
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
                {/* 内联 SVG 字标(可选)渲染在 label 前,原样内联;内容是作者义务,宿主不校验形状之外的东西。 */}
                {link.icon ? (
                  <span className="shell-link-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: link.icon.svg }} />
                ) : null}
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
          {/* hero 标题 = 走完回退链的报告标题(与浏览器标题同源)。 */}
          <h1>{shellTitle}</h1>
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
          {/* 品牌行:恒在 hero 之下、恒带官网链接,不占 footer 的语义位、没有关闭配置
              (shell.md「行为约束」)。 */}
          <span className="powered-by">
            <a href={POWERED_BY_HREF} target="_blank" rel="noopener">
              Powered by NiceEval
            </a>
          </span>
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
            <ReportSlot html={reportPages[page.id]?.[locale] || reportPages[page.id]?.en || ""} />
          </TabsContent>
        ))}

        <TabsContent value="attempts">
          <AttemptsView attempts={attempts} t={t} />
        </TabsContent>
        <TabsContent value="traces">
          <TracesView attempts={attempts} t={t} />
        </TabsContent>
      </main>
      {footerText ? (
        <footer className="site-footer">
          <span className="site-footer-text">{footerText}</span>
        </footer>
      ) : null}
      {modalResult && <AttemptModal result={modalResult} onClose={closeModal} t={t} />}
    </Tabs>
  );
}
