// Layout 的 crash journal。它不解释 LayoutV2（协议层才有这个权限），只绑定准确的原始
// canonical bytes 摘要和 generation。这样 Store 在“layout 已换、commit marker 尚未来得及写”
// 的断电窗口仍能根据可验证事实恢复，而不会产生 head 与 committedRoots 分离的状态。

import { createHash } from "node:crypto";
import { LocalStorePhysicalCorruptionError } from "./errors.ts";
import { readFileIfPresent, writeFileAtomically } from "./fs.ts";
import type { LocalStorePaths } from "./paths.ts";

const JOURNAL_SCHEMA = "niceeval.record-store-journal/1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type LocalJournalPhase = "prepare" | "committed";

export interface LocalStoreJournal {
  readonly schema: typeof JOURNAL_SCHEMA;
  readonly transactionId: string;
  readonly fencingToken: string;
  readonly phase: LocalJournalPhase;
  /** 初次 binding 的 expected layout 是 null；以后必须是前一 Layout 的 exact byte digest。 */
  readonly expectedLayout: string | null;
  readonly nextLayout: string;
  readonly nextGeneration: number;
}

export type LocalJournalRecovery =
  | { readonly state: "none" }
  | { readonly state: "prepared-not-applied"; readonly journal: LocalStoreJournal }
  | { readonly state: "completed-during-recovery"; readonly journal: LocalStoreJournal }
  | { readonly state: "committed"; readonly journal: LocalStoreJournal };

function valueAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function parseJournal(value: unknown): LocalStoreJournal | undefined {
  const schema = valueAt(value, "schema");
  const transactionId = valueAt(value, "transactionId");
  const fencingToken = valueAt(value, "fencingToken");
  const phase = valueAt(value, "phase");
  const expectedLayout = valueAt(value, "expectedLayout");
  const nextLayout = valueAt(value, "nextLayout");
  const nextGeneration = valueAt(value, "nextGeneration");
  if (
    schema !== JOURNAL_SCHEMA ||
    typeof transactionId !== "string" || transactionId === "" ||
    typeof fencingToken !== "string" || !/^[1-9][0-9]*$/.test(fencingToken) ||
    (phase !== "prepare" && phase !== "committed") ||
    (expectedLayout !== null && !isDigest(expectedLayout)) ||
    !isDigest(nextLayout) ||
    typeof nextGeneration !== "number" || !Number.isSafeInteger(nextGeneration) || nextGeneration < 1
  ) {
    return undefined;
  }
  return Object.freeze({
    schema,
    transactionId,
    fencingToken,
    phase,
    expectedLayout,
    nextLayout,
    nextGeneration,
  });
}

export function bytesDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readLocalStoreJournal(paths: LocalStorePaths): Promise<LocalStoreJournal | undefined> {
  const bytes = await readFileIfPresent(paths.journal);
  if (bytes === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new LocalStorePhysicalCorruptionError({
      component: "journal",
      path: paths.journal,
      detail: "journal is not valid JSON",
    });
  }
  const journal = parseJournal(parsed);
  if (journal === undefined) {
    throw new LocalStorePhysicalCorruptionError({
      component: "journal",
      path: paths.journal,
      detail: "journal does not match the v1 physical shape",
    });
  }
  return journal;
}

async function writeJournal(paths: LocalStorePaths, journal: LocalStoreJournal): Promise<void> {
  await writeFileAtomically(paths.journal, encoder.encode(JSON.stringify(journal)));
}

export async function writePreparedJournal(
  paths: LocalStorePaths,
  input: Omit<LocalStoreJournal, "schema" | "phase">,
): Promise<LocalStoreJournal> {
  const journal: LocalStoreJournal = Object.freeze({ schema: JOURNAL_SCHEMA, phase: "prepare", ...input });
  await writeJournal(paths, journal);
  return journal;
}

export async function markJournalCommitted(
  paths: LocalStorePaths,
  prepared: LocalStoreJournal,
): Promise<LocalStoreJournal> {
  const committed: LocalStoreJournal = Object.freeze({ ...prepared, phase: "committed" });
  await writeJournal(paths, committed);
  return committed;
}

/**
 * 调用者必须先保证不存在活 write lease，随后提供 layout bytes（absence 表示 unbound）。
 * prepared journal 对上 next bytes 时，恢复只补 commit marker；对上 expected bytes 时说明
 * layout 尚未替换，保留 staging/journal 给 grace + GC，而不伪造一次成功 commit。
 */
export async function recoverLocalStoreJournal(
  paths: LocalStorePaths,
  layoutBytes: Uint8Array | undefined,
): Promise<LocalJournalRecovery> {
  const journal = await readLocalStoreJournal(paths);
  if (journal === undefined) return Object.freeze<LocalJournalRecovery>({ state: "none" });
  const actual = layoutBytes === undefined ? null : bytesDigest(layoutBytes);

  if (journal.phase === "committed") {
    if (actual !== journal.nextLayout) {
      throw new LocalStorePhysicalCorruptionError({
        component: "journal",
        path: paths.journal,
        detail: "commit marker does not match the durable layout bytes",
      });
    }
    return Object.freeze<LocalJournalRecovery>({ state: "committed", journal });
  }

  if (actual === journal.nextLayout) {
    await markJournalCommitted(paths, journal);
    return Object.freeze<LocalJournalRecovery>({ state: "completed-during-recovery", journal });
  }
  if (actual === journal.expectedLayout) {
    return Object.freeze<LocalJournalRecovery>({ state: "prepared-not-applied", journal });
  }
  throw new LocalStorePhysicalCorruptionError({
    component: "journal",
    path: paths.journal,
    detail: "prepare marker matches neither the expected nor the next durable layout bytes",
  });
}
