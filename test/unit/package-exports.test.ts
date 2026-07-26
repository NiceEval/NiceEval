import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CJS 宿主(npm init -y 默认)下 CLI 必须能装载自己 init 生成的 config——契约见
// docs/cli.md「装载用户 .ts」,覆盖类别见 docs/engineering/testing/unit/experiments-runner.md
// 「用户 .ts 装载与宿主模块形态」。这里守护两条数据面不变量,两者缺一 CJS 宿主必崩:
// bug: memory/tsx-dynamic-import-require-cycle.md
const ROOT = resolve(import.meta.dirname, "../..");

describe("装载用户 .ts 的宿主模块形态无关性", () => {
  it("exports 每个带 import 条件的出口同时带 require 条件,且两者指向真实文件", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      exports: Record<string, string | Record<string, string>>;
    };
    const problems: string[] = [];
    for (const [entry, value] of Object.entries(pkg.exports)) {
      if (typeof value === "string") continue;
      if (!value.import) continue;
      if (!value.require) {
        problems.push(`${entry}: 有 import 条件但没有 require 条件——CJS 编译面的用户文件 require 这个子路径会 ERR_PACKAGE_PATH_NOT_EXPORTED`);
        continue;
      }
      for (const target of [value.import, value.require]) {
        // dist/ 产物由 prepare 链生成,git clean checkout 下可以不存在;源码面必须存在
        if (!target.startsWith("./dist/") && !existsSync(join(ROOT, target))) {
          problems.push(`${entry}: 条件指向的 ${target} 不存在`);
        }
      }
    }
    expect(problems, "exports 出口的 require 条件缺失或指向失效").toEqual([]);
  });

  it("bin 入口同时注册 tsx 的 ESM 与 CJS 两个 hook", () => {
    const bin = readFileSync(join(ROOT, "bin", "niceeval.js"), "utf8");
    expect(bin, "缺 tsx/esm/api——ESM 宿主的用户 .ts 没人转译").toContain('"tsx/esm/api"');
    expect(bin, "缺 tsx/cjs/api——CJS 宿主的用户 .ts 落进 Node 未挂钩的 CJS loader,裸 TS 直接语法报错").toContain('"tsx/cjs/api"');
  });
});
