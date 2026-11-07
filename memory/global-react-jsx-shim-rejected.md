# 设计裁决:否决 globalThis.React 全局 shim,包内报告 runtime 改走预编译 ESM

**裁决**(2026-07-12):`src/report/jsx-runtime-patch.ts` 里 `globalThis.React = React` 这个副作用补丁(commit 914a0bd 引入,修的是 niceeval 被 link 进消费方项目时 web 面报 `ReferenceError: React is not defined`)将被删除。修法改为:package-owned 的 CLI、report runtime 与内置组件(`src/report/` 等随包发布的部分)一律用 niceeval 自己固定的 tsconfig/JSX 语义加载——发布成预编译 ESM,不受消费方 cwd 或 tsconfig 影响;user-owned 的 config、Eval、Agent、`--report` 文件继续走现有的、不设 namespace 的 tsx loader,这部分不变。

**曾选方案**:`globalThis.React ??= React`(`src/report/web.ts` 打的全局补丁,见 [[report-web-face-loader-gotchas]] 现象一)——在唯一 import react-dom 的一侧把 React 挂到全局,绕过 tsx 编译产物引用的裸 `React` 标识符找不到定义的问题。

**否决理由**:全局 shim 只是掩盖症状——真正的根因是 tsx 对 JSX 转换的 jsx 配置按"tsconfig 所在目录"而非"被编译文件的实际归属"来生效,导致包内 `.tsx` 在消费方 cwd 下退化成 classic JSX、产物引用全局 `React`。挂 `globalThis.React` 不修这个边界错位,只是在一个从来不该有隐式全局依赖的地方,主动引入了一个隐式全局依赖(mutate 一个进程级全局变量);这正是 `plan/attempt-evidence-feedback-loop.md` 模块加载边界一节明确排除的做法——package-owned 与 user-owned 两类模块必须有清楚边界,不能靠全局变量兜底。

**日期**:2026-07-12。设计出处:`plan/attempt-evidence-feedback-loop.md`(「不接受」一节明确写「用 globalThis.React、当前 cwd 或消费方 tsconfig 修补包内 JSX」)。曾选方案的落地记录见 [[report-web-face-loader-gotchas]](commit 914a0bd)。

**落地**(2026-07-12):`src/report/jsx-runtime-patch.ts` 已删除,`report.ts`/`web.ts` 的引用已移除。`src/report/**` 改由 `tsconfig.report-build.json` 经 `pnpm run build:report` 编译进 `dist/report/**`,`package.json` 的 `"./report"` / `"./report/react"` 导出与包内动态 import(`src/show/index.ts`、`src/view/data.ts`、`src/cli.ts`)都已指向编译产物。落地过程中的构建期坑(rootDir 范围、declaration emit 撞 unique symbol、raw src 与编译产物是两份模块实例)见 [[report-build-rootdir-and-module-identity]]。
