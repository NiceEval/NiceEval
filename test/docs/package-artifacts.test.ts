// cases: docs/engineering/testing/e2e/package.md（运行时入口、类型入口、安装与身份）
// 仓库级机器守护:打包产物形状与 release 同 tgz 链。
//
// 覆盖三类契约,全部只看结构/行为,不锁死 bundler、chunk 数量或输出目录名:
// 1. package.json exports 的每个 runtime 条件(import/require)都是
//    { types 首键, default 运行目标 } 分支对象,禁止顶层单 types 同时满足两面;
//    纯 asset string 目标允许。types 与运行目标都在 pnpm pack 清单内、不指向
//    .ts/.tsx/src 源码,require 分支运行目标以 .cjs 结尾;
// 2. Report 预编译面:输出目录由 exports ./report* 的 import/require default 与
//    asset string 目标推导(允许任意目录),运行目标进 tarball 且带 sourcemap,
//    运行文件相对引用不回 src/.ts、不逃出运行输出根;
// 3. release workflow:构建统一走 build:package、pack exactly once 且保存 sha256、
//    Package/CLI/Report preflight 与 npm publish 消费同一份 tgz、Node 18 原生脚本
//    smoke、不本地 npm publish、不预改 main 版本(tag 驱动)。
//
// 并发期 package.json 可能尚未切到目标形态,本守护会先红;runtime 落地后重跑即可,
// 不允许通过放宽断言适配旧包。

import { spawnSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");

// 相对导入 specifier:静态/动态 import、export from、require 的字面量参数。
const SPECIFIER_RE =
  /(?:from\s+|import\s*\(|import\s+|require\()\s*["'](\.[^"']+)["']/g;

function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(abs, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(abs);
  }
  return out;
}

function listTarballEntries(tgzPath: string): Promise<string[]> {
  return new Promise((resolveP, rejectP) => {
    const entries: string[] = [];
    const gunzip = createGunzip();
    const extractor = extract();
    extractor.on("entry", (header, stream, next) => {
      entries.push(header.name);
      stream.resume();
      stream.on("end", next);
    });
    extractor.on("finish", () => resolveP(entries));
    extractor.on("error", (error) => rejectP(error));
    createReadStream(tgzPath).pipe(gunzip).pipe(extractor);
  });
}

// pnpm pack 清单里的路径与 exports 目标同型:去掉 tarball 内 package/ 前缀与开头的 ./
function inPack(packed: Set<string>, target: string): boolean {
  return packed.has(target.replace(/^\.\//, ""));
}

const TS_SOURCE = /\.tsx?$/;
const UNDER_SRC = /(^|\/)src\//;

// exports 条件分支:顶层 import/require 各持 { types: 首键, default: 运行目标 }。
// 纯 string 分支是旧形态,仍能取出运行目标供报错与目录推导使用。
interface RuntimeBranch {
  types?: string;
  runtime?: string;
}

function branchOf(
  target: Record<string, unknown>,
  cond: "import" | "require",
): RuntimeBranch {
  const branch = target[cond];
  if (typeof branch === "string") return { runtime: branch };
  if (branch === null || typeof branch !== "object") return {};
  const rec = branch as Record<string, unknown>;
  return {
    types: typeof rec.types === "string" ? rec.types : undefined,
    runtime: typeof rec.default === "string" ? rec.default : undefined,
  };
}

// 一组导出目标的最长公共目录:Report 输出根与运行输出根都由它推导,不锁定目录名。
function commonRootOf(paths: string[]): string {
  if (paths.length === 0) return ROOT;
  const segments = paths.map((p) => dirname(p).replace(/^\.\//, "").split("/"));
  let depth = 0;
  while (
    depth < segments[0].length &&
    segments.every((segs) => segs[depth] === segments[0][depth])
  ) {
    depth += 1;
  }
  return join(ROOT, ...segments[0].slice(0, depth));
}

// 同 tgz 链归一化:`${{ expr }}` 剥壳成 `{{expr}}`、去包裹引号;`$VAR` 引用先按
// step env → run 内 `VAR=...` 局部赋值展开再归一化,各处引用可以逐字比对。
const EXPR_RE = /\$\{\{\s*([^}]+?)\s*\}\}/g;

function normalizeTgzRef(raw: string): string {
  return raw
    .replace(EXPR_RE, (_m, expr: string) => `{{${expr.trim()}}}`)
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

// run 文本里的单行 `VAR=...` 局部赋值(不做命令替换求值,只取字面量)。
function runLocalsOf(run: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of run.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    vars[m[1]] = value;
  }
  return vars;
}

// 收集步骤里出现的 tgz 引用(--candidate 与 npm publish 的参数);`$VAR` 按
// env → run 局部赋值展开。workflow 不需要为本守护采用特定写法。
function tgzRefsOf(
  steps: Array<{ env?: Record<string, unknown>; run?: string }>,
): string[] {
  const refs: string[] = [];
  for (const step of steps) {
    const run = step.run ?? "";
    if (run.length === 0) continue;
    const vars = { ...(step.env ?? {}), ...runLocalsOf(run) } as Record<
      string,
      string
    >;
    for (const match of run.matchAll(/(?:--candidate|\bnpm publish)\s+("[^"]*"|\S+)/g)) {
      let ref = match[1].replace(/^["']+|["']+$/g, "");
      const varRef = ref.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
      if (varRef && vars[varRef[1]] !== undefined) ref = vars[varRef[1]];
      refs.push(normalizeTgzRef(ref));
    }
  }
  return refs;
}

describe("package 打包产物与 release 同 tgz 链", () => {
  let packed: Set<string>;
  let pkg: { name: string; type?: string; exports?: unknown; scripts?: Record<string, string> };
  let workflow: {
    jobs?: Record<
      string,
      {
        steps?: Array<{
          uses?: string;
          with?: Record<string, unknown>;
          env?: Record<string, unknown>;
          run?: string;
        }>;
      }
    >;
  };

  const entries = (): Array<{ subpath: string; target: unknown }> =>
    Object.entries((pkg.exports ?? {}) as Record<string, unknown>).map(
      ([subpath, target]) => ({ subpath, target }),
    );

  beforeAll(async () => {
    pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const tmp = mkdtempSync(join(tmpdir(), "niceeval-pack-guard-"));
    try {
      const pack = spawnSync("pnpm", ["pack", "--pack-destination", tmp], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 600_000,
      });
      if (pack.status !== 0) {
        throw new Error(
          `pnpm pack failed (exit ${pack.status}):\n${pack.stdout}\n${pack.stderr}`,
        );
      }
      const tgz = readdirSync(tmp).find((name) => name.endsWith(".tgz"));
      if (!tgz) throw new Error(`pnpm pack produced no .tgz in ${tmp}`);
      const entries = await listTarballEntries(join(tmp, tgz));
      packed = new Set(
        entries
          .map((name) => name.replace(/^package\//, ""))
          .filter((name) => name.length > 0),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    workflow = parseYaml(
      readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8"),
    );
  }, 600_000);

  afterAll(() => {
    // 无资源句柄;pack 的 prepare 会重建 dist/,属 gitignore 生成物,不动工作树。
  });

  describe("exports 面向打包产物,不指向 TypeScript 源码", () => {
    it("根入口与每个条件对象都同时带 import/require 分支", () => {
      const subpaths = entries().map((e) => e.subpath);
      expect(subpaths).toContain(".");
      for (const { subpath, target } of entries()) {
        if (target === null || typeof target !== "object") continue;
        const t = target as Record<string, unknown>;
        expect(Boolean(t.import), `${subpath} 缺 import 分支`).toBe(
          Boolean(t.require),
        );
      }
    });

    it("import/require 分支是 { types 首键, default 运行目标 },禁止顶层单 types 两面共用;纯 asset string 允许", () => {
      const failures: string[] = [];
      for (const { subpath, target } of entries()) {
        if (typeof target === "string") continue;
        if (target === null || typeof target !== "object") continue;
        const t = target as Record<string, unknown>;
        if (typeof t.types === "string") {
          failures.push(`${subpath} 顶层单 types 同时满足两面: ${t.types}`);
        }
        for (const cond of ["import", "require"] as const) {
          const branch = t[cond];
          if (branch === null || typeof branch !== "object") {
            failures.push(`${subpath} ${cond} 分支不是 { types, default } 对象`);
            continue;
          }
          const rec = branch as Record<string, unknown>;
          const keys = Object.keys(rec);
          if (keys[0] !== "types") {
            failures.push(`${subpath} ${cond} 分支 types 不是第一键: ${keys.join(", ")}`);
          }
          if (typeof rec.types !== "string") {
            failures.push(`${subpath} ${cond} 分支缺 types`);
          }
          if (typeof rec.default !== "string") {
            failures.push(`${subpath} ${cond} 分支缺 default 运行目标`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it("import 分支 types 为 .d.mts、require 分支 types 为 .d.cts;types 与运行目标都在 pack 清单且不指向源码", () => {
      const failures: string[] = [];
      let hasMts = false;
      let hasCts = false;
      for (const { subpath, target } of entries()) {
        if (typeof target === "string") {
          if (TS_SOURCE.test(target)) {
            failures.push(`${subpath} asset 指向 .ts/.tsx: ${target}`);
          } else if (!inPack(packed, target)) {
            failures.push(`${subpath} asset 不在 pack 清单: ${target}`);
          }
          continue;
        }
        if (target === null || typeof target !== "object") continue;
        const t = target as Record<string, unknown>;
        for (const [cond, expectExt] of [
          ["import", ".d.mts"],
          ["require", ".d.cts"],
        ] as const) {
          const { types, runtime } = branchOf(t, cond);
          if (typeof runtime === "string") {
            if (TS_SOURCE.test(runtime) || UNDER_SRC.test(runtime)) {
              failures.push(`${subpath} ${cond} 运行目标指向源码: ${runtime}`);
            } else if (!inPack(packed, runtime)) {
              failures.push(`${subpath} ${cond} 运行目标不在 pack 清单: ${runtime}`);
            }
          }
          if (typeof types === "string") {
            if (types.endsWith(".d.mts")) hasMts = true;
            if (types.endsWith(".d.cts")) hasCts = true;
            if (!types.endsWith(expectExt)) {
              failures.push(`${subpath} ${cond} types 不是 ${expectExt}: ${types}`);
            }
            if (TS_SOURCE.test(types) || UNDER_SRC.test(types)) {
              failures.push(`${subpath} ${cond} types 指向源码: ${types}`);
            } else if (!inPack(packed, types)) {
              failures.push(`${subpath} ${cond} types 不在 pack 清单: ${types}`);
            }
          }
        }
      }
      expect(hasMts, "没有任何 .d.mts 声明进入 tarball").toBe(true);
      expect(hasCts, "没有任何 .d.cts 声明进入 tarball").toBe(true);
      expect(failures).toEqual([]);
    });

    it("type:module 包中 require 运行目标以 .cjs 结尾(RAW Node 可 require,含 Node 18)", () => {
      expect(pkg.type).toBe("module");
      const failures: string[] = [];
      for (const { subpath, target } of entries()) {
        if (target === null || typeof target !== "object") continue;
        const runtime = branchOf(target as Record<string, unknown>, "require")
          .runtime;
        if (typeof runtime === "string" && !runtime.endsWith(".cjs")) {
          failures.push(`${subpath} require=${runtime} 不是 .cjs`);
        }
      }
      expect(failures).toEqual([]);
    });
  });

  describe("Report 预编译面:输出目录由 exports ./report* 推导", () => {
    const reportEntries = (): Array<{ subpath: string; target: unknown }> =>
      entries().filter(
        (e) => e.subpath === "./report" || e.subpath.startsWith("./report/"),
      );

    const reportRuntimeTargets = (): string[] => {
      const targets: string[] = [];
      for (const { target } of reportEntries()) {
        if (target === null || typeof target !== "object") continue;
        for (const cond of ["import", "require"] as const) {
          const runtime = branchOf(target as Record<string, unknown>, cond).runtime;
          if (typeof runtime === "string") targets.push(runtime);
        }
      }
      return targets;
    };

    const reportAssetTargets = (): string[] =>
      reportEntries()
        .map((e) => e.target)
        .filter((t): t is string => typeof t === "string");

    const allRuntimeTargets = (): string[] => {
      const targets: string[] = [];
      for (const { target } of entries()) {
        if (target === null || typeof target !== "object") continue;
        for (const cond of ["import", "require"] as const) {
          const runtime = branchOf(target as Record<string, unknown>, cond).runtime;
          if (typeof runtime === "string") targets.push(runtime);
        }
      }
      return targets;
    };

    it("report* 导出目标(运行 default 与 asset string)都在 pack 清单,运行目标带 sourcemap", () => {
      expect(reportEntries().length, "package.json 缺 ./report* 公开入口").toBeGreaterThan(
        0,
      );
      const failures: string[] = [];
      for (const target of reportRuntimeTargets()) {
        if (!inPack(packed, target)) {
          failures.push(`运行目标不在 pack 清单: ${target}`);
        } else if (!inPack(packed, `${target}.map`)) {
          failures.push(`运行目标缺 sourcemap: ${target}.map`);
        }
      }
      for (const target of reportAssetTargets()) {
        if (!inPack(packed, target)) {
          failures.push(`asset 不在 pack 清单: ${target}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("Report 运行文件相对引用不回 src/、不指向 .ts/.tsx、不逃出运行输出根,且目标存在", () => {
      const runTargets = reportRuntimeTargets();
      expect(runTargets.length, "./report* 没有 import/require 运行目标").toBeGreaterThan(0);
      const walkRoot = commonRootOf(runTargets);
      const escapeRoot = commonRootOf(allRuntimeTargets());
      if (!existsSync(walkRoot)) {
        throw new Error(
          `Report 输出根 ${relative(ROOT, walkRoot)} 不存在——请先运行 pnpm run build:package 或 prepare`,
        );
      }
      const violations: string[] = [];
      for (const file of walkFiles(walkRoot, [".js", ".mjs", ".cjs"])) {
        const source = readFileSync(file, "utf8");
        const rel = relative(ROOT, file);
        for (const match of source.matchAll(SPECIFIER_RE)) {
          const spec = match[1];
          const abs = resolve(dirname(file), spec);
          if (extname(abs) === ".ts" || extname(abs) === ".tsx") {
            violations.push(`${rel} → ${spec} 引用 TypeScript 源码`);
          } else if (abs.startsWith(join(ROOT, "src") + sep)) {
            violations.push(`${rel} → ${spec} 跨图回 src/`);
          } else if (abs !== escapeRoot && !abs.startsWith(escapeRoot + sep)) {
            violations.push(
              `${rel} → ${spec} 逃出运行输出根 ${relative(ROOT, escapeRoot)}`,
            );
          } else if (!existsSync(abs)) {
            violations.push(`${rel} → ${spec} 目标文件不存在`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("release workflow:pack-once / digest / 同 tgz 链", () => {
    const publishSteps = (): Array<{
      uses?: string;
      with?: Record<string, unknown>;
      env?: Record<string, unknown>;
      run?: string;
    }> => workflow.jobs?.["publish"]?.steps ?? [];

    const publishRuns = (): string[] =>
      publishSteps()
        .map((step) => step.run ?? "")
        .filter((run) => run.length > 0);

    it("构建统一调用 pnpm run build:package", () => {
      expect(
        publishRuns().some((run) => /\bpnpm run build:package\b/.test(run)),
      ).toBe(true);
    });

    it("package.json 声明统一构建入口 build:package", () => {
      expect(typeof pkg.scripts?.["build:package"]).toBe("string");
      expect(pkg.scripts?.["build:package"]?.length ?? 0).toBeGreaterThan(0);
    });

    it("pack exactly once,且保存 sha256", () => {
      const packRuns = publishRuns().filter(
        (run) => /\bpnpm e2e pack --out\b/.test(run) || /\bpnpm pack\b/.test(run),
      );
      expect(packRuns).toHaveLength(1);
      expect(packRuns[0]).toMatch(/sha256/);
    });

    it("Package/CLI/Report preflight 安装同一 tgz", () => {
      const preflightSteps = publishSteps().filter((s) =>
        /\bpnpm e2e run\b/.test(s.run ?? ""),
      );
      const preflightRuns = preflightSteps.map((s) => s.run ?? "");
      expect(preflightRuns.length).toBeGreaterThan(0);
      // 支持的两种形态:字面 `--repo <id>`,或 `for repo in package cli report`
      // 循环里以变量传入。循环列表从 run 文本机械提取,不锁死写法。
      const reposOf = (run: string): string[] => {
        const literal = [...run.matchAll(/--repo\s+(\S+)/g)].map((m) => m[1]);
        const loop = run.match(/for repo in ([^;\n]+)/);
        return [...literal, ...(loop ? loop[1].split(/\s+/).filter(Boolean) : [])];
      };
      const covered = new Set(preflightRuns.flatMap(reposOf));
      for (const repo of ["package", "cli", "report"]) {
        expect(covered.has(repo), `preflight 缺少 --repo ${repo}`).toBe(true);
      }
      // preflight 的候选 tgz 引用经归一化后存在即可;与 publish 的同一性在下一
      // 个用例里由归一化 helper 统一比对。
      expect(tgzRefsOf(preflightSteps).length).toBeGreaterThan(0);
    });

    it("npm publish 发布与 preflight 同一份 tgz,发布前核对 digest,不重新 pack", () => {
      const runs = publishRuns();
      const steps = publishSteps();
      const preflightRefs = tgzRefsOf(
        steps.filter((s) => /\bpnpm e2e run\b/.test(s.run ?? "")),
      );
      const publishRunTexts = runs.filter((run) => /\bnpm publish\b/.test(run));
      expect(publishRunTexts).toHaveLength(1);
      const publishRefs = tgzRefsOf(
        steps.filter((s) => /\bnpm publish\b/.test(s.run ?? "")),
      );
      expect(publishRefs).toHaveLength(1);
      // preflight 的 --candidate 与 npm publish 的参数(可能经 env CANDIDATE 或
      // run 内局部变量传入)统一归一化后必须指向同一表达式。
      const allTgzRefs = new Set([...preflightRefs, ...publishRefs]);
      expect(allTgzRefs.size, "preflight 与 publish 必须引用同一份 tgz").toBe(1);
      expect(
        publishRunTexts.some(
          (run) => /sha256sum/.test(run) && /\bnpm publish\b/.test(run),
        ),
        "publish 前必须重算 sha256 与记录比对",
      ).toBe(true);
      expect(
        runs.some((run) => /\bpnpm publish\b/.test(run)),
        "禁止 pnpm publish(prepare 会重建工作目录,切断同 tgz 链)",
      ).toBe(false);
    });

    it("Node 18 与 release Node 各跑一次原生脚本 smoke,不用 tsx 包装", () => {
      const steps = publishSteps();
      const node18 = steps.find(
        (step) =>
          step.uses === "actions/setup-node@v4" &&
          String(step.with?.["node-version"] ?? step.with?.nodeVersion) === "18",
      );
      expect(node18, "缺少 Node 18 setup 步骤").toBeTruthy();
      const smokeRuns = publishRuns().filter((run) => /smoke/i.test(run));
      expect(smokeRuns.length).toBeGreaterThanOrEqual(2);
      for (const run of smokeRuns) {
        expect(run, "smoke 必须用 raw node 执行").toMatch(/\bnode \S*smoke\.mjs/);
        expect(run, "smoke 不得经 tsx 包装").not.toMatch(/\btsx\b/);
      }
    });

    it("保持 tag 驱动:版本只本地写入(--no-git-tag-version),不提交/push,不本地 npm publish", () => {
      const runs = publishRuns();
      expect(
        runs.some((run) => /\bnpm version\b/.test(run) && /--no-git-tag-version/.test(run)),
      ).toBe(true);
      expect(
        runs.some((run) => /\bgit (commit|push)\b/.test(run)),
        "release 不得把版本变更提交/push 回 main",
      ).toBe(false);
      expect(
        runs.some((run) => /npm publish\s*$/.test(run)),
        "不允许无 tgz 参数的裸 npm publish",
      ).toBe(false);
    });
  });
});
