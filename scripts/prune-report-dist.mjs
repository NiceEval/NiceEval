#!/usr/bin/env node
// build:report 编译 tsconfig.report-build.json 时,rootDir 必须是仓库的 "src"(见
// tsconfig.report-build.json 顶部注释),这会把 src/report/** 之外、仅供类型层触达的
// 旁支文件也一并编译进 dist/(比如 src/runner/types.ts 里一处内联 `import("./fingerprint.ts")`
// 类型查询,会把 fingerprint.ts 连带它牵出的 sandbox provider 实现一起拉进编译)。这些旁支
// tsc 不会删除上一次构建留下、源码已经移除的产物，因此 build:report 先以 --clean 清掉
// 整个专用 outDir；否则旧 .js / .d.ts 会继续混进 tarball。重新编译后，此脚本再删除运行时
// 不可达的旁支 .js。dist/report/**、dist/shared/**、dist/results/** 的部分产物在运行时 import 图里从未被
// 引用到——真正会被执行的只有 tsc 从 dist/report/**/*.js 出发、顺着相对 import 能走到的那些
// 文件。此脚本做可达性分析,删掉图外的 .js(不影响任何人),保留本次干净编译生成的全部
// .d.ts(类型层完整性,供下游消费方的 tsc 解析)。
//
// 只删 dist/ 下、dist/report/ 之外的死 .js;dist/report/** 本身永远保留。

import { readdirSync, statSync, readFileSync, unlinkSync, rmdirSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(repoRoot, "dist");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function importSpecifiers(source) {
  const specs = [];
  // `from "..."` (static import/export) 与 `import("...")` (动态 import)都要认,
  // 只关心相对路径("./" / "../")指向的 .js —— bare specifier(react、react-dom/...)
  // 不是 dist/ 内的文件,跳过。
  const re = /(?:from\s+|import\()\s*["'](\.[^"']+\.js)["']/g;
  let m;
  while ((m = re.exec(source))) specs.push(m[1]);
  return specs;
}

function main() {
  if (process.argv.includes("--clean")) {
    rmSync(distRoot, { recursive: true, force: true });
    console.log("prune-report-dist: removed the previous generated dist tree");
    return;
  }
  const allFiles = walk(distRoot);
  const allJs = new Set(allFiles.filter((f) => extname(f) === ".js"));

  const reportRoot = join(distRoot, "report");
  const seeds = [...allJs].filter((f) => f.startsWith(reportRoot + "/") || f === reportRoot);

  const reachable = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of importSpecifiers(src)) {
      const resolved = resolve(dirname(file), spec);
      if (allJs.has(resolved) && !reachable.has(resolved)) queue.push(resolved);
    }
  }

  const dead = [...allJs].filter((f) => !reachable.has(f));
  for (const f of dead) unlinkSync(f);

  // 删掉编译后空出来的目录(从叶子往上,目录非空就停)。
  const dirs = new Set(dead.map((f) => dirname(f)));
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    let cur = d;
    while (cur.startsWith(distRoot)) {
      try {
        if (readdirSync(cur).length === 0) {
          rmdirSync(cur);
          cur = dirname(cur);
          continue;
        }
      } catch {
        // 已被上一轮删掉,或从来不是目录
      }
      break;
    }
  }

  const keptJs = reachable.size;
  console.log(
    `prune-report-dist: kept ${keptJs} reachable .js file(s) under dist/report + its live deps, ` +
      `removed ${dead.length} unreachable .js file(s) (fresh declarations retained):`,
  );
  for (const f of dead.sort()) console.log(`  - ${relative(repoRoot, f)}`);
}

main();
