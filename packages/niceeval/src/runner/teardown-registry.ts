// 强杀后的收尾登记表由 canonical ProjectDatabase 的 teardown facet 持久化；每个
// experiment/进程身份对应一条登记项。
// 契约见 docs/feature/experiments/architecture.md「强杀后的收尾兜底:收尾登记与启动自愈」。

import { readFileSync } from "node:fs";
import { Effect, Result, Schema } from "effect";
import type { TeardownObligationRow } from "../coordination/platform/sqlite-registries.ts";
import {
  ProjectStateDatabase,
  type ProjectStateFacets,
  type TeardownFacet,
} from "../record/sqlite/project-state-database.ts";
import { hashEntryId } from "../shared/entry-file-store.ts";
import { processIdentityForPidEffect } from "./shared-state-lease.ts";

function registryEffect<A>(root: string, operation: (facets: ProjectStateFacets) => Promise<A>): Effect.Effect<A, unknown, ProjectStateDatabase> {
  return Effect.flatMap(ProjectStateDatabase, (database) => Effect.flatMap(database.bind(root), (facets) =>
    Effect.tryPromise({ try: () => operation(facets), catch: (cause) => cause })));
}

function putTeardownObligation(input: Omit<Parameters<TeardownFacet["put"]>[0], "_tag"> & { readonly root: string }) {
  const { root, ...command } = input;
  return registryEffect(root, (facets) => facets.teardown.put({ _tag: "teardown-put", ...command }));
}
function getTeardownObligation(root: string, id: string) { return registryEffect<TeardownObligationRow | undefined>(root, (facets) => facets.teardown.get(id)); }
function listTeardownObligations(root: string) { return registryEffect<readonly TeardownObligationRow[]>(root, (facets) => facets.teardown.list()); }
function claimTeardownObligation(root: string, id: string) { return registryEffect<boolean>(root, (facets) => facets.teardown.claim(id)); }
type ProjectDatabaseRequirement = ProjectStateDatabase;

/** 一条收尾登记项的持久 payload 形状。 */
export interface TeardownRegistration {
  experimentId: string;
  selectedEvalIds: readonly string[];
  pid: number;
  host: string;
  startedAt: string;
}

const PositiveSafeIntegerSchema = Schema.Number.pipe(Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0, { identifier: "PositiveSafeInteger" })));

const TimestampSchema = Schema.String.pipe(Schema.check(Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), { identifier: "Timestamp" })));

const TeardownRegistrationSchema = Schema.Struct({
  experimentId: Schema.String,
  selectedEvalIds: Schema.Array(Schema.String),
  pid: PositiveSafeIntegerSchema,
  host: Schema.String,
  startedAt: TimestampSchema,
});

function errnoCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

/** 收尾登记的完整持久形状；单条读取还会核对登记身份。 */
function decodeTeardownRegistration(
  value: unknown,
  expected: { experimentId?: string; pid?: number } = {},
): TeardownRegistration | undefined {
  const decoded = Schema.decodeUnknownResult(TeardownRegistrationSchema)(value);
  if (Result.isFailure(decoded)) return undefined;
  const registration = decoded.success;
  return (expected.experimentId !== undefined && registration.experimentId !== expected.experimentId) ||
    (expected.pid !== undefined && registration.pid !== expected.pid)
    ? undefined
    : registration;
}

/** entry id:实验身份 + 进程身份的稳定散列。同一实验的并发 run 各有独立收尾义务。 */
export function teardownEntryId(experimentId: string, pid: number): string {
  return hashEntryId([experimentId, String(pid)]);
}

/** 写入一条登记项。 */
export function writeTeardownRegistrationEffect(
  niceevalRoot: string,
  entry: TeardownRegistration,
): Effect.Effect<void, unknown, ProjectDatabaseRequirement> {
  const id = teardownEntryId(entry.experimentId, entry.pid);
  return putTeardownObligation({
    root: niceevalRoot,
    id,
    experimentId: entry.experimentId,
    ownerPid: entry.pid,
    ownerHost: entry.host,
    payload: Buffer.from(JSON.stringify(entry), "utf8"),
  });
}

/** 读一条登记项(不存在或损坏都返回 undefined,不抛错)。 */
export function readTeardownRegistrationEffect(
  niceevalRoot: string,
  experimentId: string,
  pid: number,
): Effect.Effect<TeardownRegistration | undefined, unknown, ProjectDatabaseRequirement> {
  return getTeardownObligation(niceevalRoot, teardownEntryId(experimentId, pid)).pipe(
    Effect.map((row) => {
      if (row === undefined) return undefined;
      try {
        return decodeTeardownRegistration(JSON.parse(Buffer.from(row.payload).toString("utf8")), { experimentId, pid });
      } catch {
        return undefined;
      }
    }),
  );
}

/**
 * Exact recovery cannot treat a malformed or unreadable expected entry as an
 * absent cleanup obligation. Normal registry scans deliberately tolerate
 * damaged historical rows; a recovery is instead about to publish a new
 * sharedState generation, so only a genuinely absent path is safe to accept.
 */
export function readExactTeardownRegistrationEffect(
  niceevalRoot: string,
  experimentId: string,
  pid: number,
): Effect.Effect<TeardownRegistration | undefined, unknown, ProjectDatabaseRequirement> {
  const id = teardownEntryId(experimentId, pid);
  return getTeardownObligation(niceevalRoot, id).pipe(
    Effect.flatMap((row) => row === undefined ? Effect.succeed(undefined) : Effect.try({
      try: () => {
        let value: unknown;
        try {
          value = JSON.parse(Buffer.from(row.payload).toString("utf8"));
        } catch (cause) {
          throw new Error(`teardown registration ${JSON.stringify(id)} is not valid JSON`, { cause });
        }
        const registration = decodeTeardownRegistration(value, { experimentId, pid });
        if (registration === undefined) {
          throw new Error(`teardown registration ${JSON.stringify(id)} has an invalid identity or shape`);
        }
        return registration;
      },
      catch: (cause) => cause,
    })),
  );
}

/** Immutable sharedState owner facts that can prove a registry row is old. */
export interface ExactTeardownRegistrationOwner {
  readonly experimentId: string;
  readonly pid: number;
  readonly host: string;
  readonly processIdentity: string;
}

/**
 * Checks the terminal state of the exact owner recorded by a sharedState
 * generation. On the local host, this uses the same PID + process-identity
 * probe as lease recovery: ENOENT, PID reuse, and Linux Z/X/x are terminal;
 * unreadable or malformed probe evidence fails rather than guessing. Remote
 * termination was already explicitly confirmed by the recovery command.
 */
export function isExactTeardownRegistrationOwnerTerminatedEffect(input: {
  readonly registration: TeardownRegistration;
  readonly owner: ExactTeardownRegistrationOwner;
  readonly currentHost: string;
}): Effect.Effect<boolean, unknown> {
  const { registration, owner, currentHost } = input;
  if (
    registration.experimentId !== owner.experimentId ||
    registration.pid !== owner.pid ||
    registration.host !== owner.host
  ) {
    return Effect.fail(new Error(
      "teardown registration does not match the immutable sharedState owner identity",
    ));
  }
  if (owner.host !== currentHost) return Effect.succeed(true);
  return processIdentityForPidEffect(owner.pid).pipe(
    Effect.map((currentIdentity) =>
      currentIdentity === undefined || currentIdentity !== owner.processIdentity),
  );
}

/** 读全部登记项(损坏 payload 跳过,不整体失败)。 */
export function readTeardownRegistrationsEffect(
  niceevalRoot: string,
): Effect.Effect<{ id: string; entry: TeardownRegistration }[], unknown, ProjectDatabaseRequirement> {
  return listTeardownObligations(niceevalRoot).pipe(
    Effect.map((rows) => rows.flatMap((row) => {
      try {
        const entry = decodeTeardownRegistration(JSON.parse(Buffer.from(row.payload).toString("utf8")));
        return entry === undefined ? [] : [{ id: row.id, entry }];
      } catch {
        return [];
      }
    })),
  );
}

/**
 * 删登记是互斥点：成功认领(返回 true)即拿到执行权；登记已被别的进程删除
 * (返回 false)则跳过——同一份遗留义务不会被两个进程双跑。
 */
export function removeTeardownRegistrationIfPresentEffect(
  niceevalRoot: string,
  id: string,
): Effect.Effect<boolean, unknown, ProjectDatabaseRequirement> {
  return claimTeardownObligation(niceevalRoot, id);
}

/**
 * Normal startup scans only persist PID + host, so they cannot prove PID
 * reuse. They still share lease recovery's terminal Linux process states:
 * a Z/X/x task cannot execute cleanup. Any `/proc` read/parse ambiguity is
 * deliberately treated as live here; the explicit recovery path above has
 * stronger immutable identity evidence and fails closed on that ambiguity.
 */
function isPidTerminal(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
      const closing = raw.lastIndexOf(")");
      if (closing < 0 || raw[closing + 1] !== " ") return false;
      const state = raw.slice(closing + 2).trim().split(/\s+/u)[0];
      return state === "Z" || state === "X" || state === "x";
    } catch (cause) {
      return errnoCode(cause) === "ENOENT";
    }
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "EPERM";
  }
}

/** 遗留义务判定:同宿主且 PID 已缺失或处于终态。pid 存活、读取不明或异宿主可能属于并发 run,不触碰。 */
export function isOrphanedTeardownRegistration(entry: TeardownRegistration, currentHost: string): boolean {
  return entry.host === currentHost && isPidTerminal(entry.pid);
}

/**
 * `niceeval exp` 启动提醒:遗留义务里「不在本次选择」的那部分,各给一行 `--teardown` 命令。
 * 在本次选择且仍声明 teardown 的遗留义务由 run.ts 在调度前自动补执行,不出现在这里
 * (见 docs/feature/experiments/architecture.md「强杀后的收尾兜底」)。
 */
export function orphanedTeardownReminderEffect(
  niceevalRoot: string,
  recoveringExperimentIds: ReadonlySet<string>,
  currentHost: string,
): Effect.Effect<string | undefined, unknown, ProjectDatabaseRequirement> {
  return readTeardownRegistrationsEffect(niceevalRoot).pipe(
    Effect.map((registrations) => {
      const lines: string[] = [];
      for (const { entry } of registrations) {
        if (!isOrphanedTeardownRegistration(entry, currentHost)) continue;
        if (recoveringExperimentIds.has(entry.experimentId)) continue;
        lines.push(
          `unfinished experiment teardown for "${entry.experimentId}" from a killed run — niceeval exp ${entry.experimentId} --teardown\n`,
        );
      }
      return lines.length > 0 ? lines.join("") : undefined;
    }),
  );
}
