import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { Effect, Result } from "effect";

import { parseRepoRef, validateRepoRefTarget, type RepoRef, type ValidatedRepoRefTarget } from "../docs/trace/ref.js";
import type { DocsNodeKind, TraceSnapshot } from "../docs/trace/model.js";
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
import type { MemoryDocument, MemoryV1, ProblemResolution, PromotionKind } from "./schema.js";
import { promoteMemory, reopenProblem, resolveProblem, retirePromotion, supersedeMemory } from "./state.js";

const PROMOTION_KINDS = ["roadmap", "feature", "use-case", "engineering"] as const satisfies readonly DocsNodeKind[];
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
export interface MemoryCheckReceipt { readonly ok: boolean; readonly checked: number; readonly legacy: number; readonly findings: readonly string[] }

export class MemoryRepository {
  readonly #root: string;
  readonly #directory: string;

  constructor(root = process.cwd()) { this.#root = resolve(root); this.#directory = join(this.#root, "memory"); }
  get root(): string { return this.#root; }
  ownerPath(id: string): string { this.#guardId(id); return `memory/${id}.md`; }
  absoluteOwnerPath(id: string): string { return join(this.#root, this.ownerPath(id)); }

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
    this.#guardId(id);
    const path = this.absoluteOwnerPath(id);
    if (!existsSync(path)) throw new MemoryFileMissing({ operation: "read", path: relative(this.#root, path), message: "not found" });
    try { return decodeMemoryDocument(relative(this.#root, path), id, readFileSync(path, "utf8")); }
    catch (cause) {
      if (cause instanceof MemoryContentInvalid) throw cause;
      throw new MemoryIoError({ operation: "read", path: relative(this.#root, path), message: message(cause) });
    }
  }

  planCreate(metadata: MemoryV1, body: string): { readonly bytes: string; readonly metadata: MemoryV1 } {
    this.#guardId(metadata.id);
    if (metadata.promotions.length > 0) throw new MemoryReferenceConflict({ operation: "add", message: "memory add requires promotions=[]" });
    const initial = metadata.kind.type === "problem"
      ? metadata.kind.state === "open" && metadata.kind.resolution === undefined
      : metadata.kind.type === "decision"
      ? metadata.kind.state === "adopted" && metadata.kind.supersededBy === undefined
      : metadata.kind.state === "current" && metadata.kind.supersededBy === undefined;
    if (!initial) throw new MemoryReferenceConflict({
      operation: "add",
      message: "new Memory must start problem/open, decision/adopted, or insight/current without terminal-state metadata",
    });
    if (existsSync(this.absoluteOwnerPath(metadata.id))) throw new MemoryReferenceConflict({ operation: "add", path: this.ownerPath(metadata.id), message: "Memory already exists" });
    return { bytes: encodeMemoryDocument(metadata, body), metadata };
  }

  planTransition(
    id: string,
    source: string | undefined,
    transition: (value: MemoryV1) => Result.Result<MemoryV1, MemoryReferenceConflict>,
  ): { readonly bytes: string; readonly metadata: MemoryV1 } {
    if (source === undefined) throw new MemoryFileMissing({ operation: "mutate", path: this.ownerPath(id), message: "not found" });
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    if ("legacy" in document) throw new LegacyMemoryReadOnly({
      operation: "mutate",
      path: this.ownerPath(id),
      message: "legacy Memory is read-only; convert it explicitly while preserving its body",
    });
    if (document.metadata.id !== id) throw new MemoryContentInvalid({ operation: "mutate", path: this.ownerPath(id), message: "filename and metadata IDs disagree" });
    const result = transition(document.metadata);
    if (Result.isFailure(result)) throw result.failure;
    return { bytes: encodeMemoryDocument(result.success, document.body), metadata: result.success };
  }

  planResolve(id: string, source: string | undefined, resolution: ProblemResolution, regressionOwners: readonly string[] = []) {
    const planned = this.planTransition(id, source, (value) => resolveProblem(value, resolution));
    if (resolution.kind === "fixed" && regressionOwners.length === 0) throw new MemoryReferenceConflict({
      operation: "resolve",
      path: this.ownerPath(id),
      message: "fixed resolution requires a canonical E2E `regression: memory/...` owner",
    });
    return planned;
  }
  planReopen(id: string, source: string | undefined, commit: string) {
    if (source === undefined) throw new MemoryFileMissing({ operation: "reopen", path: this.ownerPath(id), message: "not found" });
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    if ("legacy" in document) throw new LegacyMemoryReadOnly({
      operation: "reopen",
      path: this.ownerPath(id),
      message: "legacy Memory is read-only; convert it explicitly while preserving its body",
    });
    if (document.metadata.id !== id) throw new MemoryContentInvalid({ operation: "reopen", path: this.ownerPath(id), message: "filename and metadata IDs disagree" });
    const previous = document.metadata.kind;
    const changed = reopenProblem(document.metadata);
    if (Result.isFailure(changed)) throw changed.failure;
    if (previous.type !== "problem" || previous.resolution === undefined) {
      throw new MemoryReferenceConflict({ operation: "reopen", message: "resolved Problem has no resolution to preserve" });
    }
    const heading = "## Resolution history";
    const entry = [
      `### Reopened at \`${commit}\``,
      "",
      "```json",
      JSON.stringify(previous.resolution, null, 2),
      "```",
    ].join("\n");
    const body = document.body.includes(heading)
      ? `${document.body.trimEnd()}\n\n${entry}\n`
      : `${document.body.trimEnd()}\n\n${heading}\n\n<!-- niceeval.memory-resolution-history/v1 -->\n\n${entry}\n`;
    return { bytes: encodeMemoryDocument(changed.success, body), metadata: changed.success };
  }
  planSupersede(id: string, source: string | undefined, replacement: MemoryV1, commit: string) {
    return this.planTransition(id, source, (value) => supersedeMemory(value, replacement, commit));
  }
  planPromote(id: string, source: string | undefined, kind: PromotionKind, target: RepoRef) {
    return this.planTransition(id, source, (value) => promoteMemory(value, kind, target));
  }
  planRetire(id: string, source: string | undefined, kind: PromotionKind, target: RepoRef, commit: string) {
    return this.planTransition(id, source, (value) => retirePromotion(value, kind, target, commit));
  }

  targetSource(target: unknown): { readonly path: string; readonly absolutePath: string; readonly source: string } {
    const parsed = parseRepoRef(target);
    if (Result.isFailure(parsed)) throw new MemoryReferenceConflict({ operation: "target", message: parsed.failure.message });
    const absolutePath = resolve(this.#root, parsed.success.path);
    if (!absolutePath.startsWith(`${this.#root}${sep}`) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new MemoryReferenceConflict({ operation: "target", path: parsed.success.path, message: "target file is missing or unsafe" });
    }
    return { path: parsed.success.path, absolutePath, source: readFileSync(absolutePath, "utf8") };
  }

  validateTarget(snapshot: TraceSnapshot, target: unknown): ValidatedRepoRefTarget & { readonly kind: PromotionKind } {
    const source = this.targetSource(target);
    const validated = validateRepoRefTarget(snapshot, target, PROMOTION_KINDS, source.source);
    if (Result.isFailure(validated)) throw new MemoryReferenceConflict({ operation: "target", path: source.path, message: validated.failure.message });
    const kind = validated.success.kind;
    if (kind !== "roadmap" && kind !== "feature" && kind !== "use-case" && kind !== "engineering") {
      throw new MemoryReferenceConflict({ operation: "target", path: source.path, message: `unsupported promotion kind ${kind}` });
    }
    return { ...validated.success, kind };
  }

  search(pattern: string): readonly MemoryDocument[] {
    const needle = pattern.toLocaleLowerCase();
    return this.list().filter((document) => {
      const metadata = "legacy" in document ? `${document.id}\n${document.title}` : `${document.metadata.id}\n${document.metadata.title}`;
      return `${metadata}\n${document.body}`.toLocaleLowerCase().includes(needle);
    });
  }

  check(snapshot: TraceSnapshot): MemoryCheckReceipt {
    const findings: string[] = [];
    const documents: MemoryDocument[] = [];
    try { documents.push(...this.list()); } catch (cause) { findings.push(message(cause)); }
    const structured = documents.filter((item): item is Exclude<MemoryDocument, { readonly legacy: true }> => !("legacy" in item));
    const byId = new Map(structured.map((item) => [item.metadata.id, item.metadata]));
    for (const { metadata } of structured) {
      if (metadata.kind.type === "problem" && ((metadata.kind.state === "resolved") !== (metadata.kind.resolution !== undefined))) {
        findings.push(`${metadata.id}: Problem state and resolution disagree`);
      }
      if (metadata.kind.type === "problem" && metadata.kind.resolution?.kind === "fixed" && !snapshot.tests.some((test) =>
        test.regressions.some((reference) => reference.split("#", 1)[0] === `memory/${metadata.id}.md`))) {
        findings.push(`${metadata.id}: fixed Problem has no canonical E2E regression owner`);
      }
      if (metadata.kind.type !== "problem" && metadata.kind.state === "superseded") {
        const target = metadata.kind.supersededBy === undefined ? undefined : byId.get(metadata.kind.supersededBy);
        if (target === undefined || target.kind.type !== metadata.kind.type) findings.push(`${metadata.id}: superseding Memory is missing or wrong kind`);
        if (metadata.promotions.some((promotion) => promotion.current.length > 0)) findings.push(`${metadata.id}: superseded Memory must have no current promotions`);
      }
      for (const promotion of metadata.promotions) {
        for (const target of promotion.current) {
          try {
            const validated = this.validateTarget(snapshot, target);
            if (validated.kind !== promotion.kind) findings.push(`${metadata.id}: ${target} is in the wrong ${promotion.kind} bucket`);
          } catch (cause) { findings.push(`${metadata.id}: ${message(cause)}`); }
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
    this.#checkRegressionReferences(snapshot, findings);
    return {
      ok: findings.length === 0,
      checked: documents.length,
      legacy: documents.filter((item) => "legacy" in item).length,
      findings,
    };
  }

  #checkRegressionReferences(snapshot: TraceSnapshot, findings: string[]): void {
    const byPath = new Map(snapshot.memory.map((memory) => [memory.path, memory]));
    for (const test of snapshot.tests) {
      for (const reference of test.regressions) {
        const target = byPath.get(reference.split("#", 1)[0] ?? reference);
        if (target === undefined) findings.push(`${test.path}: regression Memory ${reference} is missing`);
        else if (target.kind !== "problem" && target.kind !== "legacy/unstructured") {
          findings.push(`${test.path}: regression must reference Problem Memory`);
        }
      }
    }
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
