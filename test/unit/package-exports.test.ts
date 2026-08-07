// cases: docs/engineering/testing/unit/experiments-runner.md
// 「用户 .ts 装载与宿主模块形态」类别：CLI 装载用户 .ts 不受宿主 package.json 的 type 影响
// （契约见 docs/cli.md「装载用户 .ts」）。这里守护两条数据面不变量,两者缺一 CJS 宿主必崩:
// bug: memory/tsx-dynamic-import-require-cycle.md
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

function conditionTargets(condition: string | Record<string, string | Record<string, string>>): string[] {
  if (typeof condition === "string") return [condition];
  return Object.values(condition).flatMap(conditionTargets);
}

describe("装载用户 .ts 的宿主模块形态无关性", () => {
  it("exports 每个带 import 条件的出口同时带 require 条件,且两者指向真实文件", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      exports: Record<string, string | Record<string, string | Record<string, string>>>;
    };
    const problems: string[] = [];
    for (const [entry, value] of Object.entries(pkg.exports)) {
      if (typeof value === "string") continue;
      if (!value.import) continue;
      if (!value.require) {
        problems.push(`${entry}: 有 import 条件但没有 require 条件——CJS 编译面的用户文件 require 这个子路径会 ERR_PACKAGE_PATH_NOT_EXPORTED`);
        continue;
      }
      // 条件可能是纯字符串,也可能是 types/default 嵌套对象;运行时目标取全部字符串叶子。
      for (const target of [...conditionTargets(value.import), ...conditionTargets(value.require)]) {
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
