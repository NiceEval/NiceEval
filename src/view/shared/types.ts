// The browser shell's type-only data shape. Report content and Record facts
// stay inside the closed site revision; this shape carries
// only report-shell metadata and baked HTML blocks.

export type LocalizedText = string | Readonly<Record<string, string>>;
export type ReportLocale = "en" | "zh-CN";

/**
 * 一页报告的双语静态 HTML:同一棵页树按 locale 渲染两遍(en / zh-CN),server 烘成
 * <template id="niceeval-report-<pageId>-<locale>"> 静态块,前端按当前页与界面语言摆放
 * 对应块,切语言 / 切页不重算数据。
 */
export type ReportSlotHtml = Partial<globalThis.Record<ReportLocale, string>>;

/** 外壳认识的一页(id = `#/page/<id>` 路由、`--page` 的取值与 <template> 静态块的键)。 */
export interface ViewReportPageMeta {
  id: string;
  title: LocalizedText;
  /**
   * 报告声明的 `navigation: false`(docs/feature/reports/README.md「导航的组成只有一条
   * 规则」):该页退出导航,外壳不为它渲染 tab。这份列表本身不是导航列表——它同时是页内容块与
   * `#/page/<id>` 路由的键,所以退出导航的页仍如实在列,只带上这个标记;缺省即在导航里。
   */
  navigation?: false;
}

/**
 * 规范化后的报告外壳声明(docs/feature/reports/README.md):壳(导航)由前端
 * 渲染,页内容消费 <template> 静态块。title 已走完回退链(def.title → 唯一且相同的快照 name →
 * 内置文案「Eval 运行结果 / Eval Record」),宿主落点只有浏览器 <title>(文档单例);
 * 页内 hero 标题由 Hero 组件消费同一取值链,品牌是组件、宿主页头不渲染任何品牌位。
 * 页脚与页头链接是页内 ReportNode,不进 viewData。
 */
export interface ViewReportMeta {
  title: LocalizedText;
  pages: ViewReportPageMeta[];
  /** 初始页(--page 或声明序第一页);`#/page/<id>` 路由覆盖它。 */
  initialPageId: string;
  /**
   * 参数化页(声明了 `params` 的页,如 `attempt`、`experiment`)的 id 全集,声明或补位后的
   * 最终形态——外壳按这份清单判定同源链接 `<pageId>/<key>.html` 与 hash 路由 `#/<pageId>/<key>`
   * 该不该被 dialog 拦截(view.md「参数化页的 dialog 摆放」:「拦截按报告清单里的参数化页 id
   * 判定,宿主不认识具体实体」)。不进 `pages`——参数化页不出现在导航,也不是 `#/page/<id>` 路由。
   */
  paramPageIds: string[];
}

/**
 * Baked browser-shell metadata. The report itself owns all current Record
 * state, including unavailable and invalid projection states.
 */
export interface ViewData {
  /** 最近一次 run 的 startedAt(ISO);没有历史 run 时缺省。 */
  lastRunAt?: string;
  /** 报告槽 Selection 合成自几个物理 run。 */
  composedRuns: number;
  /** 报告外壳与页导航的声明(规范化后);缺省时前端按单页 `report` 兜底。 */
  report?: ViewReportMeta;
}
