// TS7 默认开启 noUncheckedSideEffectImports,CSS 副作用导入(main.tsx 引 styles.css,
// 由 Vite 处理)需要显式模块声明才能通过 typecheck。
declare module "*.css";
