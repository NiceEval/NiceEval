// PoweredBy:唯一的品牌件的 web 面。品牌契约是「提供一个组件,不给开关」——无 props、
// 无关闭配置;不想要品牌 = 不用它(docs/feature/reports/components/site.md「PoweredBy」)。
// rel 只声明 noopener 以保留 Referer(默认策略只发 origin):官网统计由此得知点击来自哪个
// 报告站点;静态导出在构建期不知道自己托管在哪个域名,来源不进 URL 参数。

import type { ReactElement } from "react";

/** 品牌行的固定去处:niceeval 官网,utm 标记「来自报告的品牌行」。 */
export const POWERED_BY_HREF = "https://niceeval.com/?utm_source=report&utm_medium=powered-by";

/** 一行品牌色小字 `Powered by NiceEval`,链接官网;HeroCard 的品牌行与它同一渲染。 */
export function PoweredBy(): ReactElement {
  return (
    <p className="nre nre-powered-by">
      <a href={POWERED_BY_HREF} target="_blank" rel="noopener">
        Powered by NiceEval
      </a>
    </p>
  );
}
