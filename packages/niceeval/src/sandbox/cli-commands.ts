// `niceeval sandbox` 命令组:查看与销毁留存的沙箱(见 docs/feature/sandbox/cli.md)。
// 不读 niceeval.config.ts、不发现 eval,只操作 canonical ProjectDatabase 中的留存注册表
// 与内置 provider 的 detached 能力;provider 名的路由发生在 CLI / 注册表边界(sandbox/ 域内)。

import { Cause, Data, Effect } from "effect";
import type { ProjectStateDatabase } from "../record/sqlite/project-state-database.ts";
import {
  destroyDetached,
  detachedCapabilityGap,
  execInDetached,
  inspectDetached,
  openInteractiveShell,
  suspendDetached,
  wakeDetached,
} from "./keep.ts";
import {
  acquireKeptLeaseEffect,
  findNiceevalRootEffect,
  keptEntryId,
  readKeptEntriesEffect,
  readKeptLeaseEffect,
  releaseKeptLeaseEffect,
  removeKeptEntryEffect,
  updateKeptEntryEffect,
  KeptSandboxRegistryError,
  type KeptSandboxEntry,
} from "./keep-registry.ts";
import { dockerOrphanCount, listOrphanCandidates, pruneOrphans, type OrphanCandidate } from "./orphans.ts";
import { panelCapabilityOf, renderPanel, type PanelMode, type PanelRow } from "../terminal/panel.ts";
import { computeExpiresAt } from "./keep.ts";

export interface SandboxCommandFlags {
  all?: boolean;
  window?: string;
  path?: string;
  leaveRunning?: boolean;
  /** 仓库外执行时显式指定结果根(.niceeval 或其父目录)。 */
  record?: string;
  /** `sandbox list` 专用:核对强杀路径留下的无主实例(见「孤儿核对」)。 */
  orphans?: boolean;
  /** `sandbox prune` 专用:连 unverified 一起销毁。 */
  force?: boolean;
}

export interface SandboxCommandIo {
  out(text: string): void;
  err(text: string): void;
}

/** Host-owned terminal and process facts. The command operation never reads process globals. */
export interface SandboxCommandFacts {
  readonly leaseHolder: string;
  readonly noColor?: string;
  readonly stdout: { readonly isTTY: boolean; readonly columns?: number };
}

const LEASE_TTL_MS = 60 * 60 * 1000;

/** detached provider / command 边界的可恢复失败；注册表 I/O 错误保留自己的领域类型。 */
export class SandboxCommandOperationError extends Data.TaggedError("SandboxCommandOperationError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

type SandboxCommandFailure = KeptSandboxRegistryError | SandboxCommandOperationError;
export type SandboxCommandEffect<A> = Effect.Effect<
  A,
  SandboxCommandFailure,
  ProjectStateDatabase
>;

/** 所有 provider Promise 都只在此处进入 Effect；信号由 runtime 接管，interruption 不会变成普通失败。 */
function providerEffect<A>(operation: string, run: (signal: AbortSignal) => Promise<A>): SandboxCommandEffect<A> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new SandboxCommandOperationError({ operation, cause }),
  });
}

function errorText(error: SandboxCommandFailure): string {
  const cause = error.cause;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Effect 的标准 finalizer 不能走 typed error channel。本命令域需要把 lease / suspend 的失败
 * 和 body 的失败一起保留，因此在 uninterruptible cleanup 段显式拼接 Cause；body 仍可被中断。
 */
function ensuringWithTypedFinalizer<A, E, R, E2, R2>(
  body: Effect.Effect<A, E, R>,
  finalizer: Effect.Effect<void, E2, R2>,
) {
  return Effect.uninterruptibleMask((restore) =>
    restore(body).pipe(
      Effect.matchCauseEffect({
        onFailure: (bodyCause) => finalizer.pipe(
          Effect.matchCauseEffect({
            onFailure: (finalizerCause) => Effect.failCause(Cause.combine(bodyCause, finalizerCause)),
            onSuccess: () => Effect.failCause(bodyCause),
          }),
        ),
        onSuccess: (value) => finalizer.pipe(Effect.as(value)),
      }),
    ));
}

/**
 * 刷新 provider 的留存期限。没有期限的 provider 必须省略字段，而不是把
 * `expiresAt: undefined` 带进逐条目 JSON；后者既不是 JSON 值，也会被共享持久层拒绝。
 */
function refreshedEntryState(
  entry: KeptSandboxEntry,
  state: KeptSandboxEntry["state"],
  now: string,
): KeptSandboxEntry {
  const { expiresAt: _previousExpiresAt, ...withoutExpiresAt } = entry;
  const expiresAt = computeExpiresAt(entry.provider, now);
  return expiresAt === undefined
    ? { ...withoutExpiresAt, state }
    : { ...withoutExpiresAt, state, expiresAt };
}

/** `list`/`history` 一次性面板的传输能力:是 TTY 且没有要求朴素输出时才画框
 *  (docs/feature/sandbox/cli.md「输出体裁」)——`sandbox` 命令组只在启动时探测一次,
 *  不像 `exp` 的 live 面板那样需要随 resize 重新判断。 */
function panelCapabilityForFacts(facts: SandboxCommandFacts): { mode: PanelMode; width: number } {
  return panelCapabilityOf({
    isTTY: facts.stdout.isTTY,
    noColor: facts.noColor,
    width: facts.stdout.columns,
  });
}

/** Effect 主入口：CLI 可将它接进自己的唯一 runtime，不启动嵌套 Promise runtime。 */
export function runSandboxCommandEffect(
  cwd: string,
  positionals: string[],
  flags: SandboxCommandFlags,
  io: SandboxCommandIo,
  facts: SandboxCommandFacts,
): SandboxCommandEffect<number>;
export function runSandboxCommandEffect(
  cwd: string,
  positionals: string[],
  flags: SandboxCommandFlags,
  io: SandboxCommandIo,
  facts: SandboxCommandFacts,
): SandboxCommandEffect<number> {
  return Effect.gen(function* () {
    const sub = positionals[0];
    const root = yield* resolveRegistryRootEffect(cwd, flags.record);
    if (root === undefined) {
      io.err(
        `No .niceeval directory found from ${cwd} upward. Run this inside the project, or pass --record <record-root> to point at it.\n`,
      );
      return 1;
    }
    switch (sub) {
      case "list":
        return yield* (flags.orphans
          ? listOrphansCommandEffect(root, io)
          : listCommandEffect(root, io, panelCapabilityForFacts(facts)));
      case "stop":
        return yield* stopCommandEffect(root, positionals.slice(1), flags, io);
      case "enter":
        return yield* enterCommandEffect(root, positionals.slice(1), flags, io, facts);
      case "history":
        return yield* historyCommandEffect(root, positionals.slice(1), flags, io, panelCapabilityForFacts(facts));
      case "diff":
        return yield* diffCommandEffect(root, positionals.slice(1), flags, io);
      case "prune":
        return yield* pruneCommandEffect(root, flags, io);
      default:
        io.err(`usage: niceeval sandbox <list|enter|history|diff|stop|prune> …\n`);
        return 1;
    }
  });
}

/** 留存注册表条目的 sandboxId 集合——孤儿核对与 prune 都要排除它们(被管理的现场不是孤儿)。 */
function keptSandboxIdsEffect(root: string): SandboxCommandEffect<Set<string>> {
  return readKeptEntriesEffect(root).pipe(
    Effect.map(({ entries }) => new Set(entries.map(({ entry }) => entry.sandboxId))),
  );
}

function listOrphansCommandEffect(root: string, io: SandboxCommandIo): SandboxCommandEffect<number> {
  return keptSandboxIdsEffect(root).pipe(
    Effect.flatMap((keptIds) => providerEffect("list orphan sandboxes", () => listOrphanCandidates(keptIds))),
    Effect.map((candidates) => {
      if (candidates.length === 0) {
        io.out("No orphan sandboxes.\n");
        return 0;
      }
      io.out(`ID        PROVIDER  OWNER              STARTED            STATE\n`);
      for (const c of candidates) {
        io.out(
          `${c.sandboxId.padEnd(10)}${c.provider.padEnd(10)}${ownerLabel(c).padEnd(19)}${formatWhen(c.identity.startedAt).padEnd(19)}${c.state}\n`,
        );
        const group = groupLabel(c);
        if (group) io.out(`          ${group}\n`);
      }
      io.out(`Remove orphans with: niceeval sandbox prune\n`);
      return 0;
    }),
  );
}

function pruneCommandEffect(root: string, flags: SandboxCommandFlags, io: SandboxCommandIo): SandboxCommandEffect<number> {
  return keptSandboxIdsEffect(root).pipe(
    Effect.flatMap((keptIds) => providerEffect("prune orphan sandboxes", () => pruneOrphans(keptIds, flags.force === true))),
    Effect.map((outcome) => {
      if (outcome.pruned.length === 0 && outcome.failed.length === 0) {
        io.out("No orphan sandboxes.\n");
      } else {
        if (outcome.pruned.length > 0) {
          io.out(`pruned ${outcome.pruned.length} orphan sandboxes\n`);
          for (const c of outcome.pruned) {
            const group = groupLabel(c);
            io.out(
              `  ${c.sandboxId}  ${c.provider}  ${ownerLabel(c)} · started ${formatWhen(c.identity.startedAt)}${group ? ` · ${group}` : ""}\n`,
            );
          }
        }
        for (const f of outcome.failed) {
          io.err(`failed to prune ${f.candidate.sandboxId} (${f.candidate.provider}): ${f.message}\n`);
        }
      }
      if (outcome.unverifiedRemaining > 0) {
        io.out(
          `${outcome.unverifiedRemaining} unverified left — inspect: niceeval sandbox list --orphans · force: niceeval sandbox prune --force\n`,
        );
      }
      return outcome.failed.length > 0 ? 1 : 0;
    }),
  );
}

/** Compose 资源组的组成一行带过:伴随容器与网络跟随主实例整组出现,不逐容器单列。 */
function groupLabel(c: OrphanCandidate): string | undefined {
  const g = c.resources;
  if (!g) return undefined;
  const containers = `${g.containerIds.length} containers`;
  const networks = `${g.networkIds.length} networks`;
  return `compose ${g.projectName} · ${containers} · ${networks}`;
}

/** `pid <pid>@<host>`,同宿主确认死亡时追加 ` dead`——unverified(异宿主)不冒充已核实。 */
function ownerLabel(c: OrphanCandidate): string {
  return `pid ${c.identity.pid}@${c.identity.host}${c.state === "orphan" ? " dead" : ""}`;
}

/** 留存注册表里还有条目时,`niceeval exp` 启动打的一行提醒(不阻塞、不清理)。 */
export function orphanReminderEffect(cwd: string): SandboxCommandEffect<string | undefined> {
  return Effect.gen(function* () {
    const root = yield* findNiceevalRootEffect(cwd);
    const keptIds = root === undefined ? new Set<string>() : yield* keptSandboxIdsEffect(root);
    const count = yield* providerEffect("count orphan sandboxes", () => dockerOrphanCount(keptIds));
    return count === 0
      ? undefined
      : `${count} orphan docker sandboxes from a killed run — niceeval sandbox prune\n`;
  });
}

function resolveRegistryRootEffect(cwd: string, runFlag: string | undefined): SandboxCommandEffect<string | undefined> {
  if (runFlag !== undefined) {
    // --record 可以指 .niceeval 本身或它的父目录。
    return Effect.succeed(runFlag.endsWith(".niceeval") ? runFlag : `${runFlag}/.niceeval`);
  }
  return findNiceevalRootEffect(cwd);
}

/** 留存注册表里还有条目时,`niceeval exp` 启动打的一行提醒(不阻塞、不清理)。 */
export function keptSandboxReminderEffect(cwd: string): SandboxCommandEffect<string | undefined> {
  return findNiceevalRootEffect(cwd).pipe(
    Effect.flatMap((root) => root === undefined
      ? Effect.succeed(undefined)
      : readKeptEntriesEffect(root).pipe(
          Effect.map(({ entries }) => entries.length === 0
            ? undefined
            : `${entries.length} kept sandboxes from earlier runs — niceeval sandbox list\n`),
        )),
  );
}

/** 每个留存条目在 `SANDBOXES` 面板里占两行:身份行(ID/PROVIDER/STATE/FROM)紧跟一条
 *  缩进到 ID 列宽的提示行(下一步动作各不相同,批量 stop --all 不能当默认下一步,所以下边框
 *  不嵌命令——见 docs/feature/sandbox/cli.md「sandbox list」)。 */
const LIST_ID_COL = 10;
const LIST_PROVIDER_COL = 10;
const LIST_STATE_COL = 10;

function listCommandEffect(root: string, io: SandboxCommandIo, panel: { mode: PanelMode; width: number }): SandboxCommandEffect<number> {
  return Effect.gen(function* () {
    const { entries } = yield* readKeptEntriesEffect(root);
    if (entries.length === 0) {
      io.out("No kept sandboxes.\n");
      return 0;
    }
    const rows: PanelRow[] = [
      { kind: "line", text: `${"ID".padEnd(LIST_ID_COL)}${"PROVIDER".padEnd(LIST_PROVIDER_COL)}${"STATE".padEnd(LIST_STATE_COL)}FROM` },
    ];
    for (const { id, entry } of entries) {
      // STATE 是当下核对的现场状态,不是登记时的旧值。
      const state = yield* providerEffect(
        "inspect kept sandbox",
        () => inspectDetached(entry.provider, entry.sandboxId),
      );
      // unknown 是探测失败，不是可持久化的现场事实；保留上次已知状态供下次核对。
      if (state !== "unknown" && state !== entry.state) {
        yield* updateKeptEntryEffect(root, id, { state }).pipe(Effect.catch(() => Effect.succeed(false)));
      }
      const from = `${entry.evalId} #${entry.attempt} · ${entry.verdict} · ${entry.locator}`;
      rows.push({
        kind: "line",
        text: `${id.padEnd(LIST_ID_COL)}${entry.provider.padEnd(LIST_PROVIDER_COL)}${state.padEnd(LIST_STATE_COL)}${from}`,
      });
      const indent = " ".repeat(LIST_ID_COL);
      if (state === "expired") {
        const when = entry.expiresAt !== undefined ? `expired ${formatWhen(entry.expiresAt)} — ` : "";
        rows.push({ kind: "line", text: `${indent}${when}remove: niceeval sandbox stop ${id}` });
      } else if (state === "unknown") {
        rows.push({ kind: "line", text: `${indent}status unknown — check credentials or retry later` });
      } else {
        rows.push({ kind: "line", text: `${indent}${formatWhen(entry.keptAt)} · enter: niceeval sandbox enter ${id}` });
      }
    }
    const lines = renderPanel({
      title: "SANDBOXES",
      meta: `${entries.length} kept`,
      rows,
      width: panel.width,
      mode: panel.mode,
    });
    io.out(`${lines.join("\n")}\n`);
    return 0;
  });
}

/** id 接受 entry id / 实例 id 的唯一前缀;有歧义或不在注册表里时报错并列出候选。 */
function resolveEntriesEffect(
  root: string,
  ids: string[],
  io: SandboxCommandIo,
): SandboxCommandEffect<{ id: string; entry: KeptSandboxEntry }[] | undefined> {
  return readKeptEntriesEffect(root).pipe(
    Effect.map(({ entries }) => {
      const resolved: { id: string; entry: KeptSandboxEntry }[] = [];
      for (const raw of ids) {
        const hits = entries.filter(
          ({ id, entry }) => id === raw || id.startsWith(raw) || entry.sandboxId === raw || entry.sandboxId.startsWith(raw),
        );
        if (hits.length === 1) {
          resolved.push(hits[0]!);
          continue;
        }
        if (hits.length === 0) {
          io.err(`"${raw}" is not in the kept-sandbox registry. Known: ${entries.map((e) => e.id).join(", ") || "(none)"}\n`);
        } else {
          io.err(`"${raw}" is ambiguous; candidates: ${hits.map((h) => `${h.id} (${h.entry.sandboxId})`).join(", ")}\n`);
        }
        return undefined;
      }
      return resolved;
    }),
  );
}

function stopCommandEffect(root: string, ids: string[], flags: SandboxCommandFlags, io: SandboxCommandIo): SandboxCommandEffect<number> {
  return Effect.gen(function* () {
    let targets: { id: string; entry: KeptSandboxEntry }[];
    if (flags.all) {
      targets = (yield* readKeptEntriesEffect(root)).entries;
    } else if (ids.length === 0) {
      io.err("specify sandbox ids or --all\n");
      return 1;
    } else {
      const resolved = yield* resolveEntriesEffect(root, ids, io);
      if (!resolved) return 1;
      targets = resolved;
    }

    let code = 0;
    for (const { id, entry } of targets) {
      const lease = yield* readKeptLeaseEffect(root, id);
      if (lease) {
        io.err(`${entry.sandboxId} (${entry.provider}) is in use by ${lease.holder} since ${lease.acquiredAt}; not stopping.\n`);
        code = 1;
        continue;
      }
      yield* providerEffect("destroy kept sandbox", () => destroyDetached(entry.provider, entry.sandboxId)).pipe(
        Effect.flatMap((outcome) => removeKeptEntryEffect(root, id).pipe(
          Effect.tap(() => Effect.sync(() => {
            if (outcome === "stopped") io.out(`stopped ${entry.sandboxId} (${entry.provider})\n`);
            else io.out(`${entry.sandboxId} (${entry.provider}) already gone — removed from registry\n`);
          })),
        )),
        Effect.catch((error) => Effect.sync(() => {
          // 只有实例成功销毁或确认已不存在时才移除登记项;其它错误保留条目并退出 1,
          // 不能把仍活着的资源从管理面隐藏掉。
          io.err(`failed to stop ${entry.sandboxId} (${entry.provider}): ${errorText(error)}\n`);
          code = 1;
        })),
      );
    }
    return code;
  });
}

function withLeaseEffect<T>(
  root: string,
  id: string,
  entry: KeptSandboxEntry,
  op: string,
  io: SandboxCommandIo,
  facts: SandboxCommandFacts,
  fn: () => SandboxCommandEffect<T>,
): SandboxCommandEffect<T | undefined> {
  const lease = { holder: facts.leaseHolder, op, acquiredAt: new Date().toISOString(), ttlMs: LEASE_TTL_MS };
  return acquireKeptLeaseEffect(root, id, lease).pipe(
    Effect.flatMap((acquired) => {
      if (!acquired.acquired) {
        io.err(`${entry.sandboxId} is in use by ${acquired.lease.holder} since ${acquired.lease.acquiredAt}\n`);
        return Effect.succeed(undefined);
      }
      return ensuringWithTypedFinalizer(fn(), releaseKeptLeaseEffect(root, id, acquired.token));
    }),
  );
}

function enterCommandEffect(
  root: string,
  ids: string[],
  flags: SandboxCommandFlags,
  io: SandboxCommandIo,
  facts: SandboxCommandFacts,
): SandboxCommandEffect<number> {
  return resolveEntriesEffect(root, ids.slice(0, 1), io).pipe(
    Effect.flatMap((resolved) => {
      if (!resolved || resolved.length === 0) {
        if (ids.length === 0) io.err("usage: niceeval sandbox enter <id> [--leave-running]\n");
        return Effect.succeed(1);
      }
      const { id, entry } = resolved[0]!;
      const gap = detachedCapabilityGap(entry.provider);
      if (gap) {
        io.err(`${entry.sandboxId}: ${gap}\n`);
        return Effect.succeed(1);
      }
      return providerEffect("inspect kept sandbox", () => inspectDetached(entry.provider, entry.sandboxId)).pipe(
        Effect.flatMap((state) => {
          if (state === "expired") {
            io.err(`${entry.sandboxId} (${entry.provider}) is gone — the instance no longer exists. Clean up with: niceeval sandbox stop ${id}\n`);
            return Effect.succeed(1);
          }
          if (state === "unknown") {
            io.err(`${entry.sandboxId} (${entry.provider}) could not be inspected — check credentials or retry later.\n`);
            return Effect.succeed(1);
          }
          return withLeaseEffect(root, id, entry, "enter", io, facts, () => Effect.gen(function* () {
            yield* providerEffect("wake kept sandbox", () => wakeDetached(entry.provider, entry.sandboxId));
            yield* updateKeptEntryEffect(root, id, (current) => refreshedEntryState(current, "alive", new Date().toISOString()));
            const code = yield* providerEffect(
              "open kept sandbox shell",
              () => openInteractiveShell(entry.provider, entry.sandboxId, entry.workdir),
            ).pipe(Effect.catch((error) => Effect.sync(() => {
              // 原生命令本身起不来(如未装对应 CLI):现场保持 alive,提示改用注册表里的原生命令直连。
              io.err(
                `failed to open an interactive shell for ${entry.sandboxId} (${entry.provider}): ${errorText(error)}${entry.enter ? `\nconnect directly instead: ${entry.enter}` : ""}\n`,
              );
              return 1;
            })));
            if (flags.leaveRunning) {
              yield* updateKeptEntryEffect(root, id, { state: "alive" });
              io.out(`left running: ${entry.sandboxId} (re-suspend with another enter, or destroy with niceeval sandbox stop ${id})\n`);
              return code;
            }
            // shell 退出(含 Ctrl+C)后自动送回休眠——「休眠不烧资源」不因进去看过一眼失效。
            yield* providerEffect("re-suspend kept sandbox", () => suspendDetached(entry.provider, entry.sandboxId)).pipe(
              Effect.andThen(updateKeptEntryEffect(
                root,
                id,
                (current) => refreshedEntryState(current, "dormant", new Date().toISOString()),
              )),
              Effect.catch((error) => Effect.sync(() => {
                io.err(`failed to re-suspend ${entry.sandboxId}: ${errorText(error)}\n`);
              }).pipe(Effect.andThen(updateKeptEntryEffect(root, id, { state: "alive" })))),
            );
            return code;
          })).pipe(Effect.map((result) => result ?? 1));
        }),
      );
    }),
  );
}

/** 在留存现场里跑一条命令(非交互;history/diff 用)——按 provider 能力路由到 `execInDetached`。 */
function execInKeptEffect(entry: KeptSandboxEntry, script: string): SandboxCommandEffect<string> {
  const gap = detachedCapabilityGap(entry.provider);
  if (gap) return Effect.fail(new SandboxCommandOperationError({ operation: "execute in kept sandbox", cause: new Error(gap) }));
  return providerEffect("execute in kept sandbox", () => execInDetached(entry.provider, entry.sandboxId, entry.workdir, script));
}

/** 唤醒 → 读 → 送回休眠(现场休眠中同样可用;读完不留 alive)。 */
function withWokenSandboxEffect<T>(
  _root: string,
  id: string,
  entry: KeptSandboxEntry,
  fn: () => SandboxCommandEffect<T>,
): SandboxCommandEffect<T> {
  const gap = detachedCapabilityGap(entry.provider);
  if (gap) return Effect.fail(new SandboxCommandOperationError({
    operation: "access kept sandbox",
    cause: new Error(`${entry.sandboxId}: ${gap}`),
  }));
  return providerEffect("inspect kept sandbox", () => inspectDetached(entry.provider, entry.sandboxId)).pipe(
    Effect.flatMap((state) => {
      if (state === "expired") {
        return Effect.fail(new SandboxCommandOperationError({
          operation: "access kept sandbox",
          cause: new Error(
            `${entry.sandboxId} (${entry.provider}) is gone; the in-sandbox ledger died with it (artifacts are unaffected). Clean up with: niceeval sandbox stop ${id}`,
          ),
        }));
      }
      if (state === "unknown") {
        return Effect.fail(new SandboxCommandOperationError({
          operation: "inspect kept sandbox",
          cause: new Error(`${entry.sandboxId} (${entry.provider}) could not be inspected — check credentials or retry later.`),
        }));
      }
      const wasDormant = state === "dormant";
      const use = fn();
      return wasDormant
        ? ensuringWithTypedFinalizer(
            providerEffect("wake kept sandbox", () => wakeDetached(entry.provider, entry.sandboxId)).pipe(Effect.andThen(use)),
            providerEffect("re-suspend kept sandbox", () => suspendDetached(entry.provider, entry.sandboxId)),
          )
        : use;
    }),
  );
}

type CommitFileChange = { status: string; path: string };

function parseCommitFileChanges(out: string): CommitFileChange[] {
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab === -1 ? { status: line, path: "" } : { status: line.slice(0, tab), path: line.slice(tab + 1) };
    });
}

/** 一次 provider exec 导出日志与每笔提交的改动。RS 分段使无父提交的 diff 失败自然成为零改动。 */
const HISTORY_EXPORT_SCRIPT = [
  "git log --reverse --format='%H %at %s' 2>/dev/null",
  "git rev-list --reverse HEAD 2>/dev/null | while IFS= read -r hash; do",
  "  printf '\\036%s\\n' \"$hash\"",
  "  git diff --name-status \"$hash^\" \"$hash\" 2>/dev/null || true",
  "done",
].join("\n");

function parseHistoryExport(out: string): { commits: { hash: string; at: number; subject: string }[]; changesByHash: Map<string, CommitFileChange[]> } {
  const [log, ...sections] = out.split("\x1e");
  const commits = log!.trim().split("\n").filter(Boolean).map((line) => {
    const [hash, atRaw, ...rest] = line.split(" ");
    return { hash: hash!, at: Number(atRaw), subject: rest.join(" ") };
  });
  const changesByHash = new Map<string, CommitFileChange[]>();
  for (const section of sections) {
    const newline = section.indexOf("\n");
    const hash = (newline === -1 ? section : section.slice(0, newline)).trim();
    if (hash) changesByHash.set(hash, parseCommitFileChanges(newline === -1 ? "" : section.slice(newline + 1)));
  }
  return { commits, changesByHash };
}

/** 窗口 / eval 阶段标签列宽(与 "agent"/"eval" 关键词列共用同一份对齐规则,见
 *  docs/feature/sandbox/cli.md「sandbox history / diff」的示例输出)。 */
const HISTORY_LABEL_COL = 8;
const HISTORY_EVAL_COUNT_COL = 20;

function historyCommandEffect(
  root: string,
  ids: string[],
  _flags: SandboxCommandFlags,
  io: SandboxCommandIo,
  panel: { mode: PanelMode; width: number },
): SandboxCommandEffect<number> {
  return resolveEntriesEffect(root, ids.slice(0, 1), io).pipe(
    Effect.flatMap((resolved) => {
      if (!resolved || resolved.length === 0) {
        if (ids.length === 0) io.err("usage: niceeval sandbox history <id>\n");
        return Effect.succeed(1);
      }
      const { id, entry } = resolved[0]!;
      return withWokenSandboxEffect(root, id, entry, () => execInKeptEffect(entry, HISTORY_EXPORT_SCRIPT)).pipe(
        Effect.map((out) => {
          const { commits, changesByHash } = parseHistoryExport(out);
          if (commits.length === 0) {
            io.out("(no ledger found in this sandbox)\n");
            return 0;
          }

          const anchor = commits.find((c) => c.subject === "anchor");
          const meta = anchor ? `anchor ${formatWhen(new Date(anchor.at * 1000).toISOString())}` : undefined;

          const rows: PanelRow[] = [];
          let sawEvalCommit = false;
          let lastWindow: string | undefined;
          for (const c of commits) {
            if (c.subject === "anchor") continue;
            if (c.subject.startsWith("eval ")) {
              // 第一次出现的 eval 提交是运行前的 fixture / setup;之后每次都是某轮 send 之后的
              // 校验写入——两者用同一份改动计数,只是阶段标签不同(见 docs 示例)。
              const label = sawEvalCommit ? "post-send validation" : "fixture / setup";
              sawEvalCommit = true;
              const changes = changesByHash.get(c.hash) ?? [];
              const count = `+${changes.length} files`;
              rows.push({
                kind: "line",
                text: `${"eval".padEnd(HISTORY_LABEL_COL)}${count.padEnd(HISTORY_EVAL_COUNT_COL)}(${label})`,
              });
            } else if (c.subject.startsWith("agent ")) {
              const window = c.subject.slice(6);
              lastWindow = window;
              const changes = changesByHash.get(c.hash) ?? [];
              const changeText = changes.map((fc) => `${fc.status} ${fc.path}`).join(" · ");
              rows.push({
                kind: "line",
                text: `${window.padEnd(HISTORY_LABEL_COL)}${"agent".padEnd(HISTORY_LABEL_COL)}${changeText}`,
              });
            } else {
              rows.push({ kind: "line", text: c.subject });
            }
          }

          const footerCommand =
            lastWindow !== undefined
              ? `niceeval sandbox diff ${entry.sandboxId} --window ${lastWindow}`
              : `niceeval sandbox diff ${entry.sandboxId}`;
          const lines = renderPanel({
            title: `HISTORY · ${entry.sandboxId}`,
            meta,
            footerCommand,
            rows,
            width: panel.width,
            mode: panel.mode,
          });
          io.out(`${lines.join("\n")}\n`);
          return 0;
        }),
        Effect.catch((error) => Effect.sync(() => {
          io.err(`${errorText(error)}\n`);
          return 1;
        })),
      );
    }),
  );
}

function diffCommandEffect(root: string, ids: string[], flags: SandboxCommandFlags, io: SandboxCommandIo): SandboxCommandEffect<number> {
  return resolveEntriesEffect(root, ids.slice(0, 1), io).pipe(
    Effect.flatMap((resolved) => {
      if (!resolved || resolved.length === 0) {
        if (ids.length === 0) io.err("usage: niceeval sandbox diff <id> [--window turn2] [--path <file>]\n");
        return Effect.succeed(1);
      }
      const { id, entry } = resolved[0]!;
      return withWokenSandboxEffect(root, id, entry, () => Effect.gen(function* () {
        const log = yield* execInKeptEffect(entry, `git log --reverse --format='%H %s' 2>/dev/null`);
        const commits = log
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const space = line.indexOf(" ");
            return { hash: line.slice(0, space), subject: line.slice(space + 1) };
          })
          .filter((c) => c.subject.startsWith("agent "));
        const wanted = flags.window !== undefined ? commits.filter((c) => c.subject === `agent ${flags.window}`) : commits;
        if (wanted.length === 0) {
          return flags.window !== undefined
            ? `window "${flags.window}" not found; windows: ${commits.map((c) => c.subject.slice(6)).join(", ") || "(none)"}\n`
            : "(no agent windows in this ledger)\n";
        }
        const pathArg = flags.path !== undefined ? ` -- '${flags.path.replaceAll("'", `'\\''`)}'` : "";
        const sections: string[] = [];
        for (const c of wanted) {
          const patch = yield* execInKeptEffect(entry, `git diff ${c.hash}^ ${c.hash}${pathArg}`);
          sections.push(`── window ${c.subject.slice(6)}\n${patch.trimEnd()}`);
        }
        return sections.join("\n\n") + "\n";
      })).pipe(
        Effect.tap((out) => Effect.sync(() => io.out(out))),
        Effect.as(0),
        Effect.catch((error) => Effect.sync(() => {
          io.err(`${errorText(error)}\n`);
          return 1;
        })),
      );
    }),
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { keptEntryId };
