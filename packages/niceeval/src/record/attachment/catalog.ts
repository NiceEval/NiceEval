import { Result, type Schema } from "effect";

import type { RecordAttachmentOwner } from "../model/core.ts";
import type { RecordAttachmentSpiFailure } from "./errors.ts";
import {
  isRecordAttachmentDefinition,
  isRecordAttachmentPersistence,
  type RecordAttachmentDefinition,
  type RecordAttachmentPersistence,
} from "./protocol.ts";

const recordAttachmentCatalogTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentCatalog/v2",
);

type AnyDefinition = RecordAttachmentDefinition<
  RecordAttachmentOwner,
  string,
  Schema.Top
>;

export type AnyRecordAttachmentPersistence = RecordAttachmentPersistence<
  AnyDefinition,
  number
>;

const catalogs = new WeakSet<object>();

function identity(owner: RecordAttachmentOwner, family: string): string {
  return `${owner}\u0000${family}`;
}

/** Immutable authority indexed by exact Attachment brand and physical identity. */
export interface RecordAttachmentCatalog {
  readonly persistences: readonly AnyRecordAttachmentPersistence[];
  readonly definitions: readonly AnyDefinition[];
  readonly get: (
    owner: RecordAttachmentOwner,
    family: string,
  ) => AnyRecordAttachmentPersistence | undefined;
  readonly persistence: (
    definition: AnyDefinition,
  ) => AnyRecordAttachmentPersistence | undefined;
  readonly [recordAttachmentCatalogTypeId]: () => void;
}

/** Pure, session-local composition. No module load can mutate an existing Host. */
export function makeRecordAttachmentCatalog(
  persistences: readonly AnyRecordAttachmentPersistence[],
): Result.Result<RecordAttachmentCatalog, RecordAttachmentSpiFailure> {
  const ordered = [...persistences].sort((left, right) => {
    const owner = left.attachment.owner === right.attachment.owner
      ? 0
      : left.attachment.owner < right.attachment.owner ? -1 : 1;
    return owner === 0
      ? left.attachment.family === right.attachment.family
        ? 0
        : left.attachment.family < right.attachment.family ? -1 : 1
      : owner;
  });
  const byIdentity = new Map<string, AnyRecordAttachmentPersistence>();
  const byDefinition = new WeakMap<object, AnyRecordAttachmentPersistence>();

  for (const persistence of ordered) {
    if (
      !isRecordAttachmentPersistence(persistence) ||
      !isRecordAttachmentDefinition(persistence.attachment)
    ) {
      return Result.fail(Object.freeze({ code: "invalid-family-definition" }));
    }
    const definition = persistence.attachment;
    const key = identity(definition.owner, definition.family);
    if (byIdentity.has(key) || byDefinition.has(definition)) {
      return Result.fail(Object.freeze({
        code: "duplicate-family",
        owner: definition.owner,
        family: definition.family,
      }));
    }
    byIdentity.set(key, persistence);
    byDefinition.set(definition, persistence);
  }

  const frozenPersistences = Object.freeze(ordered);
  const catalog: RecordAttachmentCatalog = Object.freeze({
    persistences: frozenPersistences,
    definitions: Object.freeze(frozenPersistences.map(({ attachment }) => attachment)),
    get: (owner: RecordAttachmentOwner, family: string) =>
      byIdentity.get(identity(owner, family)),
    persistence: (definition: AnyDefinition) => byDefinition.get(definition),
    [recordAttachmentCatalogTypeId]: () => undefined,
  });
  catalogs.add(catalog);
  return Result.succeed(catalog);
}

export function isRecordAttachmentCatalog(
  value: unknown,
): value is RecordAttachmentCatalog {
  return typeof value === "object" && value !== null && catalogs.has(value);
}
