// 泄题门:verifier / private 与 build context、相对 bind mount 的交叉检查。
// 过滤规则序列化进 BuildKey 输入面——BuildKey 本身的哈希在 sandbox identity 线计算,
// 本模块只提供规则求值、闭包判定与可序列化的规则面(见 docs/feature/sandbox/case.md「泄题门」)。

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";

export class LeakGateFileError extends Data.TaggedError("LeakGateFileError")<{
  readonly operation: "read-file" | "read-directory" | "hash";
  readonly path: string;
  readonly message: string;
}> {}

export class HiddenInputLeakError extends Data.TaggedError("HiddenInputLeakError")<{
  readonly findings: readonly LeakFinding[];
  readonly message: string;
}> {}

export class LeakGatePathError extends Data.TaggedError("LeakGatePathError")<{
  readonly path: string;
  readonly message: string;
}> {}

export type LeakGateError = LeakGateFileError | HiddenInputLeakError | LeakGatePathError;

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function fileError(
  operation: LeakGateFileError["operation"],
  path: string,
  cause: unknown,
): LeakGateFileError {
  return new LeakGateFileError({ operation, path, message: causeMessage(cause) });
}

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
export type BindMountPhase = "agent" | "assertions" | "any";

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
export function filterRulesForBuildKey(spec: BuildContextSpec): Effect.Effect<string[]> {
  return Effect.map(
    readDockerignoreLinesEffect(spec.dockerignorePath ?? join(spec.contextDir, ".dockerignore")),
    (fromFile) => {
      const extra = (spec.extraIgnoreRules ?? [])
        .map(normalizeIgnoreLine)
        .filter((line): line is string => line !== undefined);
      return [...fromFile, ...extra];
    },
  );
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
export function findHiddenInputLeaks(input: {
  readonly hidden: readonly HiddenInput[];
  readonly buildContexts: readonly BuildContextSpec[];
  readonly bindMounts?: readonly BindMountSpec[];
}): Effect.Effect<LeakFinding[]> {
  return Effect.gen(function* () {
    const findings: LeakFinding[] = [];
    const contextRules = yield* Effect.forEach(
      input.buildContexts,
      (ctx) => Effect.map(filterRulesForBuildKey(ctx), (rules) => ({ ctx, rules })),
      { concurrency: "unbounded" },
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
              `during the agent phase; mount it only for assertion evaluation on main, or keep it out of Agent-visible mounts.`,
          });
        }
      }
    }
    return findings;
  });
}

/** 有泄漏则抛启动期配置错误,文案列全部 findings。 */
export function assertNoHiddenInputLeaks(input: {
  readonly hidden: readonly HiddenInput[];
  readonly buildContexts: readonly BuildContextSpec[];
  readonly bindMounts?: readonly BindMountSpec[];
  /** 报错前缀(如 eval id)。 */
  readonly evalId?: string;
}): Effect.Effect<void, HiddenInputLeakError> {
  return Effect.flatMap(findHiddenInputLeaks(input), (findings) => {
    if (findings.length === 0) return Effect.void;
    const where = input.evalId ? `eval ${input.evalId}` : "eval";
    const body = findings
      .map((f, i) => `  ${i + 1}. [${f.kind} via ${f.via}] ${f.path}\n     ${f.detail}`)
      .join("\n");
    return Effect.fail(new HiddenInputLeakError({
      findings: Object.freeze([...findings]),
      message:
        `Hidden input leak gate failed for ${where}: ${findings.length} path(s) would reach the Agent environment.\n${body}`,
    }));
  });
}

/**
 * 枚举经 dockerignore 过滤后仍会进入 build context 的文件(相对 context 根,正斜杠)。
 * sandbox identity 线拿这份清单做 BuildKey 的 context 内容面。
 */
export function listFilteredBuildContextFiles(spec: BuildContextSpec): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const rules = yield* filterRulesForBuildKey(spec);
    const root = resolve(spec.contextDir);
    const out: string[] = [];
    const walk = (dir: string): Effect.Effect<void> => Effect.gen(function* () {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(dir, { withFileTypes: true }),
        // This scan intentionally treats an unreadable subtree as absent.
        catch: (cause) => fileError("read-directory", dir, cause),
      }).pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (entries === undefined) return;
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        const rel = relative(root, abs).split(sep).join("/");
        if (isIgnoredByDockerignore(rel, rules)) continue;
        if (entry.isDirectory()) {
          yield* walk(abs);
          continue;
        }
        if (entry.isFile()) out.push(rel);
      }
    });
    yield* walk(root);
    return out.sort();
  });
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
export function buildContextIdentityContribution(spec: BuildContextSpec): Effect.Effect<{
  contextFilterRules: string;
  contextDigest: string;
}, LeakGateFileError> {
  return Effect.gen(function* () {
    const rules = yield* filterRulesForBuildKey(spec);
    const files = yield* listFilteredBuildContextFiles(spec);
    const root = resolve(spec.contextDir);
    // The former for-loop was serial; preserve the same stream-open and hash order.
    const entries = yield* Effect.forEach(
      files,
      (rel): Effect.Effect<readonly [string, string], LeakGateFileError> =>
        Effect.map(streamFileDigestEffect(join(root, rel)), (digest) => [rel, digest] as const),
    );
    return {
      contextFilterRules: serializeContextFilterRules(rules),
      contextDigest: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    };
  });
}

/** CaseKey 用的普通宿主路径摘要：文件按字节，目录按相对路径 × 文件摘要。 */
export function pathContentDigest(path: string): Effect.Effect<string, LeakGateFileError | LeakGatePathError> {
  return Effect.gen(function* () {
    const root = resolve(path);
    const info = yield* Effect.tryPromise({
      try: () => stat(root),
      catch: (cause) => fileError("read-file", root, cause),
    }).pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (info === undefined) {
      return yield* Effect.fail(new LeakGatePathError({
        path: root,
        message: `Compose identity path not found at ${root}`,
      }));
    }
    if (info.isFile()) return yield* streamFileDigestEffect(root);
    if (!info.isDirectory()) {
      return yield* Effect.fail(new LeakGatePathError({
        path: root,
        message: `Compose identity path is not a file or directory: ${root}`,
      }));
    }
    const entries: Array<[string, string]> = [];
    const walk = (dir: string): Effect.Effect<void, LeakGateFileError> => Effect.gen(function* () {
      const children = yield* Effect.tryPromise({
        try: () => readdir(dir, { withFileTypes: true }),
        catch: (cause) => fileError("read-directory", dir, cause),
      });
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = join(dir, child.name);
        if (child.isDirectory()) {
          yield* walk(absolute);
        } else if (child.isFile()) {
          const digest = yield* streamFileDigestEffect(absolute);
          entries.push([relative(root, absolute).split(sep).join("/"), digest]);
        }
      }
    });
    yield* walk(root);
    return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  });
}

function streamFileDigestEffect(path: string): Effect.Effect<string, LeakGateFileError> {
  return Effect.scoped(
    Effect.acquireRelease(
      Effect.try({
        try: () => createReadStream(path),
        catch: (cause) => fileError("hash", path, cause),
      }),
      (stream) => Effect.sync(() => {
        if (!stream.destroyed) stream.destroy();
      }),
    ).pipe(
      Effect.flatMap((stream) => Effect.tryPromise({
        try: async (signal) => {
          const abort = (): void => {
            if (!stream.destroyed) {
              stream.destroy(signal.reason instanceof Error ? signal.reason : undefined);
            }
          };
          if (signal.aborted) abort();
          signal.addEventListener("abort", abort, { once: true });
          try {
            const hasher = createHash("sha256");
            for await (const chunk of stream) hasher.update(chunk as Buffer);
            return hasher.digest("hex");
          } finally {
            signal.removeEventListener("abort", abort);
          }
        },
        catch: (cause) => fileError("hash", path, cause),
      })),
    ),
  );
}

function readDockerignoreLinesEffect(path: string): Effect.Effect<string[]> {
  return Effect.tryPromise({
    try: () => readFile(path, "utf-8"),
    // A missing or unreadable .dockerignore was historically equivalent to no rules.
    catch: (cause) => fileError("read-file", path, cause),
  }).pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.map((raw) => {
      const out: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const normalized = normalizeIgnoreLine(line);
        if (normalized !== undefined) out.push(normalized);
      }
      return out;
    }),
  );
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
export function pathKind(path: string): Effect.Effect<"file" | "directory" | "missing"> {
  return Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) => fileError("read-file", path, cause),
  }).pipe(
    Effect.map((info) => info.isDirectory() ? "directory" as const : info.isFile() ? "file" as const : "missing" as const),
    Effect.catch(() => Effect.succeed("missing" as const)),
  );
}
