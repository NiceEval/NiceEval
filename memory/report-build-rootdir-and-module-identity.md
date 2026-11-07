# 编译 src/report/** 到 dist/report/**:rootDir 范围、unique symbol emit、模块身份三个坑

落地 [[global-react-jsx-shim-rejected]] 裁决(把 package-owned report runtime 从「随包发
raw .tsx、靠 tsx 的 cwd 相关 JSX 变换」改成「发布前用 niceeval 自己的 tsconfig 预编译成
dist/report/** ESM」)时踩的三个构建期坑,都不是理论能推出来的,靠实际跑 `tsc` 才发现。

## 坑一:rootDir 收窄到 `src/report` 会撞 TS6059

**现象**:`tsconfig.report-build.json` 若设 `"rootDir": "src/report"` + `"outDir":
"dist/report"`,只要 src/report/** 里有文件 import 了 src/report/ 外部的东西(哪怕只是
`import type`),`tsc` 直接报 `TS6059: File '.../src/shared/verdict.ts' is not under
'rootDir'`。

**根因**:`allowImportingTsExtensions` 真正产出 JS 时必须搭配
`rewriteRelativeImportExtensions: true`(否则报 TS5096),而这个选项对所有 relative import
一视同仁地把 `.ts`/`.tsx` 后缀重写成 `.js`——包括指向 rootDir 之外的。就算不报 TS6059(把
rootDir 放宽到能包住所有依赖的公共祖先目录),重写后的产物路径也会按「与 rootDir 的相对位置」
去算,若 rootDir 收窄、依赖在 rootDir 外,产物里的 import 路径会指向一个从未存在的文件
(`dist/report/../shared/verdict.js` 解析成 `dist/shared/verdict.js`,但这个文件从没编译
过)。

**修法**:`rootDir` 必须设成 `"src"`(仓库源码的公共祖先,不是 `"src/report"`),`outDir`
设成 `"dist"`(不是 `"dist/report"`)——这样 src/report/* 的产物仍精确落在 dist/report/*,
只是 src/report 之外、被 import 触达的文件也会连带编译到 dist/ 下的对应位置(tsc 的整体程序
模型:只要一个文件因为任何 import 而进了「程序」,不管是 `import type` 还是 barrel 文件
`export *` 里牵出来的,都会按 rootDir 镜像结构整份被编译 + emit,没有「只解析用到的那个符号」
的懒加载)。

**连带发现**:barrel 文件(`export { x } from "./y.ts"`)会把 `y.ts` 整个拉进编译,即使只需要
它转出口的一个 type。`src/report/aggregate.ts` 原来 `import { dedupeAttempts, type ... }
from "../results/index.ts"`——这一个 value import 把整个 `results/index.ts` barrel(含
`open.ts`/`writer.ts`/`copy.ts` 等真实 fs I/O 实现)都拉进了编译图,产物里多出一整份从未被
执行、纯属编译期副产物的 fs 代码。修法是把 report/* 对 `results/index.ts` 的 6 处
`import type` 改指向叶子文件 `results/types.ts`(纯类型声明、零 value 依赖),`dedupeAttempts`
改从它的真实定义处 `results/select.ts` 导入(比它所在的 barrel 小得多、自身只有类型依赖)。
这一步把编译图从「整个 results/ 实现」收窄到「report/、shared/aggregate.ts、
shared/verdict.ts、results/select.ts、results/types.ts」。

**残留噪音,判定为可接受**:即使收窄到这个程度,`src/types.ts` 根 barrel(`export *`
汇总 shared/o11y/sandbox/agents/scoring/context/runner 七个 types.ts)仍会被 `compute.ts`/
`metrics.ts` 的 `import type` 拉进程序,而 `runner/types.ts` 里一处内联类型查询
`carryPlan?: import("./fingerprint.ts").CarryPlan` 会把 `fingerprint.ts`(进而
`sandbox/docker.ts`、`sandbox/e2b.ts`、`sandbox/vercel.ts` 等 provider 实现)也拖进程序——
这是既有代码里「types.ts 只放类型」的约定被内联 `import()` 类型查询打破的个例,不是 report
构建自己的问题,不值得为了这一步反过去改 `runner/types.ts`。这些文件的 `.js` 产物在
`dist/report/**` 的运行时 import 图里从未被引用(纯因整体程序模型陪绑编译),用
`scripts/prune-report-dist.mjs` 在 `tsc` 之后做可达性分析删掉——只删 `dist/report/` 之外
不可达的 `.js`,`.d.ts` 全部保留(下游消费方的类型解析需要它们:`.d.ts` 里 `from
"../shared/verdict.ts"` 这种写法是 `allowImportingTsExtensions` 声明产物的惯例,靠 `.ts`
后缀在消费方那侧指向同名 `.d.ts`,不是要求真的存在一个 `.ts` 文件)。

## 坑二:`declaration: true` 撞 `unique symbol` 的 "cannot be named"

**现象**:`src/report/components.tsx` 里 `export const RunOverview = Object.assign(
defineComponent(...), { data: ... })` 这类无显式类型标注的导出,`declaration: true` 时报
`TS4023: Exported variable 'RunOverview' has or is using name 'COMPONENT_FACES' from
external module ".../tree" but cannot be named`——即使 `COMPONENT_FACES` 已经
`export`。`tsc --noEmit`(仓库 `typecheck` 脚本用的模式)从不触发这条,因为它是 emit 阶段的
诊断,只有真正产出 `.d.ts` 才会跑到。

**根因**:`ReportComponent<P>` 用 `[COMPONENT_FACES]: ComponentFaces<P, any>` 这种以
`unique symbol` 做计算属性键的写法;`Object.assign` 的返回类型是 TS 内置泛型套出来的匿名交叉
类型,没有显式标注时,declaration emit 要把这个匿名类型完整打印进 `.d.ts`,但打印匿名类型里
「以 unique symbol 为键」这一构造有已知的边界情况打印不出来。

**修法**:给这 11 个导出补显式类型标注(`export const RunOverview: ReportComponent<...> &
{ data: typeof overviewData } = Object.assign(...)`)。有显式标注时 declaration emit 直接
照抄标注文本(引用 `ReportComponent` 具名类型),不需要重新打印匿名结构,`COMPONENT_FACES`
被藏在具名类型背后,不再触发这条诊断。

## 坑三:raw src 与 dist 编译产物是两个模块实例,`unique symbol` 品牌与模块级可变状态都跨不过去

**现象**:`test/fixtures/report/default-report-reexport.tsx` 原来相对路径直接
`export { CostPassRateComparison as default } from "../../../src/report/built-ins/index.ts"`
(raw src)。切到编译产物后,`niceeval view --report` 走这份 fixture 渲染出的
`ExperimentTable` 丢了 `attemptHref` 深链(`<a href="#/attempt/...">` 退化成纯
`<div>`),而裸跑(走 `dist/report/built-ins/index.js`)是好的。另外
`src/show/index.ts`/`src/view/data.ts` 若只把 built-ins/web.ts 换成 dist 版、`report.ts`/
`load.ts` 留在 raw src,`pnpm run typecheck` 会报 `ReportDefinition` 类型不兼容
(`Property '[REPORT_DEFINITION]' is missing`)。

**根因**:raw `src/report/tree.ts` 和编译出的 `dist/report/tree.js` 是**同一份源码的两个物理
文件**,Node ESM 按文件路径缓存模块实例,二者永远是两个独立实例。`tree.ts` 里两类身份机制对
「跨实例」的耐受性不同:
- `COMPONENT_FACES`/`REACT_FRAGMENT`/`REPORT_DEFINITION` 三个都用 `Symbol.for(...)`(全局
  符号注册表)声明——运行时跨实例读到的是同一个 symbol 值,duck-typing 检查(`node[key]`)
  能正确工作。
- 但 `activeWebContext`(`let` 模块级变量,`runWithWebContext`/`isHostWebContextActive`
  读写它)不是 symbol 品牌,是纯模块作用域状态——dist 实例的 `runWithWebContext` 只会设置
  **dist 自己那份** `activeWebContext`,raw 实例的 `isHostWebContextActive()` 读的是
  **raw 自己那份**(永远是 `null`),二者互不可见。text 渲染路径(`renderNodeToText`)不碰
  这个状态,所以混用在 `show` 的纯文本路径下不出问题;`view` 的 web 渲染路径(实际调用
  `runWithWebContext` 包住 `renderToStaticMarkup`)一旦分裂成两个实例就会静默丢功能,不报错、
  不崩溃,只是深链消失。
- `ReportDefinition` 的品牌字段 `[REPORT_DEFINITION]: true` 虽然运行时用 `Symbol.for`
  (跨实例安全),但 TypeScript 对 `unique symbol` 走的是**声明处**身份而非运行时值身份——
  同一段源码在两个不同文件路径各自声明一次 `unique symbol`,类型系统认为是两个不兼容的类型,
  哪怕运行时是同一个 `Symbol.for` 值。这个是纯静态检查问题,`instanceof` 不受影响。

**修法**:凡是与 `ReportDefinition`/`activeWebContext` 打交道的包内调用点,必须整条链路
统一取自同一个模块实例——不能「只把碰 JSX 的文件换成 dist,其余留 raw」这种按文件表面判断的
拆分。`src/cli.ts`、`src/show/index.ts`(含它对外 re-export 的 `loadReportFile`)、
`src/view/data.ts`、`src/view/view-report.test.ts` 的 `ReportDefinition`/`ReportLoadError`/
`loadReportFile`/`renderReportToText`/`renderReportToStaticHtml` 全部改指向
`dist/report/**`;`report.ts`/`load.ts` 本身虽然没有 JSX,也要跟着挪,理由不是「它们需要预编译」
而是「它们定义的品牌类型/被 instanceof 检查的 class 必须和 built-ins/web.ts 用的是同一份」。
测试 fixture(`test/fixtures/report/*.tsx`)原先图方便相对路径直接 import raw src 的写法
(注释自称"按测试约定用相对源码路径代替 niceeval/report")在这个架构下不再等价于真实用户
`--report` 文件的行为,改成包名自引用 `from "niceeval/report"`(真实走 package.json
`exports`,解析到 dist)——这也更准确地模拟了外部用户的真实导入路径。

**适用场景**:任何「同一段 TypeScript 源码需要以两种物理形态(raw 源码 + 编译产物)同时存在
于同一进程」的设计,都要审计一遍模块级可变状态(`let`/`const` 顶层变量)与 TS `unique
symbol`/`class` 品牌——`Symbol.for` 能跨实例但模块级变量和静态 `unique symbol` 类型不能,
必须让所有跨越这条边界的调用点收敛到同一个物理文件。
