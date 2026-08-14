import { isRecordValueDefinition, type RecordValueLeaf } from "./value.ts";
import type {
  RecordAttachmentBlobBudget,
  RecordAttachmentMaterializedRefine,
} from "../attachment/types.ts";

export type RecordAttachmentOwner = "attempt" | "run";

type AttachmentOwnerValue = Readonly<{ readonly leaf: Extract<RecordValueLeaf, "json-with-blob-refs"> }>;

export type RecordAttachmentOwnerValues = Readonly<{
  readonly attempt?: AttachmentOwnerValue;
  readonly run?: AttachmentOwnerValue;
}>;

/** Per-owner materialization policy is part of the static fixed declaration. */
export interface RecordAttachmentOwnerMaterialization {
  readonly blobBudget: RecordAttachmentBlobBudget;
  readonly materializedRefine: RecordAttachmentMaterializedRefine<unknown>;
}

export type RecordAttachmentOwnerMaterializations<Owners extends RecordAttachmentOwnerValues> =
  Readonly<{
    readonly [Owner in Extract<keyof Owners, RecordAttachmentOwner>]: RecordAttachmentOwnerMaterialization;
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
}

export interface RecordAttachmentMaintenanceFacet {
  /** Historical codecs and adjacent migrations remain behind this lazy boundary. */
  readonly historicalCodecs: readonly RecordAttachmentHistoricalCodec[];
  readonly adjacentMigrations: readonly RecordAttachmentAdjacentMigration[];
}

export interface RecordAttachmentDefinition<
  out Family extends string = string,
  out Owners extends RecordAttachmentOwnerValues = RecordAttachmentOwnerValues,
> {
  readonly family: Family;
  readonly current: Readonly<{
    readonly schemaVersion: number;
    readonly owners: Owners;
    readonly materialization: RecordAttachmentOwnerMaterializations<Owners>;
  }>;
  readonly maintenance: (() => Promise<RecordAttachmentMaintenanceFacet>) | undefined;
  readonly adjacentMigrationLinks: readonly RecordAttachmentAdjacentMigrationLink[];
}

function validFamily(value: string): boolean {
  return /^niceeval\.[a-z0-9][a-z0-9.-]*$/.test(value) && !value.includes("/");
}

/**
 * NiceEval-only fixed-family declaration. It stores no registry and exposes no
 * plugin hook: the static catalog is assembled by package code alone.
 */
export function defineRecordAttachment<
  const Family extends string,
  const Owners extends RecordAttachmentOwnerValues,
>(input: {
  readonly family: Family;
  readonly current: {
    readonly schemaVersion: number;
    readonly owners: Owners;
    readonly materialization: RecordAttachmentOwnerMaterializations<Owners>;
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
  const owners = input.current.owners as RecordAttachmentOwnerValues;
  const materialization = input.current.materialization as Partial<
    Record<RecordAttachmentOwner, RecordAttachmentOwnerMaterialization>
  >;
  for (const key of keys as readonly RecordAttachmentOwner[]) {
    const owner = owners[key];
    if (
      owner === undefined ||
      !isRecordValueDefinition(owner) ||
      owner.leaf !== "json-with-blob-refs"
    ) {
      throw new TypeError("Record Attachment owners must use the json-with-blob-refs leaf");
    }
    const policy = materialization[key];
    if (
      policy === undefined ||
      typeof policy.materializedRefine !== "function" ||
      !Number.isSafeInteger(policy.blobBudget.maximumBlobs) || policy.blobBudget.maximumBlobs <= 0 ||
      !Number.isSafeInteger(policy.blobBudget.maximumBlobBytes) || policy.blobBudget.maximumBlobBytes <= 0 ||
      !Number.isSafeInteger(policy.blobBudget.maximumTotalBytes) || policy.blobBudget.maximumTotalBytes <= 0
    ) {
      throw new TypeError("Record Attachment owners must declare a bounded materialization policy");
    }
  }
  if (Reflect.ownKeys(materialization).some((key) => !keys.includes(key))) {
    throw new TypeError("Record Attachment materialization may contain only declared owners");
  }
  return Object.freeze({
    family: input.family,
    current: Object.freeze({
      schemaVersion: input.current.schemaVersion,
      owners: Object.freeze({ ...input.current.owners }) as Owners,
      materialization: Object.freeze(
        Object.fromEntries(
          (keys as readonly RecordAttachmentOwner[]).map((key) => [
            key,
            Object.freeze({
              blobBudget: Object.freeze({ ...materialization[key]!.blobBudget }),
              materializedRefine: materialization[key]!.materializedRefine,
            }),
          ]),
        ),
      ) as RecordAttachmentOwnerMaterializations<Owners>,
    }),
    maintenance: input.maintenance,
    adjacentMigrationLinks: Object.freeze(adjacentMigrationLinks.map((link) => Object.freeze({ ...link }))),
  });
}
