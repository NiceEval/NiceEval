// rerun: pnpm e2e test --candidate built --repo runner -- --run test/source-identity.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent("普通注释和保持换行的排版允许沿用 Eval，代码变化仍重跑", async () => {
  await runnerE2E.case("source-identity-trivia", async ({ commands: { niceeval }, paths }) => {
    const path = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
    const original = readFileSync(path, "utf8");
    const baseline = await niceeval.run(["exp", "carry", "simple/alpha", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    writeFileSync(
      path,
      original.replace(
        'description: "runner carry alpha",',
        '  description: /* ordinary note */ "runner carry alpha",',
      ) + "\n// agentJudge( is documentation, not a capability\n",
    );
    const dry = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    const carriedPlan = decodeExpPlanDocument(dry.json());
    expect(carriedPlan).toMatchObject({ reused: 1 });
    const carried = await niceeval.run(["exp", "carry", "simple/alpha", "--json"]);
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    const locator = carriedPlan.matrix[0]!.readbacks[0]!.source.locator;
    const sourcesRead = await niceeval.run(["show", locator, "source", "--json"]);
    expect(sourcesRead.exitCode, sourcesRead.diagnostic()).toBe(0);
    const sources = sourcesRead.attemptSources().sources;
    expect(sources.state).toBe("available");
    const source = sources.items.find((item) => item.path === "evals/simple/alpha.eval.ts")!;
    expect(source.content).toMatchObject({ state: "available", text: original });
    expect(sources.assertions).toMatchObject({ state: "available" });
    expect(sources.assertions.sourceSites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ state: "mapped", sourceItemId: source.sourceItemId }),
        }),
      ]),
    );
    writeFileSync(path, original.replace('"runner carry alpha"', '"runner carry alpha changed"'));
    const changed = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(changed.exitCode, changed.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(changed.json()).matrix[0]!.slots).toMatchObject([
      { state: "gap", reason: "identity-mismatch" },
    ]);
  });
});

const lexicalCases = [
  {
    name: "JSDoc 普通注释",
    before: "/** @param value before */\nexport const x = 1;",
    after: "/** @param value after */\nexport const x = 1;",
    reused: 1,
  },
  {
    name: "字符串里的注释符",
    before: 'export const x = "// /* literal */";',
    after: 'export const x = "// /* changed */";',
    reused: 0,
  },
  {
    name: "正则里的注释符",
    before: "export const x = /[/][*]literal[*][/]/;",
    after: "export const x = /[/][*]changed[*][/]/;",
    reused: 0,
  },
  { name: "模板静态片段", before: "export const x = ` a  b `;", after: "export const x = ` a b `;", reused: 0 },
  {
    name: "嵌套模板表达式普通注释",
    before: "export const x = `😀 ${`中 ${1 /* before */ + 2}`} tail`;",
    after: "export const x = `😀 ${`中 ${1 /* after */ + 2}`} tail`;",
    reused: 1,
  },
  {
    name: "Unicode 坐标和类型位置注释",
    before: 'const emoji = "😀中文"; export const x: /* before */ number = 1;',
    after: 'const emoji = "😀中文"; export const x: /* after */ number = 1;',
    reused: 1,
  },
  {
    name: "CRLF 与 LF",
    before: "export const x = 1;\r\nexport const y = 2;",
    after: "export const x = 1;\nexport const y = 2;",
    reused: 1,
  },
  {
    name: "CR 与 U+2028",
    before: "export const x = 1;\rexport const y = 2;",
    after: "export const x = 1;\u2028export const y = 2;",
    reused: 1,
  },
  {
    name: "U+2029 与 LF",
    before: "export const x = 1;\u2029export const y = 2;",
    after: "export const x = 1;\nexport const y = 2;",
    reused: 1,
  },
  { name: "Unicode 空白", before: "export const x = 1;", after: "export\u00a0const\u2003x = 1;", reused: 1 },
  {
    name: "U+2028 自动分号",
    before: "export function x(){ return\u2028value; } const value = 1;",
    after: "export function x(){ return value; } const value = 1;",
    reused: 0,
  },
  {
    name: "跨行块注释自动分号",
    before: "export function x(){ return/*\n*/value; } const value = 1;",
    after: "export function x(){ return/* */value; } const value = 1;",
    reused: 0,
  },
  {
    name: "跨行块注释保留换行",
    before: "export const x = 1;/* before\ncomment */export const y = 2;",
    after: "export const x = 1;\nexport const y = 2;",
    reused: 1,
  },
  {
    name: "PURE 和 sourceMappingURL 普通注释",
    before: "export const x = /*#__PURE__*/ (() => 1)();\n//# sourceMappingURL=before.map\n",
    after: "export const x = /* ordinary */ (() => 1)();\n//# sourceMappingURL=after.map\n",
    reused: 1,
  },
  {
    name: "hashbang",
    before: "#!/usr/bin/env node\nexport const x = 1;",
    after: "#!/usr/bin/node\nexport const x = 1;",
    reused: 0,
  },
  { name: "指令", before: '"use strict"; export const x = 1;', after: '"use asm"; export const x = 1;', reused: 0 },
  {
    name: "JSX 编译指令",
    ext: "tsx",
    before: '/** @jsx h */\nfunction h(){return "h"} function g(){return "g"}; export default <div/>;',
    after: '/** @jsx g */\nfunction h(){return "h"} function g(){return "g"}; export default <div/>;',
    reused: 0,
  },
  {
    name: "JSX 文本",
    ext: "tsx",
    before: "/** @jsx h */\nfunction h(){return 1} export default <div> a  b </div>;",
    after: "/** @jsx h */\nfunction h(){return 1} export default <div> a b </div>;",
    reused: 0,
  },
  {
    name: "JSX 引号属性",
    ext: "tsx",
    before: '/** @jsx h */\nfunction h(){return 1} export default <div title=" a  b "/>;',
    after: '/** @jsx h */\nfunction h(){return 1} export default <div title=" a b "/>;',
    reused: 0,
  },
  {
    name: "CJS HTML 注释",
    ext: "cjs",
    before: "<!-- before\nmodule.exports = 9;",
    after: "<!-- after\nmodule.exports = 9;",
    reused: 1,
  },
  {
    name: "普通行拆分",
    before: "export const x = 1; export const y = 2;",
    after: "export const x = 1;\nexport const y = 2;",
    reused: 0,
  },
];
// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent.each(lexicalCases)("源码沿用尊重 $name", async ({ name, ext = "ts", before, after, reused }) => {
  await runnerE2E.case(
    `source-lexical-${lexicalCases.findIndex((item) => item.name === name)}`,
    async ({ commands: { niceeval }, paths }) => {
      const path = join(paths.projectRoot, `evals/simple/identity-input.${ext}`);
      const entry = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
      writeFileSync(entry, `import "./identity-input.${ext}";\n` + readFileSync(entry, "utf8"));
      writeFileSync(path, before);
      const baseline = await niceeval.run(["exp", "carry", "simple/alpha", "--json"], { env: { JITI_JSX: "1" } });
      expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
      writeFileSync(path, after);
      const dry = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"], { env: { JITI_JSX: "1" } });
      expect(dry.exitCode, dry.diagnostic()).toBe(0);
      expect(decodeExpPlanDocument(dry.json())).toMatchObject({ reused });
    },
  );
});

const dependencyCases = [
  {
    name: "builtin",
    code: 'import assert from "node:assert"; import { existsSync } from "fs"; assert.ok(existsSync("."));',
    reused: 1,
  },
  { name: "static", code: 'import "./identity-dependency.ts";', reused: 0 },
  { name: "export-from", code: 'export { value } from "./identity-dependency.ts";', reused: 0 },
  { name: "export-all", code: 'export * from "./identity-dependency.ts";', reused: 0 },
  { name: "dynamic-literal", code: 'if (false) await import("./identity-dependency.ts");', reused: 0 },
  { name: "require", code: 'require("./identity-dependency.ts");', reused: 0 },
  { name: "module-require", code: 'module.require("./identity-dependency.ts");', reused: 0 },
  { name: "export-equals", code: 'export = require("./identity-dependency.ts");', reused: 0 },
  {
    name: "import-equals",
    code: 'import value = require("./identity-dependency.ts"); if (!value) throw new Error("missing dependency");',
    reused: 0,
  },
  {
    name: "mixed-type-value",
    code: 'import { type Value, value } from "./identity-dependency.ts"; export const kept = value;',
    reused: 0,
  },
  { name: "type-only", code: 'import type { Value } from "./identity-dependency.ts";', reused: 1 },
  { name: "type-item", code: 'import { type Value } from "./identity-dependency.ts";', reused: 1 },
  { name: "export-type-item", code: 'export { type Value } from "./identity-dependency.ts";', reused: 1 },
  { name: "export-type", code: 'export type { Value } from "./identity-dependency.ts";', reused: 1 },
  { name: "import-type-equals", code: 'import type value = require("./identity-dependency.ts");', reused: 1 },
  { name: "commented-import", code: '// import "./identity-dependency.ts";', reused: 1 },
  { name: "escaped-specifier", code: 'import "./identity-\\u0064ependency.ts";', reused: 0 },
  { name: "comment-separated-import", code: 'import /* note */ "./identity-dependency.ts";', reused: 0 },
  { name: "tsconfig-alias", code: 'import "@identity/identity-dependency";', reused: 0 },
  { name: "package-import", code: 'import "#identity";', reused: 0 },
  { name: "json", code: 'import "./identity-dependency.json";', reused: 0 },
  {
    name: "shadowed-require",
    code: 'function local(require: (x: string) => void){ require("./identity-dependency.ts"); } local(() => {});',
    reused: 1,
  },
];
// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent.each(dependencyCases)("源码沿用覆盖真实模块依赖 $name", async ({ name, code, reused }) => {
  await runnerE2E.case(`source-dependency-${name}`, async ({ commands: { niceeval }, paths }) => {
    const entry = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
    writeFileSync(entry, 'import "./identity-entry.ts";\n' + readFileSync(entry, "utf8"));
    writeFileSync(join(paths.projectRoot, "evals/simple/identity-entry.ts"), code);
    const dep = join(paths.projectRoot, "evals/simple/identity-dependency.ts");
    writeFileSync(dep, "export type Value = number; export const value = 1;");
    const json = join(paths.projectRoot, "evals/simple/identity-dependency.json");
    writeFileSync(json, '{"value":1}');
    if (name === "tsconfig-alias")
      writeFileSync(
        join(paths.projectRoot, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@identity/*": ["evals/simple/*"] } } }),
      );
    if (name === "package-import") {
      const path = join(paths.projectRoot, "package.json");
      const pkg = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(
        path,
        JSON.stringify({ ...pkg, imports: { "#identity": "./evals/simple/identity-dependency.ts" } }),
      );
    }
    const baseline = await niceeval.run(["exp", "carry", "simple/alpha", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    writeFileSync(dep, "export type Value = number; export const value = 2;");
    writeFileSync(json, '{ "value": 1 }');
    const dry = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(dry.json())).toMatchObject({ reused });
  });
});

const unresolvedCases = [
  { name: "import-expression", code: 'const name = "./identity-dependency.ts"; if (false) import(name);' },
  { name: "require-expression", code: 'const name = "./identity-dependency.ts"; require(name);' },
  { name: "module-require-expression", code: 'const name = "./identity-dependency.ts"; module.require(name);' },
  { name: "require-alias", code: 'const load = require; load("./identity-dependency.ts");' },
  {
    name: "create-require",
    code: 'import { createRequire as create } from "node:module"; const load = create(import.meta.url); load("./identity-dependency.ts");',
  },
];
// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent.each(unresolvedCases)("未确定模块依赖禁止沿用并定位 $name", async ({ name, code }) => {
  await runnerE2E.case(`source-unresolved-${name}`, async ({ commands: { niceeval }, paths }) => {
    const entry = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
    writeFileSync(entry, 'import "./identity-entry.ts";\n' + readFileSync(entry, "utf8"));
    writeFileSync(join(paths.projectRoot, "evals/simple/identity-entry.ts"), code);
    writeFileSync(join(paths.projectRoot, "evals/simple/identity-dependency.ts"), "export const value = 1;");
    const baseline = await niceeval.run(["exp", "carry", "simple/alpha", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const dry = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    const plan = decodeExpPlanDocument(dry.json());
    expect(plan.reused).toBe(0);
    expect(plan.matrix[0]!.slots).toMatchObject([{ state: "gap", reason: "dynamic-module-unresolved" }]);
    expect(JSON.stringify(plan)).toContain("evals/simple/identity-entry.ts");
    expect(JSON.stringify(plan)).toContain('"line":1');
    expect(JSON.stringify(plan)).toContain('"column":');
  });
});

// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent("条件 import 进入身份但不提前执行，Group 普通注释允许沿用", async () => {
  await runnerE2E.case("source-group-conditional", async ({ commands: { niceeval }, paths }) => {
    const entry = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
    const member =
      'import { defineEval } from "niceeval"; import { equals } from "niceeval/expect"; export default defineEval({ test(t) { t.check(1, equals(1)); } });\n';
    writeFileSync(entry, 'if (false) await import("./identity-side-effect.ts");\n' + member);
    writeFileSync(join(paths.projectRoot, "evals/simple/beta.eval.ts"), member);
    writeFileSync(
      join(paths.projectRoot, "experiments/carry.ts"),
      'import { defineExperiment } from "niceeval"; import { groupWaveAgent, groupWaveSandbox } from "../agents/group-wave-gap.ts"; export default defineExperiment({ adapter: groupWaveAgent, sandbox: groupWaveSandbox, evals: ["simple/"] });\n',
    );
    const dependency = join(paths.projectRoot, "evals/simple/identity-side-effect.ts");
    writeFileSync(dependency, 'throw new Error("CONDITIONAL_IMPORT_MUST_NOT_EXECUTE"); export const x = 1;');
    const group = join(paths.projectRoot, "evals/simple/eval-group.ts");
    const source =
      'import { defineEvalGroup } from "niceeval";\nimport alpha from "./alpha.eval.ts";\nimport beta from "./beta.eval.ts";\nexport default defineEvalGroup({ onUnavailable: "stop-group", evals: [alpha, beta] });\n';
    writeFileSync(group, source);
    const baseline = await niceeval.run(["exp", "carry", "--json"]);
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    writeFileSync(
      group,
      source.replace("evals: [alpha, beta]", "evals: [alpha, /* ordinary note */ beta]") + "// Group note\n",
    );
    const dry = await niceeval.run(["exp", "carry", "--dry", "--json"]);
    expect(dry.exitCode, dry.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(dry.json())).toMatchObject({ reused: 2 });
    writeFileSync(dependency, 'throw new Error("CONDITIONAL_IMPORT_MUST_NOT_EXECUTE"); export const x = 2;');
    const changed = await niceeval.run(["exp", "carry", "--dry", "--json"]);
    expect(changed.exitCode, changed.diagnostic()).toBe(0);
    expect(decodeExpPlanDocument(changed.json())).toMatchObject({ reused: 1 });
  });
});

// @use-case docs/feature/experiments/use-case/cache-niceeval-upgrade.md
test.concurrent("旧格式结果明确拒绝并提示重跑", async () => {
  await runnerE2E.case("source-legacy-domains", async ({ commands: { niceeval }, paths }) => {
    const imported = await niceeval.run([
      "run",
      "import",
      join(paths.projectRoot, "fixtures/legacy-agent-install/record.sqlite"),
      "--json",
    ]);
    expect(imported.exitCode).not.toBe(0);
    expect(imported.stdout + imported.stderr).toContain("older version of NiceEval");
    expect(imported.stdout + imported.stderr).toContain("Rerun");
  });
});

// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent("解析错误和替代 binding 环境在规划时具名失败", async () => {
  await runnerE2E.case("source-parser-errors", async ({ commands: { niceeval }, paths }) => {
    const entry = join(paths.projectRoot, "evals/simple/alpha.eval.ts");
    writeFileSync(entry, 'if (false) await import("./identity-broken.ts");\n' + readFileSync(entry, "utf8"));
    writeFileSync(join(paths.projectRoot, "evals/simple/identity-broken.ts"), "export const broken = ;");
    const broken = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"]);
    expect(broken.exitCode).not.toBe(0);
    expect(broken.stdout + broken.stderr).toContain("SourceParseError");
    expect(broken.stdout + broken.stderr).toContain("identity-broken.ts:1:");
    writeFileSync(join(paths.projectRoot, "evals/simple/identity-broken.ts"), "export const value = 1;");
    const binding = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"], {
      env: { NAPI_RS_FORCE_WASI: "0" },
    });
    expect(binding.exitCode).not.toBe(0);
    expect(binding.stdout + binding.stderr).toContain("SourceParserEnvironmentError");
    expect(binding.stdout + binding.stderr).toContain("NAPI_RS_FORCE_WASI");
    const preload = join(paths.projectRoot, "missing-parser-binding.cjs");
    writeFileSync(
      preload,
      `const Module = require("node:module"); const load = Module._load; Module._load = function(id, ...args) { if (id.startsWith("@oxc-parser/binding-")) { const error = new Error("native binding is absent"); error.code = "MODULE_NOT_FOUND"; throw error; } return load.call(this, id, ...args); };`,
    );
    const missing = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"], {
      env: { NODE_OPTIONS: `--require=${preload}` },
    });
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stdout + missing.stderr).toContain("SourceParserEnvironmentError");
    expect(missing.stdout + missing.stderr).toContain("@oxc-parser/binding-");
    writeFileSync(
      preload,
      `const Module = require("node:module"); const load = Module._load; Module._load = function(id, ...args) { if (id.startsWith("@oxc-parser/binding-") && id.endsWith("/package.json")) return { version: "0.0.0" }; return load.call(this, id, ...args); };`,
    );
    const mismatch = await niceeval.run(["exp", "carry", "simple/alpha", "--dry", "--json"], {
      env: { NODE_OPTIONS: `--require=${preload}` },
    });
    expect(mismatch.exitCode).not.toBe(0);
    expect(mismatch.stdout + mismatch.stderr).toContain("SourceParserEnvironmentError");
    expect(mismatch.stdout + mismatch.stderr).toContain("binding version 0.0.0");
  });
});
