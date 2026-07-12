// examples/zh 下 origin → tier1 → tier2 → tier3 目录链的同步工具。
//
// 用法：
//   pnpm tiers:sync [name]   —— 把 baseTree 到上游最新之间的变更重放进 tier（"tier rebase 上游"）;
//                               name 匹配 to 目录的 basename,会带上该应用整条链
//   pnpm tiers:check         —— 只读检查：baseTree 是否落后、冲突标记、verbatim 铁律
//
// 设计与实现细节见 docs/engineering/example-tier-sync/README.md。合并机制 100% 由 `git merge-tree --write-tree`
// 提供（需要 git ≥ 2.38），本脚本只做状态文件读写、检出、冲突上报和 lockfile 重装的粘合。
//
// 三个关键设计（docs/engineering/example-tier-sync/README.md「如何实现」有完整推导）：
// · lockfile 不进合并：pnpm-lock.yaml 完全由各 tier 自己的 `pnpm install` 生成,合并它
//   只会制造假冲突、并让链式 baseTree 永远对不上——所以三棵输入树都先剥掉 lockfile
//   再合并,baseTree 记的也是剥掉之后的 tree。
// · 冲突收尾走 pending 状态：同 base 重放会把已解决的冲突再报一遍(三方合并的固有行为,
//   不是 bug),所以冲突时把"这次要合到哪"记进 pair.pending,人解完标记、提交后重跑
//   tiers:sync 直接收尾,不再重新合并。
// · 链式同步不要求中途提交：上一对的合并结果树(已在 git 对象库里)直接作为下一对的
//   上游输入,一条命令跑完整条链,最后一起 review、一起提交。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(ROOT, "examples/zh/.tier-sync.json");
const DIFFS_DIR = join(ROOT, "examples/zh/diffs");
const LOCKFILE = "pnpm-lock.yaml";

// verbatim 契约(origin → tier1)下允许两侧不同的文件:三个集成脚手架 + 机器产物 lockfile
// + .env.example(tier 侧会追加 judge 独立凭证等 eval 侧变量)。其余同名文件必须逐字节一致。
const VERBATIM_ALLOWED = new Set(["package.json", "tsconfig.json", "pnpm-workspace.yaml", LOCKFILE, ".env.example"]);

function git(args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
    ...opts,
  });
  if (result.error) throw result.error;
  return result;
}

function gitOk(args, opts = {}) {
  const result = git(args, opts);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function loadState() {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function isClean(paths) {
  const out = gitOk(["status", "--porcelain", "--", ...paths]);
  // lockfile 不参与合并与比对(见文件头),它的未提交改动(往往是本脚本刚跑的
  // pnpm install 产生的)不算脏。
  return out
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.endsWith(`/${LOCKFILE}`))
    .length === 0;
}

/** 剥掉顶层 pnpm-lock.yaml 后的 tree(lockfile 由各 tier 的 pnpm install 生成,不参与合并与比对) */
function stripLockfile(treeOid) {
  const entries = gitOk(["ls-tree", treeOid])
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.endsWith(`\t${LOCKFILE}`));
  return gitOk(["mktree"], { input: entries.join("\n") + (entries.length ? "\n" : "") });
}

/** HEAD 上某目录的 tree(剥 lockfile 后),目录不存在时报清晰错误 */
function headTree(dir) {
  const result = git(["rev-parse", `HEAD:${dir}`]);
  if (result.status !== 0) {
    throw new Error(`HEAD 上不存在 ${dir}(还没提交?)。同步的输入都取自提交过的 tree,先提交它再跑。`);
  }
  return stripLockfile(result.stdout.trim());
}

/** 对两棵 tree 做 base 合并，返回 { treeOid, conflicts, clean } */
function mergeTree(baseTree, tierTree, upstreamTree) {
  const result = git([
    "merge-tree",
    "--write-tree",
    "--name-only",
    `--merge-base=${baseTree}`,
    tierTree,
    upstreamTree,
  ]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git merge-tree failed unexpectedly:\n${result.stderr}`);
  }
  const lines = result.stdout.split("\n");
  const treeOid = lines[0];
  const clean = result.status === 0;
  let conflicts = [];
  if (!clean) {
    const blankIdx = lines.indexOf("", 1);
    conflicts = lines.slice(1, blankIdx === -1 ? undefined : blankIdx).filter(Boolean);
  }
  return { treeOid, conflicts, clean };
}

function checkoutTree(treeOid, destDir) {
  const archive = git(["archive", treeOid], { encoding: "buffer" });
  if (archive.status !== 0) {
    throw new Error(`git archive failed:\n${archive.stderr}`);
  }
  const tar = spawnSync("tar", ["-x", "-C", destDir], { input: archive.stdout });
  if (tar.status !== 0) {
    throw new Error(`tar extract failed:\n${tar.stderr}`);
  }
}

/** 把合并里被删除的文件从工作树清掉,并返回全部变动路径(rename 视为删+增,与合并语义一致) */
function removeDeletedFiles(oldTierTree, newTreeOid, destDir) {
  const status = gitOk(["diff", "--no-renames", "--name-status", oldTierTree, newTreeOid]);
  const changed = [];
  for (const line of status.split("\n").filter(Boolean)) {
    const [code, path] = line.split("\t");
    changed.push(path);
    if (code === "D" && path !== LOCKFILE) {
      rmSync(join(destDir, path), { force: true });
    }
  }
  return changed;
}

function runInstall(name, destDir) {
  console.log(`[install] ${name}: package.json / pnpm-workspace.yaml 有变化，重跑 pnpm install`);
  const install = spawnSync("pnpm", ["install"], { cwd: destDir, stdio: "inherit" });
  if (install.status !== 0) {
    throw new Error(`${name}: pnpm install 失败`);
  }
}

// patch 阅读件按 "层级-应用名" 命名(tier1-codex-sdk.patch),同一应用的多层不撞名。
function patchName(to) {
  return to.split("/").slice(-2).join("-");
}

function exportPatch(to, upstreamTree, tierTree) {
  mkdirSync(DIFFS_DIR, { recursive: true });
  const patch = gitOk(["diff", upstreamTree, tierTree]);
  writeFileSync(join(DIFFS_DIR, `${patchName(to)}.patch`), patch ? patch + "\n" : "");
}

/** tier 的已提交 tree 里是否还有未解决的冲突标记 */
function treeHasConflictMarkers(treeOid) {
  const grep = git(["grep", "-l", "<<<<<<<", treeOid]);
  return grep.status === 0 && grep.stdout.trim().length > 0;
}

/**
 * 同步一对目录。upstreamTree 已剥 lockfile;返回:
 *   { status: "up-to-date" | "synced", tree }  —— tree 是 to 目录同步后的(剥 lockfile)tree
 *   { status: "conflict" }                     —— 工作树已留标记,pending 已记录
 */
function syncPair(pair, state, upstreamTree, upstreamDirty) {
  const { from, to } = pair;
  const name = basename(to);
  const destDir = join(ROOT, to);

  // 合并的输入取自提交过的 tree,同步才可复现;上游的"脏"若是本次链式同步自己写的
  // (upstreamDirty),它的合并结果树已经拿在手里,不受工作树影响,可以放行。
  const mustBeClean = upstreamDirty ? [to] : [from, to];
  if (!isClean(mustBeClean)) {
    throw new Error(`${name}: ${mustBeClean.join(" 或 ")} 有未提交改动，先提交或还原再同步`);
  }

  let tierTree = headTree(to);

  // 冲突收尾:上一轮 sync 报了冲突,人解完标记、提交之后走到这里。同 base 重放会把
  // 同一处冲突再报一遍(三方合并的固有行为),所以不重新合并——确认标记已清,直接把
  // baseTree 推进到当时要合的上游 tree,补上 install / patch 收尾。
  if (pair.pending) {
    if (treeHasConflictMarkers(tierTree)) {
      console.error(`[conflict] ${name}: ${to} 里仍有未解决的 <<<<<<< 标记,解完、提交后重跑 pnpm tiers:sync`);
      return { status: "conflict" };
    }
    const { upstreamTree: pendingUpstream, needsInstall } = pair.pending;
    if (needsInstall) runInstall(name, destDir);
    exportPatch(to, pendingUpstream, tierTree);
    pair.baseTree = pendingUpstream;
    delete pair.pending;
    saveState(state);
    console.log(`[resolved] ${name}: 冲突已解,baseTree -> ${pendingUpstream}`);
    // 不 return:收尾之后上游可能又前进了,继续走正常合并把余量追平。
    tierTree = headTree(to);
  }

  if (upstreamTree === pair.baseTree) {
    console.log(`[skip] ${name}: 上游未变化，已是最新`);
    return { status: "up-to-date", tree: tierTree };
  }

  const { treeOid, conflicts, clean } = mergeTree(pair.baseTree, tierTree, upstreamTree);

  checkoutTree(treeOid, destDir);
  const changed = removeDeletedFiles(tierTree, treeOid, destDir);
  const needsInstall = changed.some((f) => f === "package.json" || f === "pnpm-workspace.yaml");

  if (!clean) {
    console.error(`[conflict] ${name}: 以下文件有冲突，已在 ${to} 留下 <<<<<<< 标记`);
    for (const file of conflicts) console.error(`  - ${to}/${file}`);
    console.error(`  解完标记后提交,再跑一次 pnpm tiers:sync 收尾(不会重报这次冲突)。`);
    pair.pending = { upstreamTree, needsInstall };
    saveState(state);
    return { status: "conflict", conflicts };
  }

  if (needsInstall) runInstall(name, destDir);
  exportPatch(to, upstreamTree, treeOid);

  pair.baseTree = upstreamTree;
  saveState(state);
  console.log(`[synced] ${name}: baseTree -> ${upstreamTree}`);
  return { status: "synced", tree: treeOid };
}

/** 按链拓扑排序:某对的 from 是另一对的 to 时,排在它后面。环视为配置错误。 */
function topoSort(pairs) {
  const byTo = new Map(pairs.map((p) => [p.to, p]));
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (pair) => {
    if (visited.has(pair.to)) return;
    if (visiting.has(pair.to)) {
      throw new Error(`.tier-sync.json 里的 pairs 成环: ${pair.to}`);
    }
    visiting.add(pair.to);
    const upstreamPair = byTo.get(pair.from);
    if (upstreamPair) visit(upstreamPair);
    visiting.delete(pair.to);
    visited.add(pair.to);
    sorted.push(pair);
  };
  for (const pair of pairs) visit(pair);
  return sorted;
}

function runSync(nameFilter) {
  const state = loadState();
  let pairs = topoSort(state.pairs);
  if (nameFilter) {
    // 按应用名过滤:同名应用的整条链(tier1/x、tier2/x、tier3/x)一起同步。
    pairs = pairs.filter((p) => basename(p.to) === nameFilter);
    if (pairs.length === 0) {
      console.error(`未找到名为 ${nameFilter} 的 tier pair`);
      process.exit(1);
    }
  }

  // 链式:同步过的目录,其合并结果树直接作为下游的上游输入(不要求中途提交);
  // 冲突的目录标记为 blocked,下游整条跳过。
  const effective = new Map(); // dir -> treeOid(剥 lockfile)或 "blocked"
  let hadConflict = false;
  for (const pair of pairs) {
    const name = basename(pair.to);
    if (effective.get(pair.from) === "blocked") {
      console.error(`[skip] ${name}: 上游 ${pair.from} 本次有冲突未解决,先解完上游再同步这里`);
      hadConflict = true;
      continue;
    }
    const chained = effective.has(pair.from);
    const upstreamTree = chained ? effective.get(pair.from) : headTree(pair.from);
    const result = syncPair(pair, state, upstreamTree, chained);
    if (result.status === "conflict") {
      hadConflict = true;
      effective.set(pair.to, "blocked");
    } else if (result.status === "synced") {
      effective.set(pair.to, result.tree);
    }
    // up-to-date 不进 effective:HEAD 上的内容就是最新,下游直接读 HEAD 即可。
  }
  if (hadConflict) process.exit(1);
}

/** verbatim 契约检查:两侧都存在的同名文件必须逐字节一致(VERBATIM_ALLOWED 例外);
 *  上游有而 tier 没有的文件也算漂移(副本必须完整)。返回违规文件列表。 */
function verbatimViolations(fromDir, toDir) {
  const fromTree = gitOk(["rev-parse", `HEAD:${fromDir}`]);
  const toTree = gitOk(["rev-parse", `HEAD:${toDir}`]);
  const status = gitOk(["diff", "--no-renames", "--name-status", fromTree, toTree]);
  const violations = [];
  for (const line of status.split("\n").filter(Boolean)) {
    const [code, path] = line.split("\t");
    if (VERBATIM_ALLOWED.has(path)) continue;
    // A = 只在 tier 侧(tier 私有新增,允许);M = 两侧都有但内容不同;D = 上游有 tier 没有。
    if (code === "M") violations.push(`${path}(与上游内容不同)`);
    if (code === "D") violations.push(`${path}(上游有,tier 侧缺失)`);
  }
  return violations;
}

function runCheck() {
  const state = loadState();
  let ok = true;
  for (const pair of topoSort(state.pairs)) {
    const currentUpstreamTree = headTree(pair.from);
    if (pair.pending) {
      console.error(
        `✗ ${pair.to} 有一次未收尾的冲突同步\n  解完 <<<<<<< 标记、提交后运行 pnpm tiers:sync 收尾`,
      );
      ok = false;
    } else if (currentUpstreamTree !== pair.baseTree) {
      console.error(
        `✗ ${pair.to} 落后于 ${pair.from}\n  base ${pair.baseTree.slice(0, 8)}… ≠ 当前 ${currentUpstreamTree.slice(0, 8)}…，运行 pnpm tiers:sync 后重新提交`,
      );
      ok = false;
    }

    const grep = git(["grep", "-l", "<<<<<<<", "--", pair.to]);
    if (grep.status === 0 && grep.stdout.trim()) {
      console.error(`✗ ${pair.to} 中存在未解决的冲突标记:\n${grep.stdout}`);
      ok = false;
    }

    if (pair.contract === "verbatim") {
      const violations = verbatimViolations(pair.from, pair.to);
      if (violations.length > 0) {
        console.error(`✗ ${pair.to} 违反 verbatim 契约(副本必须与 ${pair.from} 逐字节一致):`);
        for (const v of violations) console.error(`  - ${v}`);
        ok = false;
      }
    }
  }
  if (ok) console.log("✓ 所有 tier pair 均已同步，无冲突标记,verbatim 契约完好");
  process.exit(ok ? 0 : 1);
}

const [, , cmd, arg] = process.argv;
try {
  if (cmd === "sync") {
    runSync(arg);
  } else if (cmd === "check") {
    runCheck();
  } else {
    console.error("用法: node scripts/sync-tiers.mjs <sync|check> [name]");
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
