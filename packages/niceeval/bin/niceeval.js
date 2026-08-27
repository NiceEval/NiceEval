#!/usr/bin/env node
// NiceEval 自身始终执行发布包里的 canonical CJS runtime。用户的 TypeScript 配置、Eval、
// Experiment 与项目内依赖由 runtime 的受管 loader 装载；bin 不注册全局 hook。
const cliUrl = new URL("../dist/cli/bootstrap.cjs", import.meta.url);
await import(cliUrl.href);
