// `niceeval sandbox` 命令组:查看与销毁留存的沙箱(见 docs/feature/sandbox/cli.md)。
// 不读 niceeval.config.ts、不发现 eval,只操作留存注册表(.niceeval/sandboxes/ 逐条目文件)
// 与内置 provider 的 detached 能力;provider 名的路由发生在 CLI / 注册表边界(sandbox/ 域内)。

import { hostname } from "node:os";
import { resolve } from "node:path";
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
  findNiceevalRoot,
  keptEntryId,
  readKeptEntries,
  removeKeptEntry,
  updateKeptEntry,
  type KeptSandboxEntry,
} from "./keep-registry.ts";
import { dockerOrphanCount, listOrphanCandidates, pruneOrphans, type OrphanCandidate } from "./orphans.ts";

export interface SandboxCommandFlags {
  all?: boolean;
  window?: string;
  path?: string;
  leaveRunning?: boolean;
  /** 仓库外执行时显式指定结果根(.niceeval 或其父目录)。 */
  run?: string;
  /** `sandbox list` 专用:核对强杀路径留下的无主实例(见「孤儿核对」)。 */
  orphans?: boolean;
  /** `sandbox prune` 专用:连 unverified 一起销毁。 */
  force?: boolean;
}

interface Io {
  out(text: string): void;
  err(text: string): void;
}

const LEASE_TTL_MS = 60 * 60 * 1000;

/** 入口:`niceeval sandbox <list|enter|history|diff|stop> …`;返回退出码。 */
export async function runSandboxCommand(
  cwd: string,
  positionals: string[],
  flags: SandboxCommandFlags,
  io: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
): Promise<number> {
  const sub = positionals[0];
  const root = await resolveRegistryRoot(cwd, flags.run);
  if (root === undefined) {
    io.err(
      `No .niceeval directory found from ${cwd} upward. Run this inside the project, or pass --results <results-root> to point at it.\n`,
    );
    return 1;
  }
  switch (sub) {
    case "list":
      return flags.orphans ? listOrphansCommand(root, io) : listCommand(root, io);
    case "stop":
      return stopCommand(root, positionals.slice(1), flags, io);
    case "enter":
      return enterCommand(root, positionals.slice(1), flags, io);
    case "history":
      return historyCommand(root, positionals.slice(1), flags, io);
    case "diff":
      return diffCommand(root, positionals.slice(1), flags, io);
    case "prune":
      return pruneCommand(root, flags, io);
    default:
      io.err(`usage: niceeval sandbox <list|enter|history|diff|stop|prune> …\n`);
      return 1;
  }
}

/** 留存注册表条目的 sandboxId 集合——孤儿核对与 prune 都要排除它们(被管理的现场不是孤儿)。 */
async function keptSandboxIds(root: string): Promise<Set<string>> {
  const { entries } = await readKeptEntries(root);
  return new Set(entries.map(({ entry }) => entry.sandboxId));
}

async function listOrphansCommand(root: string, io: Io): Promise<number> {
  const candidates = await listOrphanCandidates(await keptSandboxIds(root));
  if (candidates.length === 0) {
    io.out("No orphan sandboxes.\n");
    return 0;
  }
  io.out(`ID        PROVIDER  OWNER              STARTED            STATE\n`);
  for (const c of candidates) {
    io.out(
      `${c.sandboxId.padEnd(10)}${c.provider.padEnd(10)}${ownerLabel(c).padEnd(19)}${formatWhen(c.identity.startedAt).padEnd(19)}${c.state}\n`,
    );
  }
  io.out(`Remove orphans with: niceeval sandbox prune\n`);
  return 0;
}

async function pruneCommand(root: string, flags: SandboxCommandFlags, io: Io): Promise<number> {
  const outcome = await pruneOrphans(await keptSandboxIds(root), flags.force === true);
  if (outcome.pruned.length === 0 && outcome.failed.length === 0) {
    io.out("No orphan sandboxes.\n");
  } else {
    if (outcome.pruned.length > 0) {
      io.out(`pruned ${outcome.pruned.length} orphan sandbox${outcome.pruned.length === 1 ? "" : "es"}\n`);
      for (const c of outcome.pruned) {
        io.out(`  ${c.sandboxId}  ${c.provider}  ${ownerLabel(c)} · started ${formatWhen(c.identity.startedAt)}\n`);
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
}

/** `pid <pid>@<host>`,同宿主确认死亡时追加 ` dead`——unverified(异宿主)不冒充已核实。 */
function ownerLabel(c: OrphanCandidate): string {
  return `pid ${c.identity.pid}@${c.identity.host}${c.state === "orphan" ? " dead" : ""}`;
}

/** 留存注册表里还有条目时,`niceeval exp` 启动打的一行提醒(不阻塞、不清理)。 */
export async function orphanReminder(cwd: string): Promise<string | undefined> {
  const root = await findNiceevalRoot(cwd);
  const keptIds = root ? await keptSandboxIds(root) : new Set<string>();
  const count = await dockerOrphanCount(keptIds);
  if (count === 0) return undefined;
  return `${count} orphan docker sandbox${count === 1 ? "" : "es"} from a killed run — niceeval sandbox prune\n`;
}

async function resolveRegistryRoot(cwd: string, runFlag: string | undefined): Promise<string | undefined> {
  if (runFlag !== undefined) {
    const base = resolve(cwd, runFlag);
    // --results 可以指 .niceeval 本身或它的父目录。
    return base.endsWith(".niceeval") ? base : `${base}/.niceeval`;
  }
  return findNiceevalRoot(cwd);
}

/** 留存注册表里还有条目时,`niceeval exp` 启动打的一行提醒(不阻塞、不清理)。 */
export async function keptSandboxReminder(cwd: string): Promise<string | undefined> {
  const root = await findNiceevalRoot(cwd);
  if (!root) return undefined;
  const { entries } = await readKeptEntries(root);
  if (entries.length === 0) return undefined;
  return `${entries.length} kept sandbox${entries.length === 1 ? "" : "es"} from earlier runs — niceeval sandbox list\n`;
}

async function listCommand(root: string, io: Io): Promise<number> {
  const { entries } = await readKeptEntries(root);
  if (entries.length === 0) {
    io.out("No kept sandboxes.\n");
    return 0;
  }
  io.out(`ID        PROVIDER  STATE            FROM\n`);
  for (const { id, entry } of entries) {
    // STATE 是当下核对的现场状态,不是登记时的旧值。
    const state = await inspectDetached(entry.provider, entry.sandboxId);
    if (state !== entry.state) await updateKeptEntry(root, id, { state }).catch(() => false);
    const from = `${entry.evalId} #${entry.attempt} · ${entry.verdict} · ${entry.locator} · ${formatWhen(entry.keptAt)}`;
    io.out(`${id.padEnd(10)}${entry.provider.padEnd(10)}${state.padEnd(17)}${from}\n`);
    if (state === "expired") {
      const when = entry.expiresAt !== undefined ? `expired ${formatWhen(entry.expiresAt)} — ` : "";
      io.out(`            ${when}remove with: niceeval sandbox stop ${id}\n`);
    } else {
      io.out(`            enter: niceeval sandbox enter ${id}\n`);
    }
  }
  return 0;
}

/** id 接受 entry id / 实例 id 的唯一前缀;有歧义或不在注册表里时报错并列出候选。 */
async function resolveEntries(
  root: string,
  ids: string[],
  io: Io,
): Promise<{ id: string; entry: KeptSandboxEntry }[] | undefined> {
  const { entries } = await readKeptEntries(root);
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
}

function leaseHolder(): string {
  return `${process.pid}@${hostname()}`;
}

function leaseActive(entry: KeptSandboxEntry): boolean {
  if (!entry.lease) return false;
  return Date.now() - Date.parse(entry.lease.acquiredAt) < entry.lease.ttlMs;
}

async function stopCommand(root: string, ids: string[], flags: SandboxCommandFlags, io: Io): Promise<number> {
  let targets: { id: string; entry: KeptSandboxEntry }[];
  if (flags.all) {
    targets = (await readKeptEntries(root)).entries;
  } else if (ids.length === 0) {
    io.err("specify sandbox ids or --all\n");
    return 1;
  } else {
    const resolved = await resolveEntries(root, ids, io);
    if (!resolved) return 1;
    targets = resolved;
  }

  let code = 0;
  for (const { id, entry } of targets) {
    if (leaseActive(entry)) {
      io.err(`${entry.sandboxId} (${entry.provider}) is in use by ${entry.lease!.holder} since ${entry.lease!.acquiredAt}; not stopping.\n`);
      code = 1;
      continue;
    }
    try {
      const outcome = await destroyDetached(entry.provider, entry.sandboxId);
      await removeKeptEntry(root, id);
      if (outcome === "stopped") io.out(`stopped ${entry.sandboxId} (${entry.provider})\n`);
      else io.out(`${entry.sandboxId} (${entry.provider}) already gone — removed from registry\n`);
    } catch (e) {
      // 只有实例成功销毁或确认已不存在时才移除登记项;其它错误保留条目并退出 1,
      // 不能把仍活着的资源从管理面隐藏掉。
      io.err(`failed to stop ${entry.sandboxId} (${entry.provider}): ${e instanceof Error ? e.message : String(e)}\n`);
      code = 1;
    }
  }
  return code;
}

async function withLease<T>(
  root: string,
  id: string,
  entry: KeptSandboxEntry,
  op: string,
  io: Io,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (leaseActive(entry) && entry.lease!.holder !== leaseHolder()) {
    io.err(`${entry.sandboxId} is in use by ${entry.lease!.holder} since ${entry.lease!.acquiredAt}\n`);
    return undefined;
  }
  if (entry.lease && !leaseActive(entry)) {
    io.err(`taking over an expired lease from ${entry.lease.holder} (acquired ${entry.lease.acquiredAt})\n`);
  }
  await updateKeptEntry(root, id, {
    lease: { holder: leaseHolder(), op, acquiredAt: new Date().toISOString(), ttlMs: LEASE_TTL_MS },
  });
  try {
    return await fn();
  } finally {
    await updateKeptEntry(root, id, (e) => {
      const { lease, ...rest } = e;
      void lease;
      return rest as KeptSandboxEntry;
    }).catch(() => false);
  }
}

async function enterCommand(root: string, ids: string[], flags: SandboxCommandFlags, io: Io): Promise<number> {
  const resolved = await resolveEntries(root, ids.slice(0, 1), io);
  if (!resolved || resolved.length === 0) {
    if (ids.length === 0) io.err("usage: niceeval sandbox enter <id> [--leave-running]\n");
    return 1;
  }
  const { id, entry } = resolved[0]!;
  const gap = detachedCapabilityGap(entry.provider);
  if (gap) {
    io.err(`${entry.sandboxId}: ${gap}\n`);
    return 1;
  }
  const state = await inspectDetached(entry.provider, entry.sandboxId);
  if (state === "expired") {
    io.err(`${entry.sandboxId} (${entry.provider}) is gone — the instance no longer exists. Clean up with: niceeval sandbox stop ${id}\n`);
    return 1;
  }

  const result = await withLease(root, id, entry, "enter", io, async () => {
    await wakeDetached(entry.provider, entry.sandboxId);
    await updateKeptEntry(root, id, { state: "alive" });
    let code: number;
    try {
      code = await openInteractiveShell(entry.provider, entry.sandboxId, entry.workdir);
    } catch (e) {
      // 原生命令本身起不来(如未装对应 CLI):现场保持 alive,提示改用注册表里的原生命令直连。
      io.err(
        `failed to open an interactive shell for ${entry.sandboxId} (${entry.provider}): ${e instanceof Error ? e.message : String(e)}${entry.enter ? `\nconnect directly instead: ${entry.enter}` : ""}\n`,
      );
      return 1;
    }
    if (flags.leaveRunning) {
      await updateKeptEntry(root, id, { state: "alive" });
      io.out(`left running: ${entry.sandboxId} (re-suspend with another enter, or destroy with niceeval sandbox stop ${id})\n`);
      return code;
    }
    // shell 退出(含 Ctrl+C)后自动送回休眠——「休眠不烧资源」不因进去看过一眼失效。
    try {
      await suspendDetached(entry.provider, entry.sandboxId);
      await updateKeptEntry(root, id, { state: "dormant" });
    } catch (e) {
      io.err(`failed to re-suspend ${entry.sandboxId}: ${e instanceof Error ? e.message : String(e)}\n`);
      await updateKeptEntry(root, id, { state: "alive" });
    }
    return code;
  });
  return result ?? 1;
}

/** 在留存现场里跑一条命令(非交互;history/diff 用)——按 provider 能力路由到 `execInDetached`。 */
async function execInKept(entry: KeptSandboxEntry, script: string): Promise<string> {
  const gap = detachedCapabilityGap(entry.provider);
  if (gap) throw new Error(gap);
  return execInDetached(entry.provider, entry.sandboxId, entry.workdir, script);
}

/** 唤醒 → 读 → 送回休眠(现场休眠中同样可用;读完不留 alive)。 */
async function withWokenSandbox<T>(
  root: string,
  id: string,
  entry: KeptSandboxEntry,
  fn: () => Promise<T>,
): Promise<T> {
  const gap = detachedCapabilityGap(entry.provider);
  if (gap) throw new Error(`${entry.sandboxId}: ${gap}`);
  const state = await inspectDetached(entry.provider, entry.sandboxId);
  if (state === "expired") {
    throw new Error(`${entry.sandboxId} (${entry.provider}) is gone; the in-sandbox ledger died with it (artifacts are unaffected). Clean up with: niceeval sandbox stop ${id}`);
  }
  const wasDormant = state === "dormant";
  if (wasDormant) await wakeDetached(entry.provider, entry.sandboxId);
  try {
    return await fn();
  } finally {
    if (wasDormant) {
      await suspendDetached(entry.provider, entry.sandboxId).catch(() => {});
    }
  }
}

async function historyCommand(root: string, ids: string[], _flags: SandboxCommandFlags, io: Io): Promise<number> {
  const resolved = await resolveEntries(root, ids.slice(0, 1), io);
  if (!resolved || resolved.length === 0) {
    if (ids.length === 0) io.err("usage: niceeval sandbox history <id>\n");
    return 1;
  }
  const { id, entry } = resolved[0]!;
  try {
    const out = await withWokenSandbox(root, id, entry, () =>
      execInKept(entry, `git log --reverse --format='%at %s' 2>/dev/null`),
    );
    const lines = out.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      io.out("(no ledger found in this sandbox)\n");
      return 0;
    }
    for (const line of lines) {
      const space = line.indexOf(" ");
      const at = new Date(Number(line.slice(0, space)) * 1000);
      const subject = line.slice(space + 1);
      if (subject === "anchor") {
        io.out(`anchor  ${formatWhen(at.toISOString())}\n`);
      } else if (subject.startsWith("eval ")) {
        io.out(`eval    (window ${subject.slice(5)} 之前的 fixture / setup / 校验写入)\n`);
      } else if (subject.startsWith("agent ")) {
        io.out(`${subject.slice(6).padEnd(8)}agent\n`);
      } else {
        io.out(`${subject}\n`);
      }
    }
    return 0;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

async function diffCommand(root: string, ids: string[], flags: SandboxCommandFlags, io: Io): Promise<number> {
  const resolved = await resolveEntries(root, ids.slice(0, 1), io);
  if (!resolved || resolved.length === 0) {
    if (ids.length === 0) io.err("usage: niceeval sandbox diff <id> [--window s1/t2] [--path <file>]\n");
    return 1;
  }
  const { id, entry } = resolved[0]!;
  try {
    const out = await withWokenSandbox(root, id, entry, async () => {
      const log = await execInKept(entry, `git log --reverse --format='%H %s' 2>/dev/null`);
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
        const patch = await execInKept(entry, `git diff ${c.hash}^ ${c.hash}${pathArg}`);
        sections.push(`── window ${c.subject.slice(6)}\n${patch.trimEnd()}`);
      }
      return sections.join("\n\n") + "\n";
    });
    io.out(out);
    return 0;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { keptEntryId };
