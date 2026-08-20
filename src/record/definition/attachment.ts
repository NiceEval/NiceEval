import type { Schema } from "effect";
import {
  RecordBlobRefSchema,
  isRecordBlobRef,
  type RecordBlobRef,
} from "../attachment/blob-ref.ts";
import type {
  RecordAttachmentBlobBudget,
  RecordAttachmentBlobRefs,
  RecordAttachmentMaterializedRefine,
} from "../attachment/blob-policy.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import {
  compileRecordSchemaCodec,
  type RecordSchemaCodec,
  type RecordSchemaLimits,
} from "./schema-codec.ts";

const recordAttachmentOwnerDefinitionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentOwnerDefinition",
);

const compiledOwners = new WeakSet<object>();

export type { RecordAttachmentOwner } from "../model/core.ts";

export interface RecordAttachmentOwnerInput<
  SourceSchema extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
  readonly blobs: Readonly<{
    readonly refs: RecordAttachmentBlobRefs<Schema.Schema.Type<SourceSchema>>;
    readonly budget: RecordAttachmentBlobBudget;
    readonly verify: RecordAttachmentMaterializedRefine<Schema.Schema.Type<SourceSchema>>;
  }>;
}

export type RecordAttachmentOwnerInputs = Readonly<Partial<Record<
  RecordAttachmentOwner,
  RecordAttachmentOwnerInput<Schema.Schema.AnyNoContext>
>>>;

/** One owner compiled exactly once from a fixed family declaration. */
export interface RecordAttachmentOwnerDefinition<
  Owner extends RecordAttachmentOwner,
  Payload,
  SourceSchema extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> {
  readonly family: string;
  readonly schemaVersion: number;
  readonly owner: Owner;
  readonly codec: RecordSchemaCodec<Payload, RecordBlobRef, SourceSchema>;
  readonly refs: RecordAttachmentBlobRefs<Payload>;
  readonly budget: RecordAttachmentBlobBudget;
  readonly verify: RecordAttachmentMaterializedRefine<Payload>;
  readonly [recordAttachmentOwnerDefinitionTypeId]: () => void;
}

type OwnerDefinitionFor<Owner extends RecordAttachmentOwner, Input> =
  Input extends RecordAttachmentOwnerInput<infer SourceSchema>
    ? RecordAttachmentOwnerDefinition<Owner, Schema.Schema.Type<SourceSchema>, SourceSchema>
    : never;

export type RecordAttachmentOwnerDefinitions<Owners extends RecordAttachmentOwnerInputs> = Readonly<{
  readonly [Owner in keyof Owners]: Owner extends RecordAttachmentOwner
    ? OwnerDefinitionFor<Owner, Owners[Owner]>
    : never;
}>;

/** Historical codecs stay opaque to the current import graph until maintenance asks for them. */
export interface RecordAttachmentHistoricalCodec {
  readonly schemaVersion: number;
  readonly decode: (input: unknown) => unknown;
}

/** Only adjacent, package-owned migrations may be declared for a fixed family. */
export interface RecordAttachmentAdjacentMigration {
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly migrate: (input: unknown) => unknown;
}

/** Eager metadata only: implementation remains behind `maintenance`. */
export interface RecordAttachmentAdjacentMigrationLink {
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  /** Physical plan metadata shared by planning, execution, and interrupted recovery. */
  readonly rewritePayload: boolean;
}

export interface RecordAttachmentMaintenanceFacet {
  /** Historical codecs and adjacent migrations remain behind this lazy boundary. */
  readonly historicalCodecs: readonly RecordAttachmentHistoricalCodec[];
  readonly adjacentMigrations: readonly RecordAttachmentAdjacentMigration[];
}

export interface RecordAttachmentDefinition<
  out Family extends string = string,
  Owners extends RecordAttachmentOwnerInputs = RecordAttachmentOwnerInputs,
> {
  readonly family: Family;
  readonly current: Readonly<{
    readonly schemaVersion: number;
    readonly owners: RecordAttachmentOwnerDefinitions<Owners>;
  }>;
  readonly maintenance: (() => Promise<RecordAttachmentMaintenanceFacet>) | undefined;
  readonly adjacentMigrationLinks: readonly RecordAttachmentAdjacentMigrationLink[];
}

function validFamily(value: string): boolean {
  return /^niceeval\.[a-z0-9][a-z0-9.-]*$/.test(value) && !value.includes("/");
}

function validBlobBudget(value: unknown): value is RecordAttachmentBlobBudget {
  if (typeof value !== "object" || value === null) return false;
  const budget = value as Record<string, unknown>;
  return [budget.maximumBlobs, budget.maximumBlobBytes, budget.maximumTotalBytes]
    .every((limit) => Number.isSafeInteger(limit) && (limit as number) > 0);
}

function compileOwner<
  Owner extends RecordAttachmentOwner,
  SourceSchema extends Schema.Schema.AnyNoContext,
>(
  family: string,
  schemaVersion: number,
  owner: Owner,
  input: RecordAttachmentOwnerInput<SourceSchema>,
): RecordAttachmentOwnerDefinition<Owner, Schema.Schema.Type<SourceSchema>, SourceSchema> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.blobs !== "object" ||
    input.blobs === null ||
    typeof input.blobs.refs !== "function" ||
    !validBlobBudget(input.blobs.budget) ||
    typeof input.blobs.verify !== "function"
  ) {
    throw new TypeError("Record Attachment owners must declare a bounded blob policy");
  }
  const codec = compileRecordSchemaCodec({
    schema: input.schema,
    limits: input.limits,
    blobRef: {
      schema: RecordBlobRefSchema,
      isBlobRef: isRecordBlobRef,
    },
  });
  const definition: RecordAttachmentOwnerDefinition<
    Owner,
    Schema.Schema.Type<SourceSchema>,
    SourceSchema
  > = {
    family,
    schemaVersion,
    owner,
    codec,
    refs: input.blobs.refs,
    budget: Object.freeze({ ...input.blobs.budget }),
    verify: input.blobs.verify,
    [recordAttachmentOwnerDefinitionTypeId]: () => undefined,
  };
  compiledOwners.add(definition);
  return Object.freeze(definition);
}

/** @internal Runtime factories accept only owners minted by defineRecordAttachment. */
export function isRecordAttachmentOwnerDefinition(
  value: unknown,
): value is RecordAttachmentOwnerDefinition<RecordAttachmentOwner, unknown> {
  return typeof value === "object" && value !== null && compiledOwners.has(value);
}

/**
 * NiceEval-only fixed-family declaration. It stores no registry and exposes no
 * plugin hook: the static catalog is assembled by package code alone.
 */
export function defineRecordAttachment<
  const Family extends string,
  const Owners extends RecordAttachmentOwnerInputs,
>(input: {
  readonly family: Family;
  readonly current: {
    readonly schemaVersion: number;
    readonly owners: Owners;
  };
  readonly maintenance?: () => Promise<RecordAttachmentMaintenanceFacet>;
  readonly adjacentMigrationLinks?: readonly RecordAttachmentAdjacentMigrationLink[];
}): RecordAttachmentDefinition<Family, Owners> {
  if (!validFamily(input.family)) {
    throw new TypeError("Record Attachment family must be a stable niceeval.* identity without a version suffix");
  }
  if (!Number.isSafeInteger(input.current.schemaVersion) || input.current.schemaVersion <= 0) {
    throw new TypeError("Record Attachment schemaVersion must be a positive safe integer");
  }
  if (input.maintenance !== undefined && typeof input.maintenance !== "function") {
    throw new TypeError("Record Attachment maintenance must be a lazy function");
  }
  const adjacentMigrationLinks = input.adjacentMigrationLinks ?? Object.freeze([]);
  const migrationStarts = new Set<number>();
  for (const link of adjacentMigrationLinks) {
    if (
      !Number.isSafeInteger(link.fromSchemaVersion) ||
      !Number.isSafeInteger(link.toSchemaVersion) ||
      link.fromSchemaVersion <= 0 ||
      link.toSchemaVersion !== link.fromSchemaVersion + 1 ||
      link.toSchemaVersion > input.current.schemaVersion ||
      typeof link.rewritePayload !== "boolean" ||
      migrationStarts.has(link.fromSchemaVersion)
    ) {
      throw new TypeError("Record Attachment migration links must be unique adjacent upgrades to current history");
    }
    migrationStarts.add(link.fromSchemaVersion);
  }
  if (adjacentMigrationLinks.length > 0 && input.maintenance === undefined) {
    throw new TypeError("Record Attachment migration links require a lazy maintenance implementation");
  }
  const keys = Reflect.ownKeys(input.current.owners);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "attempt" && key !== "run")
  ) {
    throw new TypeError("Record Attachment owners may contain only attempt and run");
  }
  const owners = input.current.owners as RecordAttachmentOwnerInputs;
  const compiled: Partial<Record<RecordAttachmentOwner, RecordAttachmentOwnerDefinition<
    RecordAttachmentOwner,
    unknown
  >>> = {};
  for (const key of keys as readonly RecordAttachmentOwner[]) {
    const ownerInput = owners[key];
    if (ownerInput === undefined) {
      throw new TypeError("Record Attachment owners must have one schema and blob policy");
    }
    compiled[key] = compileOwner(input.family, input.current.schemaVersion, key, ownerInput);
  }
  return Object.freeze({
    family: input.family,
    current: Object.freeze({
      schemaVersion: input.current.schemaVersion,
      owners: Object.freeze(compiled) as RecordAttachmentOwnerDefinitions<Owners>,
    }),
    maintenance: input.maintenance,
    adjacentMigrationLinks: Object.freeze(adjacentMigrationLinks.map((link) => Object.freeze({ ...link }))),
  });
}
