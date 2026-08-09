import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { detectLocale, makeTranslator, persistLocale, setDocumentLocale } from "./i18n.ts";
import type { Locale, LocalizedText, ReportSlotHtml, Tab, ViewData, ViewReportPageMeta } from "./types.ts";
import {
  createTargetRequestGate,
  hashForTarget,
  hrefForTarget,
  parseTargetDocument,
  targetFromHash,
  targetFromHref,
  type PageTarget,
  type TargetDocumentContent,
} from "./lib/target-dialog.ts";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./components/ui/dialog.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.tsx";

// 导航组成只有一条规则(docs/feature/reports/view.md「页面构成」):导航项 = 报告定义声明的页,
// 按声明顺序排列(路由 `#/page/<id>`,`--page <id>` 定初始页)。宿主不追加、不保留任何导航项——
// 裸 view 的「报告 / Attempts / 追踪」三个 tab 就是内建报告的三页。页面里的 hero、Sample 警告
// 都不是宿主渲染的:它们是页内的站点组件(Hero / ScopeWarnings)。宿主保留的是机器
// 加一个恒定的品牌位:管线与路由、attempt 详情路由、文档单例(<title>)、语言切换,以及
// 页头左端的 NiceEval 字标(docs/feature/reports/architecture.md「宿主保留的只有机器」)。

// niceeval 官网。页头品牌字标与 hero 下的 `Powered by NiceEval` 行都外链到它,
// utm_medium 区分点击来自哪个品牌位(shell.md「行为约束」)。
const BRAND_HREF = "https://niceeval.com/?utm_source=report&utm_medium=brand";

/** 屏幕阅读器可用、视觉上不占位:Radix Dialog 需要一个可访问标题,内容本身(身份 / verdict)
 *  已经在 dialog 里可见,不需要再视觉重复一遍。 */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

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

/**
 * 报告槽:React 19 对 dangerouslySetInnerHTML 只比较对象身份,身份一变就无条件重设
 * innerHTML(不再比对 __html 字符串值)。{__html} 必须 memo 住,否则 App 任意一次重渲染
 * (开关 attempt 弹窗、切语言)都会重建槽内 DOM,丢掉用户展开的 <details>、排序和过滤状态。
 */
function ReportSlot({ html }: { html: string }) {
  const markup = useMemo(() => ({ __html: html }), [html]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const assets = root.current?.querySelectorAll<HTMLLinkElement | HTMLScriptElement>(
      "[data-niceeval-renderer-asset]",
    );
    if (!assets) return;
    for (const asset of assets) {
      const key = asset.dataset.niceevalRendererAsset;
      const alreadyLoaded =
        key !== undefined &&
        [...document.head.querySelectorAll<HTMLElement>("[data-niceeval-renderer-loaded]")].some(
          (loaded) => loaded.dataset.niceevalRendererLoaded === key,
        );
      if (!key || alreadyLoaded) {
        asset.remove();
        continue;
      }
      const loaded = asset.cloneNode(true) as HTMLLinkElement | HTMLScriptElement;
      loaded.removeAttribute("data-niceeval-renderer-asset");
      loaded.setAttribute("data-niceeval-renderer-loaded", key);
      document.head.appendChild(loaded);
      asset.remove();
    }
  }, [html]);
  return <div ref={root} className="report-slot" dangerouslySetInnerHTML={markup} />;
}

/** `#/page/<id>` → tab 值;认不出返回 null(交给初始页兜底)。 */
function tabFromHash(hash: string, pages: ViewReportPageMeta[]): Tab | null {
  const pageMatch = /^#\/page\/([a-z0-9-]+)$/.exec(hash);
  if (pageMatch && pages.some((p) => p.id === pageMatch[1])) return `page:${pageMatch[1]}`;
  return null;
}

/** tab 值 → hash 路由(报告页 `#/page/<id>`)。 */
function hashForTab(tab: Tab): string {
  return `#/page/${tab.slice("page:".length)}`;
}

export function App({
  data,
  reportPages,
  onActiveView,
  targetRevision,
}: {
  data: ViewData;
  reportPages: globalThis.Record<string, ReportSlotHtml>;
  /**
   * 当前在看哪一页、哪种语言。本地模式据此按需取块并订阅重建事件
   * (docs/feature/reports/view.md「只渲染看得见的那一块」);静态产物不传这个回调。
   */
  onActiveView?: (view: { page: string; locale: Locale }) => void;
  /** 本地重建版本；静态导出不传，因此不会重复获取参数化页。 */
  targetRevision?: number;
}) {
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const t = useMemo(() => makeTranslator(locale), [locale]);

  // 报告声明缺省(旧数据 / 空烘焙)时按单页 `report` 兜底,页名用内置页名。
  const pages: ViewReportPageMeta[] = data.report?.pages?.length
    ? data.report.pages
    : [{ id: "report", title: { en: "Report", "zh-CN": "报告" } }];
  // 导航只列 `navigation !== false` 的页,按声明序,宿主不追加任何项
  // (docs/feature/reports/view.md「导航机器与品牌位」/ library/shell.md「导航的组成只有一条规则」)。
  // 退出导航不等于退出站点:内容块与 `#/page/<id>` 深链仍走完整的 pages。
  const navPages = pages.filter((page) => page.navigation !== false);
  const initialPageId = data.report?.initialPageId ?? pages[0]!.id;

  const [tab, setTab] = useState<Tab>(() => tabFromHash(location.hash, pages) ?? `page:${initialPageId}`);

  // 报告清单里的参数化页 id 全集(attempt、experiment……声明或补位后的最终形态);拦截只认
  // 这份清单,不认识任何具体实体(view.md「参数化页的 dialog 摆放」)。
  const paramPageIds = data.report?.paramPageIds ?? [];

  // 参数化页详情弹窗:内容是独立文档(`<pageId>/<key>.html`)fetch 回来的同一份 server-rendered
  // 片段,不维护第二份客户端渲染(docs/feature/reports/view.md「静态导出」)。dialogTarget 为
  // null 即关闭;同一套状态服务任意参数化页,dialog 内的目标链接命中同一个点击拦截器,
  // 状态替换即完成「嵌套下钻」(实验详情里点 attempt 即此路径)。
  const [dialogTarget, setDialogTarget] = useState<PageTarget | null>(null);
  const [dialogContent, setDialogContent] = useState<TargetDocumentContent | null>(null);
  // 当前 dialog 的 hash 历史条目前面是否还有本页条目(点击链接 push 的 / 前进键回到的):
  // true → UI 关闭走 history.back(),前进键还能重新打开;false(深链直接落地)→ 原地抹 hash,
  // 免得 back 把用户弹出站外。
  const dialogOwnsHistory = useRef(false);
  const requestedDialog = useRef<{ target: PageTarget; ownsHistory: boolean } | null>(null);
  const targetRequestGate = useRef(createTargetRequestGate());
  const previousTargetRevision = useRef(targetRevision);

  useEffect(() => {
    setDocumentLocale(locale);
    persistLocale(locale);
  }, [locale]);

  const activePageId = tab.slice("page:".length);
  useEffect(() => {
    onActiveView?.({ page: activePageId, locale });
  }, [onActiveView, activePageId, locale]);

  // 浏览器标题是宿主文档单例:跟随外壳标题(回退链在 server 侧走完:def.title →
  // 唯一快照 name → 内置文案「Eval 运行结果 / Eval Record」);缺声明(旧数据)时按内置文案兜底。
  // 页面里的 hero 标题不归宿主——它是页内 Hero 组件,同一取值链经 ctx.report.title 贯通。
  const shellTitle = localizedText(data.report?.title, locale) ?? t("hero.title");
  useEffect(() => {
    document.title = shellTitle;
  }, [shellTitle]);

  /**
   * fetch 一个参数化页实例的独立文档、抠出两种语言内容并打开 dialog;定位不到就直说,
   * 不开空 dialog。对任意 pageId 通用——attempt、experiment 走同一条路径,dialog 内的目标
   * 链接命中同一个点击拦截器,状态替换即完成「嵌套下钻」(view.md「参数化页的 dialog 摆放」)。
   */
  const openTarget = useCallback(async (target: PageTarget, ownsHistory: boolean) => {
    requestedDialog.current = { target, ownsHistory };
    const request = targetRequestGate.current.begin(target);
    try {
      const res = await fetch(hrefForTarget(target.pageId, target.key));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = parseTargetDocument(await res.text());
      if (!content) throw new Error("response is not a recognized target document");
      if (!targetRequestGate.current.accepts(request)) return;
      dialogOwnsHistory.current = ownsHistory;
      setDialogTarget(target);
      setDialogContent(content);
    } catch (e) {
      console.warn(
        `[niceeval view] failed to open ${target.pageId}/${target.key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, []);

  // 一次成功重建也会更新已打开的参数化页。失败时保留旧内容；请求闸阻止
  // 旧目标的迟到响应覆盖随后打开的新目标。
  useEffect(() => {
    if (targetRevision === undefined || previousTargetRevision.current === targetRevision) return;
    previousTargetRevision.current = targetRevision;
    const requested = requestedDialog.current;
    if (requested) void openTarget(requested.target, requested.ownsHistory);
  }, [targetRevision, openTarget]);

  const closeDialog = useCallback(() => {
    requestedDialog.current = null;
    targetRequestGate.current.invalidate();
    setDialogTarget(null);
    setDialogContent(null);
    if (dialogOwnsHistory.current) {
      dialogOwnsHistory.current = false;
      history.back();
      return;
    }
    try {
      // 深链直接落地:没有可回退的本页条目,原地还原成无 hash 的 URL。
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      // 还原 URL 失败不影响关闭。
    }
  }, []);

  // 初始 URL 已经是 #/<pageId>/<key> 深链:直接打开(不经 hashchange——那只在后续变化时触发)。
  // 有效根即收窄后的结果(view.md「打开与收窄」):这份路由对完整结果根解析,不受当前统计口径
  // (现刻水位)限制,深链因此对历史 attempt 同样可达;收窄之外的实例由这份文档自身
  // 的宿主寻址语义处理(本地越过收窄解析,导出站按证据缺失呈现,不是这里的关注点)。
  // 空依赖数组是有意的:只在挂载时检查一次初始 hash,openTarget 本身是 useCallback(deps: [])
  // 的稳定引用,不会随后续渲染变化。
  useEffect(() => {
    const target = targetFromHash(location.hash, paramPageIds);
    if (target) void openTarget(target, false);
  }, [openTarget, paramPageIds]);

  // 浏览器前进/后退、手改 hash、页内链接点击(经下面的点击拦截转成 hash 变化)统一从
  // hashchange 分发:参数化页 hash 开详情 dialog,页 hash 切当前 tab。
  useEffect(() => {
    const onHashChange = () => {
      const target = targetFromHash(location.hash, paramPageIds);
      if (target) {
        // 经浏览器导航打开:前一条历史仍是本页,dialog 关闭可以安全 back()。
        void openTarget(target, true);
        return;
      }
      requestedDialog.current = null;
      targetRequestGate.current.invalidate();
      setDialogTarget(null);
      setDialogContent(null);
      const routed = tabFromHash(location.hash, pages);
      if (routed) setTab(routed);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pages, paramPageIds, openTarget]);

  // 拦截参数化页文档链接(报告页里的目标引用,`targetHref` 缺省产出的
  // `<pageId>/<encodeURIComponent(key)>.html`):点击时改写成 hash 路由,交给上面的
  // hashchange 统一打开——无 JavaScript 时这些链接原样导航到独立文档,同样完整可读。
  // 拦截按报告清单里的参数化页 id 判定(paramPageIds),不认识任何具体实体;修饰键 / 非左键
  // 点击放行,让「新标签页打开」这类浏览器原生行为不受影响。
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const clicked = e.target;
      if (!(clicked instanceof Element)) return;
      const anchor = clicked.closest("a[href]");
      if (!anchor) return;
      const target = targetFromHref(anchor.getAttribute("href") ?? "", paramPageIds);
      if (!target) return;
      e.preventDefault();
      location.hash = hashForTarget(target.pageId, target.key);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [paramPageIds]);

  const selectTab = useCallback((value: Tab) => {
    setTab(value);
    try {
      // 路径部分显式带上:文档可能落了站点根归一的 <base>(site.ts SITE_BASE_SCRIPT),
      // 裸 hash 会按 base 解析,切页会顺手把地址栏路径改写成目录形态。
      history.replaceState(null, "", `${location.pathname}${location.search}${hashForTab(value)}`);
    } catch {
      // 更新路由失败不影响切页。
    }
  }, []);

  return (
    <Tabs value={tab} onValueChange={(v) => selectTab(v as Tab)}>
      <header className="topbar">
        {/* 页头左端是恒定的 NiceEval 品牌字标(与 Powered by 行同族的产品品牌位),
            报告定义不能覆盖或移除,点击外链官网;报告 title 的落点是页内 hero 与浏览器标题。
            rel 用 noopener 而非 noreferrer:保留 Referer(默认策略只发 origin),官网统计由此
            得知点击来自哪个报告站点;utm 只负责区分品牌位。 */}
        <a className="brand" href={BRAND_HREF} target="_blank" rel="noopener">
          <span className="mark" aria-hidden="true" />
          <span>NiceEval</span>
        </a>
        <TabsList aria-label={t("nav.label")}>
          {navPages.map((page) => (
            <TabsTrigger key={`page:${page.id}`} value={`page:${page.id}`}>
              {localizedText(page.title, locale) ?? page.id}
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
        {pages.map((page) => (
          <TabsContent key={`page:${page.id}`} value={`page:${page.id}`} id={`tab-page-${page.id}`}>
            {/* 报告槽:server 侧逐页渲染好的静态 HTML(含 <Style> 产物),按当前页与界面语言
                摆放对应块;hero、品牌行、Sample 警告、批量修复 prompt 都是页内组件,壳不再渲染。
                参数化页深链是普通 <a href="<pageId>/…html">,经上面的点击拦截打开 dialog。 */}
            <ReportSlot html={reportPages[page.id]?.[locale] || reportPages[page.id]?.en || ""} />
          </TabsContent>
        ))}
      </main>
      {dialogTarget && dialogContent ? (
        <Dialog open onOpenChange={(o) => { if (!o) closeDialog(); }}>
          <DialogContent aria-describedby={undefined}>
            {/* 屏幕阅读器用的可访问标题:视觉上隐藏,身份 / verdict 等实际内容已经在下面
                fetch 回来的片段里可见,这里不重复渲染。 */}
            <DialogTitle style={VISUALLY_HIDDEN}>{t("dialog.detailTitle")}</DialogTitle>
            <div className="flex min-w-0 shrink-0 items-center justify-end border-b border-line px-7 pb-3 pt-4">
              <DialogClose
                aria-label={t("action.close")}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-(--radius) border border-transparent text-sm text-muted transition-colors hover:border-line hover:bg-panel-2 hover:text-text"
              >
                x
              </DialogClose>
            </div>
            {/* 与直接打开 <pageId>/<key>.html 看到的是同一份 server-rendered 片段，
                不是客户端重新渲染。 */}
            <div className="flex-1 overflow-y-auto px-7 pb-7 pt-2">
              <ReportSlot html={dialogContent[locale] || dialogContent.en} />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Tabs>
  );
}
