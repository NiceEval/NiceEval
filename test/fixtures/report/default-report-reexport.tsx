// 等价性测试夹具:原样 re-export 内置默认报告 CostPassRateComparison。
// 用它验证 `niceeval view` ≡ `niceeval view --report <CostPassRateComparison>` ——
// 内置报告是公开导出的普通 ReportDefinition,没有私有通道(docs/feature/reports/architecture.md)。
//
// 走包名自引用(niceeval/report,真实用户 --report 文件的路子),不是相对路径进 src/ ——
// 报告运行时以预编译产物发布(dist/report/**,见 tsconfig.report-build.json),裸跑走的
// 也是这份产物;relative-import raw src 会是另一份模块实例,ExperimentList 的
// attemptHref(经 WebContext 模块级状态判定是否在宿主内)就认不出宿主已经 runWithWebContext
// 过,渲染结果会跟裸跑对不上。

export { CostPassRateComparison as default } from "niceeval/report";
