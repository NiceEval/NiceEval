// docs/feature/reports/library.md 场景三(零框架静态导出)的最小演示:
// 读 → 算 → renderToStaticMarkup,一次成型,零前端框架、零 hydration。
// 用 src/report/components/fixtures.ts 顶替各 Source 计算产物,专看渲染面。
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

import { Chart, Series, Table } from "../src/report/react/index.tsx";
import {
  attemptListItems,
  experimentListItems,
  matrixData,
  scatterData,
  scoreboardData,
  tableData,
} from "../src/report/components/fixtures.ts";
import {
  attemptListContent,
  experimentListContent,
} from "../src/report/components/entity-lists/content.ts";
import {
  metricMatrixContent,
  scoreboardContent,
} from "../src/report/components/metric-views/content.ts";
import { datasetToTableContent, scatterDataToDataset, tableDataToDataset } from "../src/report/model/dataset.ts";

const here = dirname(fileURLToPath(import.meta.url));
const attemptHref = (locator: string) => `view/#/attempt/${locator}`;

const measureTable = datasetToTableContent(tableDataToDataset(tableData));
const matrixTable = metricMatrixContent(matrixData);
const scoreboardTable = scoreboardContent(scoreboardData);
const chartDataset = scatterDataToDataset(scatterData);
const attemptTable = attemptListContent(attemptListItems);
const experimentTable = experimentListContent(experimentListItems);

const page = renderToStaticMarkup(
  <main style={{ maxWidth: "960px", margin: "0 auto", padding: "0 1rem" }}>
    <h1>niceeval/report/react 官方原语静态演示</h1>
    <h2>Table · measure.rows</h2>
    <Table data={measureTable} attemptHref={attemptHref} />
    <h2>Table · measure.matrix</h2>
    <Table data={matrixTable} attemptHref={attemptHref} />
    <h2>Chart · measure.chart</h2>
    <Chart data={chartDataset} x="costUSD" y="passRate" legend>
      <Series id="frontier" mark="scatter" points="experiment" by="agent" />
    </Chart>
    <h2>Table · measure.scoreboard</h2>
    <Table data={scoreboardTable} />
    <h2>Table · entity.attempts</h2>
    <Table data={attemptTable} attemptHref={attemptHref} />
    <h2>Table · entity.experiments</h2>
    <Table data={experimentTable} filter attemptHref={attemptHref} />
  </main>,
);

// 样式随包发布:静态页里直接内联那份 CSS,零外部依赖
const css = readFileSync(join(here, "../src/report/assets/styles.css"), "utf8");
const html = `<!doctype html><meta charset="utf-8"><title>niceeval report demo</title><style>${css}</style>${page}`;

const out = process.argv[2]
  ? resolve(process.argv[2])
  : join(mkdtempSync(join(tmpdir(), "nre-demo-")), "report.html");
writeFileSync(out, html);
console.log(`report written: ${out} (${(html.length / 1024).toFixed(1)} KB, zero <script>)`);
