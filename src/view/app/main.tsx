import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Locale, ReportSlotHtml, ViewData } from "./types.ts";
import { App } from "./App.tsx";
import "../styles.css";

// 没有烘焙数据(比如直接打开裸产物)时的空页面兜底。
const emptyViewData: ViewData = {
  composedRuns: 0,
};

const initialData: ViewData = window.__NICEEVAL_VIEW_DATA__ ?? emptyViewData;

const LOCALES: readonly Locale[] = ["en", "zh-CN"];

// 报告块:server 把页面 HTML 烘成 <template id="niceeval-report-<pageId>-<locale>"> 静态块
// (__NICEEVAL_VIEW_DATA__ 旁)。静态产物带全部块;本地模式只带初始页那两块,其余在切过去时
// 按 `report/<pageId>.<locale>.html` 取(docs/feature/reports/view.md「只渲染看得见的那一块」)。
// 前端不解析、不 hydrate,只负责摆放。页 id 来自 viewData.report.pages;缺声明时按单页兜底。
function readBakedBlocks(data: ViewData): globalThis.Record<string, ReportSlotHtml> {
  const ids = data.report?.pages?.length ? data.report.pages.map((p) => p.id) : ["report"];
  const blocks: globalThis.Record<string, ReportSlotHtml> = {};
  for (const id of ids) {
    const slot: ReportSlotHtml = {};
    for (const locale of LOCALES) {
      const el = document.getElementById(`niceeval-report-${id}-${locale}`);
      if (el) slot[locale] = el.innerHTML;
    }
    blocks[id] = slot;
  }
  return blocks;
}

function blockPath(page: string, locale: Locale): string {
  return `report/${encodeURIComponent(page)}.${encodeURIComponent(locale)}.html`;
}

/**
 * 本地模式的活壳(view.md「页面就地换内容」)。它做三件事,静态产物下三件都不发生:
 * 按需取当前页的块、订阅重建事件、收到新块就地换掉。整页重载只在 server 说外壳变了时发生。
 */
function Live() {
  const [data, setData] = useState<ViewData>(initialData);
  const [blocks, setBlocks] = useState<globalThis.Record<string, ReportSlotHtml>>(() => readBakedBlocks(initialData));
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<{ page: string; locale: Locale } | null>(null);
  const [targetRevision, setTargetRevision] = useState(0);

  const onActiveView = useCallback((next: { page: string; locale: Locale }) => {
    setView((prev) => (prev && prev.page === next.page && prev.locale === next.locale ? prev : next));
  }, []);

  // 当前页的块不在手上就取一次。取回来留用,切回来不再取。
  useEffect(() => {
    if (!view || blocks[view.page]?.[view.locale] !== undefined) return;
    const { page, locale } = view;
    let cancelled = false;
    void fetch(blockPath(page, locale))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((html) => {
        if (!cancelled) setBlocks((prev) => ({ ...prev, [page]: { ...prev[page], [locale]: html } }));
      })
      .catch(() => {
        // 取不到就留空块:server 那边的错误已经走 error 事件说过一次。
      });
    return () => {
      cancelled = true;
    };
  }, [view, blocks]);

  // 订阅重建事件。订阅里带上在看哪一页、哪种语言 —— server 据此只渲染这一块。
  useEffect(() => {
    if (!window.__NICEEVAL_VIEW_LIVE__ || !view) return;
    const source = new EventSource(
      `__niceeval_reload?page=${encodeURIComponent(view.page)}&locale=${encodeURIComponent(view.locale)}`,
    );
    source.addEventListener("reload", () => location.reload());
    source.addEventListener("patch", (event) => {
      const patch = JSON.parse((event as MessageEvent<string>).data) as {
        viewData: ViewData;
        page: string;
        locale: Locale;
        html: string;
      };
      setFailure(null);
      setData(patch.viewData);
      setTargetRevision((revision) => revision + 1);
      // 这次重建让其余块全部作废:只留新到的这一块,切过去时按新产物重新取。
      setBlocks({ [patch.page]: { [patch.locale]: patch.html } });
    });
    source.addEventListener("error", (event) => {
      // EventSource 自己的连接错误没有 data,不当成重建失败。
      const raw = (event as MessageEvent<string | undefined>).data;
      if (raw) setFailure(JSON.parse(raw) as string);
    });
    return () => source.close();
  }, [view]);

  return (
    <>
      <App data={data} reportPages={blocks} onActiveView={onActiveView} targetRevision={targetRevision} />
      {failure ? <pre className="view-rebuild-error">{`View rebuild failed; serving the previous site.\n${failure}`}</pre> : null}
    </>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(<Live />);
