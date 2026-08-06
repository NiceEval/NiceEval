// 强杀后的收尾登记表:`.niceeval/teardowns/` 下的逐条目文件,与留存注册表
// (sandbox/keep-registry.ts)同一套原子写纪律,两者都建在 shared/entry-file-store.ts 之上
// (temp → fsync → rename → fsync 目录)。
// 契约见 docs/feature/experiments/architecture.md「强杀后的收尾兜底:收尾登记与启动自愈」。

import { join } from "node:path";
import {
  claimEntryFile,
  hashEntryId,
  readAllEntryFiles,
  readEntryFile,
  writeEntryFile,
} from "../shared/entry-file-store.ts";

/** 一条收尾登记项(逐条目文件的 JSON 形状)。 */
export interface TeardownRegistration {
  experimentId: string;
  selectedEvalIds: readonly string[];
  pid: number;
  host: string;
  startedAt: string;
}

function recordOf(value: unknown): globalThis.Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as globalThis.Record<string, unknown>
    : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** 收尾登记的完整持久形状；单条读取还会核对文件身份。 */
function decodeTeardownRegistration(
  value: unknown,
  expected: { experimentId?: string; pid?: number } = {},
): TeardownRegistration | undefined {
  const record = recordOf(value);
  if (
    record === undefined ||
    typeof record.experimentId !== "string" ||
    !Array.isArray(record.selectedEvalIds) ||
    !record.selectedEvalIds.every((id) => typeof id === "string") ||
    !isPositiveInteger(record.pid) ||
    typeof record.host !== "string" ||
    !isTimestamp(record.startedAt) ||
    (expected.experimentId !== undefined && record.experimentId !== expected.experimentId) ||
    (expected.pid !== undefined && record.pid !== expected.pid)
  ) {
    return undefined;
  }
  return {
    experimentId: record.experimentId,
    selectedEvalIds: record.selectedEvalIds,
    pid: record.pid,
    host: record.host,
    startedAt: record.startedAt,
  };
}

export function teardownsDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "teardowns");
}

/** entry id:实验身份 + 进程身份的稳定散列。同一实验的并发 run 各有独立收尾义务。 */
export function teardownEntryId(experimentId: string, pid: number): string {
  return hashEntryId([experimentId, String(pid)]);
}

/** 原子写入一条登记项(委托给共享层的 write-tmp-then-rename 纪律)。 */
export async function writeTeardownRegistration(niceevalRoot: string, entry: TeardownRegistration): Promise<void> {
  const id = teardownEntryId(entry.experimentId, entry.pid);
  await writeEntryFile(teardownsDirOf(niceevalRoot), id, entry);
}

/** 读一条登记项(不存在或损坏都返回 undefined,不抛错)。 */
export async function readTeardownRegistration(
  niceevalRoot: string,
  experimentId: string,
  pid: number,
): Promise<TeardownRegistration | undefined> {
  return readEntryFile(
    teardownsDirOf(niceevalRoot),
    teardownEntryId(experimentId, pid),
    (value) => decodeTeardownRegistration(value, { experimentId, pid }),
  );
}

/** 读全部登记项(损坏条目跳过,不整体失败;目录不存在时返回空集合)。 */
export async function readTeardownRegistrations(
  niceevalRoot: string,
): Promise<{ id: string; entry: TeardownRegistration }[]> {
  return readAllEntryFiles(teardownsDirOf(niceevalRoot), decodeTeardownRegistration);
}

/**
 * 删登记是互斥点:委托给共享层的认领原语(rename-墓碑,见 ../shared/entry-file-store.ts 的
 * `claimEntryFile` 头注释)。成功认领(返回 true)即拿到执行权;登记已被别的进程删除
 * (返回 false)则跳过——同一份遗留义务不会被两个进程双跑。
 */
export async function removeTeardownRegistrationIfPresent(niceevalRoot: string, id: string): Promise<boolean> {
  return claimEntryFile(teardownsDirOf(niceevalRoot), id);
}

/** 同宿主 pid 存活探测。runner 已依赖 sandbox 模块;此处保持本地小函数,是因为收尾登记只需
 * `kill(pid, 0)` 这一无副作用的宿主进程事实,不应把 sandbox 身份分类策略带进来。 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 遗留义务判定:同宿主且 pid 不存活。pid 存活或异宿主可能属于并发 run,不触碰。 */
export function isOrphanedTeardownRegistration(entry: TeardownRegistration, currentHost: string): boolean {
  return entry.host === currentHost && !isPidAlive(entry.pid);
}

/**
 * `niceeval exp` 启动提醒:遗留义务里「不在本次选择」的那部分,各给一行 `--teardown` 命令。
 * 在本次选择且仍声明 teardown 的遗留义务由 run.ts 在调度前自动补执行,不出现在这里
 * (见 docs/feature/experiments/architecture.md「强杀后的收尾兜底」)。
 */
export async function orphanedTeardownReminder(
  niceevalRoot: string,
  recoveringExperimentIds: ReadonlySet<string>,
  currentHost: string,
): Promise<string | undefined> {
  const registrations = await readTeardownRegistrations(niceevalRoot);
  const lines: string[] = [];
  for (const { entry } of registrations) {
    if (!isOrphanedTeardownRegistration(entry, currentHost)) continue;
    if (recoveringExperimentIds.has(entry.experimentId)) continue;
    lines.push(
      `unfinished experiment teardown for "${entry.experimentId}" from a killed run — niceeval exp ${entry.experimentId} --teardown\n`,
    );
  }
  return lines.length > 0 ? lines.join("") : undefined;
}
