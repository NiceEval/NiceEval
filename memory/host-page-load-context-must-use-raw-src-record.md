---
name: host-page-load-context-must-use-raw-src-record
description: PageLoadContext 的 locator 解析若走 dist/report/** 编译产物自带的 record import,会跟 host 侧 raw src 的 Record 对象不同模块实例、查不到索引
metadata:
  type: project
---

已修。`src/report/runtime/host.ts` 是不参与 `tsconfig.report-build.json` 编译单元的 raw
TypeScript facade(经 tsx 直接执行),对报告运行时一律动态 `import("../../../dist/report/...")`
——这条规则本身没错,但 `createHostPageLoadContext` 一度把这条规则也套用到了 `record` 模块上:
委托给 `dist/report/runtime/page-render.js` 里的 `createPageLoadContext`,而那份编译产物是
`report-build` 编译单元的一部分,它对 `resolveLocator`/`Record` 类型的 import 会解析到它自己
编译出的 `dist/record/open.js`——与 `show`/`view` 用来构造 `results`(`Record`)的
`../../record/index.ts`(raw src,同一份 tsx 进程里跑)是两个完全不同的模块实例。

**现象**:`show @<locator> --report standard`(经 `page.load` 走 `renderTarget` 的真实路径,不是
旧版直接注入 evidence 的旁路)对任意合法 locator 都报
`LocatorNotFoundError: No attempt found for locator ... in this results root`,即使同一个
locator 刚被同一个 `results` 对象成功 `resolveLocator` 过。

**根因**:`resolveLocator` 的 locator→AttemptHandle 索引挂在 `openRecord()` 内部按 `results`
对象身份建的 `WeakMap`(`src/record/open.ts` 的 `locatorIndexByResults`)。这个 WeakMap 是模块级
私有状态,`dist/record/open.js` 与 `src/record/open.ts` 是两份独立的模块实例、各自持有一份空的
WeakMap。`results` 由 raw src 的 `openRecord()` 构造并登记进 raw src 的 WeakMap;换一份编译产物的
`resolveLocator` 来查,永远查不到,不管 locator 本身合不合法。

**修法**:`createHostPageLoadContext` 不再委托 dist 版本,改成直接用 `host.ts` 已经在用(给
`Record`/`Sample` 做 type-only import)的同一份 `../../record/index.ts`,静态值导入
`resolveLocator`/`loadAttemptEvidence`,在 `host.ts` 里原地拼出 `PageLoadContext`。`view` 侧的
`src/view/data.ts` 从一开始就是这么写的(自己组装 `PageLoadContext`,没有委托 dist),所以只有
`show` 经过的 `host.ts` 这条路线中招。

**教训**:「这个模块参与 report-build 编译单元」与「这个模块的每一个 import 都该走 dist」不是
同一件事——`page-render.ts` 编译进 dist 是因为它要被 `report/` 内部消费,但它对 `record` 的依赖
终归要接到调用方(show/view)手上已经存在的那个 `Record` 对象,任何跨编译单元的「重新 import
record 再自己解析」都会撞对象身份不共享的坑。凡是 host facade 要把一个「已有对象」交给 dist 产物
处理,要么整个对象/回调原样传进去(`PageLoadContext` 类型定义可以留在 report 包,但构造它的具体
实现必须留在能访问同一个 `results` 实例模块图的地方),要么在 raw src 侧自己拼好再传下去,不要
在 dist 侧重新触达一个本该共享的状态源。

由 [[report-target-neutral-parameterized-pages]] 落地后 `show @<locator> --report standard`
真机冒烟暴露。
