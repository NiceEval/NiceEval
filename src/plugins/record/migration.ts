import { Either } from "effect";
import type {
  AnyRecordAttachmentFamily,
  RecordAttachmentRegistry,
  RecordAttachmentRegistryError,
} from "../../record/attachment/index.ts";
import { defineRecordAttachmentRegistry } from "../../record/attachment/internal.ts";
import {
  pluginAttachmentCapabilityFamily,
  type PluginAttachmentCapability,
} from "./capability.ts";
import type { PluginRecordOwner } from "./model.ts";

export interface PluginAttachmentMigrationCapabilityInvalid {
  readonly code: "plugin-attachment-migration-capability-invalid";
  readonly index: number;
}

export type PluginAttachmentMigrationRegistryError =
  | PluginAttachmentMigrationCapabilityInvalid
  | RecordAttachmentRegistryError;

export interface DefinePluginAttachmentMigrationRegistryInput {
  /**
   * An application explicitly selects the declared Plugin families it trusts
   * for migration. This adapter never discovers packages or invokes a Plugin.
   */
  readonly attachments: readonly PluginAttachmentCapability<
    PluginRecordOwner,
    unknown
  >[];
}

/**
 * Adapt explicit Plugin declaration capabilities to Record's generic family
 * registry. The generic registry remains the single authority for identity,
 * adjacent migration edges, and duplicate family rejection.
 */
export function definePluginAttachmentMigrationRegistry(
  input: DefinePluginAttachmentMigrationRegistryInput,
): Either.Either<RecordAttachmentRegistry, PluginAttachmentMigrationRegistryError> {
  if (!Array.isArray(input.attachments)) {
    return Either.left(Object.freeze({
      code: "plugin-attachment-migration-capability-invalid" as const,
      index: -1,
    }));
  }

  const families: AnyRecordAttachmentFamily[] = [];
  for (const [index, capability] of input.attachments.entries()) {
    const family = pluginAttachmentCapabilityFamily(capability);
    if (family === undefined) {
      return Either.left(Object.freeze({
        code: "plugin-attachment-migration-capability-invalid" as const,
        index,
      }));
    }
    // Capability creation has already verified a genuine Run/Attempt family.
    families.push(family as AnyRecordAttachmentFamily);
  }
  return defineRecordAttachmentRegistry({ families });
}
