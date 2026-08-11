import { Context, Either, Schema } from "effect";
import type { RecordAttachmentRegistry } from "../attachment/types.ts";
import { RecordExactParseOptions } from "../codec/core.ts";
import { RecordFormatIdSchema } from "../codec/identifiers.ts";
import type { RecordCoreV1 } from "../model/core.ts";
import type { RecordFormatId } from "../model/identifiers.ts";
import { RECORD_FORMAT_V1 } from "../model/identifiers.ts";
import {
  areAdjacentRecordFormats,
  recordFormatMajor,
} from "./identity.ts";
import {
  recordCoreMigrationRegistryInvalid,
  recordCoreMigrationRegistryIssue,
  type RecordCoreMigrationRegistryInvalid,
  type RecordCoreMigrationRegistryIssue,
} from "./errors.ts";
import type {
  RecordCoreMigrationEdge,
  RecordCoreMigrationRegistryInput,
} from "./types.ts";
import type { RecordMigrationStorage } from "./internal.ts";
import { CurrentRecordMigrationStorage } from "./storage.ts";

export type RecordCoreMigrationResolution<CoreValue> =
  | { readonly state: "current" }
  | {
      readonly state: "migration-required";
      readonly edges: readonly RecordCoreMigrationEdge<CoreValue>[];
    }
  | {
      readonly state: "migration-edge-missing";
      readonly from: RecordFormatId;
      readonly to: RecordFormatId;
    }
  | { readonly state: "unsupported" };

function freezeArray<Value>(items: readonly Value[]): readonly Value[] {
  return Object.freeze([...items]);
}

/**
 * Pure Core-major graph. It does not claim future formats exist: v1 can be the
 * current format with an empty edge list. When future formats are registered,
 * every edge remains one major wide and the graph remains unbranched.
 */
export class RecordCoreMigrationRegistry<CoreValue> {
  readonly #edgesByFrom: ReadonlyMap<string, RecordCoreMigrationEdge<CoreValue>>;

  private constructor(
    readonly currentFormat: RecordFormatId,
    edgesByFrom: ReadonlyMap<string, RecordCoreMigrationEdge<CoreValue>>,
  ) {
    this.#edgesByFrom = edgesByFrom;
    Object.freeze(this);
  }

  static make<CoreValue>(
    input: RecordCoreMigrationRegistryInput<CoreValue>,
  ): Either.Either<
    RecordCoreMigrationRegistry<CoreValue>,
    RecordCoreMigrationRegistryInvalid
  > {
    const issues: RecordCoreMigrationRegistryIssue[] = [];
    const currentMajor = recordFormatMajor(input.currentFormat);
    if (currentMajor === undefined) {
      issues.push(
        recordCoreMigrationRegistryIssue("record-core-migration-edge-invalid", [
          "currentFormat",
        ]),
      );
    }

    const byFrom = new Map<string, RecordCoreMigrationEdge<CoreValue>>();
    const byTo = new Map<string, RecordCoreMigrationEdge<CoreValue>>();
    for (const [index, edge] of input.edges.entries()) {
      const path = ["edges", String(index)];
      if (!areAdjacentRecordFormats(edge.from, edge.to)) {
        issues.push(
          recordCoreMigrationRegistryIssue("record-core-migration-edge-invalid", path),
        );
        continue;
      }
      const targetMajor = recordFormatMajor(edge.to);
      if (targetMajor === undefined || currentMajor === undefined || targetMajor > currentMajor) {
        issues.push(
          recordCoreMigrationRegistryIssue("record-core-migration-edge-invalid", path),
        );
        continue;
      }
      if (typeof edge.convert !== "function") {
        issues.push(
          recordCoreMigrationRegistryIssue("record-core-migration-edge-invalid", [
            ...path,
            "convert",
          ]),
        );
        continue;
      }
      const normalized = Object.freeze({
        from: edge.from,
        to: edge.to,
        convert: edge.convert,
      });
      const previousFrom = byFrom.get(normalized.from);
      if (previousFrom !== undefined) {
        issues.push(
          recordCoreMigrationRegistryIssue(
            previousFrom.to === normalized.to
              ? "record-core-migration-edge-duplicate"
              : "record-core-migration-edge-fork",
            path,
          ),
        );
        continue;
      }
      if (byTo.has(normalized.to)) {
        issues.push(
          recordCoreMigrationRegistryIssue("record-core-migration-edge-fork", path),
        );
        continue;
      }
      byFrom.set(normalized.from, normalized);
      byTo.set(normalized.to, normalized);
    }

    if (issues.length > 0) {
      return Either.left(recordCoreMigrationRegistryInvalid(issues));
    }
    return Either.right(new RecordCoreMigrationRegistry(input.currentFormat, byFrom));
  }

  resolve(from: RecordFormatId): RecordCoreMigrationResolution<CoreValue> {
    if (from === this.currentFormat) {
      return Object.freeze({ state: "current" });
    }
    const sourceMajor = recordFormatMajor(from);
    const targetMajor = recordFormatMajor(this.currentFormat);
    if (
      sourceMajor === undefined ||
      targetMajor === undefined ||
      sourceMajor >= targetMajor
    ) {
      return Object.freeze({ state: "unsupported" });
    }

    const edges: RecordCoreMigrationEdge<CoreValue>[] = [];
    let current = from;
    while (current !== this.currentFormat) {
      const edge = this.#edgesByFrom.get(current);
      if (edge === undefined) {
        return Object.freeze({
          state: "migration-edge-missing",
          from: current,
          to: this.currentFormat,
        });
      }
      edges.push(edge);
      current = edge.to;
    }
    return Object.freeze({
      state: "migration-required",
      edges: freezeArray(edges),
    });
  }
}

export function makeRecordCoreMigrationRegistry<CoreValue>(
  input: RecordCoreMigrationRegistryInput<CoreValue>,
): Either.Either<
  RecordCoreMigrationRegistry<CoreValue>,
  RecordCoreMigrationRegistryInvalid
> {
  return RecordCoreMigrationRegistry.make(input);
}

/**
 * Today's installed Core is v1. Its registry deliberately has no imaginary
 * future converters; later releases add adjacent edges only when their formats
 * are actually introduced.
 */
export const CurrentRecordCoreMigrationRegistry: RecordCoreMigrationRegistry<RecordCoreV1> =
  (() => {
    const currentFormat = Schema.decodeUnknownEither(
      RecordFormatIdSchema,
      RecordExactParseOptions,
    )(RECORD_FORMAT_V1);
    if (Either.isLeft(currentFormat)) {
      throw new Error("The built-in Record v1 format identity is invalid");
    }
    const built = RecordCoreMigrationRegistry.make<RecordCoreV1>({
      currentFormat: currentFormat.right,
      edges: [],
    });
    if (Either.isLeft(built)) {
      throw new Error("The built-in Record v1 migration registry is invalid");
    }
    return built.right;
  })();

/**
 * Installed migration capabilities live at the application composition edge.
 * Public plan/run calls only name a Record root; the current Core registry,
 * selected Attachment families, and current-layout storage stay behind this
 * Effect service.
 */
export interface RecordMigrationRegistryService {
  readonly core: RecordCoreMigrationRegistry<RecordCoreV1>;
  readonly attachments: RecordAttachmentRegistry;
  readonly storage: RecordMigrationStorage<RecordCoreV1>;
}

export class RecordMigrationRegistry extends Context.Tag(
  "@niceeval/record/RecordMigrationRegistry",
)<RecordMigrationRegistry, RecordMigrationRegistryService>() {}

/**
 * Compose today's concrete v1 storage with the Attachment families selected
 * by the application. The public plan/run API never asks callers to pass the
 * three internals individually.
 */
export function makeCurrentRecordMigrationRegistry(input: {
  readonly attachments: RecordAttachmentRegistry;
}): RecordMigrationRegistryService {
  return Object.freeze({
    core: CurrentRecordCoreMigrationRegistry,
    attachments: input.attachments,
    storage: CurrentRecordMigrationStorage,
  });
}
