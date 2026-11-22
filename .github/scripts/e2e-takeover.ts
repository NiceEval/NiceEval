// CI transport around the existing Concord selectors and E2E takeover command.
// No packing, native test discovery, or product assertions happen here.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const readRevision = (root, revision, file) => {
  // Missing/deleted files are different from empty files. Other Git failures fail closed.
  const exists = spawnSync("git", ["cat-file", "-e", `${revision}:${file}`], { cwd: root, encoding: "utf8" });
  if (exists.status !== 0) return undefined;
  return git(root, ["show", `${revision}:${file}`]);
};
export function substantiveSource(file, source) {
  if (source === undefined) return undefined;
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(parsed);
  }
  if (file.endsWith(".json")) {
    try { return JSON.stringify(JSON.parse(source)); } catch { return source; }
  }
  return source;
}

export function selectTakeoverOwners({ root, base, head, plan, cases }) {
  const actualHead = git(root, ["rev-parse", "HEAD"]).trim();
  const resolvedHead = git(root, ["rev-parse", "--verify", `${head}^{commit}`]).trim();
  if (actualHead !== resolvedHead) throw Error("takeover selection head must match checkout HEAD");
  const resolvedBase = /^0{40}$/.test(base)
    ? git(root, ["hash-object", "-t", "tree", "--stdin"]).trim()
    : git(root, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  // PR uses its merge-base; push compares the exact before/after trees (also handles force pushes).
  const changed = git(root, ["diff", "--no-renames", "--name-only", "-z", resolvedBase, resolvedHead]).split("\0").filter(Boolean)
    .filter(file => substantiveSource(file, readRevision(root, resolvedBase, file)) !== substantiveSource(file, readRevision(root, resolvedHead, file)));
  const active = cases.filter(owner => owner.status === "active" && owner.file.startsWith("e2e/"));
  const ownerFiles = new Set(active.map(owner => owner.file));
  const cells = [];
  for (const cell of plan.cells) {
    const owners = [];
    for (let index = 0; index < cell.repoIds.length; index++) {
      const repo = cell.repoIds[index];
      const prefix = `e2e/${cell.dirs[index]}/`;
      const metadata = JSON.parse(readFileSync(join(root, prefix, "project.json"), "utf8")).targets.e2e.metadata.niceeval;
      if (metadata.requires?.externalNetwork === true) continue;
      const repoCases = active.filter(owner => owner.file.startsWith(prefix));
      const sharedChanged = changed.some(file => file.startsWith(prefix) && !ownerFiles.has(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
      for (const owner of repoCases) {
        if (!sharedChanged && !changed.includes(owner.file)) continue;
        if (!/^neref_[a-f0-9]{32}$/.test(owner.id)) throw Error("invalid Concord case id");
        owners.push({ repo, selector: `${owner.file}#${owner.id}` });
      }
    }
    if (owners.length) cells.push({ ...cell, owners: owners.sort((a, b) => a.selector.localeCompare(b.selector)) });
  }
  return { base: resolvedBase, head: resolvedHead, changedPaths: changed, cells };
}

export function runOwners({ plan, cellId, candidate, artifactRoot }) {
  const cell = plan.cells.find(cell => cell.id === cellId);
  if (!cell) throw Error(`unknown takeover cell: ${cellId}`);
  let failed = false;
  // One owner at a time per cell: each invocation owns its complete reliability matrix.
  for (const [index, owner] of cell.owners.entries()) {
    const destination = join(artifactRoot, String(index));
    mkdirSync(destination, { recursive: true });
    const result = spawnSync("pnpm", ["e2e", "takeover", "--candidate", candidate, "--repo", owner.repo, "--selector", owner.selector, "--artifact-root", destination], { stdio: "inherit" });
    if (result.signal || result.error) throw Error(`takeover process interrupted: ${result.signal ?? result.error.message}`);
    if (result.status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    base: { type: "string" }, head: { type: "string" }, plan: { type: "string" },
    run: { type: "boolean", default: false }, cell: { type: "string" },
    candidate: { type: "string" }, "artifact-root": { type: "string" },
  } });
  if (!values.plan) throw Error("--plan is required");
  const plan = JSON.parse(readFileSync(values.plan, "utf8"));
  if (values.run) {
    if (!values.cell || !values.candidate || !values["artifact-root"]) throw Error("--run requires --cell, --candidate and --artifact-root");
    process.exitCode = runOwners({ plan, cellId: values.cell, candidate: values.candidate, artifactRoot: values["artifact-root"] });
  } else {
    if (!values.base || !values.head) throw Error("selection requires --base and --head");
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const listed = JSON.parse(execFileSync("concord", ["--root", root, "--json", "test", "list"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
    if (listed.operation !== "test-list" || !Array.isArray(listed.cases)) throw Error("invalid Concord test list response");
    console.log(JSON.stringify(selectTakeoverOwners({ root, base: values.base, head: values.head, plan, cases: listed.cases })));
  }
}
