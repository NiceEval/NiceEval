// docs/feature/reports/library.md 场景三(零框架静态导出)的最小演示:
// 读 → 算 → renderToStaticMarkup,一次成型,零前端框架、零 hydration。
// 用 src/report/react/fixtures.ts 顶替各组件 .data 计算函数的产物,专看渲染面。
//
//   pnpm exec tsx scripts/report-react-demo.tsx [输出路径.html]
//
// 不传输出路径时写到系统临时目录,打印文件位置;浏览器直接打开即可检查
// 「不 hydrate 也完整」:排序、覆盖率角标、缺数据、下钻链接全部在静态 HTML 里。

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// scripts/ 不在 tsconfig include 里,tsx 对本文件用 classic JSX 转换,需要显式 React
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AttemptList,
  DeltaTable,
  MetricBars,
  MetricLine,
  MetricMatrix,
  MetricScatter,
  MetricTable,
  RunOverview,
  Scoreboard,
} from "../src/report/react/index.tsx";
import {
  attemptListItems,
  deltaData,
  lineData,
  matrixData,
  overviewData,
  scatterData,
  scoreboardData,
  tableData,
} from "../src/report/react/fixtures.ts";

const here = dirname(fileURLToPath(import.meta.url));
const attemptHref = (locator: string) => `view/#/attempt/${locator}`;

const page = renderToStaticMarkup(
  <main style={{ maxWidth: "960px", margin: "0 auto", padding: "0 1rem" }}>
    <h1>niceeval/report/react 官方组件静态演示</h1>
    <RunOverview data={overviewData} />
    <h2>MetricTable</h2>
    <MetricTable data={tableData} attemptHref={attemptHref} />
    <h2>MetricMatrix</h2>
    <MetricMatrix data={matrixData} attemptHref={attemptHref} />
    <h2>MetricBars</h2>
    <MetricBars data={matrixData} />
    <h2>MetricLine</h2>
    <MetricLine data={lineData} />
    <h2>Scoreboard</h2>
    <Scoreboard data={scoreboardData} />
    <h2>MetricScatter</h2>
    <MetricScatter data={scatterData} pointHref={(row) => `view/#/experiment/${row.key}`} />
    <h2>DeltaTable</h2>
    <DeltaTable data={deltaData} />
    {/* AttemptList/EvalList/ExperimentList 没有 attemptHref prop(证据室深链恒经宿主 ctx,
        docs/feature/reports/library.md「嵌入自己的 React 页面」的函数签名没有这个参数);裸嵌进自己的 React 应用时退化为
        默认 `#/attempt/<locator>`,不在这里自定去处。 */}
    <h2>AttemptList</h2>
    <AttemptList items={attemptListItems} />
  </main>,
);

// 样式随包发布:静态页里直接内联那份 CSS,零外部依赖
const css = readFileSync(join(here, "../src/report/react/styles.css"), "utf8");
const html = `<!doctype html><meta charset="utf-8"><title>niceeval report demo</title><style>${css}</style>${page}`;

const out = process.argv[2]
  ? resolve(process.argv[2])
  : join(mkdtempSync(join(tmpdir(), "nre-demo-")), "report.html");
writeFileSync(out, html);
console.log(`report written: ${out} (${(html.length / 1024).toFixed(1)} KB, zero <script>)`);
