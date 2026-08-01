// 官方原生配置文件(Claude Code settings.json / Codex config.toml)的共享实现:
// 「从本地项目根安全取原始字节」+「按各 Agent 的保留键清单验收」+「原样落进沙箱」。
// 定稿见 docs/feature/adapters/architecture/coding-agent-extensions.md「类型边界」「安装顺序」。
//
// 关键契约:文件是完整用户配置层,不是 patch —— 只解析以验证官方语法和检查保留键,
// 验证后写入的仍是**原始字节**(JSON Schema 标记、TOML 注释与官方编辑器支持全保留),
// 不继承宿主机配置,不拼接、deep merge 或重新序列化。字段名不跨 Agent 统一
// (`settingsFile` / `configFile`),但路径解析、字节承诺和保留键语义是同一套,收在这里。

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { posix } from "node:path";
import { t } from "../i18n/index.ts";
import type { Sandbox } from "../types.ts";

/** 本地读到的一份原生配置文件:规范化的项目相对路径、原始字节与字节 SHA-256。 */
export interface LoadedNativeConfig {
  /** 规范化后的项目相对路径(manifest 记录用;`./a/b` → `a/b`)。 */
  path: string;
  /** 原始字节 —— 上传沙箱时原样写入,不重新序列化。 */
  bytes: Buffer;
  /** 原始字节的 SHA-256(hex):进安装 checkpoint key 与 manifest;正文不落任何 artifact。 */
  sha256: string;
}

export interface LoadNativeConfigOptions {
  /** 报错归属的 agent 名(如 "claude-code")。 */
  agent: string;
  /** 报错归属的 config 字段名(如 "settingsFile" / "configFile")。 */
  field: string;
  /** 用户配置的路径(必须是项目根内的相对路径)。 */
  path: string;
  /** 解析根;省略用跑 niceeval 的项目根(process.cwd()),与 SkillSpec 本地路径同一口径。 */
  projectRoot?: string;
}

/**
 * 从本地项目根解析并读取一份原生配置文件的原始字节。
 * 路径契约(docs 定稿):只接受项目根内的相对路径 —— 普通相对路径与 `./` 前缀合法;
 * 包含 `..` 的路径、绝对路径、`~` 路径,以及解析符号链接后逃出项目根的路径,全部在
 * setup 阶段抛错(attempt errored,不伪装成断言失败)。
 */
export async function loadNativeConfigFile(opts: LoadNativeConfigOptions): Promise<LoadedNativeConfig> {
  const { agent, field, path } = opts;
  const rejectPath = () => new Error(t("nativeConfig.pathNotProjectRelative", { agent, field, path }));
  if (!path || path.startsWith("~") || isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)) throw rejectPath();
  if (path.split(/[\\/]/).includes("..")) throw rejectPath();

  const root = opts.projectRoot ?? process.cwd();
  const abs = resolve(root, path);
  const info = await stat(abs).catch(() => undefined);
  if (!info) throw new Error(t("nativeConfig.missing", { agent, field, path, resolved: abs }));
  if (!info.isFile()) throw new Error(t("nativeConfig.notFile", { agent, field, path }));

  // 符号链接逃逸检查按真实路径做:文件与项目根都 realpath 之后再验包含关系。
  const [realFile, realRoot] = await Promise.all([realpath(abs), realpath(root)]);
  if (!realFile.startsWith(realRoot + sep)) {
    throw new Error(t("nativeConfig.escapesRoot", { agent, field, path, resolved: realFile }));
  }

  const bytes = await readFile(abs);
  return {
    path: posix.normalize(path.split(/[\\/]/).join("/")),
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

// ───────────────────────── 验收:语法 + 保留键 ─────────────────────────

export interface NativeConfigValidationOptions {
  agent: string;
  field: string;
  /** 该 Agent 的保留键清单(experiment / Adapter 拥有,出现在用户文件里即报错)。 */
  reservedKeys: readonly string[];
}

/** JSON 形态(Claude Code settings.json):整文件必须是合法 JSON 对象,顶层不得含保留键。 */
export function assertJsonNativeConfig(cfg: LoadedNativeConfig, opts: NativeConfigValidationOptions): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cfg.bytes.toString("utf8"));
  } catch (e) {
    throw invalidSyntax(cfg, opts, "JSON", e instanceof Error ? e.message : String(e));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidSyntax(cfg, opts, "JSON", "top level must be a JSON object");
  }
  const hit = opts.reservedKeys.filter((k) => Object.prototype.hasOwnProperty.call(parsed, k));
  if (hit.length) throw reservedKeys(cfg, opts, hit);
}

/**
 * TOML 形态(Codex config.toml):行级语法验收 + 顶层保留键检查。
 * 保留键的判定口径:根上下文的键首段(`otel.environment = …` 算 `otel`)与所有表头首段
 * (`[mcp_servers.browser]` 算 `mcp_servers`);非保留表**里面**的同名键不算
 * (`[profiles.x]` 下的 `model` 属于 profiles,不占顶层 `model`)。
 */
export function assertTomlNativeConfig(cfg: LoadedNativeConfig, opts: NativeConfigValidationOptions): void {
  const scan = scanTomlTopLevel(cfg.bytes.toString("utf8"));
  if (scan.error) throw invalidSyntax(cfg, opts, "TOML", scan.error);
  const hit = opts.reservedKeys.filter((k) => scan.rootKeys.has(k));
  if (hit.length) throw reservedKeys(cfg, opts, hit);
}

function invalidSyntax(
  cfg: LoadedNativeConfig,
  opts: NativeConfigValidationOptions,
  format: string,
  detail: string,
): Error {
  return new Error(
    t("nativeConfig.invalidSyntax", { agent: opts.agent, field: opts.field, path: cfg.path, format, detail }),
  );
}

function reservedKeys(cfg: LoadedNativeConfig, opts: NativeConfigValidationOptions, keys: string[]): Error {
  return new Error(
    t("nativeConfig.reservedKeys", { agent: opts.agent, field: opts.field, path: cfg.path, keys: keys.join(", ") }),
  );
}

// ───────────────────────── TOML 顶层扫描 ─────────────────────────

type StrMode = "none" | "basic" | "literal";

/**
 * 轻量 TOML 顶层扫描:抠出「根上下文的键首段 + 表头首段」供保留键检查,顺带做行级语法
 * 验收(每个非空非注释行必须是表头或键赋值)。不是完整 TOML 解析器 —— 验证后写回沙箱的
 * 是原始字节,解析结果只用于验收,不值得为它引入解析依赖;多行字符串(""" / ''')与
 * 多行数组的跨行状态有覆盖,足以对官方 config.toml 做保留键判定。
 */
export function scanTomlTopLevel(text: string): { rootKeys: Set<string>; error?: string } {
  const rootKeys = new Set<string>();
  let currentTable: string | null = null;
  let mode: StrMode = "none";
  let depth = 0;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    if (mode !== "none") {
      const close = line.indexOf(mode === "basic" ? '"""' : "'''");
      if (close === -1) continue;
      ({ mode, depth } = scanValue(line.slice(close + 3), depth));
      continue;
    }
    if (depth > 0) {
      ({ mode, depth } = scanValue(line, depth));
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(trimmed);
      if (!header) return { rootKeys, error: `line ${n + 1}: invalid table header: ${trimmed}` };
      currentTable = firstKeySegment(header[1]!);
      rootKeys.add(currentTable);
      continue;
    }
    const assign = /^((?:"[^"]*"|'[^']*'|[\w-]+)(?:\s*\.\s*(?:"[^"]*"|'[^']*'|[\w-]+))*)\s*=(.*)$/.exec(trimmed);
    if (!assign) {
      return { rootKeys, error: `line ${n + 1}: expected a key assignment or table header, got: ${trimmed}` };
    }
    if (currentTable === null) rootKeys.add(firstKeySegment(assign[1]!));
    ({ mode, depth } = scanValue(assign[2]!, depth));
  }
  if (mode !== "none") return { rootKeys, error: "unterminated multi-line string" };
  if (depth > 0) return { rootKeys, error: "unbalanced array brackets" };
  return { rootKeys };
}

/** 扫过一段 value 文本,返回跨行状态(未闭合的多行字符串 / 未配平的数组括号)。 */
function scanValue(s: string, depth: number): { mode: StrMode; depth: number } {
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('"""', i)) {
      const close = s.indexOf('"""', i + 3);
      if (close === -1) return { mode: "basic", depth };
      i = close + 3;
      continue;
    }
    if (s.startsWith("'''", i)) {
      const close = s.indexOf("'''", i + 3);
      if (close === -1) return { mode: "literal", depth };
      i = close + 3;
      continue;
    }
    const ch = s[i]!;
    if (ch === '"') {
      i += 1;
      while (i < s.length && s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < s.length && s[i] !== "'") i += 1;
      i += 1;
      continue;
    }
    if (ch === "#") break;
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    i += 1;
  }
  return { mode: "none", depth };
}

/** 点分键的首段:`mcp_servers.browser` → `mcp_servers`;带引号的首段剥引号。 */
function firstKeySegment(dotted: string): string {
  const s = dotted.trim();
  const quoted = /^"([^"]*)"|^'([^']*)'/.exec(s);
  if (quoted) return quoted[1] ?? quoted[2] ?? "";
  return /^[\w-]+/.exec(s)?.[0] ?? s;
}

// ───────────────────────── 落进沙箱 ─────────────────────────

function tmpUploadPath(): string {
  return `/tmp/niceeval-native-config-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * 原始字节整文件替换沙箱内 destPath(claude-code:用户级 `~/.claude/settings.json`)。
 * 走 writeBytes + mv 而不是 heredoc:heredoc 会给内容补换行,破坏「原始字节」承诺。
 * destPath 不加引号,以便 shell 展开 `~`(受信内部路径,同 shared.writeFile 的约定)。
 */
export async function uploadNativeConfigFile(sb: Sandbox, cfg: LoadedNativeConfig, destPath: string): Promise<void> {
  const tmp = tmpUploadPath();
  await sb.writeBytes(tmp, cfg.bytes);
  const res = await sb.runShell(`mkdir -p $(dirname ${destPath}) && mv ${tmp} ${destPath}`);
  if (res.exitCode !== 0) {
    throw new Error(t("nativeConfig.uploadFailed", { path: cfg.path, dest: destPath, tail: outputTail(res) }));
  }
}

/**
 * 原始字节追加到沙箱内 destPath 末尾,前后各补一个换行(补的换行在用户字节之外,用户内容
 * 本身逐字节保留)。codex 专用:codex 只读一份用户级 config.toml,Adapter 生成层与用户层
 * 只能同文件分段共存(见 codex.ts setup 的布局说明)。
 */
export async function appendNativeConfigFile(sb: Sandbox, cfg: LoadedNativeConfig, destPath: string): Promise<void> {
  const tmp = tmpUploadPath();
  await sb.writeBytes(tmp, cfg.bytes);
  const res = await sb.runShell(
    `printf '\\n' >> ${destPath} && cat ${tmp} >> ${destPath} && printf '\\n' >> ${destPath} && rm -f ${tmp}`,
  );
  if (res.exitCode !== 0) {
    throw new Error(t("nativeConfig.uploadFailed", { path: cfg.path, dest: destPath, tail: outputTail(res) }));
  }
}

/**
 * 原生配置文件在安装 checkpoint key 里的条目。契约(docs/feature/adapters/architecture/
 * coding-agent-extensions.md「可复现性」):安装 checkpoint key 必须包含配置文件原始字节的
 * SHA-256,内容不同的两个配置文件不复用同一份安装缓存。claude-code / codex 当前没有跨沙箱
 * 安装缓存(每个沙箱的 setup 全量执行,不存在错配复用的通道);本函数是该条目的单一事实源
 * —— 为这两个 adapter 引入任何安装缓存(如 bub 式 checkpoint)时,key 必须并入本条目。
 */
export function nativeConfigCheckpointItem(agent: string, cfg: Pick<LoadedNativeConfig, "sha256">): string {
  return `--native-config(${agent}:sha256:${cfg.sha256})`;
}

function outputTail(res: { stdout: string; stderr: string }, n = 12): string {
  return (res.stdout + res.stderr).trim().split("\n").slice(-n).join("\n");
}
