// SkillSpec 的安装实现 —— 三个内置沙箱型 adapter(claude-code / codex / bub)共用的那一半:
// 「从哪里取得哪份 Skill」(本地目录/文件、repo + ref + 选择集)。另一半——装到哪个目录、
// 要不要额外写发现指引——留在各 adapter 里,由它们传 `dir` 并自己写 project instruction。
// 定稿见 docs/feature/adapters/architecture/coding-agent-extensions.md。
//
// 为什么不调 `npx skills add`:那个 installer 没有钉 ref 的入口,也没有机器可读的「这个 repo
// 里有哪些 skill」输出(-l 只打人看的带 ANSI 的清单),而契约要求「来源必须可复现」(钉 ref)
// 与「多 Skill Repo 必须明确选择启用集合」(选不中要报出可选集)。所以 repo skill 走 git:
// clone → 枚举 SKILL.md → 按规则选 → 拷进 agent 的 skill 目录。顺带绕开了 memory 里
// npx-skills-add-headless-hang 那个交互式选择框(无 tty 卡死)的整类问题。

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { shellQuote as q } from "../sandbox/shell.ts";
import { t } from "../i18n/index.ts";
import type { AgentSetupSkill, Sandbox, SkillSpec } from "../types.ts";

/** 沙箱里放临时 clone 的地方(装完即删;不在 workdir 下,不进 diff)。 */
const CLONE_ROOT = "/tmp/niceeval-git";

export interface InstallSkillsOptions {
  /** 沙箱里的 Skill 安装根目录(相对 workdir):claude-code 用 `.claude/skills`,codex/bub 用 `.agents/skills`。 */
  dir: string;
  /** 本地 Skill 的解析根;省略用跑 niceeval 的项目根(process.cwd())。 */
  projectRoot?: string;
}

/**
 * 按配置顺序把 SkillSpec 装进沙箱,返回 manifest 里的 Skill 记录(与配置顺序一一对应)。
 * 同名 Skill 来自多个来源时后装的覆盖磁盘、manifest 保留每一条(不静默合并)。
 * 任何一条装不上(路径不存在 / 形状不支持 / clone 或 ref 解析失败 / 选择集不合法)直接抛错 ——
 * setup 失败即 attempt errored,不伪装成断言失败。
 */
export async function installSkills(
  sandbox: Sandbox,
  specs: readonly SkillSpec[],
  opts: InstallSkillsOptions,
): Promise<AgentSetupSkill[]> {
  const out: AgentSetupSkill[] = [];
  for (const spec of specs) {
    out.push(
      spec.kind === "local"
        ? await installLocalSkill(sandbox, spec, opts)
        : await installRepoSkill(sandbox, spec, opts),
    );
  }
  if (out.length) await excludeFromDiff(sandbox, [`${opts.dir}/`]);
  return out;
}

// ───────────────────────── 本地 Skill ─────────────────────────

async function installLocalSkill(
  sandbox: Sandbox,
  spec: Extract<SkillSpec, { kind: "local" }>,
  opts: InstallSkillsOptions,
): Promise<AgentSetupSkill> {
  const root = opts.projectRoot ?? process.cwd();
  const abs = resolve(root, spec.path);
  const info = await stat(abs).catch(() => undefined);
  if (!info) throw new Error(t("skill.localMissing", { path: spec.path, resolved: abs }));

  if (info.isDirectory()) {
    const files = await readDirFiles(abs);
    if (!files.some((f) => f.path === "SKILL.md")) {
      throw new Error(t("skill.localDirNoSkillFile", { path: spec.path }));
    }
    const name = spec.name ?? basename(abs);
    const sha256 = hashFiles(files);
    await sandbox.uploadDirectory(abs, posix.join(opts.dir, name));
    return { kind: "local", name, path: spec.path, sha256 };
  }

  if (!info.isFile() || extname(abs).toLowerCase() !== ".md") {
    throw new Error(t("skill.localUnsupportedShape", { path: spec.path }));
  }
  const content = await readFile(abs, "utf-8");
  const name = spec.name ?? localFileSkillName(abs);
  await sandbox.writeText(posix.join(opts.dir, name, "SKILL.md"), content);
  return { kind: "local", name, path: spec.path, sha256: hashFiles([{ path: "SKILL.md", content }]) };
}

/** `skills/effect-ts/SKILL.md` → `effect-ts`(SKILL.md 的名字不含信息,取所在目录);`skills/guide.md` → `guide`。 */
export function localFileSkillName(absPath: string): string {
  const file = basename(absPath);
  return file.toLowerCase() === "skill.md" ? basename(dirname(absPath)) : basename(file, extname(file));
}

/** 目录内容的确定性哈希:按相对路径排序,逐条喂 `path\0content\0`(二进制附件按原字节)。 */
function hashFiles(files: { path: string; content: string | Buffer }[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path).update("\0").update(f.content).update("\0");
  }
  return h.digest("hex");
}

/** Skill 目录可以带脚本 / 图片等附件,一律按原字节读 + 上传,不做文本假设。 */
async function readDirFiles(dir: string): Promise<{ path: string; content: Buffer }[]> {
  const out: { path: string; content: Buffer }[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        await walk(full);
      } else if (entry.isFile()) {
        out.push({ path: relative(dir, full).split(sep).join("/"), content: await readFile(full) });
      }
    }
  };
  await walk(dir);
  return out;
}

// ───────────────────────── Repo Skill ─────────────────────────

async function installRepoSkill(
  sandbox: Sandbox,
  spec: Extract<SkillSpec, { kind: "repo" }>,
  opts: InstallSkillsOptions,
): Promise<AgentSetupSkill> {
  const cloneDir = await cloneRepo(sandbox, spec.source, spec.ref);
  try {
    const available = await discoverSkills(sandbox, cloneDir, spec.source);
    const selected = selectRepoSkills(available, spec);
    for (const name of selected) {
      const src = available.find((s) => s.name === name)!.dir;
      const dest = posix.join(opts.dir, name);
      const res = await sandbox.runShell(
        `mkdir -p ${q(opts.dir)} && rm -rf ${q(dest)} && cp -R ${q(src)} ${q(dest)}`,
      );
      if (res.exitCode !== 0) {
        throw new Error(t("skill.copyFailed", { name, dest, tail: tail(res.stdout + res.stderr) }));
      }
    }
    return {
      kind: "repo",
      source: spec.source,
      ...(spec.ref !== undefined ? { ref: spec.ref } : {}),
      skills: selected,
    };
  } finally {
    await sandbox.runShell(`rm -rf ${q(cloneDir)}`).catch(() => undefined);
  }
}

/** repo 里可用的一个 Skill:名字 + 沙箱内 SKILL.md 所在目录。 */
export interface DiscoveredSkill {
  name: string;
  dir: string;
}

/**
 * 枚举 clone 里的 Skill:根 `SKILL.md` 存在 → 整个 repo 就是一个 Skill(名字取 repo 名);
 * 否则每个含 `SKILL.md` 的目录是一个 Skill(名字取该目录名),与 `skills` CLI 的默认口径一致。
 */
async function discoverSkills(sandbox: Sandbox, cloneDir: string, source: string): Promise<DiscoveredSkill[]> {
  const res = await sandbox.runShell(`find ${q(cloneDir)} -name SKILL.md -not -path '*/.git/*'`);
  const paths = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean).sort();
  if (paths.length === 0) throw new Error(t("skill.repoNoSkills", { source }));

  const rootFile = `${cloneDir}/SKILL.md`;
  if (paths.includes(rootFile)) return [{ name: repoName(source), dir: cloneDir }];
  return paths
    .map((p) => {
      const dir = posix.dirname(p);
      return { name: posix.basename(dir), dir };
    })
    .sort((a, b) => a.name.localeCompare(b.name)); // 报错里的「可选集」按名字排,不按路径排
}

/**
 * 选择规则(docs 的表):repo 只有一个 Skill 且省略 `skills` → 装唯一那个;多个且省略 →
 * 失败并列出可选集;指定了不存在的 Skill → 失败并报 source / ref / 名字。
 */
export function selectRepoSkills(
  available: readonly DiscoveredSkill[],
  spec: Extract<SkillSpec, { kind: "repo" }>,
): string[] {
  const names = available.map((s) => s.name);
  if (!spec.skills?.length) {
    if (available.length === 1) return [names[0]!];
    throw new Error(t("skill.repoAmbiguous", { source: spec.source, available: names.join(", ") }));
  }
  for (const want of spec.skills) {
    if (!names.includes(want)) {
      throw new Error(
        t("skill.repoUnknownSkill", {
          skill: want,
          source: spec.source,
          ref: spec.ref ?? "(default)",
          available: names.join(", "),
        }),
      );
    }
  }
  return [...spec.skills];
}

// ───────────────────────── git ─────────────────────────

/**
 * 把一个 repo clone 进沙箱临时目录,给了 ref 就钉到那个 tag/commit/branch,返回 clone 目录。
 * ref 可能是任意 commit,所以钉 ref 时不能 `--depth 1`(浅克隆 checkout 不到历史 commit)。
 * Skill 与 native plugin 的 marketplace(claude 侧 CLI 没有钉 ref 的入口)共用这一条。
 */
export async function cloneRepo(sandbox: Sandbox, source: string, ref?: string): Promise<string> {
  const dir = `${CLONE_ROOT}/${slug(source)}-${Math.random().toString(36).slice(2, 8)}`;
  const url = gitUrlOf(source);
  const script =
    `rm -rf ${q(dir)} && mkdir -p ${q(CLONE_ROOT)} && ` +
    `git clone --quiet ${ref ? "" : "--depth 1 "}${q(url)} ${q(dir)}` +
    (ref ? ` && git -C ${q(dir)} checkout --quiet ${q(ref)}` : "");
  const res = await sandbox.runShell(script);
  if (res.exitCode !== 0) {
    throw new Error(
      t("skill.repoCloneFailed", { source, ref: ref ?? "(default)", tail: tail(res.stdout + res.stderr) }),
    );
  }
  return dir;
}

/** `owner/repo` → GitHub HTTPS URL;已经是 URL(含 `://` 或 `git@`)则原样用。 */
export function gitUrlOf(source: string): string {
  if (source.includes("://") || source.startsWith("git@")) return source;
  return `https://github.com/${source}.git`;
}

function repoName(source: string): string {
  const last = gitUrlOf(source).replace(/\/+$/, "").split("/").pop() ?? source;
  return last.replace(/\.git$/, "");
}

function slug(source: string): string {
  return source.replace(/[^\w.-]/g, "-");
}

function tail(output: string, n = 12): string {
  return output.trim().split("\n").slice(-n).join("\n");
}

// ───────────────────────── 发现指引 ─────────────────────────

/** manifest 里的 Skill 记录 → 沙箱里实际的目录名(发现指引要逐条点名)。 */
export function installedSkillNames(skills: readonly AgentSetupSkill[]): string[] {
  const names: string[] = [];
  for (const skill of skills) {
    if (skill.kind === "local") names.push(skill.name);
    else names.push(...skill.skills);
  }
  return [...new Set(names)];
}

/**
 * 给没有原生 Skill 加载机制的 agent(codex / bub)写的 project instruction 段落:
 * 只把文件装到 skill 目录不足以让它们读到(见 memory/codex-no-native-skill-tool.md ——
 * 不提示的话 codex 连一次 shell 读取都不会发生),必须在 AGENTS.md 里给出稳定的发现指引。
 */
export function skillDiscoveryInstruction(dir: string, skills: readonly string[]): string {
  const list = skills.map((name) => `- ${name}: ${posix.join(dir, name)}/SKILL.md`).join("\n");
  return [
    "",
    "## Skills",
    "",
    `Skill files are installed in \`${dir}/\`:`,
    "",
    list,
    "",
    "Before answering a task, check whether one of these skills covers it and read its `SKILL.md`",
    "(e.g. with a shell command). Follow the skill's instructions when it applies.",
    "",
  ].join("\n");
}

/**
 * 把发现指引追加进沙箱里的一个 instruction 文件(不存在则创建)。落在 workspace 里时,
 * 新建的文件顺手排除出 diff —— setup 装的东西不是 agent 的产出(见 excludeFromDiff)。
 * 文件本来就存在(starter 自带 AGENTS.md)时不排除:那是 agent 也可能改的文件,
 * 排掉会把真实改动一起藏起来;此时追加的这一段会如实出现在 diff 里。
 */
export async function appendProjectInstruction(sandbox: Sandbox, text: string, file = "AGENTS.md"): Promise<void> {
  const existed = await sandbox.pathExists(file).catch(() => false);
  const delim = `NICEEVAL_EOF_${Math.random().toString(36).slice(2, 8)}`;
  await sandbox.runShell(`cat >> ${q(file)} <<'${delim}'\n${text}\n${delim}\n`);
  if (!existed) await excludeFromDiff(sandbox, [file]);
}

/**
 * 把 setup 装进 workspace 的东西(skill 目录、adapter 新建的 instruction 文件)写进
 * `.git/info/exclude`:git 基线是在 agent.setup **之前**打的,不排除的话这些文件会被
 * `captureGeneratedFiles`(git add -A && git diff HEAD)当成「agent 生成的文件」记进
 * diff.json —— 装了 skill 的实验,diff 里凭空多出几十个文件,基于 diff 的断言与展示全被污染。
 * 排除只对未跟踪文件有效,这正是 adapter 自己创建的那一类。
 */
export async function excludeFromDiff(sandbox: Sandbox, paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  const lines = paths.map((p) => `printf '%s\\n' ${q(p)} >> .git/info/exclude`).join(" && ");
  await sandbox.runShell(`test -d .git && mkdir -p .git/info && ${lines}`).catch(() => undefined);
}
