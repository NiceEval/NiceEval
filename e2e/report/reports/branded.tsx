// 代表性自定义报告 1/2 —— 复用内建 standard pages，只改外壳 title。
// defineReport 不再接受 extends / links / footer；品牌外链改由页内组件或 head 承担。
import { defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";

export default defineReport({
  pages: standard.pages,
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
