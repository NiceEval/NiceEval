# TypeScript 7 不带编程 API,直接升级会炸 next build

## 现象

把 devDependencies 的 `typescript` 从 5.x/6.x 直升 `typescript@7`(2026-07 发布的 Go 原生版)后:

- `pnpm run site:build` 崩溃:Next 16.2.x 会编程式 `require("typescript")` 做类型检查,拿不到 API 后先自动重装 typescript(无效),再报 `The "id" argument must be of type string. Received undefined`,build worker exit 1。
- `pnpm run typecheck` 新报 `TS2882: Cannot find module or type declarations for side-effect import of '../styles.css'` —— TS7 默认开启 `noUncheckedSideEffectImports`。

## 根因

TypeScript 7(Go 原生移植,tsc 快 8-12 倍)首发**只提供 `tsc` 二进制,不提供编程 API**。所有编程式加载 `typescript` 模块的工具(Next、typescript-eslint、本仓库的 `scripts/generate-reference.ts`)都需要 TS 6 的 JS 实现。微软为此发布了 `@typescript/typescript6` 包走 npm alias 并行安装。公告:https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/

## 修法

官方双装配方(修在根 package.json,2026-07-10):

```json
"typescript": "npm:@typescript/typescript6@^6.0.2",
"@typescript/native": "npm:typescript@^7.0.2",
```

- 名字 `typescript` 必须映射到 typescript6:API 消费者按字面量解析模块名。它的 bin 叫 `tsc6`,不与 TS7 冲突。
- `@typescript/native`(→ typescript@7)提供 `tsc` bin,`tsc --noEmit` 自动用上原生版(本仓库 typecheck ~0.7s)。
- `scripts/generate-reference.ts` 的 `import ts from "typescript"` 不用改——alias 后解析到的就是 TS6 API。
- CSS 副作用导入:加 `src/view/app/css.d.ts` 声明 `declare module "*.css"`,不要关 `noUncheckedSideEffectImports`(它能抓 import 路径拼写错误)。

## 适用场景 / 何时复盘

等 TS7 提供编程 API、且 Next 稳定版(≥16.3?)支持后,把 alias 收敛回单一 `typescript@7` 并删掉 `@typescript/native`。在那之前不要"顺手把 typescript 升到 7"——版本号在 alias 的 spec 里,`typescript` 名下看到 6.0.x 是有意为之。
