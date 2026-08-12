// 留存沙箱的持久注册表:`.niceeval/sandboxes/` 下的逐条目文件(不是多个 attempt 竞争改写的
// 一份 JSON)。entry id 由 provider + sandboxId 做稳定散列;每条走 shared/entry-file-store.ts
// 的原子写纪律(临时文件 → fsync 文件 → rename → fsync 目录)——不同 attempt 与不同 niceeval
// 进程不会覆盖彼此。
// 契约见 docs/feature/sandbox/architecture.md「留存(keep)与注册表」。
//
// 条目旁独立的 `.lease` 文件是另一套机制(短命的操作互斥,见 acquireKeptLease 一节),不走
// entry-file-store 的原子写纪律——lease 的持有点是 `wx` 独占创建本身,不需要 tmp+rename。

import { mkdir, open, readdir, readFile, rm, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Data, Effect } from "effect";
import {
  fsyncDirEffect,
  hashEntryId,
  readEntryFileEffect,
  writeEntryFileEffect,
} from "../shared/entry-file-store.ts";
import type { Verdict } from "../types.ts";

/** 一条留存登记项(逐条目文件的 JSON 形状)。 */
export interface KeptSandboxEntry {
  sandboxId: string;
  provider: string;
  evalId: string;
  attempt: number;
  experimentId?: string;
  locator: string;
  verdict: Verdict;
  keptAt: string;
  workdir: string;
  /** provider 原生的进入命令(直连与审计用);日常入口是 `niceeval sandbox enter`。 */
  enter?: string;
  /** 现场可找回的截止时刻——provider 声明了保留期限才写(vercel 写,e2b pause 无限期保留则不写)。 */
  expiresAt?: string;
  /** alive = 实例在跑;dormant = 可唤醒;expired = 确认不存在;unknown = 探测失败。 */
  state: "alive" | "dormant" | "expired" | "unknown";
}

/** 条目旁独立 lease 文件的内容。注册表条目本体不承载短暂互斥状态。 */
export interface KeptSandboxLease {
  holder: string;
  op: string;
  acquiredAt: string;
  ttlMs: number;
}

interface PersistedKeptSandboxLease extends KeptSandboxLease {
  token?: string;
}

/** 注册表自己的可恢复 I/O 失败；损坏或缺失的逐条目数据仍是成功 ADT。 */
export class KeptSandboxRegistryError extends Data.TaggedError("KeptSandboxRegistryError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export type KeptSandboxRegistryEffect<A> = Effect.Effect<A, KeptSandboxRegistryError>;
type RegistryEffect<A> = KeptSandboxRegistryEffect<A>;

function registryError(operation: string, cause: unknown): KeptSandboxRegistryError {
  return new KeptSandboxRegistryError({ operation, cause });
}

/** Node Promise 边界：传入 Effect 的 signal，因而 fiber interruption 能传给支持 AbortSignal 的调用。 */
function nodeIo<A>(operation: string, run: (signal: AbortSignal) => Promise<A>): RegistryEffect<A> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => registryError(operation, cause),
  });
}

function errnoCode(cause: unknown): string | undefined {
  const original = cause instanceof KeptSandboxRegistryError ? cause.cause : cause;
  return typeof original === "object" && original !== null && "code" in original && typeof original.code === "string"
    ? original.code
    : undefined;
}

function isAbsent(cause: unknown): boolean {
  const code = errnoCode(cause);
  return code === "ENOENT" || code === "ENOTDIR";
}

function withOpenFile<A>(
  operation: string,
  path: string,
  flags: string,
  use: (handle: FileHandle) => RegistryEffect<A>,
): RegistryEffect<A> {
  return Effect.scoped(
    Effect.acquireRelease(
      nodeIo(`${operation}: open`, (signal) => open(path, flags)),
      (handle) => nodeIo(`${operation}: close`, () => handle.close()).pipe(Effect.orDie),
    ).pipe(Effect.flatMap(use)),
  );
}

function readTextIfPresentEffect(path: string, operation: string): RegistryEffect<string | undefined> {
  return nodeIo(operation, (signal) => readFile(path, { encoding: "utf-8", signal })).pipe(
    Effect.catchAll((cause) => isAbsent(cause) ? Effect.succeed(undefined) : Effect.fail(cause)),
  );
}

function readDirectoryIfPresentEffect(path: string, operation: string): RegistryEffect<string[] | undefined> {
  return nodeIo(operation, (signal) => readdir(path)).pipe(
    Effect.catchAll((cause) => isAbsent(cause) ? Effect.succeed(undefined) : Effect.fail(cause)),
  );
}

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as globalThis.Record<string, unknown>
    : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isVerdict(value: unknown): value is Verdict {
  return value === "passed" || value === "failed" || value === "errored" || value === "skipped";
}

function isKeptSandboxState(value: unknown): value is KeptSandboxEntry["state"] {
  return value === "alive" || value === "dormant" || value === "expired" || value === "unknown";
}

/** 留存条目的全部字段均在磁盘边界验证，特别是两个字符串联合与可选时间字段。 */
function decodeKeptSandboxEntry(value: unknown): KeptSandboxEntry | undefined {
  const record = recordOf(value);
  if (
    record === undefined ||
    typeof record.sandboxId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.evalId !== "string" ||
    !isNonNegativeInteger(record.attempt) ||
    (record.experimentId !== undefined && typeof record.experimentId !== "string") ||
    typeof record.locator !== "string" ||
    !isVerdict(record.verdict) ||
    !isTimestamp(record.keptAt) ||
    typeof record.workdir !== "string" ||
    (record.enter !== undefined && typeof record.enter !== "string") ||
    (record.expiresAt !== undefined && !isTimestamp(record.expiresAt)) ||
    !isKeptSandboxState(record.state)
  ) {
    return undefined;
  }
  return {
    sandboxId: record.sandboxId,
    provider: record.provider,
    evalId: record.evalId,
    attempt: record.attempt,
    ...(record.experimentId === undefined ? {} : { experimentId: record.experimentId }),
    locator: record.locator,
    verdict: record.verdict,
    keptAt: record.keptAt,
    workdir: record.workdir,
    ...(record.enter === undefined ? {} : { enter: record.enter }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    state: record.state,
  };
}

/** lease 同样来自持久 JSON；token 是内部互斥凭据，可选但类型必须正确。 */
function decodeKeptSandboxLease(value: unknown): PersistedKeptSandboxLease | undefined {
  const record = recordOf(value);
  if (
    record === undefined ||
    typeof record.holder !== "string" ||
    typeof record.op !== "string" ||
    !isTimestamp(record.acquiredAt) ||
    !isPositiveInteger(record.ttlMs) ||
    (record.token !== undefined && typeof record.token !== "string")
  ) {
    return undefined;
  }
  return {
    holder: record.holder,
    op: record.op,
    acquiredAt: record.acquiredAt,
    ttlMs: record.ttlMs,
    ...(record.token === undefined ? {} : { token: record.token }),
  };
}

/** entry id:provider + sandboxId 的稳定散列(条目文件名)。 */
export function keptEntryId(provider: string, sandboxId: string): string {
  return hashEntryId([provider, sandboxId]);
}

export function sandboxesDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "sandboxes");
}

function leasePath(niceevalRoot: string, id: string): string {
  return join(sandboxesDirOf(niceevalRoot), `${id}.lease`);
}

/** 读取当前 lease；坏文件也视为占坑，避免在不明状态下并发操作现场。 */
function readPersistedKeptLeaseEffect(
  niceevalRoot: string,
  id: string,
): RegistryEffect<PersistedKeptSandboxLease | undefined> {
  return readTextIfPresentEffect(leasePath(niceevalRoot, id), "read kept sandbox lease").pipe(
    Effect.map((raw) => {
      if (raw === undefined) return undefined;
      try {
        return decodeKeptSandboxLease(JSON.parse(raw));
      } catch {
        return undefined;
      }
    }),
  );
}

export function readKeptLeaseEffect(niceevalRoot: string, id: string): RegistryEffect<KeptSandboxLease | undefined> {
  return readPersistedKeptLeaseEffect(niceevalRoot, id).pipe(
    Effect.map((lease) => lease === undefined
      ? undefined
      : {
          holder: lease.holder,
          op: lease.op,
          acquiredAt: lease.acquiredAt,
          ttlMs: lease.ttlMs,
        }),
  );
}

function createKeptLeaseExclusiveEffect(
  dir: string,
  id: string,
  payload: PersistedKeptSandboxLease,
): RegistryEffect<boolean> {
  const path = leasePathFromDir(dir, id);
  return nodeIo("create kept sandbox lease directory", () => mkdir(dir, { recursive: true })).pipe(
    Effect.zipRight(
      withOpenFile("create kept sandbox lease", path, "wx", (handle) =>
        nodeIo(
          "write kept sandbox lease",
          (signal) => handle.writeFile(JSON.stringify(payload), { encoding: "utf-8", signal }),
        ).pipe(
          Effect.zipRight(nodeIo("sync kept sandbox lease", () => handle.sync())),
        )),
    ),
    Effect.as(true),
    Effect.catchAll((cause) => errnoCode(cause) === "EEXIST" ? Effect.succeed(false) : Effect.fail(cause)),
  );
}

function leasePathFromDir(dir: string, id: string): string {
  return join(dir, `${id}.lease`);
}

/**
 * 原子占坑：`wx` 是唯一持有点。TTL 到期时先移除旧文件、再重新竞争；因此旧持有者 finally
 * 只会尝试删除带自己 token 的文件，绝不剥离后来者。
 */
export function acquireKeptLeaseEffect(
  niceevalRoot: string,
  id: string,
  lease: KeptSandboxLease,
): RegistryEffect<{ acquired: true; token: string } | { acquired: false; lease: KeptSandboxLease }> {
  const dir = sandboxesDirOf(niceevalRoot);
  const path = leasePathFromDir(dir, id);
  return Effect.gen(function* () {
    const token = `${lease.holder}:${lease.acquiredAt}:${Math.random().toString(36).slice(2)}`;
    const payload = { ...lease, token };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (yield* createKeptLeaseExclusiveEffect(dir, id, payload)) return { acquired: true, token };
      const current = yield* readKeptLeaseEffect(niceevalRoot, id);
      if (current && Date.now() - Date.parse(current.acquiredAt) < current.ttlMs) {
        return { acquired: false, lease: current };
      }
      // 过期或损坏的 lease 可以被接管；unlink 后所有竞争者重新 wx，不能覆盖彼此。
      yield* nodeIo("remove expired kept sandbox lease", () => rm(path, { force: true }));
    }
    const current = yield* readKeptLeaseEffect(niceevalRoot, id);
    return { acquired: false, lease: current ?? lease };
  });
}

export function releaseKeptLeaseEffect(niceevalRoot: string, id: string, token: string): RegistryEffect<void> {
  const path = leasePath(niceevalRoot, id);
  return readPersistedKeptLeaseEffect(niceevalRoot, id).pipe(
    Effect.flatMap((current) => current?.token === token
      ? nodeIo("release kept sandbox lease", () => rm(path, { force: true }))
      : Effect.void),
  );
}

/**
 * 注册表发现:从 cwd 向上找最近的 `.niceeval/`(与结果根发现同一规则)。
 * 找不到返回 undefined,调用方报错并提示 `--run <结果根>`。
 */
export function findNiceevalRootEffect(cwd: string): RegistryEffect<string | undefined> {
  return Effect.gen(function* () {
    let current = resolve(cwd);
    for (;;) {
      const candidate = join(current, ".niceeval");
      const entries = yield* readDirectoryIfPresentEffect(candidate, "find .niceeval directory");
      if (entries !== undefined) return candidate;
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  });
}

/** 原子写入一条登记项(委托给共享层的 write-tmp-then-rename 纪律)。 */
export function writeKeptEntryEffect(niceevalRoot: string, entry: KeptSandboxEntry): RegistryEffect<void> {
  const id = keptEntryId(entry.provider, entry.sandboxId);
  return writeEntryFileEffect(sandboxesDirOf(niceevalRoot), id, entry).pipe(
    Effect.mapError((cause) => registryError("write kept sandbox entry", cause)),
  );
}

/**
 * 读全部登记项(坏条目跳过并记名,不整体失败)。逐条目解析走共享层的 `readEntryFile`(损坏
 * 返回 undefined、不抛错);目录扫描与 malformed 文件名收集是留存注册表自己的诊断需求
 * (`readAllEntryFiles` 只做静默跳过,不回传坏文件名),因此这里保留自己的扫描循环。
 */
export function readKeptEntriesEffect(
  niceevalRoot: string,
): RegistryEffect<{ entries: { id: string; entry: KeptSandboxEntry }[]; malformed: string[] }> {
  const dir = sandboxesDirOf(niceevalRoot);
  return Effect.gen(function* () {
    const files = (yield* readDirectoryIfPresentEffect(dir, "read kept sandbox registry directory")) ?? [];
    const decoded = yield* Effect.forEach(files, (file) => {
      if (!file.endsWith(".json") || file.startsWith(".")) return Effect.succeed(undefined);
      const id = file.slice(0, -".json".length);
      return readEntryFileEffect(dir, id, decodeKeptSandboxEntry).pipe(
        Effect.mapError((cause) => registryError("read kept sandbox entry", cause)),
        Effect.map((entry) => ({ file, id, entry })),
      );
    });
    const entries: { id: string; entry: KeptSandboxEntry }[] = [];
    const malformed: string[] = [];
    for (const decodedEntry of decoded) {
      if (decodedEntry === undefined) continue;
      if (decodedEntry.entry === undefined) malformed.push(decodedEntry.file);
      else entries.push({ id: decodedEntry.id, entry: decodedEntry.entry });
    }
    entries.sort((a, b) => a.entry.keptAt.localeCompare(b.entry.keptAt));
    return { entries, malformed };
  });
}

/** 更新一条登记项(读-改-原子写;字段浅合并)。条目不存在时静默返回 false。 */
export function updateKeptEntryEffect(
  niceevalRoot: string,
  id: string,
  patch: Partial<KeptSandboxEntry> | ((entry: KeptSandboxEntry) => KeptSandboxEntry),
): RegistryEffect<boolean> {
  const dir = sandboxesDirOf(niceevalRoot);
  return readEntryFileEffect(dir, id, decodeKeptSandboxEntry).pipe(
    Effect.mapError((cause) => registryError("read kept sandbox entry for update", cause)),
    Effect.flatMap((entry) => {
      if (entry === undefined) return Effect.succeed(false);
      const next = typeof patch === "function" ? patch(entry) : { ...entry, ...patch };
      return writeKeptEntryEffect(niceevalRoot, next).pipe(Effect.as(true));
    }),
  );
}

/** 删除一条登记项并同步目录(只在实例成功销毁或确认已不存在后调用)。 */
export function removeKeptEntryEffect(niceevalRoot: string, id: string): RegistryEffect<void> {
  const dir = sandboxesDirOf(niceevalRoot);
  return nodeIo("remove kept sandbox entry", () => rm(join(dir, `${id}.json`), { force: true })).pipe(
    Effect.zipRight(
      fsyncDirEffect(dir).pipe(Effect.mapError((cause) => registryError("sync kept sandbox registry directory", cause))),
    ),
  );
}
