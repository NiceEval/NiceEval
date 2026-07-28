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
  acquireKeptLease,
  keptEntryId,
  readKeptEntries,
  readKeptLease,
  releaseKeptLease,
  removeKeptEntry,
  updateKeptEntry,
  type KeptSandboxEntry,
} from "./keep-registry.ts";
import { dockerOrphanCount, listOrphanCandidates, pruneOrphans, type OrphanCandidate } from "./orphans.ts";
import { panelCapabilityOf, renderPanel, type PanelMode, type PanelRow } from "../report/model/panel.ts";
import { computeExpiresAt } from "./keep.ts";

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
  /** stdout 的 TTY 探测(面板 `mode` 的传输能力信号);省略时按 `process.stdout` 探测——
   *  测试注入固定值,不依赖真实终端设备。 */
  isTTY?: boolean;
  /** stdout 的显示列数;省略时按 `process.stdout.columns` 探测,取不到时兜底 80。 */
  columns?: number;
}

const LEASE_TTL_MS = 60 * 60 * 1000;

/** `list`/`history` 一次性面板的传输能力:是 TTY 且没有要求朴素输出时才画框
 *  (docs/feature/sandbox/cli.md「输出体裁」)——`sandbox` 命令组只在启动时探测一次,
 *  不像 `exp` 的 live 面板那样需要随 resize 重新判断。 */
function panelCapabilityForIo(io: Io): { mode: PanelMode; width: number } {
  return panelCapabilityOf({
    isTTY: io.isTTY ?? process.stdout.isTTY,
    noColor: process.env.NO_COLOR,
    width: io.columns ?? process.stdout.columns,
  });
}

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
      `No .niceeval directory found from ${cwd} upward. Run this inside the project, or pass --record <record-root> to point at it.\n`,
    );
    return 1;
  }
  switch (sub) {
    case "list":
      return flags.orphans ? listOrphansCommand(root, io) : listCommand(root, io, panelCapabilityForIo(io));
    case "stop":
      return stopCommand(root, positionals.slice(1), flags, io);
    case "enter":
      return enterCommand(root, positionals.slice(1), flags, io);
    case "history":
      return historyCommand(root, positionals.slice(1), flags, io, panelCapabilityForIo(io));
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
    // --record 可以指 .niceeval 本身或它的父目录。
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

/** 每个留存条目在 `SANDBOXES` 面板里占两行:身份行(ID/PROVIDER/STATE/FROM)紧跟一条
 *  缩进到 ID 列宽的提示行(下一步动作各不相同,批量 stop --all 不能当默认下一步,所以下边框
 *  不嵌命令——见 docs/feature/sandbox/cli.md「sandbox list」)。 */
const LIST_ID_COL = 10;
const LIST_PROVIDER_COL = 10;
const LIST_STATE_COL = 10;

async function listCommand(root: string, io: Io, panel: { mode: PanelMode; width: number }): Promise<number> {
  const { entries } = await readKeptEntries(root);
  if (entries.length === 0) {
    io.out("No kept sandboxes.\n");
    return 0;
  }
  const rows: PanelRow[] = [
    { kind: "line", text: `${"ID".padEnd(LIST_ID_COL)}${"PROVIDER".padEnd(LIST_PROVIDER_COL)}${"STATE".padEnd(LIST_STATE_COL)}FROM` },
  ];
  for (const { id, entry } of entries) {
    // STATE 是当下核对的现场状态,不是登记时的旧值。
    const state = await inspectDetached(entry.provider, entry.sandboxId);
    // unknown 是探测失败，不是可持久化的现场事实；保留上次已知状态供下次核对。
    if (state !== "unknown" && state !== entry.state) await updateKeptEntry(root, id, { state }).catch(() => false);
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
    const lease = await readKeptLease(root, id);
    if (lease && Date.now() - Date.parse(lease.acquiredAt) < lease.ttlMs) {
      io.err(`${entry.sandboxId} (${entry.provider}) is in use by ${lease.holder} since ${lease.acquiredAt}; not stopping.\n`);
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
  const lease = { holder: leaseHolder(), op, acquiredAt: new Date().toISOString(), ttlMs: LEASE_TTL_MS };
  const acquired = await acquireKeptLease(root, id, lease);
  if (!acquired.acquired) {
    io.err(`${entry.sandboxId} is in use by ${acquired.lease.holder} since ${acquired.lease.acquiredAt}\n`);
    return undefined;
  }
  try {
    return await fn();
  } finally {
    await releaseKeptLease(root, id, acquired.token);
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
  if (state === "unknown") {
    io.err(`${entry.sandboxId} (${entry.provider}) could not be inspected — check credentials or retry later.\n`);
    return 1;
  }

  const result = await withLease(root, id, entry, "enter", io, async () => {
    await wakeDetached(entry.provider, entry.sandboxId);
    await updateKeptEntry(root, id, (current) => ({
      ...current,
      state: "alive",
      expiresAt: computeExpiresAt(current.provider, new Date().toISOString()),
    }));
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
      await updateKeptEntry(root, id, (current) => ({
        ...current,
        state: "dormant",
        expiresAt: computeExpiresAt(current.provider, new Date().toISOString()),
      }));
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
  if (state === "unknown") {
    throw new Error(`${entry.sandboxId} (${entry.provider}) could not be inspected — check credentials or retry later.`);
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

async function historyCommand(
  root: string,
  ids: string[],
  _flags: SandboxCommandFlags,
  io: Io,
  panel: { mode: PanelMode; width: number },
): Promise<number> {
  const resolved = await resolveEntries(root, ids.slice(0, 1), io);
  if (!resolved || resolved.length === 0) {
    if (ids.length === 0) io.err("usage: niceeval sandbox history <id>\n");
    return 1;
  }
  const { id, entry } = resolved[0]!;
  try {
    const out = await withWokenSandbox(root, id, entry, () => execInKept(entry, HISTORY_EXPORT_SCRIPT));
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
        const count = `+${changes.length} file${changes.length === 1 ? "" : "s"}`;
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
