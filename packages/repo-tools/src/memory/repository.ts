import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { Effect, Either } from "effect";
import { decodeMemoryDocument, encodeMemoryDocument } from "./codec.js";
import {
  LegacyMemoryReadOnly,
  MemoryContentInvalid,
  MemoryFileMissing,
  MemoryIoError,
  MemoryLockConflict,
  MemoryReferenceConflict,
  type MemoryError,
} from "./errors.js";
import type { MemoryDocument, MemoryV1, ProblemResolution, Promotion } from "./schema.js";
import { promoteMemory, reopenProblem, resolveProblem, supersedeMemory } from "./state.js";

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
export interface MemoryCheckReceipt { readonly ok: boolean; readonly checked: number; readonly legacy: number; readonly findings: readonly string[] }

export class MemoryRepository {
  readonly #root: string;
  readonly #directory: string;

  constructor(root = process.cwd()) { this.#root = resolve(root); this.#directory = join(this.#root, "memory"); }
  #path(id: string): string { return join(this.#directory, `${id}.md`); }
  #guardId(id: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id) || id === "INDEX") {
      throw new MemoryContentInvalid({ operation: "resolve id", message: `unsafe Memory id ${JSON.stringify(id)}` });
    }
  }

  list(): readonly MemoryDocument[] {
    if (!existsSync(this.#directory)) return [];
    return readdirSync(this.#directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md")
      .map((entry) => this.read(entry.name.slice(0, -3)))
      .sort((left, right) => ("legacy" in left ? left.id : left.metadata.id)
        .localeCompare("legacy" in right ? right.id : right.metadata.id));
  }

  read(id: string): MemoryDocument {
    this.#guardId(id); const path = this.#path(id);
    if (!existsSync(path)) throw new MemoryFileMissing({ operation: "read", path: relative(this.#root, path), message: "not found" });
    try { return decodeMemoryDocument(relative(this.#root, path), id, readFileSync(path, "utf8")); }
    catch (cause) {
      if (cause instanceof MemoryContentInvalid) throw cause;
      throw new MemoryIoError({ operation: "read", path: relative(this.#root, path), message: message(cause) });
    }
  }

  create(metadata: MemoryV1, body: string, dryRun = false): MemoryV1 {
    this.#guardId(metadata.id); mkdirSync(this.#directory, { recursive: true });
    const path = this.#path(metadata.id);
    if (existsSync(path)) throw new MemoryReferenceConflict({ operation: "add", path: relative(this.#root, path), message: "Memory already exists" });
    if (dryRun) return metadata;
    const temporary = `${path}.${process.pid}.tmp`;
    try { this.#writeDurable(temporary, encodeMemoryDocument(metadata, body)); renameSync(temporary, path); }
    catch (cause) {
      rmSync(temporary, { force: true });
      if (cause instanceof MemoryReferenceConflict) throw cause;
      throw new MemoryIoError({ operation: "add", path: relative(this.#root, path), message: message(cause) });
    }
    return metadata;
  }

  update(
    id: string,
    transition: (value: MemoryV1) => Either.Either<MemoryV1, MemoryReferenceConflict>,
    dryRun = false,
  ): MemoryV1 {
    const apply = (): MemoryV1 => {
      const document = this.read(id);
      if ("legacy" in document) throw new LegacyMemoryReadOnly({
        operation: "mutate", path: relative(this.#root, this.#path(id)),
        message: "legacy Memory is read-only; convert it explicitly while preserving its body",
      });
      const result = transition(document.metadata);
      if (Either.isLeft(result)) throw result.left;
      if (!dryRun) this.#replace(this.#path(id), encodeMemoryDocument(result.right, document.body));
      return result.right;
    };
    if (dryRun) return apply();
    let updated: MemoryV1 | undefined;
    this.#withLock(id, () => { updated = apply(); });
    if (updated === undefined) throw new MemoryIoError({ operation: "update", message: "transition produced no result" });
    return updated;
  }

  resolve(id: string, resolution: ProblemResolution, dryRun = false): MemoryV1 {
    return this.update(id, (value) => resolveProblem(value, resolution), dryRun);
  }
  reopen(id: string, dryRun = false): MemoryV1 { return this.update(id, reopenProblem, dryRun); }
  supersede(id: string, replacementId: string, dryRun = false): MemoryV1 {
    const replacement = this.read(replacementId);
    if ("legacy" in replacement) throw new LegacyMemoryReadOnly({ operation: "supersede", message: "replacement must be structured Memory" });
    return this.update(id, (value) => supersedeMemory(value, replacement.metadata), dryRun);
  }
  promote(id: string, promotion: Promotion, commit: string, dryRun = false): MemoryV1 {
    return this.update(id, (value) => promoteMemory(value, promotion, commit), dryRun);
  }

  search(pattern: string): readonly MemoryDocument[] {
    const needle = pattern.toLocaleLowerCase();
    return this.list().filter((document) => {
      const metadata = "legacy" in document ? `${document.id}\n${document.title}` :
        `${document.metadata.id}\n${document.metadata.title}`;
      return `${metadata}\n${document.body}`.toLocaleLowerCase().includes(needle);
    });
  }

  check(): MemoryCheckReceipt {
    const findings: string[] = []; const documents: MemoryDocument[] = [];
    try { documents.push(...this.list()); } catch (cause) { findings.push(message(cause)); }
    const structured = documents.filter((item): item is Exclude<MemoryDocument, { readonly legacy: true }> => !("legacy" in item));
    const byId = new Map(structured.map((item) => [item.metadata.id, item.metadata]));
    for (const { metadata } of structured) {
      if (metadata.kind.type === "problem" &&
        ((metadata.kind.state === "resolved") !== (metadata.kind.resolution !== undefined))) {
        findings.push(`${metadata.id}: Problem state and resolution disagree`);
      }
      if (metadata.kind.type !== "problem" && metadata.kind.state === "superseded") {
        const target = metadata.kind.supersededBy === undefined ? undefined : byId.get(metadata.kind.supersededBy);
        if (target === undefined || target.kind.type !== metadata.kind.type) findings.push(`${metadata.id}: superseding Memory is missing or wrong kind`);
      }
      for (const promotion of metadata.promotions) {
        if (promotion.current !== undefined && !this.#anchorExists(promotion.current.path, promotion.current.anchor)) {
          findings.push(`${metadata.id}: promotion target ${promotion.current.path}#${promotion.current.anchor} is missing`);
        }
      }
    }
    for (const { metadata } of structured) {
      if (metadata.kind.type === "problem") continue;
      const seen = new Set<string>(); let cursor: MemoryV1 | undefined = metadata;
      while (cursor !== undefined && cursor.kind.type !== "problem" && cursor.kind.supersededBy !== undefined) {
        if (seen.has(cursor.id)) { findings.push(`${metadata.id}: supersession cycle`); break; }
        seen.add(cursor.id); cursor = byId.get(cursor.kind.supersededBy);
      }
    }
    this.#checkRegressionReferences(byId, findings);
    return { ok: findings.length === 0, checked: documents.length,
      legacy: documents.filter((item) => "legacy" in item).length, findings };
  }

  #checkRegressionReferences(byId: ReadonlyMap<string, MemoryV1>, findings: string[]): void {
    const e2e = join(this.#root, "e2e"); if (!existsSync(e2e)) return;
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          for (const match of source.matchAll(/regression:\s*memory\/([^\s]+)\.md/gu)) {
            const id = match[1]; if (id !== undefined) {
              const memory = byId.get(id);
              if (memory !== undefined && memory.kind.type !== "problem") findings.push(`${relative(this.#root, path)}: regression must reference Problem Memory`);
              else if (memory === undefined && !existsSync(this.#path(id))) findings.push(`${relative(this.#root, path)}: regression Memory ${id} is missing`);
            }
          }
        }
      }
    }; visit(e2e);
  }

  #anchorExists(path: string, anchor: string): boolean {
    const target = resolve(this.#root, path);
    if (!target.startsWith(`${this.#root}/`) || !existsSync(target)) return false;
    const normalized = anchor.replace(/^#/, "");
    return readFileSync(target, "utf8").split(/\r?\n/u).some((line) =>
      line.startsWith("#") && line.replace(/^#+\s*/u, "").trim().toLocaleLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, "").replace(/\s+/gu, "-") === normalized);
  }

  #withLock(id: string, use: () => void): void {
    const lock = join(this.#directory, ".locks", id); mkdirSync(join(this.#directory, ".locks"), { recursive: true });
    try { mkdirSync(lock); } catch (cause) { throw new MemoryLockConflict({ operation: "lock", path: relative(this.#root, lock), message: message(cause) }); }
    try { use(); } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  #writeDurable(path: string, source: string): void {
    const descriptor = openSync(path, "wx");
    try { writeFileSync(descriptor, source); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  #replace(path: string, source: string): void {
    const temporary = `${path}.${process.pid}.tmp`;
    try { this.#writeDurable(temporary, source); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
  }
}

export const memoryEffect = <A>(operation: string, thunk: () => A): Effect.Effect<A, MemoryError> =>
  Effect.try({
    try: thunk,
    catch: (cause) => cause instanceof MemoryFileMissing || cause instanceof MemoryContentInvalid ||
      cause instanceof MemoryReferenceConflict || cause instanceof LegacyMemoryReadOnly ||
      cause instanceof MemoryLockConflict || cause instanceof MemoryIoError
      ? cause : new MemoryIoError({ operation, message: message(cause) }),
  });
