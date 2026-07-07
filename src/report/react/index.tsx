// niceeval/report/react —— 纯渲染的报告积木(docs/reports.md 第一档,原型实现)。
//
// 契约:
//   - 组件只认「算好的可序列化数据」:零 IO、零 hooks、零数据操作,可进 "use client";
//   - 不 hydrate 也完整:renderToStaticMarkup 的产物即成品——排序在数据侧预排,
//     hover 退化为 title,下钻是普通 <a>,展开折叠是 <details>;
//   - 样式随包发布:配套 ./styles.css(nre-* 稳定类名),使用者在其后加载覆盖即可;
//   - 跨块配色一致:维度键 → 稳定散列 → 固定调色板下标(colors.ts)。
//
// 数据从哪来:niceeval/report 的计算函数(table()/matrix()/scoreboard()/scatter()/
// overview()/delta()/cases())。计算层在并行实验中实现;类型暂由 ./data.ts 声明,
// 合并时切换为从计算层 re-export。

export { RunOverview } from "./RunOverview.tsx";
export { MetricTable } from "./MetricTable.tsx";
export { MetricMatrix } from "./MetricMatrix.tsx";
export { Scoreboard } from "./Scoreboard.tsx";
export { MetricScatter } from "./MetricScatter.tsx";
export { DeltaTable } from "./DeltaTable.tsx";
export { CaseList } from "./CaseList.tsx";

// 数据契约类型(临时家在 ./data.ts,见该文件头部说明)
export type {
  AttemptRef,
  MetricColumn,
  MetricCell,
  TableData,
  MatrixData,
  ScoreboardData,
  ScatterData,
  OverviewData,
  DeltaData,
  CaseListData,
} from "./data.ts";
