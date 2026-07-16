import { createRoot } from "react-dom/client";
import type { ReportSlotHtml, ViewData } from "./types.ts";
import { App } from "./App.tsx";
import "../styles.css";

// 没有烘焙数据(比如直接打开裸产物)时的空页面兜底。
const emptyViewData: ViewData = {
  composedRuns: 0,
  snapshots: [],
};

const initialData: ViewData = window.__NICEEVAL_VIEW_DATA__ ?? emptyViewData;

// 报告页:server 把每页的静态 HTML 烘成 <template id="niceeval-report-<pageId>-<locale>">
// 静态块(__NICEEVAL_VIEW_DATA__ 旁)。前端按当前页与界面语言把对应块摆进报告槽位置,
// 切页 / 切语言即换块;不解析、不 hydrate。页 id 来自 viewData.report.pages;
// 旧数据 / 缺声明时按单页 `report` 兜底。
const pageIds = initialData.report?.pages?.length ? initialData.report.pages.map((p) => p.id) : ["report"];
const reportPages: Record<string, ReportSlotHtml> = {};
for (const id of pageIds) {
  reportPages[id] = {
    en: document.getElementById(`niceeval-report-${id}-en`)?.innerHTML ?? "",
    "zh-CN": document.getElementById(`niceeval-report-${id}-zh-CN`)?.innerHTML ?? "",
  };
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(<App data={initialData} reportPages={reportPages} />);
