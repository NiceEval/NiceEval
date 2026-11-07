# report-src-changes-need-dist-rebuild

改 src/report/** 后 CLI 行为不变——show/view 宿主 import 的是 dist/report 预编译产物,要 pnpm run build:report

**现象**(2026-07-15):修好 `src/report/text/faces.ts` / `table.ts` 的 Result 单元格收口,typecheck 与 vitest 全绿,但在真实 repo 里 `pnpm exec niceeval show` 输出完全没变,极像改错了渲染器。

**根因**:`src/show/index.ts` 对 report 包 import 的是 `../../dist/report/report.js` 与 `../../dist/report/built-ins/index.js`——`src/report/**` 是全仓库唯一预编译发布的部分(JSX web 面,见 CLAUDE.md Release 节),CLI 宿主为了与用户报告共享同一模块实例也吃 dist。vitest 直接测 src,所以测试绿与 CLI 行为旧可以同时成立。

**修法**:改完 `src/report/**` 想在 CLI(`niceeval show` / `view`)上看到效果,必须先 `pnpm run build:report`。判别口径:单测绿 + CLI 旧 ≈ 大概率忘了重建 dist,先重建再怀疑改错文件。
