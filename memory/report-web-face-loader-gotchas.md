# view --report 装载:tsx 的 jsx 配置按 tsconfig 目录为界 + query 会破 vite-node

## 现象一:web 面渲染报 `React is not defined`(已修)

CLI 在**用户项目 cwd** 下跑 `niceeval view --report` 时,`renderReportToStaticHtml` 一进
web 面就抛 `ReferenceError: React is not defined`,栈指向包内 `src/report/primitives.tsx`
的 web 面。`show --report` 一直正常(text 宿主从不求值 JSX,web 面只是定义未调用),所以
积木层落地后一直没暴露。

**根因**:tsx 应用 jsx 编译配置以「tsconfig 所在目录」为界——用户项目的
`"jsx": "react-jsx"` 只覆盖用户目录下的 .tsx;包内 .tsx(primitives / react 组件的
web 面)落在覆盖范围之外,esbuild 退化成 classic JSX,编译产物引用全局 `React`。包的
`files` 不含 tsconfig.json,发布安装后必然如此,不是本机巧合。

**修法**:`src/report/web.ts`(全仓唯一 import react-dom 的一侧)补全局 React shim:
`globalThis.React ??= React`。两种编译模式下 web 面都可渲染;只定义一次,不覆盖宿主已有
全局。适用场景:任何「库自带 .tsx 组件 + 用户项目 cwd 下经 tsx 渲染」的路径。

## 现象二:`.tsx?mtime=` 的 cache-busting query 在 vite-node 下炸(已修)

dev server 的报告文件重载靠 `import("file:///...tsx?mtime=<mtimeMs>")` 绕 ESM 模块缓存。
真 tsx loader 与 Node 原生 ESM 都认 file URL 的 query(实测通过);但 vitest 的
vite-node 按「扩展名 + query」误判文件类型,esbuild 报 `JSX syntax is disabled`。

**修法**:`src/report/load.ts` 的 `loadReportFile` 里 query import 失败时退化为普通
import(失去变更重载,不失去功能);仍失败才抛真错误。测试里 tmpdir 的 `.mjs` 报告文件
走原生 import,query 正常,重载语义仍被 `src/view/view-report.test.ts` 覆盖。

另注:旧实现的 cache-busting 只 bust 报告文件本体(依赖不追踪)。已改为 tsx
namespaced register 失效整棵项目内 import 图,见
[[view-hot-reload-needs-namespace-import]]。仍不要用无控制的 `tsImport` 乱造第二份
包内模块实例以外的用途——view 这条路径的品牌与 faces 都走 `Symbol.for`,跨实例安全。
