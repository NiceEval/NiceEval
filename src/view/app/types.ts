// The browser shell only needs the two report locales and the execution-owned
// shell data shape; it does not import the retired report/Record runtime.
export type Locale = "en" | "zh-CN";
export type { LocalizedText } from "../shared/types.ts";
export type { ReportSlotHtml, ViewData, ViewReportPageMeta } from "../shared/types.ts";

/** 导航 tab:只有报告定义声明的页(`page:<id>`,路由 `#/page/<id>`),按声明序;宿主不追加任何项。 */
export type Tab = `page:${string}`;

declare global {
  interface Window {
    __NICEEVAL_VIEW_DATA__?: import("../shared/types.ts").ViewData;
    /** 本地 server 注入(静态产物没有):页面可以订阅重建事件并就地换块。 */
    __NICEEVAL_VIEW_LIVE__?: boolean;
  }
}
