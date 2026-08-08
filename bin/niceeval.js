#!/usr/bin/env node
// niceeval 入口:注册 tsx 的 ESM + CJS 两个 loader hook(让我们能直接 import 用户的 .ts:
// niceeval.config.ts、evals/*.eval.ts、agents/*.ts),再加载真正的 CLI。
// 两个 hook 缺一不可:tsx 按离文件最近的 package.json 的 type 决定把用户 .ts 编成 ESM 还是
// CJS,宿主项目是 CJS 形态(npm init -y 默认)时用户文件落进 Node 的 CJS loader,只注册 ESM
// hook 就没人转译(见 docs/cli.md「装载用户 .ts」)。
// 这样框架与被测项目都不需要编译步骤,也不挑宿主的模块形态。
// NiceEval 自身始终执行已发布的 canonical CJS runtime；tsx 只负责随后动态装载用户项目的
// TypeScript，绝不把已安装包回跳到 checkout 的 src/。
const cliUrl = new URL("../dist/cli.cjs", import.meta.url);
await import(cliUrl.href);

// 先原生加载 CLI，避免 CJS hook 截获已预编译的 canonical graph 形成 require/import 循环；
// CLI 随后的 config、eval、experiment 与 report 文件仍由两面 hook 动态装载。
const { register: registerCjs } = await import("tsx/cjs/api");
const { register: registerEsm } = await import("tsx/esm/api");
registerCjs();
registerEsm();
