import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// e2e/repos/* 是一组独立测试仓库(见 docs/engineering/e2e-ci/README.md §2),由其它 agent
// 并行搭建,本文件写作时一个都不存在。这里守的是 README §8 列出的结构边界——它是仓库形状
// 的契约测试,不是某个仓库的验收测试(仓库自己的验收脚本见 verification.md)。
//
// 写法:每条规则收集违规到一个数组,`expect(violations).toEqual([])`。目录发现基于
// `readdirSync`,零仓库时循环体不执行、数组天然为空——不需要为「零仓库」写显式跳过分支,
// 契约测试本身就是平凡通过的。真实仓库落地后同一份断言自动开始生效。
//
// 但「零仓库=空数组=通过」也意味着这一遍 `pnpm test` 通过本身不能证明校验逻辑真的会咬人。
// 因此下面把每条规则拆成不碰全局状态的纯函数,并在文末「守护函数自测」里用合成的合法/
// 违规样本直接调用这些函数,证明它们在违规样本上真的会返回非空结果——这是本文件的核心
// 自证机制,不是可选的锦上添花。
const ROOT = resolve(import.meta.dirname, "..");
const REPOS_DIR = join(ROOT, "e2e", "repos");

// ---------------------------------------------------------------------------
// 纯校验函数——只接受数据/文本/路径参数,不读全局目录,方便独立单测
// ---------------------------------------------------------------------------

type RequiresShape = {
  runtimes?: unknown;
  docker?: unknown;
  arch?: unknown;
  memoryGB?: unknown;
};

/** README §2.3 e2e.json 字段契约。repoLabel 只用于拼错误信息,不参与判定。 */
function schemaViolations(repoLabel: string, json: unknown): string[] {
  const errs: string[] = [];
  const fail = (msg: string) => errs.push(`[${repoLabel}] e2e.json ${msg}`);

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    fail("必须是 JSON 对象(README §2.3)");
    return errs;
  }
  const j = json as Record<string, unknown>;

  if (typeof j.id !== "string" || j.id.length === 0) {
    fail(`字段 \`id\` 必须是非空字符串,实际是 ${JSON.stringify(j.id)}`);
  }
  if (j.group !== "sdk" && j.group !== "sandbox" && j.group !== "contract") {
    fail(`字段 \`group\` 必须是 "sdk" | "sandbox" | "contract" 之一,实际是 ${JSON.stringify(j.group)}`);
  }
  if (
    !Array.isArray(j.command) ||
    j.command.length === 0 ||
    !j.command.every((c) => typeof c === "string")
  ) {
    fail(`字段 \`command\` 必须是非空字符串数组,实际是 ${JSON.stringify(j.command)}`);
  }
  if (typeof j.timeoutMinutes !== "number" || !(j.timeoutMinutes > 0)) {
    fail(`字段 \`timeoutMinutes\` 必须是正数,实际是 ${JSON.stringify(j.timeoutMinutes)}`);
  }
  if (!Array.isArray(j.secrets) || !j.secrets.every((s) => typeof s === "string")) {
    fail(`字段 \`secrets\` 必须是字符串数组,实际是 ${JSON.stringify(j.secrets)}`);
  }
  if (!Array.isArray(j.artifacts) || !j.artifacts.every((a) => typeof a === "string")) {
    fail(`字段 \`artifacts\` 必须是字符串数组,实际是 ${JSON.stringify(j.artifacts)}`);
  }
  if (j.requires !== undefined) {
    if (typeof j.requires !== "object" || j.requires === null || Array.isArray(j.requires)) {
      fail(`字段 \`requires\` 如果存在必须是对象,实际是 ${JSON.stringify(j.requires)}`);
    } else {
      const r = j.requires as RequiresShape;
      if (
        r.runtimes !== undefined &&
        (!Array.isArray(r.runtimes) || !r.runtimes.every((x) => typeof x === "string"))
      ) {
        fail(`字段 \`requires.runtimes\` 如果存在必须是字符串数组,实际是 ${JSON.stringify(r.runtimes)}`);
      }
      if (r.docker !== undefined && typeof r.docker !== "boolean") {
        fail(`字段 \`requires.docker\` 如果存在必须是布尔值,实际是 ${JSON.stringify(r.docker)}`);
      }
      if (r.arch !== undefined && typeof r.arch !== "string") {
        fail(`字段 \`requires.arch\` 如果存在必须是字符串,实际是 ${JSON.stringify(r.arch)}`);
      }
      if (r.memoryGB !== undefined && typeof r.memoryGB !== "number") {
        fail(`字段 \`requires.memoryGB\` 如果存在必须是数字,实际是 ${JSON.stringify(r.memoryGB)}`);
      }
    }
  }
  return errs;
}

// 已知局限:只识别整行就是 ".niceeval" 变体的写法(可带前导 "/"、前导 "**/"、
// 尾部 "/" 或若干个 "*")。不识别 "**/.niceeval/**" 之外更复杂的 glob 组合写法
// (如放在注释同一行、或用否定模式 "!" 重新纳入),也不做真正的 gitignore 模式匹配。
function ignoresNiceevalDir(content: string): boolean {
  return content
    .split("\n")
    .map((l) => l.trim())
    .some((l) => /^\/?(\*\*\/)?\.niceeval\/?(\*+)?$/.test(l));
}

/**
 * README §2.1/§3.2:单个依赖说明符是否是指向父目录的 file:/link:。
 * 判定只看是否含 ".."——同目录或子目录的 file:(如 "file:./vendor/x.tgz")不含 ".."、不算越出。
 */
function dependencySpecifierEscapesRoot(spec: string): boolean {
  return /^(file|link):/.test(spec) && spec.includes("..");
}

/** 同上,但直接在 lockfile 原始文本里找——lockfile 格式因包管理器而异,不逐格式解析,按文本扫描。 */
function findEscapingLockfileSpecifiers(text: string): string[] {
  const matches = text.match(/(?:file|link):[^\s"'\n]*\.\.[^\s"'\n]*/g) ?? [];
  return [...new Set(matches)];
}

/**
 * README 总则第 5 条 / §2.1:单个 import 说明符是否违规。
 * - "niceeval" / "niceeval/xxx" 是发布包的公开入口,任何仓库都允许——包括 results-contract 的
 *   "niceeval/results";这条豁免不按仓库名单开例外,对所有仓库统一生效。
 * - 相对路径说明符解析后落在仓库根之外,判越界(会覆盖「引用其它测试仓库」「引用根 src/」
 *   「引用 e2e/shared」三种情况,因为它们都必然经过 ".." 走出仓库根)。
 * - 非相对但字面写死了 "e2e/repos/<other-id>" 路径片段的说明符(别名、拼接路径等),单独兜底。
 */
function importSpecifierViolation(args: {
  repoId: string;
  repoRoot: string;
  fromFile: string;
  specifier: string;
}): string | null {
  const { repoId, repoRoot, fromFile, specifier } = args;

  if (specifier === "niceeval" || specifier.startsWith("niceeval/")) return null;

  if (specifier.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), specifier);
    const relFromRepo = relative(repoRoot, resolved);
    if (relFromRepo.startsWith("..") || isAbsolute(relFromRepo)) {
      return (
        `[${repoId}] ${relative(ROOT, fromFile)} 的相对 import "${specifier}" 越出仓库根` +
        `(解析到 ${relative(ROOT, resolved) || "."})——不得 import 其它测试仓库、niceeval 根 src/ 或 e2e/shared,` +
        `把依赖复制进本仓库,或改用裸包名 "niceeval" 导入(README §2.1)`
      );
    }
    return null;
  }

  const otherRepoMatch = specifier.match(/e2e\/repos\/([^/"'\s]+)/);
  if (otherRepoMatch && otherRepoMatch[1] !== repoId) {
    return (
      `[${repoId}] ${relative(ROOT, fromFile)} 的 import "${specifier}" 引用了另一个测试仓库` +
      ` e2e/repos/${otherRepoMatch[1]}——每个仓库必须自持全部运行时代码(README §2.1)`
    );
  }
  return null;
}

const IMPORT_PATTERNS: RegExp[] = [
  /\bimport\s+[^;]*?\sfrom\s*["']([^"']+)["']/g, // import ... from "..."
  /\bimport\s*["']([^"']+)["']/g, // import "..." (副作用引入)
  /\bexport\s+[^;]*?\sfrom\s*["']([^"']+)["']/g, // export ... from "..."
  /\brequire\(\s*["']([^"']+)["']\s*\)/g, // require("...")
  /\bimport\(\s*["']([^"']+)["']\s*\)/g, // 动态 import("...")
];

/**
 * 文本/正则扫描,不解析 AST——已知局限:多行 import 依赖非贪婪的 "跨行任意字符直到 from"
 * 匹配,遇到罕见写法(如字符串里出现 "from" 关键字、极端嵌套解构)可能漏报或多报;
 * 只覆盖 JS/TS 系扩展名,不扫描 Python 等其它运行时的 import/from 语句(README 里
 * "不 import 其它仓库/根 src/" 的约束描述的是 niceeval 源码连接,天然是 TS 生态的关注点)。
 */
function extractImportSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      if (m[1]) specifiers.add(m[1]);
    }
  }
  return [...specifiers];
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".niceeval",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  ".next",
  ".pnpm-store",
  "coverage",
]);

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const LOCKFILE_CANDIDATES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Cargo.lock",
  "go.sum",
  "composer.lock",
];

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** README §2.2:仓库自己的 package.json、lockfile、evals/、experiments/、.env.example、.gitignore。 */
function repoStructureViolations(repoId: string, repoRoot: string): string[] {
  const violations: string[] = [];

  if (!existsSync(join(repoRoot, "package.json"))) {
    violations.push(`[${repoId}] 缺少 package.json——每个仓库必须是完整项目,不加入根 workspace(README §2.1/§2.2)`);
  }
  const hasLockfile = LOCKFILE_CANDIDATES.some((name) => existsSync(join(repoRoot, name)));
  if (!hasLockfile) {
    violations.push(
      `[${repoId}] 缺少 lockfile(如 pnpm-lock.yaml,或对应运行时的等价锁文件)——依赖必须仓库自持并锁定(README §2.1)`,
    );
  }
  if (!existsSync(join(repoRoot, "evals"))) {
    violations.push(`[${repoId}] 缺少 evals/ 目录——每个仓库拥有自己的 Eval(README §2.1/§2.2)`);
  }
  if (!existsSync(join(repoRoot, "experiments"))) {
    violations.push(`[${repoId}] 缺少 experiments/ 目录——每个仓库拥有自己的 Experiment(README §2.1/§2.2)`);
  }
  if (!existsSync(join(repoRoot, ".env.example"))) {
    violations.push(`[${repoId}] 缺少 .env.example——secrets 变量名必须在仓库内可见(README §2.2/§3.3)`);
  }
  const gitignorePath = join(repoRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    violations.push(`[${repoId}] 缺少 .gitignore——.niceeval/ 等一次性证据必须被 ignore(README §2.1)`);
  } else if (!ignoresNiceevalDir(readFileSync(gitignorePath, "utf8"))) {
    violations.push(`[${repoId}] .gitignore 未忽略 .niceeval/——一次运行的临时结果不得成为下一次运行的输入(README §2.1)`);
  }
  return violations;
}

/** README §2.1:仓库源文件里没有越出仓库根、指向其它仓库、根 src/ 或 e2e/shared 的相对 import。 */
function repoImportViolations(repoId: string, repoRoot: string): string[] {
  if (!existsSync(repoRoot)) return [];
  const violations: string[] = [];
  const files = walkFiles(repoRoot).filter((f) => SOURCE_EXTENSIONS.some((ext) => f.endsWith(ext)));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const specifier of extractImportSpecifiers(text)) {
      const violation = importSpecifierViolation({ repoId, repoRoot, fromFile: file, specifier });
      if (violation) violations.push(violation);
    }
  }
  return violations;
}

/** README §2.1/§3.2:package.json 与 lockfile 都不含指向父目录的 file:/link:。 */
function repoDependencyEscapeViolations(repoId: string, repoRoot: string): string[] {
  const violations: string[] = [];

  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    let pkg: Record<string, unknown> = {};
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      pkg = {}; // 非法 JSON 由仓库自己的验收/schema 检查负责,这里不重复报
    }
    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field];
      if (!deps || typeof deps !== "object") continue;
      for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
        if (typeof spec === "string" && dependencySpecifierEscapesRoot(spec)) {
          violations.push(
            `[${repoId}] package.json ${field}.${name} = "${spec}" 是指向父目录的 file:/link: 依赖——` +
              `候选 niceeval 由执行器通过 tarball 注入,不得用路径依赖连接父目录(README §2.1/§3.2)`,
          );
        }
      }
    }
  }

  for (const lockName of LOCKFILE_CANDIDATES) {
    const lockPath = join(repoRoot, lockName);
    if (!existsSync(lockPath)) continue;
    const hits = findEscapingLockfileSpecifiers(readFileSync(lockPath, "utf8"));
    if (hits.length > 0) {
      violations.push(
        `[${repoId}] lockfile ${lockName} 里发现指向父目录的 file:/link: 说明符:${hits.join(", ")}——` +
          `用注入的候选 tarball 重新生成 lockfile(README §2.1/§3.2)`,
      );
    }
  }
  return violations;
}

const DENYLIST_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "claudeCodeAgent factory 名", re: /\bclaudeCodeAgent\b/ },
  { label: "aiSdkAgent factory 名", re: /\baiSdkAgent\b/ },
  { label: "codexAgent factory 名", re: /\bcodexAgent\b/ },
  { label: "bubAgent factory 名", re: /\bbubAgent\b/ },
  { label: "openClawAgent factory 名", re: /\bopenClawAgent\b/ },
  { label: "uiMessageStreamAgent factory 名", re: /\buiMessageStreamAgent\b/ },
  { label: "MCP 工具名前缀 mcp__", re: /\bmcp__/ },
  { label: "字面 eval 数量断言(如 toHaveLength(3))", re: /toHaveLength\(\s*\d+\s*\)/ },
  { label: "字面 eval 数量断言(如 evals.length === 3)", re: /\bevals?\.length\s*(?:===|==|>=|<=|>|<)\s*\d+/i },
  { label: "字面 expected count 赋值(如 expectedCount = 3)", re: /\bexpected(?:Eval)?Count\s*[:=]\s*\d+/i },
];

/**
 * README §5/§8:根编排脚本不得内置 SDK/协议专属知识或写死的 Eval 数量。
 * 这是启发式黑名单,不是穷举——它能挡住「复制了某个已知 adapter 工厂名/MCP 工具名前缀/
 * 数字断言」这类具体写法,挡不住换个说法达到同样效果的编排代码(如把仓库特有的 Eval id
 * 硬编码进 switch,或把「至少要跑 N 条」写成不含这些关键词的算式)。
 */
function orchestratorDenylistHits(text: string): string[] {
  return DENYLIST_PATTERNS.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

// ---------------------------------------------------------------------------
// 目录发现
// ---------------------------------------------------------------------------

function listRepoIds(): string[] {
  if (!existsSync(REPOS_DIR)) return [];
  return readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// 对真实 e2e/repos/* 的结构守护——落地前循环体为空,断言天然平凡通过
// ---------------------------------------------------------------------------

describe("e2e/repos/* 结构守护(docs/engineering/e2e-ci/README.md §2 / §8)", () => {
  const repoIds = listRepoIds();

  it("每个仓库的 e2e.json 是合法 JSON 且匹配 §2.3 schema", () => {
    const violations: string[] = [];
    for (const id of repoIds) {
      const jsonPath = join(REPOS_DIR, id, "e2e.json");
      if (!existsSync(jsonPath)) {
        violations.push(`[${id}] 缺少 e2e.json——每个测试仓库必须声明编排器需要的事实(README §2.3)`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
      } catch (err) {
        violations.push(`[${id}] e2e.json 不是合法 JSON:${(err as Error).message}`);
        continue;
      }
      violations.push(...schemaViolations(id, parsed));
    }
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });

  it("e2e.json 的 id 在全部仓库范围内唯一", () => {
    const idOwners = new Map<string, string[]>();
    for (const repo of repoIds) {
      const jsonPath = join(REPOS_DIR, repo, "e2e.json");
      if (!existsSync(jsonPath)) continue;
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
        if (typeof parsed.id === "string" && parsed.id.length > 0) {
          idOwners.set(parsed.id, [...(idOwners.get(parsed.id) ?? []), repo]);
        }
      } catch {
        continue; // 非法 JSON 已经被上一条测试断言过,这里不重复报
      }
    }
    const violations = [...idOwners.entries()]
      .filter(([, repos]) => repos.length > 1)
      .map(
        ([id, repos]) =>
          `id "${id}" 被多个仓库同时使用:${repos.join(", ")}——id 是全局稳定的仓库选择器,必须唯一(README §2.3)`,
      );
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });

  it("每个仓库都有自己的 package.json、lockfile、evals/、experiments/、.env.example,以及忽略 .niceeval/ 的 .gitignore", () => {
    const violations = repoIds.flatMap((id) => repoStructureViolations(id, join(REPOS_DIR, id)));
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });

  it("没有仓库通过相对 import 越出仓库根、引用其它测试仓库,或引用 e2e/shared / niceeval 根 src/", () => {
    const violations = repoIds.flatMap((id) => repoImportViolations(id, join(REPOS_DIR, id)));
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });

  it("没有仓库的 package.json 或 lockfile 使用指向父目录的 file:/link: 依赖", () => {
    const violations = repoIds.flatMap((id) => repoDependencyEscapeViolations(id, join(REPOS_DIR, id)));
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 根编排脚本守护——list.ts / run.ts 由并行 agent 构建,文件写作时可能尚不存在
// ---------------------------------------------------------------------------

describe("根编排脚本不内置 SDK/仓库专属知识(README.md §5 / §8)", () => {
  const scriptPaths = [join(ROOT, "e2e", "scripts", "list.ts"), join(ROOT, "e2e", "scripts", "run.ts")];

  it("list.ts / run.ts(存在时)不含 adapter factory 名、MCP 工具名前缀或写死的 eval 数量断言", () => {
    const violations: string[] = [];
    for (const scriptPath of scriptPaths) {
      if (!existsSync(scriptPath)) continue; // 由并行 agent 构建中,尚不存在时对它平凡通过
      const text = readFileSync(scriptPath, "utf8");
      const relPath = relative(ROOT, scriptPath);
      for (const label of orchestratorDenylistHits(text)) {
        violations.push(
          `[${relPath}] 命中启发式黑名单「${label}」——根编排器不得内置 SDK/协议专属知识或写死的 Eval 数量` +
            `(README §5/§8),对应逻辑应移回具体测试仓库`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 守护函数自测——用合成的合法/违规样本直接调用上面的纯函数与文件系统函数,
// 证明规则在真实仓库落地前就已经会在违规样本上触发,而不是只在空目录上平凡通过。
// 这一段本身不依赖 e2e/repos/*,不受仓库是否已落地影响。
// ---------------------------------------------------------------------------

describe("守护函数自测(合成样本,证明规则真的会咬人)", () => {
  it("schemaViolations 接受合法 e2e.json、拒绝每个字段各自的违规", () => {
    const valid = {
      id: "claude-agent-sdk",
      group: "sdk",
      command: ["pnpm", "e2e"],
      timeoutMinutes: 20,
      secrets: ["DEEPSEEK_API_KEY"],
      artifacts: [".niceeval/**"],
      requires: { runtimes: ["node>=22"] },
    };
    expect(schemaViolations("t", valid)).toEqual([]);
    expect(schemaViolations("t", { ...valid, id: "" }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, group: "adapter" }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, command: [] }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, command: "pnpm e2e" }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, timeoutMinutes: 0 }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, timeoutMinutes: "20" }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, secrets: [1] }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, artifacts: "x" }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, requires: { docker: "yes" } }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", { ...valid, requires: ["node>=22"] }).length).toBeGreaterThan(0);
    expect(schemaViolations("t", null).length).toBeGreaterThan(0);
    expect(schemaViolations("t", "not-json-object").length).toBeGreaterThan(0);
  });

  it("ignoresNiceevalDir 识别常见 .niceeval/ 忽略写法,拒绝没忽略的 .gitignore", () => {
    expect(ignoresNiceevalDir(".niceeval\nnode_modules\n")).toBe(true);
    expect(ignoresNiceevalDir(".niceeval/\n")).toBe(true);
    expect(ignoresNiceevalDir("/.niceeval/\n")).toBe(true);
    expect(ignoresNiceevalDir("**/.niceeval/**\n")).toBe(true);
    expect(ignoresNiceevalDir("node_modules\ndist\n")).toBe(false);
    expect(ignoresNiceevalDir("")).toBe(false);
  });

  it("dependencySpecifierEscapesRoot 只对含 .. 的 file:/link: 判越出", () => {
    expect(dependencySpecifierEscapesRoot("file:../../niceeval-0.1.0.tgz")).toBe(true);
    expect(dependencySpecifierEscapesRoot("link:../sibling-repo")).toBe(true);
    expect(dependencySpecifierEscapesRoot("file:./vendor/local.tgz")).toBe(false);
    expect(dependencySpecifierEscapesRoot("^1.2.3")).toBe(false);
  });

  it("findEscapingLockfileSpecifiers 在多种 file:/link: 写法里只挑出越出父目录的那些", () => {
    const text = [
      'resolution: "file:../../niceeval-0.1.0.tgz"',
      'other: "file:./vendor/local.tgz"',
      'yet: "link:./../parent-sibling"',
      'clean: "link:./child"',
    ].join("\n");
    const hits = findEscapingLockfileSpecifiers(text);
    expect(hits.some((h) => h.includes("file:../../niceeval"))).toBe(true);
    expect(hits.some((h) => h.includes("link:./../parent-sibling"))).toBe(true);
    expect(hits.some((h) => h.includes("file:./vendor/local.tgz"))).toBe(false);
    expect(hits.some((h) => h.includes("link:./child"))).toBe(false);
  });

  it("extractImportSpecifiers 从 import/export/require/动态 import 里都能取到说明符", () => {
    const code = [
      'import { foo } from "./foo";',
      'import "./side-effect";',
      'export { bar } from "../bar";',
      'const baz = require("./baz");',
      'const qux = await import("./qux");',
      'import { niceeval } from "niceeval/results";',
    ].join("\n");
    const specs = extractImportSpecifiers(code);
    expect(specs).toEqual(
      expect.arrayContaining(["./foo", "./side-effect", "../bar", "./baz", "./qux", "niceeval/results"]),
    );
  });

  it("importSpecifierViolation 放行仓库内相对 import 与裸 niceeval 包名,拒绝越出仓库根或指名其它仓库", () => {
    const repoRoot = join(REPOS_DIR, "claude-agent-sdk");
    const fromFile = join(repoRoot, "agents", "index.ts");

    expect(
      importSpecifierViolation({ repoId: "claude-agent-sdk", repoRoot, fromFile, specifier: "./weather" }),
    ).toBeNull();
    expect(
      importSpecifierViolation({ repoId: "claude-agent-sdk", repoRoot, fromFile, specifier: "niceeval" }),
    ).toBeNull();
    expect(
      importSpecifierViolation({
        repoId: "results-contract",
        repoRoot: join(REPOS_DIR, "results-contract"),
        fromFile: join(REPOS_DIR, "results-contract", "verify.ts"),
        specifier: "niceeval/results",
      }),
    ).toBeNull();

    const escapesToSrc = importSpecifierViolation({
      repoId: "claude-agent-sdk",
      repoRoot,
      fromFile,
      specifier: "../../../src/agents/claude-code",
    });
    expect(escapesToSrc).not.toBeNull();
    expect(escapesToSrc).toContain("越出仓库根");

    // 相对 import 引用兄弟仓库时,先命中的是通用的「越出仓库根」判定(它已经覆盖了
    // 「其它测试仓库/根 src//e2e/shared」三种情况);只有非相对但字面写死 e2e/repos/<id>
    // 路径片段的说明符才会命中下面「引用了另一个测试仓库」这条更具体的兜底分支。
    const referencesOtherRepoViaRelative = importSpecifierViolation({
      repoId: "claude-agent-sdk",
      repoRoot,
      fromFile,
      specifier: "../../codex-sdk/evals/weather",
    });
    expect(referencesOtherRepoViaRelative).not.toBeNull();
    expect(referencesOtherRepoViaRelative).toContain("越出仓库根");

    const referencesOtherRepoViaAlias = importSpecifierViolation({
      repoId: "claude-agent-sdk",
      repoRoot,
      fromFile,
      specifier: "@fixtures/e2e/repos/codex-sdk/evals/weather",
    });
    expect(referencesOtherRepoViaAlias).not.toBeNull();
    expect(referencesOtherRepoViaAlias).toContain("引用了另一个测试仓库");
  });

  it("orchestratorDenylistHits 命中已知 adapter factory 名、MCP 前缀与写死的 eval 数量,放行中性编排代码", () => {
    expect(orchestratorDenylistHits('import { claudeCodeAgent } from "niceeval";')).toContain(
      "claudeCodeAgent factory 名",
    );
    expect(orchestratorDenylistHits('assert(tool === "mcp__demo-tools__get_weather")')).toContain(
      "MCP 工具名前缀 mcp__",
    );
    expect(orchestratorDenylistHits("expect(evals.length).toHaveLength(3);")).toContain(
      "字面 eval 数量断言(如 toHaveLength(3))",
    );
    expect(orchestratorDenylistHits("if (evals.length === 12) fail();")).toContain(
      "字面 eval 数量断言(如 evals.length === 3)",
    );
    expect(orchestratorDenylistHits("const expectedCount = 5;")).toContain(
      "字面 expected count 赋值(如 expectedCount = 3)",
    );
    expect(
      orchestratorDenylistHits(
        'const repos = discoverRepos(); for (const r of repos) spawn(r.command, { cwd: r.root });',
      ),
    ).toEqual([]);
  });

  describe("对文件系统的结构/依赖检查(临时目录合成仓库)", () => {
    const scratch = mkdtempSync(join(tmpdir(), "e2e-structure-guard-"));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    it("repoStructureViolations 在完整仓库上通过、在残缺仓库上逐项报缺失", () => {
      const complete = join(scratch, "complete-repo");
      mkdirSync(join(complete, "evals"), { recursive: true });
      mkdirSync(join(complete, "experiments"), { recursive: true });
      writeFileSync(join(complete, "package.json"), "{}");
      writeFileSync(join(complete, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      writeFileSync(join(complete, ".env.example"), "DEEPSEEK_API_KEY=\n");
      writeFileSync(join(complete, ".gitignore"), ".niceeval/\nnode_modules\n");
      expect(repoStructureViolations("complete-repo", complete)).toEqual([]);

      const bare = join(scratch, "bare-repo");
      mkdirSync(bare, { recursive: true });
      const violations = repoStructureViolations("bare-repo", bare);
      expect(violations.some((v) => v.includes("package.json"))).toBe(true);
      expect(violations.some((v) => v.includes("lockfile"))).toBe(true);
      expect(violations.some((v) => v.includes("evals/"))).toBe(true);
      expect(violations.some((v) => v.includes("experiments/"))).toBe(true);
      expect(violations.some((v) => v.includes(".env.example"))).toBe(true);
      expect(violations.some((v) => v.includes(".gitignore"))).toBe(true);

      const gitignoreNotIgnoring = join(scratch, "gitignore-gap-repo");
      mkdirSync(join(gitignoreNotIgnoring, "evals"), { recursive: true });
      mkdirSync(join(gitignoreNotIgnoring, "experiments"), { recursive: true });
      writeFileSync(join(gitignoreNotIgnoring, "package.json"), "{}");
      writeFileSync(join(gitignoreNotIgnoring, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      writeFileSync(join(gitignoreNotIgnoring, ".env.example"), "");
      writeFileSync(join(gitignoreNotIgnoring, ".gitignore"), "node_modules\ndist\n");
      const gapViolations = repoStructureViolations("gitignore-gap-repo", gitignoreNotIgnoring);
      expect(gapViolations).toEqual([
        expect.stringContaining("未忽略 .niceeval/"),
      ]);
    });

    it("repoImportViolations 在合成仓库上抓到越出仓库根和跨仓库引用的相对 import", () => {
      const repoRoot = join(scratch, "import-violation-repo");
      mkdirSync(join(repoRoot, "agents"), { recursive: true });
      writeFileSync(
        join(repoRoot, "agents", "index.ts"),
        [
          'import { Agent } from "niceeval";',
          'import { helper } from "./helper";',
          'import { claudeCodeAgent } from "../../../src/agents/claude-code";',
          'import { sharedProfile } from "../../shared/profile";',
          'import { otherEvals } from "../../codex-sdk/evals/weather";',
        ].join("\n"),
      );
      writeFileSync(join(repoRoot, "agents", "helper.ts"), "export const helper = 1;\n");

      const violations = repoImportViolations("import-violation-repo", repoRoot);
      expect(violations.length).toBe(3);
      expect(violations.some((v) => v.includes("claude-code"))).toBe(true);
      expect(violations.some((v) => v.includes("shared/profile") || v.includes("越出仓库根"))).toBe(true);
      expect(violations.some((v) => v.includes("codex-sdk"))).toBe(true);
    });

    it("repoImportViolations 在干净仓库上不报任何违规", () => {
      const repoRoot = join(scratch, "clean-import-repo");
      mkdirSync(join(repoRoot, "agents"), { recursive: true });
      writeFileSync(
        join(repoRoot, "agents", "index.ts"),
        ['import { Agent } from "niceeval";', 'import { helper } from "./helper";'].join("\n"),
      );
      writeFileSync(join(repoRoot, "agents", "helper.ts"), "export const helper = 1;\n");
      expect(repoImportViolations("clean-import-repo", repoRoot)).toEqual([]);
    });

    it("repoDependencyEscapeViolations 抓到 package.json 与 lockfile 里指向父目录的 file:/link:", () => {
      const repoRoot = join(scratch, "dependency-escape-repo");
      mkdirSync(repoRoot, { recursive: true });
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({
          name: "dependency-escape-repo",
          dependencies: { niceeval: "^0.5.0" },
          devDependencies: { "sibling-tool": "file:../../sibling-tool" },
        }),
      );
      writeFileSync(join(repoRoot, "pnpm-lock.yaml"), "resolution: \"link:../../niceeval\"\n");

      const violations = repoDependencyEscapeViolations("dependency-escape-repo", repoRoot);
      expect(violations.some((v) => v.includes("devDependencies.sibling-tool"))).toBe(true);
      expect(violations.some((v) => v.includes("pnpm-lock.yaml"))).toBe(true);
    });

    it("repoDependencyEscapeViolations 在正常依赖声明上不报违规", () => {
      const repoRoot = join(scratch, "dependency-clean-repo");
      mkdirSync(repoRoot, { recursive: true });
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({ name: "dependency-clean-repo", dependencies: { niceeval: "^0.5.0" } }),
      );
      writeFileSync(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      expect(repoDependencyEscapeViolations("dependency-clean-repo", repoRoot)).toEqual([]);
    });
  });
});
