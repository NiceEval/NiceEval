// 代表性自定义报告 1/2 —— 复用内建 standard pages，并替换首页的品牌 Hero。
// defineReport 不再接受 extends / links / footer；品牌外链改由页内组件或 head 承担。
import type { Sample } from "niceeval/record";
import { Col, Hero, SampleOverview, defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";

const logo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#6d5ce7"/><path d="M17 45V19h7l8 13 8-13h7v26h-7V30l-8 12-8-12v15z" fill="white"/></svg>',
)}`;

async function brandedOverviewRender(_sample: Sample) {
  return (
    <Col>
      <Hero
        logo={{ src: logo, alt: "Results E2E logo" }}
        description="A branded report assembled entirely from official niceeval components."
        links={[{ label: "View niceeval on GitHub", href: "https://github.com/niceeval/niceeval" }]}
      />
      <SampleOverview />
    </Col>
  );
}

export default defineReport({
  pages: [
    {
      ...standard.pages[0],
      render: brandedOverviewRender,
    },
    ...standard.pages.slice(1),
  ],
  title: { en: "Results E2E · Branded", "zh-CN": "Results E2E · 品牌版" },
  head: [
    {
      tag: "link",
      attrs: {
        rel: "noopener",
        href: "https://github.com/niceeval/niceeval",
      },
    },
  ],
});
