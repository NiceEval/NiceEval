// 泄题门:verifier / private 与 build context、相对 bind mount 的交叉检查。
// 过滤规则序列化进 BuildKey 输入面——BuildKey 本身的哈希在 sandbox identity 线计算,
// 本模块只提供规则求值、闭包判定与可序列化的规则面(见 docs/feature/sandbox/case.md「泄题门」)。

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";

/** 隐藏输入种类:verifier 可在判分期挂进 main;private 任何阶段都不能挂入。 */
export type HiddenInputKind = "verifier" | "private";

export interface HiddenInput {
  /** 绝对路径。 */
  readonly path: string;
  readonly kind: HiddenInputKind;
}

/**
 * 一个 Docker / OCI build context。`extraIgnoreRules` 是 materializer 生成的
 * filtered-context 等价规则(dockerignore 语法),与文件内 `.dockerignore` 按声明顺序拼接后求值。
 */
export interface BuildContextSpec {
  /** build context 根目录(绝对路径)。 */
  readonly contextDir: string;
  /** `.dockerignore` 绝对路径;省略则读 `contextDir/.dockerignore`(不存在视为空规则)。 */
  readonly dockerignorePath?: string;
  /** materializer 追加的过滤规则,dockerignore 语法。 */
  readonly extraIgnoreRules?: readonly string[];
  /** 报错时点名用(如 Compose 服务名)。 */
  readonly label?: string;
}

/** bind mount 对 Agent 可见面的阶段。 */
export type BindMountPhase = "agent" | "scoring" | "any";

export interface BindMountSpec {
  /** 宿主机源路径(绝对;文件或目录)。 */
  readonly source: string;
  /** 挂载生效阶段。 */
  readonly phase: BindMountPhase;
  /** 是否挂到 Agent 可达服务(main 或 Agent 可交互的 sidecar)。 */
  readonly agentReachable: boolean;
  readonly label?: string;
}

export interface LeakFinding {
  readonly path: string;
  readonly kind: HiddenInputKind;
  readonly via: "build-context" | "bind-mount";
  readonly detail: string;
}

/** sandbox source 可贴在 environment 对象上的泄题门提示(发现期自动交叉检查)。 */
export interface LeakGateHints {
  readonly buildContexts: readonly BuildContextSpec[];
  readonly bindMounts?: readonly BindMountSpec[];
}

const LEAK_GATE_HINTS = Symbol.for("niceeval.leakGateHints");

/** 把泄题门提示挂到 folder-local sandbox source 上,供 discover 在发现期读取。 */
export function attachLeakGateHints<T extends object>(source: T, hints: LeakGateHints): T {
  Object.defineProperty(source, LEAK_GATE_HINTS, {
    value: hints,
    enumerable: false,
    configurable: true,
  });
  return source;
}

/** 从 environment 值读取泄题门提示;没有挂载则 undefined。 */
export function getLeakGateHints(environment: unknown): LeakGateHints | undefined {
  if (environment === null || typeof environment !== "object") return undefined;
  const hints = (environment as Record<symbol, unknown>)[LEAK_GATE_HINTS];
  if (!hints || typeof hints !== "object") return undefined;
  const buildContexts = (hints as LeakGateHints).buildContexts;
  if (!Array.isArray(buildContexts)) return undefined;
  return hints as LeakGateHints;
}

/**
 * 读 `.dockerignore` + extra 规则,返回进入 BuildKey 的过滤规则面。
 * 顺序保留(后写覆盖先写);空行与注释剥掉;路径分隔统一为正斜杠。
 */
export async function filterRulesForBuildKey(spec: BuildContextSpec): Promise<string[]> {
  const fromFile = await readDockerignoreLines(spec.dockerignorePath ?? join(spec.contextDir, ".dockerignore"));
  const extra = (spec.extraIgnoreRules ?? []).map(normalizeIgnoreLine).filter((line): line is string => line !== undefined);
  return [...fromFile, ...extra];
}

/**
 * 判定相对 context 根的路径在给定规则下是否被忽略。
 * 语义对齐 Docker:默认全收;pattern 排除;`!` 例外;最后一个命中的 pattern 定案。
 */
export function isIgnoredByDockerignore(relativePath: string, rules: readonly string[]): boolean {
  const path = relativePath.split(sep).join("/");
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(path, rule)) ignored = !rule.startsWith("!");
  }
  return ignored;
}

/** 交叉检查:返回全部泄漏项(不抛)。 */
export async function findHiddenInputLeaks(input: {
  readonly hidden: readonly HiddenInput[];
  readonly buildContexts: readonly BuildContextSpec[];
  readonly bindMounts?: readonly BindMountSpec[];
}): Promise<LeakFinding[]> {
  const findings: LeakFinding[] = [];
  const contextRules = await Promise.all(
    input.buildContexts.map(async (ctx) => ({ ctx, rules: await filterRulesForBuildKey(ctx) })),
  );

  for (const hidden of input.hidden) {
    const abs = resolve(hidden.path);
    for (const { ctx, rules } of contextRules) {
      const contextRoot = resolve(ctx.contextDir);
      if (!isInside(abs, contextRoot)) continue;
      const rel = relative(contextRoot, abs).split(sep).join("/");
      if (isIgnoredByDockerignore(rel, rules)) continue;
      const label = ctx.label ?? contextRoot;
      findings.push({
        path: abs,
        kind: hidden.kind,
        via: "build-context",
        detail:
          `${hidden.kind} file still enters build context ${label} as ${rel}. ` +
          `Move it out of the context, add it to .dockerignore, or declare an equivalent filtered-context rule ` +
          `(filter rules themselves enter BuildKey).`,
      });
    }

    for (const mount of input.bindMounts ?? []) {
      if (!pathCoveredByMount(abs, resolve(mount.source))) continue;
      if (hidden.kind === "private") {
        findings.push({
          path: abs,
          kind: "private",
          via: "bind-mount",
          detail:
            `private file is bind-mounted via ${mount.label ?? mount.source} ` +
            `(phase=${mount.phase}); private paths must never be mounted.`,
        });
        continue;
      }
      // verifier: Agent 阶段挂入可达服务才算泄。
      const agentPhase = mount.phase === "agent" || mount.phase === "any";
      if (mount.agentReachable && agentPhase) {
        findings.push({
          path: abs,
          kind: "verifier",
          via: "bind-mount",
          detail:
            `verifier file is bind-mounted into an Agent-reachable service via ${mount.label ?? mount.source} ` +
            `during the agent phase; mount it only for scoring on main, or keep it out of Agent-visible mounts.`,
        });
      }
    }
  }
  return findings;
}

/** 有泄漏则抛启动期配置错误,文案列全部 findings。 */
export async function assertNoHiddenInputLeaks(input: {
  readonly hidden: readonly HiddenInput[];
  readonly buildContexts: readonly BuildContextSpec[];
  readonly bindMounts?: readonly BindMountSpec[];
  /** 报错前缀(如 eval id)。 */
  readonly evalId?: string;
}): Promise<void> {
  const findings = await findHiddenInputLeaks(input);
  if (findings.length === 0) return;
  const where = input.evalId ? `eval ${input.evalId}` : "eval";
  const body = findings
    .map((f, i) => `  ${i + 1}. [${f.kind} via ${f.via}] ${f.path}\n     ${f.detail}`)
    .join("\n");
  throw new Error(
    `Hidden input leak gate failed for ${where}: ${findings.length} path(s) would reach the Agent environment.\n${body}`,
  );
}

/**
 * 枚举经 dockerignore 过滤后仍会进入 build context 的文件(相对 context 根,正斜杠)。
 * sandbox identity 线拿这份清单做 BuildKey 的 context 内容面。
 */
export async function listFilteredBuildContextFiles(spec: BuildContextSpec): Promise<string[]> {
  const rules = await filterRulesForBuildKey(spec);
  const root = resolve(spec.contextDir);
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
    if (!entries) return;
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (isIgnoredByDockerignore(rel, rules)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile()) out.push(rel);
    }
  };
  await walk(root);
  return out.sort();
}

/**
 * 压成 `BuildKeyInput.contextFilterRules` 的字符串面(与 sandbox/identity.ts 对齐)。
 * 行序保留——dockerignore 后写覆盖先写,打乱顺序会改变求值结果。
 */
export function serializeContextFilterRules(rules: readonly string[]): string {
  return rules.join("\n");
}

/**
 * 一次算出 BuildKey 需要的两格:
 * - `contextFilterRules`:过滤规则自身
 * - `contextDigest`:求值后仍进入 context 的「相对路径 × 内容 sha256」稳定摘要
 *
 * 调用方把它填进 `computeBuildKey({ contextDigest, contextFilterRules, ... })`。
 */
export async function buildContextIdentityContribution(spec: BuildContextSpec): Promise<{
  contextFilterRules: string;
  contextDigest: string;
}> {
  const rules = await filterRulesForBuildKey(spec);
  const files = await listFilteredBuildContextFiles(spec);
  const root = resolve(spec.contextDir);
  const entries: Array<[string, string]> = [];
  for (const rel of files) {
    const hasher = createHash("sha256");
    const stream = createReadStream(join(root, rel));
    stream.on("data", (chunk: string | Buffer) => hasher.update(chunk));
    await finished(stream);
    entries.push([rel, hasher.digest("hex")]);
  }
  return {
    contextFilterRules: serializeContextFilterRules(rules),
    contextDigest: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
}

/** CaseKey 用的普通宿主路径摘要：文件按字节，目录按相对路径 × 文件摘要。 */
export async function pathContentDigest(path: string): Promise<string> {
  const root = resolve(path);
  const info = await stat(root).catch(() => undefined);
  if (info === undefined) throw new Error(`Compose identity path not found at ${root}`);
  if (info.isFile()) return streamFileDigest(root);
  if (!info.isDirectory()) throw new Error(`Compose identity path is not a file or directory: ${root}`);
  const entries: Array<[string, string]> = [];
  const walk = async (dir: string): Promise<void> => {
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, child.name);
      if (child.isDirectory()) {
        await walk(absolute);
      } else if (child.isFile()) {
        entries.push([relative(root, absolute).split(sep).join("/"), await streamFileDigest(absolute)]);
      }
    }
  };
  await walk(root);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function streamFileDigest(path: string): Promise<string> {
  const hasher = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk: string | Buffer) => hasher.update(chunk));
  await finished(stream);
  return hasher.digest("hex");
}

async function readDockerignoreLines(path: string): Promise<string[]> {
  const raw = await readFile(path, "utf-8").catch(() => "");
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const normalized = normalizeIgnoreLine(line);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeIgnoreLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return undefined;
  // Docker 允许可选的前导 `/` 表示相对 context 根;统一去掉便于匹配。
  const body = trimmed.startsWith("!") ? `!${trimmed.slice(1).replace(/^\//, "")}` : trimmed.replace(/^\//, "");
  return body.split(sep).join("/");
}

function ruleMatches(path: string, rule: string): boolean {
  const body = rule.startsWith("!") ? rule.slice(1) : rule;
  if (body === "") return false;
  // 目录规则:以 `/` 结尾只匹配该目录及其子孙。
  if (body.endsWith("/")) {
    const dir = body.slice(0, -1);
    return path === dir || path.startsWith(`${dir}/`);
  }
  if (body.includes("/")) {
    return matchGlob(path, body) || matchGlob(path, `${body}/**`);
  }
  // 无斜杠:匹配任意段同名文件/目录及其下。
  const segments = path.split("/");
  if (segments.some((seg) => matchGlob(seg, body))) return true;
  return segments.some((_, i) => matchGlob(segments.slice(i).join("/"), body));
}

/** 极简 glob:`*` 不跨段,`**` 跨段,`?` 单字符。dockerignore 够用的子集。 */
function matchGlob(text: string, pattern: string): boolean {
  const regex = globToRegExp(pattern);
  return regex.test(text);
}

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if ("+.^$()[]{}|\\".includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  out += "$";
  return new RegExp(out);
}

function isInside(abs: string, root: string): boolean {
  const a = resolve(abs);
  const r = resolve(root);
  return a === r || a.startsWith(`${r}${sep}`);
}

function pathCoveredByMount(abs: string, mountSource: string): boolean {
  if (abs === mountSource) return true;
  if (abs.startsWith(`${mountSource}${sep}`)) return true;
  // mount 源是文件时只等值;源是目录时上面已覆盖。若 mount 源尚不存在,按路径前缀保守判定。
  return false;
}

/** 供测试与调用方确认某路径当前是否文件/目录(可选;泄题门本身不依赖存在性)。 */
export async function pathKind(path: string): Promise<"file" | "directory" | "missing"> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return "missing";
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  return "missing";
}
