import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { Effect, Either, ParseResult, Schema } from "effect";
import { decodeFeedbackDocument, encodeFeedbackDocument, type FeedbackDocument } from "./codec.js";
import {
  FeedbackContentInvalid,
  FeedbackFileMissing,
  FeedbackIoError,
  FeedbackLockConflict,
  FeedbackReferenceConflict,
  type FeedbackError,
} from "./errors.js";
import {
  FeedbackEnvelopeV1Schema,
  FrogMigrationReceiptSchema,
  type FeedbackClosure,
  type FeedbackEnvelopeV1,
  type FeedbackMemoryRelation,
  type FeedbackV1,
} from "./schema.js";
import { closeFeedback, linkMemory, reopenFeedback } from "./state.js";
import { decodeMemoryDocument } from "../memory/codec.js";

export interface FeedbackRepositoryOptions { readonly root?: string }
export interface FeedbackCheckReceipt { readonly ok: boolean; readonly checked: number; readonly findings: readonly string[] }
interface ArtifactCopy { readonly relativePath: string; readonly sourcePath: string }

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export class FeedbackRepository {
  readonly #root: string;
  readonly #directory: string;

  constructor(options: FeedbackRepositoryOptions = {}) {
    this.#root = resolve(options.root ?? process.cwd());
    this.#directory = join(this.#root, "feedback");
  }

  #path(id: string): string { return join(this.#directory, id, "README.md"); }

  #guardId(id: string): void {
    if (id.trim() === "" || id === "." || id === ".." || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      throw new FeedbackContentInvalid({ operation: "resolve id", message: `unsafe feedback id ${JSON.stringify(id)}` });
    }
  }

  list(): readonly FeedbackDocument[] {
    if (!existsSync(this.#directory)) return [];
    return readdirSync(this.#directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => this.read(entry.name))
      .sort((left, right) => left.metadata.id.localeCompare(right.metadata.id));
  }

  read(id: string): FeedbackDocument {
    this.#guardId(id);
    const path = this.#path(id);
    if (!existsSync(path)) throw new FeedbackFileMissing({ operation: "read", path: relative(this.#root, path), message: "not found" });
    try { return decodeFeedbackDocument(relative(this.#root, path), readFileSync(path, "utf8")); }
    catch (cause) {
      if (cause instanceof FeedbackContentInvalid) throw cause;
      throw new FeedbackIoError({ operation: "read", path: relative(this.#root, path), message: message(cause) });
    }
  }

  create(document: FeedbackDocument, artifacts: readonly ArtifactCopy[] = [], dryRun = false): FeedbackV1 {
    this.#guardId(document.metadata.id);
    const target = dirname(this.#path(document.metadata.id));
    if (existsSync(target)) throw new FeedbackReferenceConflict({ operation: "add", path: relative(this.#root, target), message: "feedback already exists" });
    if (dryRun) return document.metadata;
    mkdirSync(this.#directory, { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      mkdirSync(temporary);
      this.#writeDurable(join(temporary, "README.md"), encodeFeedbackDocument(document));
      for (const artifact of artifacts) {
        const destination = join(temporary, "artifacts", artifact.relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        this.#writeDurable(destination, readFileSync(artifact.sourcePath));
      }
      renameSync(temporary, target);
    } catch (cause) {
      rmSync(temporary, { recursive: true, force: true });
      if (cause instanceof FeedbackReferenceConflict) throw cause;
      throw new FeedbackIoError({ operation: "add", path: relative(this.#root, target), message: message(cause) });
    }
    return document.metadata;
  }

  update(
    id: string,
    transition: (value: FeedbackV1) => Either.Either<FeedbackV1, FeedbackReferenceConflict>,
    dryRun = false,
  ): FeedbackV1 {
    const apply = (): FeedbackV1 => {
      const document = this.read(id);
      const result = transition(document.metadata);
      if (Either.isLeft(result)) throw result.left;
      if (!dryRun) this.#replace(this.#path(id), encodeFeedbackDocument({ ...document, metadata: result.right }));
      return result.right;
    };
    if (dryRun) return apply();
    let updated: FeedbackV1 | undefined;
    this.#withLock(id, () => { updated = apply(); });
    if (updated === undefined) throw new FeedbackIoError({ operation: "update", message: "transition produced no result" });
    return updated;
  }

  link(id: string, relation: FeedbackMemoryRelation, dryRun = false): FeedbackV1 {
    const path = join(this.#root, "memory", `${relation.memory}.md`);
    if (!existsSync(path)) throw new FeedbackReferenceConflict({ operation: "link", path: relative(this.#root, path), message: "Memory is missing" });
    return this.update(id, (value) => linkMemory(value, relation), dryRun);
  }
  close(id: string, closure: FeedbackClosure, dryRun = false): FeedbackV1 {
    return this.update(id, (value) => {
      const changed = closeFeedback(value, closure);
      if (Either.isLeft(changed)) return changed;
      this.#validateClosure(changed.right, closure);
      return changed;
    }, dryRun);
  }
  reopen(id: string, dryRun = false): FeedbackV1 { return this.update(id, reopenFeedback, dryRun); }

  importEnvelope(input: unknown, artifactRoot: string, reportedAt: string, dryRun = false): FeedbackV1 {
    const decoded = Schema.decodeUnknownEither(FeedbackEnvelopeV1Schema, { errors: "all" })(input);
    if (Either.isLeft(decoded)) throw new FeedbackContentInvalid({
      operation: "import", message: ParseResult.TreeFormatter.formatErrorSync(decoded.left),
    });
    const envelope = decoded.right;
    this.#verifyEnvelope(envelope, artifactRoot);
    const existing = this.list().find((item) => item.metadata.source.kind === "dogfood" &&
      item.metadata.source.repository === envelope.origin.repository &&
      item.metadata.source.originId === envelope.origin.originId);
    if (existing !== undefined) {
      const priorDigest = /^Envelope digest:\s*`([^`]+)`$/mu.exec(existing.body)?.[1];
      if (priorDigest === envelope.digest) return existing.metadata;
      throw new FeedbackReferenceConflict({ operation: "import", message: "origin id already exists with a different digest" });
    }
    const id = `feedback-${createHash("sha256")
      .update(`${envelope.origin.repository}\0${envelope.origin.originId}`)
      .digest("hex").slice(0, 16)}`;
    const feedback: FeedbackV1 = {
      format: "niceeval.feedback/v1", id, title: envelope.observation.split("\n", 1)[0] || id,
      state: "open", reportedAt,
      source: { kind: "dogfood", ...envelope.origin }, subject: "product", claim: "friction",
      observation: envelope.observation, impact: envelope.impact, memoryRelations: [],
    };
    this.create(
      { metadata: feedback, body: `# ${feedback.title}\n\nEnvelope digest: \`${envelope.digest}\`\n` },
      envelope.artifacts.map((artifact) => ({
        relativePath: artifact.path,
        sourcePath: resolve(artifactRoot, artifact.path),
      })),
      dryRun,
    );
    return feedback;
  }

  check(): FeedbackCheckReceipt {
    const findings: string[] = [];
    const entries: FeedbackDocument[] = [];
    try { entries.push(...this.list()); } catch (cause) { findings.push(message(cause)); }
    const ids = new Map(entries.map((entry) => [entry.metadata.id, entry]));
    for (const entry of entries) {
      const value = entry.metadata;
      if ((value.state === "closed") !== (value.closure !== undefined)) findings.push(`${value.id}: state and closure disagree`);
      if (value.duplicateOf !== undefined && !ids.has(value.duplicateOf)) findings.push(`${value.id}: duplicate target ${value.duplicateOf} is missing`);
      if (value.adoptedContract !== undefined &&
        !this.#anchorExists(value.adoptedContract.path, value.adoptedContract.anchor)) {
        findings.push(`${value.id}: adopted contract target is missing`);
      }
      for (const relation of value.memoryRelations) {
        if (!existsSync(join(this.#root, "memory", `${relation.memory}.md`))) findings.push(`${value.id}: Memory ${relation.memory} is missing`);
      }
      const currentClosure = value.closure;
      if (currentClosure !== undefined &&
        (currentClosure.kind === "fixed" || currentClosure.kind === "delivered" || currentClosure.kind === "declined")) {
        try { this.#validateClosure(value, currentClosure); }
        catch (cause) { findings.push(`${value.id}: ${message(cause)}`); }
      }
    }
    for (const entry of entries) {
      const seen = new Set<string>(); let cursor: FeedbackDocument | undefined = entry;
      while (cursor?.metadata.duplicateOf !== undefined) {
        if (seen.has(cursor.metadata.id)) { findings.push(`${entry.metadata.id}: duplicate cycle`); break; }
        seen.add(cursor.metadata.id); cursor = ids.get(cursor.metadata.duplicateOf);
      }
    }
    this.#checkMigration(findings);
    return { ok: findings.length === 0, checked: entries.length, findings };
  }

  #checkMigration(findings: string[]): void {
    const receiptPath = join(this.#directory, "migration-receipt.json");
    if (!existsSync(receiptPath)) return;
    try {
      const decoded = Schema.decodeUnknownEither(FrogMigrationReceiptSchema, { errors: "all" })(JSON.parse(readFileSync(receiptPath, "utf8")) as unknown);
      if (Either.isLeft(decoded)) { findings.push(`migration receipt: ${ParseResult.TreeFormatter.formatErrorSync(decoded.left)}`); return; }
      const receipt = decoded.right;
      if (receipt.expectedCount !== receipt.migratedCount || receipt.entries.length !== receipt.migratedCount) findings.push("migration receipt: counts disagree");
      const legacyIds = receipt.entries.map((entry) => entry.legacyId);
      if (new Set(legacyIds).size !== legacyIds.length) findings.push("migration receipt: legacy IDs are not unique");
      for (const entry of receipt.entries) {
        const feedback = this.read(entry.feedbackId);
        if (feedback.metadata.observation !== entry.body ||
          createHash("sha256").update(entry.body).digest("hex") !== entry.bodySha256) {
          findings.push(`${entry.feedbackId}: migrated body digest disagrees with receipt`);
        }
      }
    } catch (cause) { findings.push(`migration receipt: ${message(cause)}`); }
  }

  #verifyEnvelope(envelope: FeedbackEnvelopeV1, artifactRoot: string): void {
    const root = resolve(artifactRoot);
    const maximumArtifactBytes = 20 * 1024 * 1024;
    const maximumTotalBytes = 100 * 1024 * 1024;
    const declared = new Set(envelope.artifacts.map((item) => item.path));
    if (declared.size !== envelope.artifacts.length) {
      throw new FeedbackContentInvalid({ operation: "import artifact", message: "artifact paths must be unique" });
    }
    if (envelope.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0) > maximumTotalBytes) {
      throw new FeedbackContentInvalid({ operation: "import artifact", message: "artifact bundle exceeds size limit" });
    }
    for (const artifact of envelope.artifacts) {
      if (artifact.byteLength > maximumArtifactBytes) {
        throw new FeedbackContentInvalid({ operation: "import artifact", path: artifact.path, message: "artifact exceeds size limit" });
      }
      const path = resolve(root, artifact.path);
      if (!path.startsWith(`${root}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
        throw new FeedbackContentInvalid({ operation: "import artifact", path: artifact.path, message: "unsafe or missing regular file" });
      }
      const bytes = readFileSync(path);
      if (bytes.byteLength !== artifact.byteLength || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
        throw new FeedbackContentInvalid({ operation: "import artifact", path: artifact.path, message: "size or digest mismatch" });
      }
    }
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new FeedbackContentInvalid({ operation: "import artifact", message: "symlinks are forbidden" });
      if (entry.isFile()) {
        const path = relative(root, join(entry.parentPath, entry.name));
        if (!declared.has(path)) throw new FeedbackContentInvalid({ operation: "import artifact", path, message: "undeclared file" });
      }
    }
  }

  #validateClosure(feedback: FeedbackV1, closure: FeedbackClosure): void {
    if (closure.kind !== "fixed" && closure.kind !== "delivered" && closure.kind !== "declined") return;
    const memoryPath = join(this.#root, "memory", `${closure.memory}.md`);
    if (!existsSync(memoryPath)) throw new FeedbackReferenceConflict({
      operation: "close", path: relative(this.#root, memoryPath), message: "closure Memory is missing",
    });
    const memory = decodeMemoryDocument(relative(this.#root, memoryPath), closure.memory, readFileSync(memoryPath, "utf8"));
    if ("legacy" in memory) throw new FeedbackReferenceConflict({ operation: "close", message: "closure must cite structured Memory" });
    const kind = memory.metadata.kind;
    if (closure.kind === "fixed") {
      if (kind.type !== "problem" || kind.state !== "resolved" || kind.resolution?.kind !== "fixed") {
        throw new FeedbackReferenceConflict({ operation: "close", message: "fixed closure must cite a fixed, resolved Problem Memory" });
      }
      if (feedback.adoptedContract !== undefined &&
        !kind.resolution.proof.some((proof) => /e2e|regression/iu.test(proof))) {
        throw new FeedbackReferenceConflict({ operation: "close", message: "adopted product defect requires E2E regression proof" });
      }
    }
    if (closure.kind === "delivered" && !(
      (kind.type === "problem" && kind.state === "resolved") ||
      (kind.type === "decision" && kind.state === "adopted")
    )) throw new FeedbackReferenceConflict({ operation: "close", message: "delivered closure must cite a resolved Problem or adopted Decision Memory" });
    if (closure.kind === "declined" && !(kind.type === "decision" && kind.state === "adopted")) {
      throw new FeedbackReferenceConflict({ operation: "close", message: "declined closure must cite an adopted Decision Memory" });
    }
  }

  #anchorExists(path: string, anchor: string): boolean {
    const target = resolve(this.#root, path);
    if (!target.startsWith(`${this.#root}${sep}`) || !existsSync(target) || !statSync(target).isFile()) return false;
    const normalized = anchor.replace(/^#/, "");
    return readFileSync(target, "utf8").split(/\r?\n/u).some((line) =>
      line.startsWith("#") && line.replace(/^#+\s*/u, "").trim().toLocaleLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, "").replace(/\s+/gu, "-") === normalized);
  }

  #withLock(id: string, use: () => void): void {
    const lock = join(this.#directory, ".locks", id);
    mkdirSync(dirname(lock), { recursive: true });
    try { mkdirSync(lock); } catch (cause) { throw new FeedbackLockConflict({ operation: "lock", path: relative(this.#root, lock), message: message(cause) }); }
    try { use(); } finally { rmSync(lock, { recursive: true, force: true }); }
  }

  #writeDurable(path: string, source: string | Uint8Array): void {
    const descriptor = openSync(path, "wx");
    try { writeFileSync(descriptor, source); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }

  #replace(path: string, source: string): void {
    const temporary = `${path}.${process.pid}.tmp`;
    try { this.#writeDurable(temporary, source); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
  }
}

export const feedbackEffect = <A>(operation: string, thunk: () => A): Effect.Effect<A, FeedbackError> =>
  Effect.try({
    try: thunk,
    catch: (cause) => cause instanceof FeedbackFileMissing || cause instanceof FeedbackContentInvalid ||
      cause instanceof FeedbackReferenceConflict || cause instanceof FeedbackLockConflict || cause instanceof FeedbackIoError
      ? cause : new FeedbackIoError({ operation, message: message(cause) }),
  });
