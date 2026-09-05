import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { createHash } from "node:crypto";

import { Effect, Result, Schema } from "effect";

import { parseRepoRef, validateRepoRefTarget, type RepoRef, type ValidatedRepoRefTarget } from "../docs/trace/ref.js";
import { ADOPTABLE_DOCS_NODE_KINDS, type TraceSnapshot } from "../docs/trace/model.js";
import { traceDigest } from "../docs/trace/relation-mutation.js";
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

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
export interface MemoryCheckReceipt {
  readonly ok: boolean;
  readonly checked: number;
  readonly legacy: number;
  readonly legacyFixedMigrationDebt: readonly string[];
  readonly findings: readonly string[];
}
export interface MemoryAuthorSnapshot {
  readonly document: MemoryDocument;
  readonly ownerPreimageDigest: string;
  readonly authorRegionDigest: string;
}

export interface FixedEvidenceValidation {
  readonly selectors: readonly string[];
  readonly preimagePaths: readonly string[];
}

const EvidenceFileSchema = Schema.Struct({ path: Schema.String, digest: Schema.String });
const EvidenceIndexSchema = Schema.Struct({
  format: Schema.Literal("niceeval.e2e-case-evidence-index/v1"),
  current: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Struct({
    red: EvidenceFileSchema,
    green: EvidenceFileSchema,
    certificate: EvidenceFileSchema,
    inventory: EvidenceFileSchema,
  }))),
});
const FormalReceiptSchema = Schema.Struct({
  format: Schema.Literal("niceeval.e2e-case-receipt/v1"),
  mode: Schema.Literal("formal"),
  observation: Schema.Literals(["red", "green", "reliability"]),
  selector: Schema.String,
  caseId: Schema.String,
  inventoryDigest: Schema.String,
  candidate: Schema.Struct({ sha256: Schema.String }),
  source: Schema.Struct({ testFileSha256: Schema.String, sidecarSha256: Schema.String }),
  result: Schema.Struct({ disposition: Schema.Literals(["regression", "pass"]) }),
  cleanup: Schema.Struct({ ok: Schema.Boolean }),
  invocationId: Schema.String,
  receiptSha256: Schema.String,
});
const InventorySchema = Schema.Struct({
  digest: Schema.String,
  findings: Schema.Array(Schema.Unknown),
  bodyExecutions: Schema.Number,
  forbiddenSetupExecutions: Schema.Number,
  cases: Schema.Array(Schema.Struct({ path: Schema.String, caseId: Schema.String })),
});
const CertificateSchema = Schema.Struct({
  format: Schema.Literal("niceeval.e2e-takeover-certificate/v1"),
  selector: Schema.String,
  caseId: Schema.String,
  candidateSha256: Schema.String,
  greenReceipt: Schema.String,
  observations: Schema.Struct({
    isolatedCopies: Schema.Array(Schema.String),
    sameCopy: Schema.Array(Schema.String),
    defaultParallel: Schema.String,
    singleCase: Schema.String,
    cleanup: Schema.Array(Schema.String),
  }),
  certificateSha256: Schema.String,
});

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const canonicalDigest = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const canonicalSignatureDigest = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
const sourceDigest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

const RESOLUTION_HISTORY_MARKER = "<!-- niceeval.memory-resolution-history/v1 -->";
const FIXED_EVIDENCE_CREDENTIAL = "niceeval.fixed-evidence/v1:";

function authorRegion(body: string): { readonly author: string; readonly managed: string } {
  const marker = body.indexOf(RESOLUTION_HISTORY_MARKER);
  if (marker < 0) return { author: body, managed: "" };
  return { author: body.slice(0, marker), managed: body.slice(marker) };
}

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

  readAuthorSnapshot(id: string): MemoryAuthorSnapshot {
    this.#guardId(id);
    const path = this.absoluteOwnerPath(id);
    if (!existsSync(path)) throw new MemoryFileMissing({ operation: "read", path: this.ownerPath(id), message: "not found" });
    try {
      const source = readFileSync(path, "utf8");
      const document = decodeMemoryDocument(this.ownerPath(id), id, source);
      return {
        document,
        ownerPreimageDigest: traceDigest(source),
        authorRegionDigest: traceDigest(authorRegion(document.body).author),
      };
    } catch (cause) {
      if (cause instanceof MemoryContentInvalid) throw cause;
      throw new MemoryIoError({ operation: "read", path: this.ownerPath(id), message: message(cause) });
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

  planAuthorSet(
    id: string,
    source: string | undefined,
    body: string,
    expectedOwnerDigest: string,
    expectedAuthorDigest: string,
  ): { readonly bytes: string; readonly metadata: MemoryV1 } {
    if (source === undefined) throw new MemoryFileMissing({ operation: "author set", path: this.ownerPath(id), message: "not found" });
    if (traceDigest(source) !== expectedOwnerDigest) throw new MemoryReferenceConflict({
      operation: "author set", path: this.ownerPath(id), message: "owner preimage digest changed; read the Memory again before updating it",
    });
    if (body.includes(RESOLUTION_HISTORY_MARKER)) throw new MemoryContentInvalid({
      operation: "author set",
      path: this.ownerPath(id),
      message: "author body must not contain the managed Resolution history marker",
    });
    const document = decodeMemoryDocument(this.ownerPath(id), id, source);
    if ("legacy" in document) throw new LegacyMemoryReadOnly({ operation: "author set", path: this.ownerPath(id), message: "legacy Memory is read-only" });
    if (document.metadata.id !== id) throw new MemoryContentInvalid({
      operation: "author set",
      path: this.ownerPath(id),
      message: "filename and metadata IDs disagree",
    });
    const regions = authorRegion(document.body);
    if (traceDigest(regions.author) !== expectedAuthorDigest) throw new MemoryReferenceConflict({
      operation: "author set", path: this.ownerPath(id), message: "author region digest changed; read the Memory again before updating it",
    });
    return { bytes: encodeMemoryDocument(document.metadata, `${body}${regions.managed}`), metadata: document.metadata };
  }

  planResolve(id: string, source: string | undefined, resolution: ProblemResolution, regressionOwners: readonly string[] = []) {
    if (resolution.kind === "fixed" && regressionOwners.length === 0) throw new MemoryReferenceConflict({
      operation: "resolve",
      path: this.ownerPath(id),
      message: "fixed resolution requires a current E2E case selector with a sidecar regression relation",
    });
    if (resolution.proof.some((proof) => proof.startsWith(FIXED_EVIDENCE_CREDENTIAL))) throw new MemoryReferenceConflict({
      operation: "resolve",
      path: this.ownerPath(id),
      message: "fixed evidence credential is repository-managed and must not be supplied as proof",
    });
    const credentialed = resolution.kind === "fixed"
      ? {
          ...resolution,
          proof: [
            resolution.proof[0],
            ...resolution.proof.slice(1),
            `${FIXED_EVIDENCE_CREDENTIAL}${JSON.stringify({ selectors: [...regressionOwners].sort() })}`,
          ] as const,
        }
      : resolution;
    return this.planTransition(id, source, (value) => resolveProblem(value, credentialed));
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
    const validated = validateRepoRefTarget(snapshot, target, ADOPTABLE_DOCS_NODE_KINDS, source.source);
    if (Result.isFailure(validated)) throw new MemoryReferenceConflict({ operation: "target", path: source.path, message: validated.failure.message });
    const kind = validated.success.kind;
    if (kind !== "roadmap" && kind !== "feature" && kind !== "use-case" && kind !== "engineering") {
      throw new MemoryReferenceConflict({ operation: "target", path: source.path, message: `unsupported promotion kind ${kind}` });
    }
    return { ...validated.success, kind };
  }

  validateFixedEvidence(snapshot: TraceSnapshot, memoryPath: string): FixedEvidenceValidation {
    const related = snapshot.tests.filter((test) => test.regressions.some((reference) => reference.split("#", 1)[0] === memoryPath));
    if (related.length === 0) throw new MemoryReferenceConflict({
      operation: "resolve",
      path: memoryPath,
      message: "fixed resolution requires a current E2E case with regression evidence",
    });
    const preimages = new Set<string>();
    const decode = <A>(path: string, schema: Schema.Codec<A>): A => {
      const source = this.targetSource(path).source;
      preimages.add(path);
      let input: unknown;
      try { input = JSON.parse(source) as unknown; }
      catch (cause) { throw new MemoryReferenceConflict({ operation: "resolve", path, message: `invalid evidence JSON: ${message(cause)}` }); }
      const decoded = Schema.decodeUnknownResult(schema)(input);
      if (Result.isFailure(decoded)) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "invalid or incomplete fixed evidence" });
      return decoded.success;
    };
    const verifySigned = (path: string, field: "receiptSha256" | "certificateSha256"): unknown => {
      const source = this.targetSource(path).source;
      preimages.add(path);
      const document = JSON.parse(source) as Record<string, unknown>;
      const declared = document[field];
      const unsigned = { ...document };
      delete unsigned[field];
      if (declared !== canonicalSignatureDigest(unsigned)) throw new MemoryReferenceConflict({
        operation: "resolve", path, message: `${field} does not match the evidence contents`,
      });
      return document;
    };
    const decodeSigned = <A>(
      path: string,
      schema: Schema.Codec<A>,
      field: "receiptSha256" | "certificateSha256",
    ): A => {
      const decoded = Schema.decodeUnknownResult(schema)(verifySigned(path, field));
      if (Result.isFailure(decoded)) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "invalid or incomplete signed evidence" });
      return decoded.success;
    };
    const verifySignedInventory = (path: string) => {
      const source = this.targetSource(path).source;
      preimages.add(path);
      const input = JSON.parse(source) as Record<string, unknown>;
      const declared = input.digest;
      const unsigned = { ...input };
      delete unsigned.digest;
      if (declared !== canonicalDigest(unsigned)) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "inventory digest does not match its contents" });
      const decoded = Schema.decodeUnknownResult(InventorySchema)(input);
      if (Result.isFailure(decoded)) throw new MemoryReferenceConflict({ operation: "resolve", path, message: "invalid inventory evidence" });
      return decoded.success;
    };
    for (const test of related) {
      const sidecarPath = `${test.path}.cases.json`;
      const indexPath = `${test.path}.cases.evidence.json`;
      this.targetSource(sidecarPath);
      const testFile = this.targetSource(test.path);
      preimages.add(sidecarPath);
      preimages.add(test.path);
      const index = decode(indexPath, EvidenceIndexSchema);
      const entry = index.current[test.caseId]?.[memoryPath];
      if (entry === undefined) throw new MemoryReferenceConflict({
        operation: "resolve", path: indexPath, message: `no current evidence for ${test.selector} and ${memoryPath}`,
      });
      const inventoryInput = verifySignedInventory(entry.inventory.path);
      preimages.add(entry.inventory.path);
      if (inventoryInput.digest !== entry.inventory.digest || inventoryInput.findings.length !== 0 ||
        inventoryInput.bodyExecutions !== 0 || inventoryInput.forbiddenSetupExecutions !== 0 ||
        !inventoryInput.cases.some((item) => `${item.path}#${item.caseId}` === test.selector)) {
        throw new MemoryReferenceConflict({ operation: "resolve", path: entry.inventory.path, message: "inventory does not safely collect the live case selector" });
      }
      const receipt = (path: string, expectedDigest?: string) => {
        const raw = this.targetSource(path).source;
        if (expectedDigest !== undefined && traceDigest(raw) !== expectedDigest) throw new MemoryReferenceConflict({
          operation: "resolve", path, message: "evidence index digest does not match receipt bytes",
        });
        const value = decodeSigned(path, FormalReceiptSchema, "receiptSha256");
        if (value.selector !== test.selector || value.caseId !== test.caseId || value.inventoryDigest !== inventoryInput.digest ||
          value.cleanup.ok !== true || value.source.testFileSha256 !== sourceDigest(testFile.source)) {
          throw new MemoryReferenceConflict({ operation: "resolve", path, message: "formal receipt diverges from selector, inventory, or current source digests" });
        }
        return value;
      };
      const red = receipt(entry.red.path, entry.red.digest);
      const green = receipt(entry.green.path, entry.green.digest);
      if (red.source.sidecarSha256 !== green.source.sidecarSha256) throw new MemoryReferenceConflict({
        operation: "resolve", path: indexPath, message: "formal red and green evidence diverge from the same sidecar source",
      });
      if (red.observation !== "red" || red.result.disposition !== "regression" || green.observation !== "green" || green.result.disposition !== "pass") {
        throw new MemoryReferenceConflict({ operation: "resolve", path: indexPath, message: "fixed evidence requires a formal red regression and green pass" });
      }
      const certificateRaw = this.targetSource(entry.certificate.path).source;
      if (traceDigest(certificateRaw) !== entry.certificate.digest) throw new MemoryReferenceConflict({
        operation: "resolve", path: entry.certificate.path, message: "evidence index digest does not match certificate bytes",
      });
      const certificate = decodeSigned(entry.certificate.path, CertificateSchema, "certificateSha256");
      if (certificate.selector !== test.selector || certificate.caseId !== test.caseId ||
        certificate.candidateSha256 !== green.candidate.sha256 || certificate.greenReceipt !== entry.green.path ||
        certificate.observations.singleCase !== entry.green.path ||
        certificate.observations.isolatedCopies.length !== 3 || certificate.observations.sameCopy.length !== 2 ||
        certificate.observations.cleanup.length === 0) {
        throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "takeover certificate is incomplete or diverges from the green case evidence" });
      }
      const reliabilityPaths = [
        ...certificate.observations.isolatedCopies,
        ...certificate.observations.sameCopy,
        certificate.observations.defaultParallel,
      ];
      if (new Set(reliabilityPaths).size !== 6) throw new MemoryReferenceConflict({
        operation: "resolve", path: entry.certificate.path, message: "takeover certificate reuses reliability receipts",
      });
      const reliability = reliabilityPaths.map((path) => receipt(path));
      if (reliability.some((item) => item.observation !== "reliability" || item.result.disposition !== "pass" || item.candidate.sha256 !== green.candidate.sha256)) {
        throw new MemoryReferenceConflict({ operation: "resolve", path: entry.certificate.path, message: "takeover receipts do not all pass on the green candidate" });
      }
      if (reliability.some((item) => item.source.sidecarSha256 !== green.source.sidecarSha256)) throw new MemoryReferenceConflict({
        operation: "resolve", path: entry.certificate.path, message: "takeover receipts diverge from the green sidecar source",
      });
      const invocationIds = [red.invocationId, green.invocationId, ...reliability.map((item) => item.invocationId)];
      if (new Set(invocationIds).size !== invocationIds.length) throw new MemoryReferenceConflict({
        operation: "resolve", path: entry.certificate.path, message: "formal evidence reuses an invocation identity",
      });
    }
    return { selectors: related.map((test) => test.selector).sort(), preimagePaths: [...preimages].sort() };
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
    const legacyFixedMigrationDebt: string[] = [];
    const documents: MemoryDocument[] = [];
    try { documents.push(...this.list()); } catch (cause) { findings.push(message(cause)); }
    const structured = documents.filter((item): item is Exclude<MemoryDocument, { readonly legacy: true }> => !("legacy" in item));
    const byId = new Map(structured.map((item) => [item.metadata.id, item.metadata]));
    for (const { metadata } of structured) {
      if (metadata.kind.type === "problem" && ((metadata.kind.state === "resolved") !== (metadata.kind.resolution !== undefined))) {
        findings.push(`${metadata.id}: Problem state and resolution disagree`);
      }
      if (metadata.kind.type === "problem" && metadata.kind.resolution?.kind === "fixed") {
        const credentials = metadata.kind.resolution.proof.filter((proof) => proof.startsWith(FIXED_EVIDENCE_CREDENTIAL));
        const encoded = credentials[0];
        if (encoded === undefined) legacyFixedMigrationDebt.push(metadata.id);
        else if (credentials.length !== 1) findings.push(`${metadata.id}: fixed resolution must contain exactly one repository-managed evidence credential`);
        else try {
          const credential = JSON.parse(encoded.slice(FIXED_EVIDENCE_CREDENTIAL.length)) as { selectors?: unknown };
          const validated = this.validateFixedEvidence(snapshot, `memory/${metadata.id}.md`);
          if (!Array.isArray(credential.selectors) || !credential.selectors.every((item) => typeof item === "string") ||
            JSON.stringify([...credential.selectors].sort()) !== JSON.stringify(validated.selectors)) {
            findings.push(`${metadata.id}: fixed evidence credential selectors diverge from current validated evidence`);
          }
        } catch (cause) { findings.push(`${metadata.id}: ${message(cause)}`); }
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
      legacyFixedMigrationDebt: legacyFixedMigrationDebt.sort(),
      findings,
    };
  }

  #checkRegressionReferences(snapshot: TraceSnapshot, findings: string[]): void {
    const byPath = new Map(snapshot.memory.map((memory) => [memory.path, memory]));
    for (const test of snapshot.tests) {
      for (const reference of test.regressions) {
        const target = byPath.get(reference.split("#", 1)[0] ?? reference);
        if (target === undefined) findings.push(`${test.selector}: regression Memory ${reference} is missing`);
        else if (target.kind !== "problem" && target.kind !== "legacy/unstructured") {
          findings.push(`${test.selector}: regression must reference Problem Memory`);
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
