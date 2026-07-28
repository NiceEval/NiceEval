// server(data.ts)与前端(app/)共用的 view 数据形状。
// viewData 会被序列化进静态 HTML,两边必须对同一份声明编程;只允许 type import。
//
// viewData 只携带壳需要的东西:unreadable、项目名与 run 元信息。attempt 明细不在这里——
// 每份 attempt/<locator>.html 是独立静态文档(site.ts),不通过 viewData 这条通道下发;
// 统计口径(KPI / 实验列表 / 挑选警告)整体住在报告槽的静态 HTML 里(ExperimentComparison 或
// --report 的报告自己算),壳与报告之间没有第二条数据通道。

import type { LocalizedText } from "../../types.ts";
import type { ReportLocale } from "../../report/model/locale.ts";
import type { AttemptLocator } from "../../record/locator.ts";

export type { AttemptLocator };

/**
 * 一页报告的双语静态 HTML:同一棵页树按 locale 渲染两遍(en / zh-CN),server 烘成
 * <template id="niceeval-report-<pageId>-<locale>"> 静态块,前端按当前页与界面语言摆放
 * 对应块,切语言 / 切页不重算数据。
 */
export type ReportSlotHtml = globalThis.Record<ReportLocale, string>;

/** 服务端渲染好的一页报告(HTML 本体不进 viewData,烘成 <template> 静态块)。 */
export interface ViewReportPageHtml {
  id: string;
  html: ReportSlotHtml;
}

/** 外壳认识的一页(id = `#/page/<id>` 路由、`--page` 的取值与 <template> 静态块的键)。 */
export interface ViewReportPageMeta {
  id: string;
  title: LocalizedText;
  /**
   * 报告声明的 `navigation: false`(docs/feature/reports/library/shell.md「导航的组成只有一条
   * 规则」):该页退出导航,外壳不为它渲染 tab。这份列表本身不是导航列表——它同时是页内容块与
   * `#/page/<id>` 路由的键,所以退出导航的页仍如实在列,只带上这个标记;缺省即在导航里。
   */
  navigation?: false;
}

/**
 * 规范化后的报告外壳声明(docs/feature/reports/library/shell.md):壳(导航 / 页脚)由前端
 * 渲染,页内容消费 <template> 静态块。title 已走完回退链(def.title → 唯一且相同的快照 name →
 * 内置文案「Eval 运行结果 / Eval Record」),宿主落点只有浏览器 <title>(文档单例);
 * 页内 hero 标题由 Hero 组件消费同一取值链,品牌是组件、宿主页头不渲染任何品牌位。
 * scripts / styles 是注入资产,不进 viewData。
 * link 的 icon 是内联 SVG 字符串(原样透传、原样内联),不收组件——viewData 就是序列化边界。
 */
export interface ViewReportMeta {
  title: LocalizedText;
  links: { label: LocalizedText; href: string; icon?: { svg: string } }[];
  footer?: LocalizedText;
  pages: ViewReportPageMeta[];
  /** 初始页(--page 或声明序第一页);`#/page/<id>` 路由覆盖它。 */
  initialPageId: string;
}

/**
 * 目录扫描里被跳过的 run 的结构化条目;三种原因与 niceeval/record 的 unreadable 一致。
 * 页面上的呈现不走它:不可读快照已形成 `unreadable-run` Sample warning,由报告页内的
 * `ScopeWarnings` 组件显示;这里只随 viewData 携带原始事实。
 */
export interface SkippedRunNotice {
  /** run 目录,相对 cwd。 */
  dir: string;
  reason: "incompatible" | "malformed" | "incomplete";
  schemaVersion?: number;
  /** 完整 producer:只有 name === "niceeval" 才配得出 npx 命令,第三方 harness 如实报名字。 */
  producerName?: string;
  producerVersion?: string;
  /** incompatible 且 producer 是 niceeval:服务端拼好的查看命令。 */
  command?: string;
  /** malformed:一句诊断(invalid JSON / results 不是数组 …)。 */
  detail?: string;
}

/**
 * 烘焙进 HTML 的页面数据(证据室与壳)。时间/成本一律传原始值(ISO 字符串、number),
 * 格式化统一由前端按当前界面 locale 做。
 */
export interface ViewData {
  /** 最近一次 run 的 startedAt(ISO);没有历史 run 时缺省。 */
  lastRunAt?: string;
  /** 报告槽 Selection 合成自几个物理 run。 */
  composedRuns: number;
  /** 读不了的落盘(三种原因);呈现走报告页内的 ScopeWarnings(unreadable-run warning)。 */
  skippedRuns?: SkippedRunNotice[];
  /** 报告外壳与页导航的声明(规范化后);缺省时前端按单页 `report` 兜底。 */
  report?: ViewReportMeta;
}
