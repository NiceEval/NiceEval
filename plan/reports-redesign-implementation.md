# PLAN:Reports 三层重设计的实现落地

设计已定稿并全部落进 `docs/feature/reports/`（2026-07-16,设计裁决台账见 `memory/reports-component-page-report-redesign.md`）。本 PLAN 给实现 Agent:按 docs 声明改 `src/`,测试只实现 `docs/engineering/unit-tests/reports/cases.md` 已登记的行。

## 契约变更总览(实现对照清单)

1. **`Selection` 改名 `Scope`**(全仓类型与导出):`results.latest()` / `results.current()` 返回 `Scope`;`ScopeWarning`;`ReportInput = Scope | readonly Snapshot[]`。类型的家在 `src/types.ts` / results 模块。这是破坏性改名,不留别名。
2. **`defineComponent` 双形态**(`src/report/`):
   - 函数形态 `(props, ctx) => ReportNode | Promise<ReportNode>` → 组合组件;`ctx: ComposeContext = { scope, results, report }`(`report: ReportMeta` 形状见 `docs/feature/reports/library/layout.md`)。
   - 对象形态 `{ resolve?, text, web }` → 双面组件;`resolve(props, ResolveContext { input })` 把 props 规范化成渲染 props;缺 `text`/`web` 定义时报错。
3. **官方数据组件 props 双形态**(`data` 判别):spec 形态 = Options 平铺 + 可选 `input`(默认宿主 Scope);`data` 与 spec 字段同时出现报完整用户反馈。`DataProps<Data, Options, Presentation>` 联合见 `docs/feature/reports/library/metric-views.md`。
4. **resolve 管线**(`src/report/tree.ts` 的 `resolveReportTree` 扩展):`装载 → resolve(展开组合组件 + spec 取数,同层并行、保持声明顺序、按「同引用 input + 深相等 spec」记忆化)→ validate → render`。非法节点(React 组件、未包装函数、intrinsic)在展开遇到时拒绝且不取数。
5. **`defineReport` 单一产物**:`defineReport(树)` / `defineReport({外壳, content | pages})`;`ReportPage = { id, title, content: ReportNode }`;`ReportBodyDefinition` / `ReportSiteDefinition` / `ReportBuild` / `ReportContext` 类型删除;`ReportDefinition { kind: "report" }` 不在 `ReportNode` 内。报错文案:content/pages 同缺或同给时下一步是 `content: <ExperimentComparison />`。
6. **内建报告**(`src/report/built-ins/`):`niceeval/report/built-in` 入口改为一行 `export default defineReport(<ExperimentComparison />)`;`comparisonReport` 具名导出删除。`ExperimentComparison` 获得 spec 形态(input 可选)。
7. **`ctx.report`(ReportMeta)**:规范化声明只读注入组合组件——回退链后的 `title`、`links`(默认 `[]`)、`footer`、`pages: [{id,title}]`、当前 `page` id;`scripts`/`styles` 不进。
8. **组件 `.data` 静态属性形态废除**:计算函数只以具名 `*Data` 导出(`metricTableData` 等);`niceeval/report/react` 仍只导出 data 形态纯组件。
9. **`view --out` 无档位**(`src/view/`):根里存在且前端会读取的证据文件全部复制——`diff.json` 有就带(旧行为「一律不复制 diff」废除),`o11y.json` 永不复制;发布防呆(redaction 标记 / `--allow-sensitive-artifacts`)行为不变,报错文案措辞从「数据等级」改「发布防呆」、「消毒」改「脱敏」(错误信息与注释同步,API 名 `redact`/`publish.redaction` 不动)。`--out` 与位置参数 / `--experiment` 互斥,报错下一步是 `copySnapshots` + `filter` 换根。见 `docs/feature/reports/view.md#静态导出`。

## 步骤建议

1. 类型层:Scope 改名 + 新 `defineComponent`/`defineReport` 签名(`src/types.ts`、`src/report/report.ts`、`src/define.ts` 如涉及)。
2. resolve 管线:扩展 `src/report/tree.ts`(组合展开、记忆化、并行序保持、非法节点反馈),宿主接线 `src/report/report.ts`(text)与 `src/report/web.ts`(web)。
3. 官方组件逐个加 spec 形态(resolve 调对应 `*Data`)。
4. 内建入口、CLI 装载(`src/cli.ts` `--report`/`--page` 报错文案)、view 宿主。
5. 测试:把 `cases.md` 新增/改写的行变绿,特别是「组件解析(resolve)与组合组件」新分区;旧的 `Component.data` spy 相关测试按 memory/report-component-data-fn-spyon-must-target-component 的历史注意迁移。
6. 收尾同步义务(CLAUDE.md 表):`pnpm run typecheck`、`pnpm test`、`pnpm run build:report`(注意 memory/stale-dist-report-type-identity-typecheck)、公开面变更跑 `pnpm docs:reference`、核对 `src/i18n/` 两份 `--help` 速查、更新 `docs/source-map.md` reports 相关行、在真实 evals repo(如 `/Users/ctrdh/Code/coding-agent-memory-evals`)跑 `pnpm exec niceeval show / view --report` 对照 docs 预期。

## docs-site

`docs-site/zh` 四篇(custom-reports / report-components / publish-report / results-data)与英文入口按新契约同步——若本 PLAN 执行时它们尚未更新,以 `docs/feature/reports/` 为准源改写;改前必读 `docs-site/AGENTS.md`。验证:`PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate && pnpm run docs:links`。
