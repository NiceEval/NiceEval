# 跨项目 cwd 装载 --report 报 "React is not defined"

**现象**：在 niceeval 仓库 cwd 下用绝对路径加载另一个项目的报告文件（`pnpm run niceeval -- show --results <他仓>/.niceeval --report <他仓>/reports/x.tsx`）报 `Cannot load report file …: React is not defined`；cd 进该项目再跑（`pnpm exec niceeval show --report reports/x.tsx`）完全正常。2026-07-16 集成冒烟与 web 面 smoke 各复现一次。

**根因**：tsx 的 tsconfig 发现按**进程 cwd**而不是按被加载文件的位置；拿不到报告文件所属项目的 `"jsx": "react-jsx"` 时回退 classic runtime，JSX 编译成 `React.createElement`，而新契约的报告文件不再 import React。

**修法**：未修。候选方向：装载面（`src/report/load.ts`）对 `--report` 文件按其所在目录解析 tsconfig，或干脆对报告文件强制 `jsx: react-jsx`（报告契约已declared JSX 形态，不该受宿主 cwd 影响）。修之前的 workaround：在报告文件所在项目 cwd 里跑。
