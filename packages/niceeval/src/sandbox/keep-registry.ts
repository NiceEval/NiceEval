// 留存沙箱的持久注册表:`.niceeval/sandboxes/` 下的逐条目文件(不是多个 attempt 竞争改写的
// 一份 JSON)。entry id 由 provider + sandboxId 做稳定散列;每条走 shared/entry-file-store.ts
// 的原子写纪律(临时文件 → fsync 文件 → rename → fsync 目录)——不同 attempt 与不同 niceeval
// 进程不会覆盖彼此。
// 契约见 docs/feature/sandbox/architecture.md「留存(keep)与注册表」。
//
// 条目旁独立的 `.lease` 文件是另一套机制(短命的操作互斥,见 acquireKeptLease 一节),不走
// entry-file-store 的原子写纪律——lease 的持有点是 `wx` 独占创建本身,不需要 tmp+rename。

import { readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Data, Effect, Result, Schema } from "effect";
import type { KeptSandboxLeaseRow, KeptSandboxRow } from "../coordination/platform/sqlite-registries.ts";
import {
  ProjectStateDatabase,
  type KeepFacet,
  type ProjectStateFacets,
} from "../record/sqlite/project-state-database.ts";
import { hashEntryId } from "../shared/entry-file-store.ts";
import { processIdentityForPidEffect } from "../runner/shared-state-lease.ts";
import type { Verdict } from "../types.ts";

function registryEffect<A>(root: string, operation: (facets: ProjectStateFacets) => Promise<A>): Effect.Effect<A, unknown, ProjectStateDatabase> {
  return Effect.flatMap(ProjectStateDatabase, (database) => Effect.flatMap(database.bind(root), (facets) =>
    Effect.tryPromise({ try: () => operation(facets), catch: (cause) => cause })));
}
function getKeptSandboxLease(root: string, id: string) { return registryEffect<KeptSandboxLeaseRow | undefined>(root, (facets) => facets.keep.getLease(id)); }
function acquireKeptSandboxLease(input: Omit<Parameters<KeepFacet["acquireLease"]>[0], "_tag"> & { readonly root: string }) {
  const { root, ...command } = input;
  return registryEffect(root, (facets) => facets.keep.acquireLease({ _tag: "keep-lease-acquire", ...command }));
}
function releaseKeptSandboxLease(input: Omit<Parameters<KeepFacet["releaseLease"]>[0], "_tag"> & { readonly root: string }) {
  const { root, ...command } = input;
  return registryEffect(root, (facets) => facets.keep.releaseLease({ _tag: "keep-lease-release", ...command }));
}
function putKeptSandbox(input: Omit<Parameters<KeepFacet["put"]>[0], "_tag"> & { readonly root: string }) {
  const { root, ...command } = input;
  return registryEffect(root, (facets) => facets.keep.put({ _tag: "keep-put", ...command }));
}
function listKeptSandboxes(root: string) { return registryEffect<readonly KeptSandboxRow[]>(root, (facets) => facets.keep.list()); }
function getKeptSandbox(root: string, id: string) { return registryEffect<KeptSandboxRow | undefined>(root, (facets) => facets.keep.get(id)); }
function updateKeptSandbox(root: string, id: string, payload: Uint8Array) { return registryEffect<boolean>(root, (facets) => facets.keep.update(id, payload)); }
function deleteKeptSandbox(root: string, id: string) { return registryEffect<void>(root, (facets) => facets.keep.delete(id)); }
type ProjectDatabaseRequirement = ProjectStateDatabase;

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
  generation?: number;
  ownerPid?: number;
  ownerHost?: string;
  ownerProcessIdentity?: string;
}

/** 注册表自己的可恢复 I/O 失败；损坏或缺失的逐条目数据仍是成功 ADT。 */
export class KeptSandboxRegistryError extends Data.TaggedError("KeptSandboxRegistryError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export type KeptSandboxRegistryEffect<A> = Effect.Effect<A, KeptSandboxRegistryError, ProjectDatabaseRequirement>;
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

function readDirectoryIfPresentEffect(path: string, operation: string): RegistryEffect<string[] | undefined> {
  return nodeIo(operation, (signal) => readdir(path)).pipe(
    Effect.catch((cause) => isAbsent(cause) ? Effect.succeed(undefined) : Effect.fail(cause)),
  );
}

const NonNegativeSafeIntegerSchema = Schema.Number.pipe(Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0, { identifier: "NonNegativeSafeInteger" })));

const PositiveSafeIntegerSchema = Schema.Number.pipe(Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0, { identifier: "PositiveSafeInteger" })));

const TimestampSchema = Schema.String.pipe(Schema.check(Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), { identifier: "Timestamp" })));

const KeptSandboxEntrySchema = Schema.Struct({
  sandboxId: Schema.String,
  provider: Schema.String,
  evalId: Schema.String,
  attempt: NonNegativeSafeIntegerSchema,
  experimentId: Schema.optional(Schema.String),
  locator: Schema.String,
  verdict: Schema.Literals(["passed", "failed", "errored", "skipped"]),
  keptAt: TimestampSchema,
  workdir: Schema.String,
  enter: Schema.optional(Schema.String),
  expiresAt: Schema.optional(TimestampSchema),
  state: Schema.Literals(["alive", "dormant", "expired", "unknown"]),
});

const PersistedKeptSandboxLeaseSchema = Schema.Struct({
  holder: Schema.String,
  op: Schema.String,
  acquiredAt: TimestampSchema,
  ttlMs: PositiveSafeIntegerSchema,
  token: Schema.optional(Schema.String),
  generation: Schema.optional(PositiveSafeIntegerSchema),
  ownerPid: Schema.optional(PositiveSafeIntegerSchema),
  ownerHost: Schema.optional(Schema.String),
  ownerProcessIdentity: Schema.optional(Schema.String),
});

/** 留存条目的全部字段均在磁盘边界验证，特别是两个字符串联合与可选时间字段。 */
function decodeKeptSandboxEntry(value: unknown): KeptSandboxEntry | undefined {
  const decoded = Schema.decodeUnknownResult(KeptSandboxEntrySchema)(value);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** lease 同样来自持久 JSON；token 是内部互斥凭据，可选但类型必须正确。 */
function decodeKeptSandboxLease(value: unknown): PersistedKeptSandboxLease | undefined {
  const decoded = Schema.decodeUnknownResult(PersistedKeptSandboxLeaseSchema)(value);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** entry id:provider + sandboxId 的稳定散列(条目文件名)。 */
export function keptEntryId(provider: string, sandboxId: string): string {
  return hashEntryId([provider, sandboxId]);
}

export function sandboxesDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "sandboxes");
}

/** 读取当前 lease；坏文件也视为占坑，避免在不明状态下并发操作现场。 */
function readPersistedKeptLeaseEffect(
  niceevalRoot: string,
  id: string,
): RegistryEffect<PersistedKeptSandboxLease | undefined> {
  return getKeptSandboxLease(niceevalRoot, id).pipe(
    Effect.map((lease): PersistedKeptSandboxLease | undefined => lease === undefined ? undefined : ({
      holder: lease.holder,
      op: lease.operation,
      acquiredAt: lease.acquiredAt,
      ttlMs: lease.ttlMs,
      token: lease.token,
      generation: lease.generation,
      ownerPid: lease.ownerPid,
      ownerHost: lease.ownerHost,
      ownerProcessIdentity: lease.ownerProcessIdentity,
    })),
    Effect.mapError((cause) => registryError("read kept sandbox lease", cause)),
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

/**
 * SQLite row CAS is the sole acquisition point. TTL remains diagnostic and
 * never authorizes takeover of a live or unverifiable exact owner.
 */
export function acquireKeptLeaseEffect(
  niceevalRoot: string,
  id: string,
  lease: KeptSandboxLease,
): RegistryEffect<{ acquired: true; token: string } | { acquired: false; lease: KeptSandboxLease }> {
  return Effect.gen(function* () {
    const processIdentity = yield* processIdentityForPidEffect(process.pid).pipe(
      Effect.mapError((cause) => registryError("establish kept sandbox lease owner identity", cause)),
      Effect.flatMap((identity) => identity === undefined
        ? Effect.fail(registryError("establish kept sandbox lease owner identity", new Error("current process identity is unavailable")))
        : Effect.succeed(identity)),
    );
    const ownerHost = hostname();
    const secret = crypto.randomUUID();
    const acquired = yield* acquireKeptSandboxLease({
      root: niceevalRoot,
      id,
      token: secret,
      holder: lease.holder,
      operation: lease.op,
      acquiredAt: lease.acquiredAt,
      ttlMs: lease.ttlMs,
      ownerPid: process.pid,
      ownerHost,
      ownerProcessIdentity: processIdentity,
    }).pipe(Effect.mapError((cause) => registryError("acquire kept sandbox lease", cause)));
    if (!acquired.acquired) {
      return {
        acquired: false as const,
        lease: {
          holder: acquired.lease.holder,
          op: acquired.lease.operation,
          acquiredAt: acquired.lease.acquiredAt,
          ttlMs: acquired.lease.ttlMs,
        },
      };
    }
    const token = Buffer.from(JSON.stringify({
      secret,
      generation: acquired.generation,
      ownerPid: process.pid,
      ownerHost,
      ownerProcessIdentity: processIdentity,
    }), "utf8").toString("base64url");
    return { acquired: true as const, token };
  });
}

export function releaseKeptLeaseEffect(niceevalRoot: string, id: string, token: string): RegistryEffect<void> {
  return Effect.try({
    try: () => JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      secret: string; generation: number; ownerPid: number; ownerHost: string; ownerProcessIdentity: string;
    },
    catch: (cause) => registryError("decode kept sandbox lease token", cause),
  }).pipe(
    Effect.flatMap((owner) => releaseKeptSandboxLease({ root: niceevalRoot, id, token: owner.secret, ...owner })),
    Effect.mapError((cause) => cause instanceof KeptSandboxRegistryError ? cause : registryError("release kept sandbox lease", cause)),
    Effect.asVoid,
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
  return putKeptSandbox({
    root: niceevalRoot,
    id,
    provider: entry.provider,
    sandboxId: entry.sandboxId,
    keptAt: entry.keptAt,
    payload: Buffer.from(JSON.stringify(entry), "utf8"),
  }).pipe(
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
  return listKeptSandboxes(niceevalRoot).pipe(
    Effect.mapError((cause) => registryError("read kept sandbox registry", cause)),
    Effect.map((rows) => {
    const entries: { id: string; entry: KeptSandboxEntry }[] = [];
    const malformed: string[] = [];
    for (const row of rows) {
      let entry: KeptSandboxEntry | undefined;
      try {
        entry = decodeKeptSandboxEntry(JSON.parse(Buffer.from(row.payload).toString("utf8")));
      } catch {
        entry = undefined;
      }
      if (entry === undefined) malformed.push(row.id);
      else entries.push({ id: row.id, entry });
    }
    entries.sort((a, b) => a.entry.keptAt.localeCompare(b.entry.keptAt));
    return { entries, malformed };
    }),
  );
}

/** 更新一条登记项(读-改-原子写;字段浅合并)。条目不存在时静默返回 false。 */
export function updateKeptEntryEffect(
  niceevalRoot: string,
  id: string,
  patch: Partial<KeptSandboxEntry> | ((entry: KeptSandboxEntry) => KeptSandboxEntry),
): RegistryEffect<boolean> {
  return getKeptSandbox(niceevalRoot, id).pipe(
    Effect.mapError((cause) => registryError("read kept sandbox entry for update", cause)),
    Effect.flatMap((row) => {
      if (row === undefined) return Effect.succeed(false);
      let entry: KeptSandboxEntry | undefined;
      try {
        entry = decodeKeptSandboxEntry(JSON.parse(Buffer.from(row.payload).toString("utf8")));
      } catch {
        entry = undefined;
      }
      if (entry === undefined) return Effect.fail(registryError("decode kept sandbox entry for update", new Error("malformed kept sandbox metadata")));
      const next = typeof patch === "function" ? patch(entry) : { ...entry, ...patch };
      return updateKeptSandbox(niceevalRoot, id, Buffer.from(JSON.stringify(next), "utf8")).pipe(
        Effect.mapError((cause) => registryError("update kept sandbox entry", cause)),
      );
    }),
  );
}

/** 删除一条登记项并同步目录(只在实例成功销毁或确认已不存在后调用)。 */
export function removeKeptEntryEffect(niceevalRoot: string, id: string): RegistryEffect<void> {
  return deleteKeptSandbox(niceevalRoot, id).pipe(
    Effect.mapError((cause) => registryError("remove kept sandbox entry", cause)),
  );
}
