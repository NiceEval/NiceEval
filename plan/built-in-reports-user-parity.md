# PLAN：用两个声明式组件重建默认内置报告

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；先写定稿文档，再改组件库和内置报告，最后接宿主并验收。
>
> 用户目标：当前默认页面只由“成本 × 成功率图”和“实验明细表”两个组件组成。报告按实际展示内容命名，放进统一的 built-in 目录。built-in 的 TSX 必须和用户报告完全同构，只摆组件，不写额外的数据装配 JavaScript。
>
> 范围：设计并实现声明式报告组件的数据绑定、内置报告目录和默认报告改名。不要改 Selection 算法、Results Format、证据页面、Compare UI 或图表视觉。

## 开始前必读

按顺序阅读，不能只读本计划：

1. `AGENTS.md`：beta 阶段允许破坏式 API 收敛；必须先文档后代码；公开面、TSDoc、docs-site 与验证命令需要同步。
2. `docs/README.md`：内部设计文档入口。
3. `docs/source-map.md`：Reports、show、view 与公开导出的源码映射。
4. `docs/reports.md`：`ReportDefinition`、计算函数、双面组件、text/web renderer、默认报告的当前契约。
5. `docs/view.md`：网页宿主中报告与证据页面的边界。
6. `docs/results-lib.md`：`Selection`、`Selection.filter()`、warnings 与 attempt artifact 身份。
7. `docs/concepts.md`：Report、Reporter、view、默认报告等术语。
8. `docs-site/AGENTS.md`：公开中文文档术语与校验规则。
9. `docs-site/zh/guides/custom-reports.mdx`、`report-components.mdx`、`viewing-results.mdx`。
10. 当前源码：
    - `src/report/default-report.tsx`
    - `src/report/official-report.tsx`
    - `src/report/report.ts`
    - `src/report/tree.ts`
    - `src/report/components.tsx`
    - `src/report/compute.ts`
    - `src/report/primitives.tsx`
    - `src/report/index.ts`
    - `src/report/web.ts`
    - `src/show/index.ts`
    - `src/view/data.ts`
11. 当前测试与真实用户报告：
    - `src/report/dual-render.test.tsx`
    - `src/report/report.test.ts`
    - `src/show/show.test.ts`
    - `src/view/view-report.test.ts`
    - `test/fixtures/report/exam-report.tsx`
    - `/Users/ctrdh/Code/coding-agent-memory-evals/reports/memory-conditions.tsx`（只读参考，不修改外部仓库）
12. 命中的 memory 正文：
    - `memory/visual-migration-silently-changed-computed-formulas.md`
    - `memory/reasonfor-priority-and-severity-bug.md`
    - `memory/metrictable-expand-replaces-default-report-caselist.md`
    - `memory/report-zero-js-to-progressive-enhancement.md`
    - `memory/report-web-face-loader-gotchas.md`
    - `memory/report-locale-rendering.md`

动手前用 `rg` 搜索全部调用点：

```text
DefaultReport
defaultReport
prepareDefaultReportData
runWithDefaultReportData
MetricScatter.data
ExperimentTable.data
defineComponent
renderReportToText
renderReportToStaticHtml
```

## 最终产品形状

### 默认 built-in 的名字

默认内置报告定名为 `CostPassRateComparison`：

- `CostPassRate` 明确图的两个轴是 estimated cost 与 pass rate。
- `Comparison` 表明它同时提供图和实验明细，用来比较 experiments。
- 名字不含 `Default`、`Official`、`BuiltIn` 或 `View`。默认只是 show/view 的选择，不是报告内容。

如果实现时发现产品正式用词已经把 `pass rate` 统一成 `success rate`，先在文档中裁决并全仓一致改成 `CostSuccessRateComparison`；不能代码、图轴和文档各用一个词。本计划后文以当前代码指标 `passRate` 为准。

### built-in 文件必须长这样

目标文件：`src/report/built-ins/cost-pass-rate-comparison.tsx`。

```tsx
import {
  Col,
  ExperimentTable,
  MetricScatter,
  costUSD,
  defineReport,
  passRate,
} from "../public-equivalent-imports"; // 示意；包内按最终无环依赖使用相对 import

export const CostPassRateComparison = defineReport(({ selection }) => (
  <Col>
    <MetricScatter
      selection={selection}
      points="experiment"
      series="agent"
      x={costUSD}
      y={passRate}
    />
    <ExperimentTable selection={selection} filter />
  </Col>
));
```

上面是需要达到的复杂度上限，不是伪代码方向。最终 built-in 文件必须满足：

- 正文只有 `defineReport` 与两个组件。
- 不写 `await MetricScatter.data(...)`。
- 不写 `await ExperimentTable.data(...)`。
- 不写 `Promise.all`。
- 不写 `groupOf`、`groupKeysOf`、`groupData`、`groupNodes`。
- 不写 drawable 数量判断；组件自己处理无数据或不足以成图的状态。
- 不拼 `[overview, ...sections]`。
- 不 import `ReportNode`、`Snapshot` 或内部 renderer。
- 不用宿主预热、AsyncLocalStorage、全局 current data 或 built-in 专属 context。

报告只负责声明“摆什么”；组件负责“如何从 Selection 得到自己的 data”；框架负责在渲染前完成异步解析。

### 用户报告必须使用完全相同的写法

包外用户应能写：

```tsx
import {
  Col,
  ExperimentTable,
  MetricScatter,
  costUSD,
  defineReport,
  passRate,
} from "niceeval/report";

export default defineReport(({ selection }) => (
  <Col>
    <MetricScatter
      selection={selection}
      points="experiment"
      series="agent"
      x={costUSD}
      y={passRate}
    />
    <ExperimentTable selection={selection} filter />
  </Col>
));
```

该文件与 built-in 除 import 路径和 export 形式外必须逐节点同构。测试要以这个包外 fixture 证明，而不是靠注释声称“用户也能写”。

## 完成定义

- `src/report/built-ins/` 是内置报告的唯一目录，一个文件一个按展示内容命名的 `ReportDefinition`。
- `src/report/built-ins/index.ts` 只显式导出值，不建字符串 registry。
- `CostPassRateComparison: ReportDefinition` 是 show/view 裸跑时选择的默认 definition。
- `DefaultReport`、`defaultReport` 以及零 props 官方水位锚点全部删除，不留兼容 alias；项目处于 beta，不背旧 API。
- 当前默认报告最终只有 `MetricScatter` 和 `ExperimentTable` 两个直接子组件，不包含 `RunOverview`、`GroupSummary`、`Section` 或 `CaseList`。
- 两个组件直接接收 `selection` 与计算选项；报告作者不手动调用 `.data()`。
- built-in、包外用户报告和测试 fixture 都走同一条 `build → resolve data-bound components → validate → text/web render` 管线。
- renderer 不知道 definition 是否 built-in，不按名字、引用相等或 kind 分支。
- text/web 的布局可以不同，但组件解析得到的 data、Selection、计算公式和节点顺序相同。
- 无客户端 JavaScript 时 web 报告内容完整；现有 enhance.js 只保留排序、过滤、tooltip 等浏览增强，不承担数据计算。

最终运行：

```bash
pnpm docs:reference
pnpm run typecheck
pnpm test
pnpm run niceeval -- show --help
pnpm run niceeval -- view --help
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

---

## Phase 1：先把报告与组件的新契约写进文档

### TODO

- [ ] 重写 `docs/reports.md` 的报告定义、组件数据边界、内置报告与宿主默认行为。
- [ ] 在 `docs/reports.md` 明确 data-bound component 的解析阶段：报告 build 产生声明树，框架解析组件数据，随后才进入纯同步 text/web render。
- [ ] 重写 `docs/view.md`：裸跑选择 `CostPassRateComparison`；`--report` 换成用户 definition；两者之后没有分支。
- [ ] 更新 `docs/concepts.md`：“内置报告”是普通 `ReportDefinition`；“默认”只是宿主当前选择。
- [ ] 更新 `docs/source-map.md`，加入 `src/report/built-ins/` 和组件 resolver 的最终位置。
- [ ] 更新 docs-site 中文的 custom reports、report components、viewing results 示例，展示上面的无 `.data()` 写法。
- [ ] 修改相关公开 TSDoc，并运行 `pnpm docs:reference`；不手改 GENERATED 区块。

### 文档必须回答

1. 为什么报告组件同时支持声明式 `selection + options` 和纯渲染 `data`？
2. 哪一阶段允许 IO/await，哪一阶段必须同步？
3. 用户何时用 `<MetricScatter selection={...} ... />`，何时用 `<MetricScatter data={preparedData} />`？
4. show 与 view 如何保证同一份组件数据？
5. 无 JS 静态 HTML 为什么仍完整？

### Acceptance criteria

- [ ] 公开教程中的最小自定义报告没有 `.data()`、`await` 或数据装配变量。
- [ ] 高级用法仍说明可传预计算 `data`，用于外部 React app、缓存或跨边界序列化。
- [ ] 文档不再出现 `<DefaultReport />` 或 `defaultReport`。
- [ ] docs consistency 测试通过。

---

## Phase 2：给报告组件增加声明式数据输入

### 目标 API

`MetricScatter` 支持互斥的两种 props：

```ts
type MetricScatterProps =
  | {
      data: ScatterData;
      selection?: never;
      points?: never;
      series?: never;
      x?: never;
      y?: never;
      // 纯渲染选项仍可在两臂共享
    }
  | {
      data?: never;
      selection: Selection;
      points: DimensionInput;
      series: DimensionInput;
      x: Metric;
      y: Metric;
    };
```

`ExperimentTable` 同样支持：

```ts
type ExperimentTableProps =
  | { data: ExperimentTableData; selection?: never; /* render props */ }
  | { data?: never; selection: Selection; /* data options + render props */ };
```

最终字段要复用现有 `ScatterDataOptions`、`ExperimentTableDataOptions`，不要复制出会漂移的手写类型。联合类型必须让同时传 `data` 与 `selection`、或两者都不传在 typecheck 阶段失败。

### TODO

- [ ] 盘点所有官方报告组件的 `Props`、`.data(selection, options)` 和 faces 装配方式。
- [ ] 先只为本次 built-in 需要的 `MetricScatter`、`ExperimentTable` 建立完整 vertical slice。
- [ ] 扩展 `defineComponent` 或新增中性 data-bound component primitive，使组件能声明 `resolve(props)`。
- [ ] resolver 在 report build 后递归遍历树；遇到 selection-form props 时调用现有 `.data` 计算，替换成 data-form props。
- [ ] 同层互不依赖的组件并行 resolve；保持原始节点顺序。
- [ ] resolve 完成后再做 tree validation 和 text/web render；两个 renderer只接收已解析树。
- [ ] data-form 组件跳过 resolve，可继续用于用户自己的 React 页面和预计算数据。
- [ ] 明确错误包装：指出组件名和数据解析阶段，保留原始 cause。
- [ ] 添加类型测试和运行时测试。

### 实现逻辑

推荐把组件定义扩展为三个职责：

```ts
defineComponent({
  resolve: async (props) => {
    if ("data" in props) return props;
    return {
      ...renderOnlyProps(props),
      data: await scatterData(props.selection, dataOptions(props)),
    };
  },
  web: (resolvedProps) => ...,
  text: (resolvedProps) => ...,
});
```

具体泛型可以不同，但必须保证：

- `web` / `text` 只看 resolved props，保持同步、零 IO。
- 现有 `MetricScatter.data` 与 `ExperimentTable.data` 仍是唯一计算实现；resolver 调它们，不复制公式。
- selection-form props 不会被传进 React 静态 renderer。
- resolve 不改变 keys、children 顺序、locale、attemptHref 或 className。
- 多个 sibling 的 resolve 可以 `Promise.all`，但这个并行逻辑只存在于框架，不出现在报告文件。

不要选择以下方案：

- 在 React web face 中 `await` 或 `use()` 读取 Selection。
- text face 与 web face 各自调用一次 `.data()`。
- 把计算移到 `enhance.js` 或浏览器 fetch。
- 为 built-in 写专用 `resolveDefaultReport()`。
- 用 AsyncLocalStorage/全局变量让零 props 组件偷取 Selection。

### 是否扩展到其它组件

本阶段先完成 `MetricScatter` 与 `ExperimentTable`。API 与 resolver 稳定后，执行 AI 必须盘点 `RunOverview`、`GroupSummary`、`MetricTable`、`MetricMatrix`、`MetricBars`、`Scoreboard`、`MetricLine`、`DeltaTable`、`CaseList`：

- 若它们都可机械复用同一 primitive，应在同一变更中统一支持 selection-form，避免组件库出现两种作者体验。
- 若某组件需要额外设计，记录明确阶段性差异并只实现本任务所需两个；不要为了“统一”复制大量特殊分支。
- 无论范围如何，primitive 必须是通用的，不能写 `MetricScatter` / `ExperimentTable` 名字判断。

### Acceptance criteria

- [ ] 两个目标组件的 selection-form 和 data-form 都通过类型检查。
- [ ] 同时传 `data`/`selection` 与两者都不传都有负向类型测试。
- [ ] 同一 Selection 下，两种 props 解析后的结构化 data 完全相同。
- [ ] text/web 只消费 resolved data，不触发重复计算。
- [ ] 两个 sibling 的数据计算并行且输出顺序稳定。
- [ ] 最小空报告不触发任何 built-in 或组件数据计算。

---

## Phase 3：建立 built-in 目录并实现两组件默认报告

### TODO

- [ ] 创建 `src/report/built-ins/cost-pass-rate-comparison.tsx`。
- [ ] 按“最终产品形状”的目标 TSX 实现，只摆 `MetricScatter` 与 `ExperimentTable`。
- [ ] 创建 `src/report/built-ins/index.ts`，显式导出 `CostPassRateComparison`。
- [ ] 从 `src/report/index.ts` 公开导出该 definition。
- [ ] 删除 `src/report/default-report.tsx` 与 `src/report/official-report.tsx`；可复用的中性计算必须先迁入对应组件/compute 模块。
- [ ] 删除 `DefaultReport`、`defaultReport`、`DefaultReportData`、`prepareDefaultReportData`、`runWithDefaultReportData` 等 API 和隐藏通道。
- [ ] 删除 `report.ts` / `web.ts` 对具体默认报告的 import 与预计算。
- [ ] 删除为 TDZ/cycle 安排的装载顺序与注释。
- [ ] 删除原 default report 的分组 helper、RunOverview、GroupSummary、Section、drawable 判断和 children 数组 workaround。

### 图表空态规则

旧代码在可画点少于 2 时由报告 JS 省略 scatter。新报告不允许写这个判断，因此规则归 `MetricScatter` 自己：

- 0 个可画点：渲染组件级空态，明确说明 x/y 指标没有可用数据。
- 1 个可画点：仍显示单点图，或显示“至少两个实验才能比较”的组件级状态；执行前先在 docs/reports.md 裁决一种。
- 2 个及以上：正常绘图。

不允许组件返回 `null` 让用户不知道图为何消失。text/web 必须表达同一个事实。

### 表格规则

`ExperimentTable selection={selection} filter` 自己完成全部计算：

- 一行一个 experiment。
- 保留 model、agent、平均耗时、pass rate、tokens、estimated cost、结果摘要。
- 保留当前原生 `<details>` 下钻 eval/attempt 的能力和 attemptHref。
- filter 仍是渐进增强；无 JS 时完整表格可读。

### Acceptance criteria

- [ ] built-in 文件没有 `await`、`.data(`、局部数据变量或报告专用 helper。
- [ ] AST 或源码契约测试钉住它只有两个直接业务组件：MetricScatter、ExperimentTable。
- [ ] `CostPassRateComparison` 满足 `isReportDefinition()`。
- [ ] `report.ts` 与通用 renderer 不 import `built-ins/*`。
- [ ] 空/单点/多点 scatter 在 text/web 均有明确且一致的行为。
- [ ] ExperimentTable 的现有字段、展开和证据深链没有回归。

---

## Phase 4：证明 built-in 与用户报告完全同构

### TODO

- [ ] 新建包外风格 fixture，只从 `niceeval/report` 的测试 public facade import，内容逐节点复制目标 TSX。
- [ ] 同一 ReportContext 下分别 build/resolve built-in 与 fixture，比较 resolved tree 的组件类型、props data、顺序和 keys。
- [ ] 分别渲染 text 与 web，比较事实而非空格、CSS class 或 locale 文案。
- [ ] 验证裸 show/view 只是选择 `CostPassRateComparison`，随后调用与 `--report` 相同的函数。
- [ ] 验证显式用户 fixture 与裸跑默认得到相同 scatter 点、series、ExperimentTable 行和 attempt refs。
- [ ] 验证用户自定义报告可以换指标/维度，而不需要框架新增分支。

### 必测场景

1. 多个 experiment、多个 agent，成本与 pass rate 都有值。
2. 某些 experiment 缺成本，scatter 如实处理 null，表格仍显示。
3. 只有一个可画点。
4. 空 Selection / 全部指标不可测。
5. failed、errored、skipped 混合，ExperimentTable 结果摘要正确。
6. 同 experiment 多 eval、多 attempts，展开层与 refs 正确。
7. en 与 zh-CN：数据只 resolve 一次，chrome 分别本地化。
8. view attemptHref 与用户 `--report` 的同一组件一致。
9. 最小用户报告只放 `<ExperimentTable selection={selection} />`，不会计算 scatter。

### 代码要求

- 等价测试比较结构化 resolved data，不只做 HTML snapshot。
- 不为了测试公开 built-in 私有 helper；built-in 本来就不应有 helper。
- 不用引用相等证明同构；必须跑两份独立 definition。
- 组件计算公式继续唯一落在现有 compute/data 函数。
- 若 resolver 处理嵌套 children，必须递归并保持顺序；顺手修复 `<Col><A />{sections}</Col>` 的嵌套数组问题并加测试，不在报告里 workaround。

### Acceptance criteria

- [ ] 改坏 built-in 或 fixture 任一组件 props，结构化等价测试失败。
- [ ] 让 renderer 对 built-in 增加特殊分支，架构测试失败。
- [ ] 让 text/web 任一面重新自行计算 data，调用次数测试失败。
- [ ] built-in 与用户 fixture 的 scatter/Table 事实完全相同。

---

## Phase 5：接入默认宿主并完成公开验收

### TODO

- [ ] show 无 `--report` 时选择内存中的 `CostPassRateComparison`。
- [ ] view 无 `--report` 时选择同一个 definition。
- [ ] 有 `--report` 时只替换 definition，不改变 Selection、resolver、validation 或 renderer。
- [ ] 更新相关 fixture、测试名、注释、TSDoc、docs-site 中文示例和生成参考。
- [ ] `rg` 全仓清除作为当前 API/概念存在的 `DefaultReport` / `defaultReport`；历史 memory 保留原文，但索引不能误导为当前 API。
- [ ] 如本次异步 resolver 或组件空态产生反直觉修法，按 `memory/INDEX.md` 新增条目并索引。

### 真实 CLI 冒烟

用临时结果 fixture 执行：

```bash
pnpm run niceeval -- show --run <fixture-results>
pnpm run niceeval -- show --run <fixture-results> --report <public-copy.tsx>
pnpm run niceeval -- view --run <fixture-results> --out <out-default>
pnpm run niceeval -- view --run <fixture-results> --report <public-copy.tsx> --out <out-custom>
```

检查实际输出：

- 默认与 public-copy 都只有成本 × pass rate 图和 ExperimentTable。
- scatter 点、颜色系列、轴指标与表格行一致。
- ExperimentTable 可展开并能深链到真实 attempt artifact。
- 无 JS 的导出 HTML 仍包含完整 SVG/空态和完整表格；JS 只增强 filter、sort、tooltip。

### Acceptance criteria

- [ ] 裸 show/view 与显式 public-copy 的结构化事实相同。
- [ ] `CostPassRateComparison` 是唯一默认选择，但没有 renderer 特权。
- [ ] `pnpm docs:reference` 无漂移。
- [ ] `pnpm run typecheck`、`pnpm test`、CLI 冒烟、`docs:validate`、`docs:links` 全部通过。

---

## 不在本计划内

- 不增加 built-in 切换 UI、tab、下拉框或 `--built-in <name>` CLI flag。
- 不提前设计第二个 built-in；只保证目录和普通 ReportDefinition 模型可以自然新增。
- 不保留旧默认报告中的 RunOverview、GroupSummary、按目录前缀 Section 分组或 CaseList。
- 不改变 `passRate`、`costUSD`、ExperimentTable 各列的公式。
- 不把数据计算搬到浏览器或 enhance.js。
- 不改变 Selection、Results Format、artifact 路径或证据页面。
- 不创建 feature branch；按仓库规则直接在当前 `main` 工作树实施并保护已有改动。

## 交付清单

执行 AI 最终回复必须列出：

- `CostPassRateComparison` 的最终 TSX 全文；
- 两个声明式组件 props 的最终 public 类型；
- resolver 的位置、异步边界、并行策略和错误语义；
- 被删除的默认报告专用数据通道、循环依赖与 JS 装配代码；
- built-in 与包外 public-copy 的结构化等价证据；
- scatter 空/单点/多点行为；
- typecheck、完整测试、CLI 冒烟、reference、docs validate、links 的实际结果；
- 未完成项或明确排除项。

不要只回复“默认报告已改名”。必须展示最终 built-in 确实只是两个组件，并证明用户复制同一段 TSX 会走完全相同的解析与渲染逻辑。
