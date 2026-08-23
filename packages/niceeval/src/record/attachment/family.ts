import { Either, type Schema } from "effect";

import { isRecordAttachmentName } from "../model/identifiers.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import {
  compileRecordSchemaCodec,
  type RecordSchemaCodec,
  type RecordSchemaFailure,
} from "../definition/schema-codec.ts";
import { isRecordBlobRef, RecordBlobRefSchema, type RecordBlobRef } from "./blob-ref.ts";
import {
  nonEmptyRecordAttachmentIssues,
  recordAttachmentIssue,
  recordAttachmentPayloadInvalid,
  RecordAttachmentSpiDefinitionError,
  type RecordAttachmentIssue,
  type RecordAttachmentSpiFailure,
} from "./errors.ts";
import {
  makeFixedRecordAttachmentWriteFromDrafts,
  makeRecordAttachmentWriteSpec,
  validateRecordAttachmentWrite,
} from "./runtime.ts";
import type {
  FixedAttachmentWriteSpec,
  RecordAttachmentWrite,
  RecordBlobDrafts,
  RecordBlobErrors,
  RecordBlobRequirements,
} from "./types.ts";
import {
  isRecordAttachmentMigration,
  type AnyRecordAttachmentMigration,
} from "./migration.ts";
import {
  isRecordAttachmentVersion,
  type AnyRecordAttachmentVersion,
  type RecordAttachmentVersion,
  type RecordAttachmentVersionValue,
} from "./version.ts";
import { getRecordAttachmentMaterializedRefine } from "./compatibility.ts";

const recordAttachmentFamilyTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentFamily",
);

const families = new WeakMap<object, FamilyRuntime>();

interface CompiledVersion {
  readonly token: AnyRecordAttachmentVersion;
  readonly codec: RecordSchemaCodec<unknown, RecordBlobRef>;
}

interface FamilyRuntime {
  readonly versions: ReadonlyMap<number, CompiledVersion>;
  readonly currentWrite: FixedAttachmentWriteSpec<RecordAttachmentOwner, unknown>;
}

function makeVersionWriteSpec<Owner extends RecordAttachmentOwner>(input: {
  readonly owner: Owner;
  readonly family: string;
  readonly compiled: CompiledVersion;
}): FixedAttachmentWriteSpec<Owner, unknown> {
  const version = input.compiled.token;
  const codec = input.compiled.codec;
  return makeRecordAttachmentWriteSpec<Owner, unknown>({
    owner: input.owner,
    family: input.family,
    schemaVersion: version.version,
    encodePayload: (payload) => {
      const encoded = codec.encode(payload);
      return Either.isLeft(encoded)
        ? Either.left(recordAttachmentPayloadInvalid([
            recordAttachmentIssue("record-attachment-schema-invalid", ["value"]),
          ]))
        : Either.right(encoded.right);
    },
    decodePayload: (value) => {
      const decoded = codec.decode(value);
      return Either.isLeft(decoded)
        ? Either.left(recordAttachmentPayloadInvalid([
            recordAttachmentIssue("record-attachment-schema-invalid", ["value"]),
          ]))
        : Either.right(decoded.right);
    },
    refs: (payload) => version.contents.select(payload as never),
    budget: version.contents.budget,
    verify: (payload, blobs) => {
      const issues = [...version.invariants(payload as never)];
      const materializedRefine = getRecordAttachmentMaterializedRefine(version);
      if (materializedRefine !== undefined) issues.push(...materializedRefine(payload, blobs));
      return Object.freeze(issues);
    },
    references: (payload) => version.references.select(payload as never),
    maximumReferences: version.references.maximumReferences,
  });
}

type CurrentValue<Current extends AnyRecordAttachmentVersion> =
  RecordAttachmentVersionValue<Current>;

export interface RecordAttachmentFamilyDefinition<
  out Owner extends RecordAttachmentOwner,
  out Family extends string,
  Current extends AnyRecordAttachmentVersion,
> {
  readonly owner: Owner;
  readonly family: Family;
  readonly current: Current;
  readonly schemaVersion: Current["version"];
  /** Diagnostic-only derivative; durable identity remains the tuple fields. */
  readonly schemaId: `${Owner}:${Family}/v${Current["version"]}`;
  readonly versions: readonly AnyRecordAttachmentVersion[];
  readonly migrations: readonly AnyRecordAttachmentMigration[];
  readonly prepare: <const Sources extends RecordBlobDrafts>(
    value: CurrentValue<Current>,
    sources: Sources,
  ) => Either.Either<
    RecordAttachmentWrite<
      Owner,
      RecordBlobErrors<Sources>,
      RecordBlobRequirements<Sources>,
      Family,
      Current["version"]
    >,
    RecordAttachmentSpiFailure
  >;
  readonly [recordAttachmentFamilyTypeId]: () => {
    readonly owner: Owner;
    readonly family: Family;
    readonly current: Current["version"];
  };
}

export type AnyRecordAttachmentFamilyDefinition = RecordAttachmentFamilyDefinition<
  RecordAttachmentOwner,
  string,
  AnyRecordAttachmentVersion
>;

function invalid(
  cause?: unknown,
  code: "invalid-family-definition" | "migration-chain-invalid" =
    "invalid-family-definition",
): never {
  throw new RecordAttachmentSpiDefinitionError(code, cause);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validVersion(token: AnyRecordAttachmentVersion): boolean {
  const contents = token.contents;
  const references = token.references;
  const limits = contents.valueLimits;
  return positiveSafeInteger(token.version) &&
    typeof token.invariants === "function" &&
    typeof contents.select === "function" &&
    typeof references.select === "function" &&
    nonNegativeSafeInteger(references.maximumReferences) &&
    positiveSafeInteger(contents.budget.maximumBlobs) &&
    positiveSafeInteger(contents.budget.maximumBlobBytes) &&
    positiveSafeInteger(contents.budget.maximumTotalBytes) &&
    contents.budget.maximumTotalBytes >= contents.budget.maximumBlobBytes &&
    positiveSafeInteger(limits.maximumJsonBytes) &&
    positiveSafeInteger(limits.maximumDepth) &&
    positiveSafeInteger(limits.maximumNodes) &&
    positiveSafeInteger(limits.maximumObjectKeys) &&
    positiveSafeInteger(limits.maximumArrayItems) &&
    positiveSafeInteger(limits.maximumKeyUtf8Bytes) &&
    positiveSafeInteger(limits.maximumStringUtf8Bytes);
}

function compileVersion(token: AnyRecordAttachmentVersion): CompiledVersion {
  if (!isRecordAttachmentVersion(token) || !validVersion(token)) return invalid();
  try {
    return Object.freeze({
      token,
      codec: compileRecordSchemaCodec({
        schema: token.schema,
        limits: token.contents.valueLimits,
        blobRef: { schema: RecordBlobRefSchema, isBlobRef: isRecordBlobRef },
      }) as RecordSchemaCodec<unknown, RecordBlobRef>,
    });
  } catch (cause) {
    return invalid(cause);
  }
}

function schemaFailure(failure: RecordSchemaFailure): RecordAttachmentSpiFailure {
  return failure.kind === "canonical" && failure.failure.code === "record-json-limit-exceeded"
    ? Object.freeze({ code: "resource-budget-exceeded", resource: "value", cause: failure })
    : Object.freeze({ code: "exact-decode-failed", cause: failure });
}

function callbackFailure(
  code: "invariant-failed" | "content-closure-failed" | "reference-closure-failed",
  cause: unknown,
): RecordAttachmentSpiFailure {
  return Object.freeze({ code, cause }) as RecordAttachmentSpiFailure;
}

function validateReferences(
  value: unknown,
  current: AnyRecordAttachmentVersion,
): Either.Either<void, RecordAttachmentSpiFailure> {
  let references: readonly unknown[];
  try {
    references = current.references.select(value as never);
  } catch (cause) {
    return Either.left(callbackFailure("reference-closure-failed", cause));
  }
  if (!Array.isArray(references)) {
    return Either.left(Object.freeze({ code: "reference-closure-failed" }));
  }
  if (references.length > current.references.maximumReferences) {
    return Either.left(Object.freeze({ code: "resource-budget-exceeded", resource: "reference" }));
  }
  try {
    const identities = new Set<string>();
    for (const reference of references) {
      if (typeof reference !== "object" || reference === null) {
        return Either.left(Object.freeze({ code: "reference-closure-failed" }));
      }
      const descriptors = Object.getOwnPropertyDescriptors(reference);
      const keys = Reflect.ownKeys(reference);
      const owner = descriptors.owner;
      const family = descriptors.family;
      if (
        keys.length !== 2 ||
        !("value" in (owner ?? {})) ||
        !("value" in (family ?? {})) ||
        (owner.value !== "run" && owner.value !== "attempt") ||
        typeof family.value !== "string" ||
        !isRecordAttachmentName(family.value)
      ) {
        return Either.left(Object.freeze({ code: "reference-closure-failed" }));
      }
      const identity = `${owner.value}\u0000${family.value}`;
      if (identities.has(identity)) {
        return Either.left(Object.freeze({ code: "reference-closure-failed" }));
      }
      identities.add(identity);
    }
  } catch (cause) {
    return Either.left(callbackFailure("reference-closure-failed", cause));
  }
  return Either.right(undefined);
}

function validateInvariants(
  value: unknown,
  current: AnyRecordAttachmentVersion,
): Either.Either<void, RecordAttachmentSpiFailure> {
  let issues: readonly RecordAttachmentIssue[];
  try {
    issues = current.invariants(value as never);
  } catch (cause) {
    return Either.left(callbackFailure("invariant-failed", cause));
  }
  if (!Array.isArray(issues)) {
    return Either.left(callbackFailure("invariant-failed", new TypeError("invariants must return issues")));
  }
  const nonEmpty = nonEmptyRecordAttachmentIssues(issues);
  return nonEmpty === undefined
    ? Either.right(undefined)
    : Either.left(Object.freeze({ code: "invariant-failed", issues: nonEmpty }));
}

function validateMigrationChain(
  versions: readonly AnyRecordAttachmentVersion[],
  migrations: readonly AnyRecordAttachmentMigration[],
): void {
  if (migrations.length !== Math.max(0, versions.length - 1)) {
    invalid(undefined, "migration-chain-invalid");
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const from = versions[index];
    const to = versions[index + 1];
    if (
      !isRecordAttachmentMigration(migration) ||
      migration.from !== from ||
      migration.to !== to ||
      to.version !== from.version + 1
    ) {
      invalid(undefined, "migration-chain-invalid");
    }
  }
}

/**
 * Compile one owner/family version chain. No registry, I/O service, path or
 * legacy-root decoder is captured by the returned pure definition.
 */
export function defineRecordAttachment<
  const Owner extends RecordAttachmentOwner,
  const Family extends string,
  const Versions extends readonly [AnyRecordAttachmentVersion, ...AnyRecordAttachmentVersion[]],
  const Current extends Versions[number],
>(input: {
  readonly owner: Owner;
  readonly family: Family;
  readonly current: Current;
  readonly versions: Versions;
  readonly migrations: readonly AnyRecordAttachmentMigration[];
}): RecordAttachmentFamilyDefinition<Owner, Family, Current> {
  if ((input.owner !== "run" && input.owner !== "attempt") || !isRecordAttachmentName(input.family)) {
    return invalid();
  }
  const compiled = input.versions.map(compileVersion);
  for (let index = 0; index < compiled.length; index += 1) {
    if (compiled[index].token.version !== index + 1) return invalid();
  }
  if (input.current !== input.versions[input.versions.length - 1]) return invalid();
  validateMigrationChain(input.versions, input.migrations);

  const currentCompiled = compiled[compiled.length - 1];
  const current = input.current;
  const codec = currentCompiled.codec;
  const fixed = makeVersionWriteSpec({
    owner: input.owner,
    family: input.family,
    compiled: currentCompiled,
  }) as FixedAttachmentWriteSpec<Owner, CurrentValue<Current>>;

  const definition = {
    owner: input.owner,
    family: input.family,
    current,
    schemaVersion: current.version,
    schemaId: `${input.owner}:${input.family}/v${current.version}`,
    versions: Object.freeze([...input.versions]),
    migrations: Object.freeze([...input.migrations]),
    prepare: <const Sources extends RecordBlobDrafts>(
      value: CurrentValue<Current>,
      sources: Sources,
    ) => {
      const encoded = codec.encode(value);
      if (Either.isLeft(encoded)) return Either.left(schemaFailure(encoded.left));
      const decoded = codec.decode(encoded.right);
      if (Either.isLeft(decoded)) return Either.left(schemaFailure(decoded.left));
      const snapshot = decoded.right as CurrentValue<Current>;
      const invariants = validateInvariants(snapshot, current);
      if (Either.isLeft(invariants)) return Either.left(invariants.left);
      const references = validateReferences(snapshot, current);
      if (Either.isLeft(references)) return Either.left(references.left);

      let selected: readonly RecordBlobRef[];
      try {
        selected = current.contents.select(snapshot);
      } catch (cause) {
        return Either.left(callbackFailure("content-closure-failed", cause));
      }
      if (!Array.isArray(selected)) {
        return Either.left(Object.freeze({ code: "content-closure-failed" }));
      }
      if (selected.length > current.contents.budget.maximumBlobs) {
        return Either.left(Object.freeze({ code: "resource-budget-exceeded", resource: "content" }));
      }

      const write = makeFixedRecordAttachmentWriteFromDrafts(fixed, snapshot, sources);
      const closure = validateRecordAttachmentWrite(write);
      if (Either.isLeft(closure)) {
        const exceeded = closure.left.issues.some((issue) =>
          issue.code === "record-attachment-blob-budget-exceeded"
        );
        return Either.left(exceeded
          ? Object.freeze({ code: "resource-budget-exceeded", resource: "content" })
          : Object.freeze({
              code: "content-closure-failed",
              issues: closure.left.issues,
            }));
      }
      return Either.right(write as RecordAttachmentWrite<
        Owner,
        RecordBlobErrors<Sources>,
        RecordBlobRequirements<Sources>,
        Family,
        Current["version"]
      >);
    },
    [recordAttachmentFamilyTypeId]: () => ({
      owner: input.owner,
      family: input.family,
      current: current.version,
    }),
  } as RecordAttachmentFamilyDefinition<Owner, Family, Current>;

  families.set(definition, Object.freeze({
    versions: new Map(compiled.map((entry) => [entry.token.version, entry])),
    currentWrite: fixed as FixedAttachmentWriteSpec<RecordAttachmentOwner, unknown>,
  }));
  return Object.freeze(definition);
}

export function isRecordAttachmentFamilyDefinition(
  value: unknown,
): value is AnyRecordAttachmentFamilyDefinition {
  return typeof value === "object" && value !== null && families.has(value);
}

/** @internal Existing Host/reader code derives its fixed descriptor from this token. */
export function getRecordAttachmentFixedWriteSpec<
  const Owner extends RecordAttachmentOwner,
  const Family extends string,
  const Current extends AnyRecordAttachmentVersion,
>(
  definition: RecordAttachmentFamilyDefinition<Owner, Family, Current>,
): FixedAttachmentWriteSpec<Owner, CurrentValue<Current>> {
  const runtime = families.get(definition);
  if (runtime === undefined) {
    throw new TypeError("Record Attachment compatibility bridge requires a branded definition");
  }
  return runtime.currentWrite as FixedAttachmentWriteSpec<Owner, CurrentValue<Current>>;
}

/** @internal Maintenance obtains the exact compiled algebra for one durable predecessor. */
export function getRecordAttachmentVersionWriteSpec(
  definition: AnyRecordAttachmentFamilyDefinition,
  schemaVersion: number,
): FixedAttachmentWriteSpec<RecordAttachmentOwner, unknown> | undefined {
  const runtime = families.get(definition);
  const compiled = runtime?.versions.get(schemaVersion);
  return compiled === undefined
    ? undefined
    : makeVersionWriteSpec({
        owner: definition.owner,
        family: definition.family,
        compiled,
      });
}

/** Owner-scoped writers must perform this runtime check even when types agree. */
export function validateRecordAttachmentDefinitionOwner<Owner extends RecordAttachmentOwner>(
  expected: Owner,
  definition: AnyRecordAttachmentFamilyDefinition,
): Either.Either<void, RecordAttachmentSpiFailure> {
  return definition.owner === expected
    ? Either.right(undefined)
    : Either.left(Object.freeze({
        code: "owner-mismatch",
        expected,
        actual: definition.owner,
      }));
}
