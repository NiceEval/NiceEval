import { Either } from "effect";

import type { RecordAttachmentOwner } from "../model/core.ts";
import type { RecordAttachmentSpiFailure } from "./errors.ts";
import {
  isRecordAttachmentFamilyDefinition,
  type AnyRecordAttachmentFamilyDefinition,
} from "./family.ts";

const recordAttachmentCatalogTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentCatalog",
);

const catalogs = new WeakSet<object>();

function identity(owner: RecordAttachmentOwner, family: string): string {
  return `${owner}\u0000${family}`;
}

/** Immutable, session-local composition. It is never a process-global registry. */
export interface RecordAttachmentCatalog {
  readonly definitions: readonly AnyRecordAttachmentFamilyDefinition[];
  readonly get: (
    owner: RecordAttachmentOwner,
    family: string,
  ) => AnyRecordAttachmentFamilyDefinition | undefined;
  readonly [recordAttachmentCatalogTypeId]: () => void;
}

export function makeRecordAttachmentCatalog(
  definitions: readonly AnyRecordAttachmentFamilyDefinition[],
): Either.Either<RecordAttachmentCatalog, RecordAttachmentSpiFailure> {
  const ordered = [...definitions].sort((left, right) => {
    const owner = left.owner === right.owner ? 0 : left.owner < right.owner ? -1 : 1;
    return owner === 0
      ? left.family === right.family ? 0 : left.family < right.family ? -1 : 1
      : owner;
  });
  const byIdentity = new Map<string, AnyRecordAttachmentFamilyDefinition>();
  for (const definition of ordered) {
    if (!isRecordAttachmentFamilyDefinition(definition)) {
      return Either.left(Object.freeze({ code: "invalid-family-definition" }));
    }
    const key = identity(definition.owner, definition.family);
    if (byIdentity.has(key)) {
      return Either.left(Object.freeze({
        code: "duplicate-family",
        owner: definition.owner,
        family: definition.family,
      }));
    }
    byIdentity.set(key, definition);
  }
  const catalog: RecordAttachmentCatalog = Object.freeze({
    definitions: Object.freeze(ordered),
    get: (owner: RecordAttachmentOwner, family: string) => byIdentity.get(identity(owner, family)),
    [recordAttachmentCatalogTypeId]: () => undefined,
  });
  catalogs.add(catalog);
  return Either.right(catalog);
}

/** Runtime authority check; copied catalog-shaped objects are not compositions. */
export function isRecordAttachmentCatalog(
  value: unknown,
): value is RecordAttachmentCatalog {
  return typeof value === "object" && value !== null && catalogs.has(value);
}
