#!/usr/bin/env node
// fastevals 入口:注册 tsx 的 ESM loader(让我们能直接 import 用户的 .ts:
// fastevals.config.ts、evals/*.eval.ts、agents/*.ts),再加载真正的 CLI。
// 这样框架与被测项目都不需要编译步骤。
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();

const cliUrl = new URL("../src/cli.ts", import.meta.url);
await import(fileURLToPath(cliUrl));
