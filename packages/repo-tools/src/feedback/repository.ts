import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { Effect, Result, Schema } from "effect";
import { parse } from "yaml";

import { parseRepoRef, validateRepoRefTarget, type RepoRef, type ValidatedRepoRefTarget } from "../docs/trace/ref.js";
import { traceDigest } from "../docs/trace/relation-mutation.js";
import type { DocsNodeKind, TraceSnapshot } from "../docs/trace/model.js";
import { decodeMemoryDocument } from "../memory/codec.js";
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
  FeedbackV1MigrationSourceSchema,
  FeedbackV2Schema,
  FeedbackV2MigrationReceiptSchema,
  FrogMigrationReceiptSchema,
  type FeedbackClosure,
  type FeedbackEnvelopeV1,
  type FeedbackMemoryRelation,
  type FeedbackV1MigrationSource,
  type FeedbackV2,
} from "./schema.js";
import { adoptFeedback, closeFeedback, linkMemory, reopenFeedback, retireFeedback } from "./state.js";

export interface FeedbackRepositoryOptions { readonly root?: string }
export interface FeedbackCheckReceipt { readonly ok: boolean; readonly checked: number; readonly findings: readonly string[] }
export interface ArtifactCopy { readonly relativePath: string; readonly sourcePath: string }
export interface StagedFeedback { readonly stage: string; readonly target: string }

const ADOPTION_KINDS = ["roadmap", "feature", "use-case", "engineering"] as const satisfies readonly DocsNodeKind[];
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const digestText = (value: string): string => traceDigest(value);

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalValue(item)]));
}

function metadataDigest(value: unknown): string {
  return digestText(JSON.stringify(canonicalValue(value)));
}

function migrateFeedbackV1(value: FeedbackV1MigrationSource): FeedbackV2 {
  const { adoptedContract, duplicateOf, ...preserved } = value;
  if (duplicateOf !== undefined && preserved.closure !== undefined && !(
    preserved.closure.kind === "duplicate" && preserved.closure.canonical === duplicateOf
  )) throw new Error(`${value.id}: duplicateOf conflicts with the existing closure`);
  const candidate: unknown = {
    ...preserved,
    format: "niceeval.feedback/v2",
    ...(duplicateOf === undefined ? {} : {
      state: "closed",
      closure: { kind: "duplicate", canonical: duplicateOf },
    }),
    adoptions: {
      current: adoptedContract === undefined ? [] : [`${adoptedContract.path}#${adoptedContract.anchor}`],
      history: [],
    },
  };
  const decoded = Schema.decodeUnknownResult(FeedbackV2Schema, {
    errors: "all",
    onExcessProperty: "error",
  })(candidate);
  if (Result.isFailure(decoded)) throw new Error(
    `${value.id}: historical v1 cannot be migrated: ${String(decoded.failure)}`,
  );
  return decoded.success;
}

export class FeedbackRepository {
  readonly #root: string;
  readonly #directory: string;

  constructor(options: FeedbackRepositoryOptions = {}) {
    this.#root = resolve(options.root ?? process.cwd());
    this.#directory = join(this.#root, "feedback");
  }

  get root(): string { return this.#root; }
  ownerPath(id: string): string { this.#guardId(id); return `feedback/${id}/README.md`; }
  absoluteOwnerPath(id: string): string { return join(this.#root, this.ownerPath(id)); }

  #guardId(id: string): void {
    if (id.trim() === "" || id.startsWith(".") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
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
    const path = this.absoluteOwnerPath(id);
    if (!existsSync(path)) throw new FeedbackFileMissing({ operation: "read", path: relative(this.#root, path), message: "not found" });
    try { return decodeFeedbackDocument(relative(this.#root, path), readFileSync(path, "utf8")); }
    catch (cause) {
      if (cause instanceof FeedbackContentInvalid) throw cause;
      throw new FeedbackIoError({ operation: "read", path: relative(this.#root, path), message: message(cause) });
    }
  }

  planCreate(document: FeedbackDocument): { readonly bytes: string; readonly metadata: FeedbackV2 } {
    this.#guardId(document.metadata.id);
    if (document.metadata.adoptions.current.length > 0 || document.metadata.adoptions.history.length > 0) {
      throw new FeedbackReferenceConflict({ operation: "add", message: "feedback add requires empty adoption current/history" });
    }
    if (document.metadata.state !== "open" || document.metadata.closure !== undefined) {
      throw new FeedbackReferenceConflict({ operation: "add", message: "new Feedback must start open without a closure" });
    }
    const relationKeys = document.metadata.memoryRelations.map((relation) => `${relation.kind}\0${relation.memory}`);
    if (new Set(relationKeys).size !== relationKeys.length) {
      throw new FeedbackReferenceConflict({ operation: "add", message: "Memory relations must be unique" });
    }
    for (const relation of document.metadata.memoryRelations) this.#readRelatedMemory(relation.memory, "add");
    if (existsSync(this.absoluteOwnerPath(document.metadata.id))) {
      throw new FeedbackReferenceConflict({ operation: "add", path: this.ownerPath(document.metadata.id), message: "feedback already exists" });
    }
    return { bytes: encodeFeedbackDocument(document), metadata: document.metadata };
  }

  planTransition(
    id: string,
    source: string | undefined,
    transition: (value: FeedbackV2) => Result.Result<FeedbackV2, FeedbackReferenceConflict>,
  ): { readonly bytes: string; readonly metadata: FeedbackV2 } {
    if (source === undefined) throw new FeedbackFileMissing({ operation: "mutate", path: this.ownerPath(id), message: "not found" });
    const document = decodeFeedbackDocument(this.ownerPath(id), source);
    if (document.metadata.id !== id) throw new FeedbackContentInvalid({ operation: "mutate", path: this.ownerPath(id), message: "directory and metadata IDs disagree" });
    const result = transition(document.metadata);
    if (Result.isFailure(result)) throw result.failure;
    return { bytes: encodeFeedbackDocument({ ...document, metadata: result.success }), metadata: result.success };
  }

  planLink(id: string, source: string | undefined, relation: FeedbackMemoryRelation) {
    this.#readRelatedMemory(relation.memory, "link");
    return this.planTransition(id, source, (value) => linkMemory(value, relation));
  }

  #readRelatedMemory(id: string, operation: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id) || id === "INDEX") {
      throw new FeedbackReferenceConflict({ operation, message: `unsafe Memory id ${JSON.stringify(id)}` });
    }
    const path = join(this.#root, "memory", `${id}.md`);
    if (!existsSync(path)) {
      throw new FeedbackReferenceConflict({ operation, path: relative(this.#root, path), message: "Memory is missing" });
    }
    decodeMemoryDocument(relative(this.#root, path), id, readFileSync(path, "utf8"));
  }

  planAdopt(id: string, source: string | undefined, target: RepoRef) {
    return this.planTransition(id, source, (value) => adoptFeedback(value, target));
  }

  planRetire(id: string, source: string | undefined, target: RepoRef, commit: string) {
    return this.planTransition(id, source, (value) => retireFeedback(value, target, commit));
  }

  planClose(id: string, source: string | undefined, closure: FeedbackClosure, regressionOwners: readonly string[] = []) {
    return this.planTransition(id, source, (value) => {
      const changed = closeFeedback(value, closure);
      if (Result.isFailure(changed)) return changed;
      this.validateClosure(changed.success, closure, regressionOwners);
      return changed;
    });
  }

  planReopen(id: string, source: string | undefined) {
    return this.planTransition(id, source, reopenFeedback);
  }

  targetSource(target: unknown): { readonly path: string; readonly absolutePath: string; readonly source: string } {
    const parsed = parseRepoRef(target);
    if (Result.isFailure(parsed)) throw new FeedbackReferenceConflict({ operation: "target", message: String(parsed.failure) });
    const absolutePath = resolve(this.#root, parsed.success.path);
    if (!absolutePath.startsWith(`${this.#root}${sep}`) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new FeedbackReferenceConflict({ operation: "target", path: parsed.success.path, message: "target file is missing or unsafe" });
    }
    return { path: parsed.success.path, absolutePath, source: readFileSync(absolutePath, "utf8") };
  }

  validateTarget(snapshot: TraceSnapshot, target: unknown): ValidatedRepoRefTarget {
    const source = this.targetSource(target);
    const validated = validateRepoRefTarget(snapshot, target, ADOPTION_KINDS, source.source);
    if (Result.isFailure(validated)) throw new FeedbackReferenceConflict({ operation: "target", path: source.path, message: String(validated.failure) });
    return validated.success;
  }

  prepareImport(input: unknown, artifactRoot: string, reportedAt: string): {
    readonly document: FeedbackDocument;
    readonly artifacts: readonly ArtifactCopy[];
    readonly existing?: FeedbackV2;
  } {
    const decoded = Schema.decodeUnknownResult(FeedbackEnvelopeV1Schema, { errors: "all" })(input);
    if (Result.isFailure(decoded)) throw new FeedbackContentInvalid({ operation: "import", message: String(decoded.failure) });
    const envelope = decoded.success;
    this.#verifyEnvelope(envelope, artifactRoot);
    const existing = this.list().find((item) => item.metadata.source.kind === "dogfood" &&
      item.metadata.source.repository === envelope.origin.repository &&
      item.metadata.source.originId === envelope.origin.originId);
    if (existing !== undefined) {
      const priorDigest = /^Envelope digest:\s*`([^`]+)`$/mu.exec(existing.body)?.[1];
      if (priorDigest === envelope.digest) return { document: existing, artifacts: [], existing: existing.metadata };
      throw new FeedbackReferenceConflict({ operation: "import", message: "origin id already exists with a different digest" });
    }
    const id = `feedback-${createHash("sha256").update(`${envelope.origin.repository}\0${envelope.origin.originId}`).digest("hex").slice(0, 16)}`;
    const metadata: FeedbackV2 = {
      format: "niceeval.feedback/v2",
      id,
      title: envelope.observation.split("\n", 1)[0] || id,
      state: "open",
      reportedAt,
      source: { kind: "dogfood", ...envelope.origin },
      subject: "product",
      claim: "friction",
      observation: envelope.observation,
      impact: envelope.impact,
      adoptions: { current: [], history: [] },
      memoryRelations: [],
    };
    return {
      document: { metadata, body: `# ${metadata.title}\n\nEnvelope digest: \`${envelope.digest}\`\n` },
      artifacts: envelope.artifacts.map((artifact) => ({ relativePath: artifact.path, sourcePath: resolve(artifactRoot, artifact.path) })),
    };
  }

  stage(document: FeedbackDocument, artifacts: readonly ArtifactCopy[]): StagedFeedback {
    mkdirSync(this.#directory, { recursive: true });
    this.#fsyncDirectory(this.#root);
    const stage = join(this.#directory, `.stage-${randomUUID()}`);
    mkdirSync(stage, { mode: 0o755 });
    this.#fsyncDirectory(this.#directory);
    const target = dirname(this.absoluteOwnerPath(document.metadata.id));
    try {
      this.#writeDurable(join(stage, "README.md"), encodeFeedbackDocument(document));
      for (const artifact of artifacts) {
        const destination = join(stage, "artifacts", artifact.relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        this.#writeDurable(destination, readFileSync(artifact.sourcePath));
      }
      this.#normalizeStageModes(stage);
      this.#fsyncTree(stage);
      this.#fsyncDirectory(this.#directory);
      return { stage: relative(this.#root, stage).split(sep).join("/"), target: relative(this.#root, target).split(sep).join("/") };
    } catch (cause) {
      rmSync(stage, { recursive: true, force: true });
      this.#fsyncDirectory(this.#directory);
      throw new FeedbackIoError({ operation: "stage", path: relative(this.#root, stage), message: message(cause) });
    }
  }

  cleanupStage(staged: StagedFeedback): void {
    if (!/^feedback\/\.stage-[0-9a-f-]{36}$/u.test(staged.stage)) throw new Error("unsafe Feedback stage path");
    rmSync(resolve(this.#root, staged.stage), { recursive: true, force: true });
    this.#fsyncDirectory(this.#directory);
  }

  #writeDurable(path: string, bytes: string | Uint8Array): void {
    const descriptor = openSync(path, "wx", 0o644);
    try { fchmodSync(descriptor, 0o644); writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }

  #normalizeStageModes(directory: string): void {
    chmodSync(directory, 0o755);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Feedback stage symlink is forbidden");
      if (entry.isDirectory()) this.#normalizeStageModes(path);
      else if (entry.isFile()) chmodSync(path, 0o644);
      else throw new Error("Feedback stage special file is forbidden");
    }
  }

  #fsyncTree(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) this.#fsyncTree(path);
      else if (entry.isFile()) {
        const descriptor = openSync(path, "r");
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      }
    }
    this.#fsyncDirectory(directory);
  }

  #fsyncDirectory(path: string): void {
    const descriptor = openSync(path, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }

  check(snapshot: TraceSnapshot): FeedbackCheckReceipt {
    const findings: string[] = [];
    if (existsSync(this.#directory)) {
      for (const entry of readdirSync(this.#directory, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(".stage-")) findings.push(`${entry.name}: unpublished Feedback stage requires recovery or manual review`);
      }
    }
    const entries: FeedbackDocument[] = [];
    try { entries.push(...this.list()); } catch (cause) { findings.push(message(cause)); }
    const ids = new Map(entries.map((entry) => [entry.metadata.id, entry]));
    for (const entry of entries) {
      const value = entry.metadata;
      if ((value.state === "closed") !== (value.closure !== undefined)) findings.push(`${value.id}: state and closure disagree`);
      const relationKeys = value.memoryRelations.map((item) => `${item.kind}\0${item.memory}`);
      if (new Set(relationKeys).size !== relationKeys.length) findings.push(`${value.id}: duplicate Memory relation`);
      for (const target of value.adoptions.current) {
        try { this.validateTarget(snapshot, target); } catch (cause) { findings.push(`${value.id}: ${message(cause)}`); }
      }
      for (const relation of value.memoryRelations) {
        if (!existsSync(join(this.#root, "memory", `${relation.memory}.md`))) findings.push(`${value.id}: Memory ${relation.memory} is missing`);
      }
      if (value.closure !== undefined) {
        const closure = value.closure;
        if (closure.kind === "fixed" && (value.subject === "dependency" ||
          (value.claim !== "defect" && value.claim !== "friction"))) {
          findings.push(`${value.id}: fixed closure requires a product/repository defect or friction`);
        }
        if (closure.kind === "delivered" && value.claim !== "request") findings.push(`${value.id}: delivered closure requires request Feedback`);
        if (closure.kind === "external-fixed" && value.subject !== "dependency") findings.push(`${value.id}: external-fixed closure requires dependency Feedback`);
        if (closure.kind === "declined" && value.claim !== "request" && value.claim !== "friction") findings.push(`${value.id}: declined closure requires request or friction Feedback`);
        if (closure.kind === "duplicate" && closure.canonical === value.id) findings.push(`${value.id}: duplicate closure cannot name itself`);
        if ((closure.kind === "declined" || closure.kind === "invalid" || closure.kind === "duplicate") &&
          value.adoptions.current.length > 0) findings.push(`${value.id}: ${value.closure.kind} closure requires empty current adoptions`);
        if (closure.kind === "delivered" && !value.adoptions.current.includes(closure.target) &&
          !value.adoptions.history.some((item) => item.target === closure.target)) {
          findings.push(`${value.id}: delivered closure target is absent from adoption current/history`);
        }
        const regressionOwners = closure.kind === "fixed"
          ? snapshot.tests.filter((test) => test.regressions.some((reference) =>
            reference.split("#", 1)[0] === `memory/${closure.memory}.md`)).map((test) => test.path)
          : [];
        try { this.validateClosure(value, closure, regressionOwners); } catch (cause) { findings.push(`${value.id}: ${message(cause)}`); }
      }
    }
    for (const entry of entries) {
      const seen = new Set<string>(); let cursor: FeedbackDocument | undefined = entry;
      while (cursor?.metadata.closure?.kind === "duplicate") {
        if (seen.has(cursor.metadata.id)) { findings.push(`${entry.metadata.id}: duplicate cycle`); break; }
        seen.add(cursor.metadata.id);
        cursor = ids.get(cursor.metadata.closure.canonical);
        if (cursor === undefined) { findings.push(`${entry.metadata.id}: duplicate canonical is missing`); break; }
      }
    }
    this.#checkFrogMigration(findings);
    this.#checkV2Migration(entries, findings);
    return { ok: findings.length === 0, checked: entries.length, findings };
  }

  validateClosure(feedback: FeedbackV2, closure: FeedbackClosure, regressionOwners: readonly string[] = []): void {
    if (closure.kind === "duplicate") {
      if (!existsSync(this.absoluteOwnerPath(closure.canonical))) throw new FeedbackReferenceConflict({ operation: "close", message: "duplicate canonical Feedback is missing" });
      const seen = new Set([feedback.id]);
      let cursor: FeedbackDocument | undefined = this.read(closure.canonical);
      while (cursor.metadata.closure?.kind === "duplicate") {
        if (seen.has(cursor.metadata.id)) throw new FeedbackReferenceConflict({ operation: "close", message: "duplicate closure would form a cycle" });
        seen.add(cursor.metadata.id);
        cursor = this.read(cursor.metadata.closure.canonical);
      }
      if (seen.has(cursor.metadata.id)) throw new FeedbackReferenceConflict({ operation: "close", message: "duplicate closure would form a cycle" });
      return;
    }
    if (closure.kind !== "fixed" && closure.kind !== "delivered" && closure.kind !== "declined") return;
    const memoryPath = join(this.#root, "memory", `${closure.memory}.md`);
    if (!existsSync(memoryPath)) throw new FeedbackReferenceConflict({ operation: "close", path: relative(this.#root, memoryPath), message: "closure Memory is missing" });
    const memory = decodeMemoryDocument(relative(this.#root, memoryPath), closure.memory, readFileSync(memoryPath, "utf8"));
    if ("legacy" in memory) throw new FeedbackReferenceConflict({ operation: "close", message: "closure must cite structured Memory" });
    const kind = memory.metadata.kind;
    if (closure.kind === "fixed") {
      if (kind.type !== "problem" || kind.state !== "resolved" || kind.resolution?.kind !== "fixed") {
        throw new FeedbackReferenceConflict({ operation: "close", message: "fixed closure must cite a fixed, resolved Problem Memory" });
      }
      if (regressionOwners.length === 0) throw new FeedbackReferenceConflict({
        operation: "close",
        message: "fixed closure requires a canonical E2E `regression: memory/...` owner",
      });
    }
    if (closure.kind === "delivered" && !(
      (kind.type === "problem" && kind.state === "resolved") ||
      (kind.type === "decision" && kind.state === "adopted")
    )) throw new FeedbackReferenceConflict({ operation: "close", message: "delivered closure must cite a resolved Problem or adopted Decision Memory" });
    if (closure.kind === "declined" && !(kind.type === "decision" && kind.state === "adopted")) {
      throw new FeedbackReferenceConflict({ operation: "close", message: "declined closure must cite an adopted Decision Memory" });
    }
  }

  #checkV2Migration(entries: readonly FeedbackDocument[], findings: string[]): void {
    const path = join(this.#directory, "schema-v2-migration-receipt.json");
    if (!existsSync(path)) { findings.push("schema v2 migration receipt is missing"); return; }
    try {
      const decoded = Schema.decodeUnknownResult(FeedbackV2MigrationReceiptSchema, { errors: "all", onExcessProperty: "error" })(JSON.parse(readFileSync(path, "utf8")) as unknown);
      if (Result.isFailure(decoded)) { findings.push(`schema v2 migration receipt: ${String(decoded.failure)}`); return; }
      const receipt = decoded.success;
      execFileSync("git", ["merge-base", "--is-ancestor", receipt.sourceCommit, "HEAD"], {
        cwd: this.#root,
        stdio: ["ignore", "ignore", "pipe"],
      });
      execFileSync("git", ["merge-base", "--is-ancestor", receipt.sourceCommit, receipt.resultCommit], {
        cwd: this.#root,
        stdio: ["ignore", "ignore", "pipe"],
      });
      execFileSync("git", ["merge-base", "--is-ancestor", receipt.resultCommit, "HEAD"], {
        cwd: this.#root,
        stdio: ["ignore", "ignore", "pipe"],
      });
      const trackedPaths = execFileSync(
        "git",
        ["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", receipt.sourceCommit, "feedback"],
        { cwd: this.#root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 },
      ).split(/\r?\n/u).filter((item) => item.length > 0);
      const sourceOwners = trackedPaths.filter((item) => /^feedback\/[^/]+\/README\.md$/u.test(item));
      const resultPaths = execFileSync(
        "git",
        ["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", receipt.resultCommit, "feedback"],
        { cwd: this.#root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 },
      ).split(/\r?\n/u).filter((item) => item.length > 0);
      const historical = new Map<string, {
        readonly metadata: FeedbackV1MigrationSource;
        readonly body: string;
        readonly artifacts: readonly { readonly path: string; readonly byteLength: number; readonly digest: string }[];
      }>();
      for (const owner of sourceOwners) {
        const source = execFileSync("git", ["show", `${receipt.sourceCommit}:${owner}`], {
          cwd: this.#root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 128 * 1024 * 1024,
        });
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
        if (frontmatter?.[1] === undefined || frontmatter[2] === undefined) throw new Error(`${owner}: historical v1 frontmatter is missing`);
        const sourceDecoded = Schema.decodeUnknownResult(FeedbackV1MigrationSourceSchema, {
          errors: "all",
          onExcessProperty: "error",
        })(parse(frontmatter[1]) as unknown);
        if (Result.isFailure(sourceDecoded)) throw new Error(
          `${owner}: historical v1 is invalid: ${String(sourceDecoded.failure)}`,
        );
        const id = owner.slice("feedback/".length, -"/README.md".length);
        if (sourceDecoded.success.id !== id) throw new Error(`${owner}: historical directory and metadata IDs disagree`);
        const artifactPrefix = `feedback/${id}/artifacts/`;
        const artifacts = trackedPaths.filter((item) => item.startsWith(artifactPrefix)).map((artifactPath) => {
          const bytes = execFileSync("git", ["show", `${receipt.sourceCommit}:${artifactPath}`], {
            cwd: this.#root,
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 128 * 1024 * 1024,
          });
          return {
            path: artifactPath.slice(`feedback/${id}/`.length),
            byteLength: bytes.byteLength,
            digest: traceDigest(bytes),
          };
        }).sort((left, right) => left.path.localeCompare(right.path));
        historical.set(id, { metadata: sourceDecoded.success, body: frontmatter[2], artifacts });
      }
      if (receipt.before.v1 !== historical.size || receipt.before.v2 !== 0 ||
        receipt.after.v1 !== 0 || receipt.after.v2 !== historical.size) {
        findings.push(`schema v2 migration receipt: source commit contains ${historical.size} v1 owners but totals are ${receipt.before.v1}/${receipt.before.v2} → ${receipt.after.v1}/${receipt.after.v2}`);
      }
      if (receipt.entries.length !== historical.size) findings.push("schema v2 migration receipt: entry count disagrees with the historical source set");
      const receiptIds = receipt.entries.map((entry) => entry.id);
      if (new Set(receiptIds).size !== receiptIds.length) findings.push("schema v2 migration receipt: IDs are not unique");
      for (const id of historical.keys()) if (!receiptIds.includes(id)) findings.push(`${id}: historical v1 is absent from the schema migration receipt`);
      for (const id of receiptIds) if (!historical.has(id)) findings.push(`${id}: schema migration receipt has no v1 owner at sourceCommit`);
      const byId = new Map(entries.map((entry) => [entry.metadata.id, entry]));
      for (const item of receipt.entries) {
        const source = historical.get(item.id);
        if (source === undefined) continue;
        if (metadataDigest(source.metadata) !== item.v1MetadataDigest) findings.push(`${item.id}: v1 metadata digest disagrees with sourceCommit`);
        if (metadataDigest(migrateFeedbackV1(source.metadata)) !== item.v2MetadataDigest) findings.push(`${item.id}: v2 metadata digest disagrees with the deterministic migration`);
        if (digestText(source.body) !== item.bodyDigest) findings.push(`${item.id}: historical body digest disagrees with sourceCommit`);
        if (digestText(source.metadata.observation) !== item.observationDigest) findings.push(`${item.id}: historical observation digest disagrees with sourceCommit`);
        if (digestText(source.metadata.impact) !== item.impactDigest) findings.push(`${item.id}: historical impact digest disagrees with sourceCommit`);
        if (JSON.stringify(source.artifacts) !== JSON.stringify(item.artifacts)) findings.push(`${item.id}: historical artifacts disagree with sourceCommit`);
        const baselinePath = `feedback/${item.id}/README.md`;
        if (!resultPaths.includes(baselinePath)) {
          findings.push(`${item.id}: migrated Feedback is absent from resultCommit`);
        } else {
          const baselineSource = execFileSync("git", ["show", `${receipt.resultCommit}:${baselinePath}`], {
            cwd: this.#root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 128 * 1024 * 1024,
          });
          const baseline = decodeFeedbackDocument(baselinePath, baselineSource);
          if (baseline.metadata.id !== item.id) findings.push(`${item.id}: resultCommit directory and metadata IDs disagree`);
          if (metadataDigest(baseline.metadata) !== item.v2MetadataDigest) findings.push(`${item.id}: resultCommit metadata differs from the deterministic v2 migration`);
          if (digestText(baseline.body) !== item.bodyDigest) findings.push(`${item.id}: resultCommit body differs from the migration receipt`);
          const artifactPrefix = `feedback/${item.id}/artifacts/`;
          const baselineArtifacts = resultPaths.filter((path) => path.startsWith(artifactPrefix)).map((artifactPath) => {
            const bytes = execFileSync("git", ["show", `${receipt.resultCommit}:${artifactPath}`], {
              cwd: this.#root,
              stdio: ["ignore", "pipe", "pipe"],
              maxBuffer: 128 * 1024 * 1024,
            });
            return {
              path: artifactPath.slice(`feedback/${item.id}/`.length),
              byteLength: bytes.byteLength,
              digest: traceDigest(bytes),
            };
          }).sort((left, right) => left.path.localeCompare(right.path));
          if (JSON.stringify(baselineArtifacts) !== JSON.stringify(item.artifacts)) findings.push(`${item.id}: resultCommit artifacts differ from the migration receipt`);
        }
        const current = byId.get(item.id);
        if (current === undefined) {
          findings.push(`${item.id}: migrated Feedback is missing`);
          continue;
        }
        if (digestText(current.body) !== item.bodyDigest) findings.push(`${item.id}: body differs from schema migration receipt`);
        if (digestText(current.metadata.observation) !== item.observationDigest) findings.push(`${item.id}: observation differs from schema migration receipt`);
        if (digestText(current.metadata.impact) !== item.impactDigest) findings.push(`${item.id}: impact differs from schema migration receipt`);
        const artifacts = this.#artifacts(item.id);
        if (JSON.stringify(artifacts) !== JSON.stringify(item.artifacts)) findings.push(`${item.id}: artifacts differ from schema migration receipt`);
      }
    } catch (cause) { findings.push(`schema v2 migration receipt: ${message(cause)}`); }
  }

  #artifacts(id: string): readonly { readonly path: string; readonly byteLength: number; readonly digest: string }[] {
    const directory = join(this.#directory, id, "artifacts");
    if (!existsSync(directory)) return [];
    const values: { path: string; byteLength: number; digest: string }[] = [];
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`${id}: artifact symlink is forbidden`);
      if (entry.isFile()) {
        const absolute = join(entry.parentPath, entry.name);
        const bytes = readFileSync(absolute);
        values.push({ path: `artifacts/${relative(directory, absolute).split(sep).join("/")}`, byteLength: bytes.byteLength, digest: traceDigest(bytes) });
      }
    }
    return values.sort((left, right) => left.path.localeCompare(right.path));
  }

  #checkFrogMigration(findings: string[]): void {
    const receiptPath = join(this.#directory, "migration-receipt.json");
    if (!existsSync(receiptPath)) return;
    try {
      const decoded = Schema.decodeUnknownResult(FrogMigrationReceiptSchema, { errors: "all" })(JSON.parse(readFileSync(receiptPath, "utf8")) as unknown);
      if (Result.isFailure(decoded)) { findings.push(`migration receipt: ${String(decoded.failure)}`); return; }
      const receipt = decoded.success;
      if (receipt.expectedCount !== receipt.migratedCount || receipt.entries.length !== receipt.migratedCount) findings.push("migration receipt: counts disagree");
      const legacyIds = receipt.entries.map((entry) => entry.legacyId);
      if (new Set(legacyIds).size !== legacyIds.length) findings.push("migration receipt: legacy IDs are not unique");
      for (const entry of receipt.entries) {
        const feedback = this.read(entry.feedbackId);
        if (feedback.metadata.observation !== entry.body || createHash("sha256").update(entry.body).digest("hex") !== entry.bodySha256) {
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
    if (declared.size !== envelope.artifacts.length) throw new FeedbackContentInvalid({ operation: "import artifact", message: "artifact paths must be unique" });
    if (envelope.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0) > maximumTotalBytes) throw new FeedbackContentInvalid({ operation: "import artifact", message: "artifact bundle exceeds size limit" });
    for (const artifact of envelope.artifacts) {
      if (artifact.byteLength > maximumArtifactBytes) throw new FeedbackContentInvalid({ operation: "import artifact", path: artifact.path, message: "artifact exceeds size limit" });
      const path = resolve(root, artifact.path);
      if (!path.startsWith(`${root}${sep}`) || !existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        throw new FeedbackContentInvalid({ operation: "import artifact", path: artifact.path, message: "unsafe or missing regular file" });
      }
      const bytes = readFileSync(path);
      if (bytes.byteLength !== artifact.byteLength || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
        throw new FeedbackContentInvalid({ operation: "import artifact", path: artifact.path, message: "size or digest mismatch" });
      }
    }
    if (existsSync(root)) for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new FeedbackContentInvalid({ operation: "import artifact", message: "symlinks are forbidden" });
      if (entry.isFile()) {
        const path = relative(root, join(entry.parentPath, entry.name));
        if (!declared.has(path)) throw new FeedbackContentInvalid({ operation: "import artifact", path, message: "undeclared file" });
      }
    }
  }
}

export const feedbackEffect = <A>(operation: string, thunk: () => A): Effect.Effect<A, FeedbackError> =>
  Effect.try({
    try: thunk,
    catch: (cause) => cause instanceof FeedbackFileMissing || cause instanceof FeedbackContentInvalid ||
      cause instanceof FeedbackReferenceConflict || cause instanceof FeedbackLockConflict || cause instanceof FeedbackIoError
      ? cause : new FeedbackIoError({ operation, message: message(cause) }),
  });
