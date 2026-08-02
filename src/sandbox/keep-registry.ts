// 留存沙箱的持久注册表:`.niceeval/sandboxes/` 下的逐条目文件(不是多个 attempt 竞争改写的
// 一份 JSON)。entry id 由 provider + sandboxId 做稳定散列;每条走 shared/entry-file-store.ts
// 的原子写纪律(临时文件 → fsync 文件 → rename → fsync 目录)——不同 attempt 与不同 niceeval
// 进程不会覆盖彼此。
// 契约见 docs/feature/sandbox/architecture.md「留存(keep)与注册表」。
//
// 条目旁独立的 `.lease` 文件是另一套机制(短命的操作互斥,见 acquireKeptLease 一节),不走
// entry-file-store 的原子写纪律——lease 的持有点是 `wx` 独占创建本身,不需要 tmp+rename。

import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fsyncDir, hashEntryId, readEntryFile, writeEntryFile } from "../shared/entry-file-store.ts";
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
export async function readKeptLease(niceevalRoot: string, id: string): Promise<KeptSandboxLease | undefined> {
  try {
    return decodeKeptSandboxLease(JSON.parse(await readFile(leasePath(niceevalRoot, id), "utf-8")));
  } catch {
    return undefined;
  }
}

/**
 * 原子占坑：`wx` 是唯一持有点。TTL 到期时先移除旧文件、再重新竞争；因此旧持有者 finally
 * 只会尝试删除带自己 token 的文件，绝不剥离后来者。
 */
export async function acquireKeptLease(
  niceevalRoot: string,
  id: string,
  lease: KeptSandboxLease,
): Promise<{ acquired: true; token: string } | { acquired: false; lease: KeptSandboxLease }> {
  const dir = sandboxesDirOf(niceevalRoot);
  await mkdir(dir, { recursive: true });
  const path = leasePath(niceevalRoot, id);
  const token = `${lease.holder}:${lease.acquiredAt}:${Math.random().toString(36).slice(2)}`;
  const payload = { ...lease, token };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(JSON.stringify(payload), "utf-8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { acquired: true, token };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readKeptLease(niceevalRoot, id);
      if (current && Date.now() - Date.parse(current.acquiredAt) < current.ttlMs) return { acquired: false, lease: current };
      // 过期或损坏的 lease 可以被接管；unlink 后所有竞争者重新 wx，不能覆盖彼此。
      await rm(path, { force: true });
    }
  }
  const current = await readKeptLease(niceevalRoot, id);
  return { acquired: false, lease: current ?? lease };
}

export async function releaseKeptLease(niceevalRoot: string, id: string, token: string): Promise<void> {
  const path = leasePath(niceevalRoot, id);
  try {
    const current = decodeKeptSandboxLease(JSON.parse(await readFile(path, "utf-8")));
    if (current?.token === token) await rm(path, { force: true });
  } catch {
    // 已被接管或删除时无需动作。
  }
}

/**
 * 注册表发现:从 cwd 向上找最近的 `.niceeval/`(与结果根发现同一规则)。
 * 找不到返回 undefined,调用方报错并提示 `--run <结果根>`。
 */
export async function findNiceevalRoot(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  for (;;) {
    const candidate = join(current, ".niceeval");
    try {
      const entries = await readdir(candidate);
      void entries;
      return candidate;
    } catch {
      // 不存在,继续向上
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** 原子写入一条登记项(委托给共享层的 write-tmp-then-rename 纪律)。 */
export async function writeKeptEntry(niceevalRoot: string, entry: KeptSandboxEntry): Promise<void> {
  const id = keptEntryId(entry.provider, entry.sandboxId);
  await writeEntryFile(sandboxesDirOf(niceevalRoot), id, entry);
}

/**
 * 读全部登记项(坏条目跳过并记名,不整体失败)。逐条目解析走共享层的 `readEntryFile`(损坏
 * 返回 undefined、不抛错);目录扫描与 malformed 文件名收集是留存注册表自己的诊断需求
 * (`readAllEntryFiles` 只做静默跳过,不回传坏文件名),因此这里保留自己的扫描循环。
 */
export async function readKeptEntries(
  niceevalRoot: string,
): Promise<{ entries: { id: string; entry: KeptSandboxEntry }[]; malformed: string[] }> {
  const dir = sandboxesDirOf(niceevalRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return { entries: [], malformed: [] };
  }
  const entries: { id: string; entry: KeptSandboxEntry }[] = [];
  const malformed: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    const id = file.slice(0, -".json".length);
    const entry = await readEntryFile(dir, id, decodeKeptSandboxEntry);
    if (entry === undefined) malformed.push(file);
    else entries.push({ id, entry });
  }
  entries.sort((a, b) => a.entry.keptAt.localeCompare(b.entry.keptAt));
  return { entries, malformed };
}

/** 更新一条登记项(读-改-原子写;字段浅合并)。条目不存在时静默返回 false。 */
export async function updateKeptEntry(
  niceevalRoot: string,
  id: string,
  patch: Partial<KeptSandboxEntry> | ((entry: KeptSandboxEntry) => KeptSandboxEntry),
): Promise<boolean> {
  const entry = await readEntryFile(sandboxesDirOf(niceevalRoot), id, decodeKeptSandboxEntry);
  if (entry === undefined) return false;
  const next = typeof patch === "function" ? patch(entry) : { ...entry, ...patch };
  await writeKeptEntry(niceevalRoot, next);
  return true;
}

/** 删除一条登记项并同步目录(只在实例成功销毁或确认已不存在后调用)。 */
export async function removeKeptEntry(niceevalRoot: string, id: string): Promise<void> {
  const dir = sandboxesDirOf(niceevalRoot);
  await rm(join(dir, `${id}.json`), { force: true });
  await fsyncDir(dir);
}
