import { Either, Schema } from "effect";

import {
  makeRecordAttachmentCatalog,
  type AnyRecordAttachmentFamilyDefinition,
  type AnyRecordAttachmentVersion,
  type RecordAttachmentCatalog,
  type RecordAttachmentFamilyDefinition,
  type RecordAttachmentVersionValue,
} from "../attachment/index.ts";
import { getRecordAttachmentFixedWriteSpec } from "../attachment/internal.ts";
import type {
  FixedAttachmentWriteSpec,
  RecordAttachmentWrite,
} from "../attachment/types.ts";
import { RecordExactParseOptions } from "../codec/core.ts";
import { isRecordAttachmentName } from "../model/identifiers.ts";
import { assertionsRecordAttachment } from "./assertions/definition.ts";
import { agentTurnsRecordAttachment } from "./agent-turns/definition.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./artifacts/definition.ts";
import type { FixedRecordAttachmentOwner } from "./common.ts";
import { fileChangesRecordAttachment } from "./file-changes/definition.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
} from "./runner-activities/definition.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "./runner-diagnostics/definition.ts";
import { sandboxCommandsRecordAttachment } from "./sandbox-commands/definition.ts";
import { sourcesRecordAttachment } from "./sources/definition.ts";
import { turnContextsRecordAttachment } from "./turn-contexts/definition.ts";

/** Official definitions are ordinary branded SPI values, grouped only for composition. */
export const NiceEvalRecordAttachments = Object.freeze({
  assertions: assertionsRecordAttachment,
  agentTurns: agentTurnsRecordAttachment,
  turnContexts: turnContextsRecordAttachment,
  sandboxCommands: sandboxCommandsRecordAttachment,
  runnerActivities: Object.freeze({
    attempt: attemptRunnerActivitiesRecordAttachment,
    run: runRunnerActivitiesRecordAttachment,
  }),
  runnerDiagnostics: Object.freeze({
    attempt: attemptRunnerDiagnosticsRecordAttachment,
    run: runRunnerDiagnosticsRecordAttachment,
  }),
  fileChanges: fileChangesRecordAttachment,
  sources: sourcesRecordAttachment,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordAttachment,
    run: runArtifactsRecordAttachment,
  }),
});

/** Explicit immutable official composition; no registry or module side effect is involved. */
export const NiceEvalRecordAttachmentDefinitions = Object.freeze([
  NiceEvalRecordAttachments.assertions,
  NiceEvalRecordAttachments.agentTurns,
  NiceEvalRecordAttachments.turnContexts,
  NiceEvalRecordAttachments.sandboxCommands,
  NiceEvalRecordAttachments.runnerActivities.attempt,
  NiceEvalRecordAttachments.runnerActivities.run,
  NiceEvalRecordAttachments.runnerDiagnostics.attempt,
  NiceEvalRecordAttachments.runnerDiagnostics.run,
  NiceEvalRecordAttachments.fileChanges,
  NiceEvalRecordAttachments.sources,
  NiceEvalRecordAttachments.artifacts.attempt,
  NiceEvalRecordAttachments.artifacts.run,
] as const);

function requireCatalog(
  result: Either.Either<RecordAttachmentCatalog, unknown>,
): RecordAttachmentCatalog {
  if (Either.isLeft(result)) {
    throw new Error("NiceEval official Record Attachment catalog is invalid");
  }
  return result.right;
}

export const NiceEvalRecordAttachmentCatalog = requireCatalog(
  makeRecordAttachmentCatalog(NiceEvalRecordAttachmentDefinitions),
);

/** Family identities and source subsets derive from the composed definitions. */
export const NICE_EVAL_FAMILIES = Object.freeze([
  NiceEvalRecordAttachments.assertions.family,
  NiceEvalRecordAttachments.agentTurns.family,
  NiceEvalRecordAttachments.turnContexts.family,
  NiceEvalRecordAttachments.sandboxCommands.family,
  NiceEvalRecordAttachments.runnerActivities.attempt.family,
  NiceEvalRecordAttachments.runnerDiagnostics.attempt.family,
  NiceEvalRecordAttachments.fileChanges.family,
  NiceEvalRecordAttachments.sources.family,
  NiceEvalRecordAttachments.artifacts.attempt.family,
] as const);

export const NICE_EVAL_OBSERVABILITY_SOURCE_FAMILIES = Object.freeze([
  NiceEvalRecordAttachments.agentTurns.family,
  NiceEvalRecordAttachments.turnContexts.family,
  NiceEvalRecordAttachments.sandboxCommands.family,
  NiceEvalRecordAttachments.runnerActivities.attempt.family,
  NiceEvalRecordAttachments.runnerDiagnostics.attempt.family,
] as const);

export type NiceEvalFamily = (typeof NICE_EVAL_FAMILIES)[number];

export const NiceEvalFamilySchema: Schema.Schema<NiceEvalFamily> = Schema.Literal(
  ...NICE_EVAL_FAMILIES,
);

type DefinitionValue<Definition> =
  Definition extends RecordAttachmentFamilyDefinition<
    FixedRecordAttachmentOwner,
    string,
    infer Current
  >
    ? RecordAttachmentVersionValue<Current>
    : never;

/** @internal Existing Host descriptor, derived from one branded SPI definition. */
export interface FixedRecordFamilyDescriptor<
  Family extends string,
  Owner extends FixedRecordAttachmentOwner,
  Payload,
> {
  readonly definition: RecordAttachmentFamilyDefinition<Owner, Family, AnyRecordAttachmentVersion>;
  readonly family: Family;
  readonly schemaVersion: number;
  readonly owner: Owner;
  readonly write: FixedAttachmentWriteSpec<Owner, Payload>;
  readonly adjacentMigrationLinks: readonly {
    readonly fromSchemaVersion: number;
    readonly toSchemaVersion: number;
  }[];
}

function fixedFamily<
  const Definition extends AnyRecordAttachmentFamilyDefinition,
>(
  definition: Definition,
): FixedRecordFamilyDescriptor<
  Definition["family"],
  Definition["owner"],
  DefinitionValue<Definition>
> {
  return Object.freeze({
    definition,
    family: definition.family,
    schemaVersion: definition.schemaVersion,
    owner: definition.owner,
    write: getRecordAttachmentFixedWriteSpec(definition),
    adjacentMigrationLinks: Object.freeze(definition.migrations.map((migration) => Object.freeze({
      fromSchemaVersion: migration.from.version,
      toSchemaVersion: migration.to.version,
    }))),
  }) as FixedRecordFamilyDescriptor<
    Definition["family"],
    Definition["owner"],
    DefinitionValue<Definition>
  >;
}

export interface RecordFamilyDescriptorCatalog {
  readonly attachments: RecordAttachmentCatalog;
  readonly get: (
    owner: FixedRecordAttachmentOwner,
    family: string,
  ) => FixedRecordFamilyDescriptor<string, FixedRecordAttachmentOwner, unknown> | undefined;
  readonly descriptor: (
    definition: AnyRecordAttachmentFamilyDefinition,
  ) => FixedRecordFamilyDescriptor<string, FixedRecordAttachmentOwner, unknown> | undefined;
  readonly byOwner: Readonly<{
    readonly attempt: readonly FixedRecordFamilyDescriptor<
      string,
      "attempt",
      unknown
    >[];
    readonly run: readonly FixedRecordFamilyDescriptor<string, "run", unknown>[];
  }>;
}

function descriptorIdentity(owner: FixedRecordAttachmentOwner, family: string): string {
  return `${owner}\u0000${family}`;
}

/**
 * Derive the Host's immutable runtime view from one explicit SPI catalog.
 * Host code never selects a definition by a concrete family string.
 */
export function deriveRecordFamilyDescriptorCatalog(
  attachments: RecordAttachmentCatalog,
): RecordFamilyDescriptorCatalog {
  const descriptors = attachments.definitions.map((definition) => fixedFamily(
    definition,
  )) as readonly FixedRecordFamilyDescriptor<
    string,
    FixedRecordAttachmentOwner,
    unknown
  >[];
  const byIdentity = new Map(descriptors.map((descriptor) => [
    descriptorIdentity(descriptor.owner, descriptor.family),
    descriptor,
  ] as const));
  const byDefinition = new WeakMap<object, FixedRecordFamilyDescriptor<
    string,
    FixedRecordAttachmentOwner,
    unknown
  >>();
  descriptors.forEach((descriptor) => byDefinition.set(descriptor.definition, descriptor));
  const attempt = Object.freeze(descriptors.filter((descriptor) =>
    descriptor.owner === "attempt"
  )) as readonly FixedRecordFamilyDescriptor<string, "attempt", unknown>[];
  const run = Object.freeze(descriptors.filter((descriptor) =>
    descriptor.owner === "run"
  )) as readonly FixedRecordFamilyDescriptor<string, "run", unknown>[];
  return Object.freeze({
    attachments,
    get: (owner: FixedRecordAttachmentOwner, family: string) =>
      byIdentity.get(descriptorIdentity(owner, family)),
    descriptor: (definition: AnyRecordAttachmentFamilyDefinition) =>
      byDefinition.get(definition),
    byOwner: Object.freeze({ attempt, run }),
  });
}

export const assertionsRecordFamily = fixedFamily(
  NiceEvalRecordAttachments.assertions,
);
export const agentTurnsRecordFamily = fixedFamily(NiceEvalRecordAttachments.agentTurns);
export const turnContextsRecordFamily = fixedFamily(NiceEvalRecordAttachments.turnContexts);
export const sandboxCommandsRecordFamily = fixedFamily(NiceEvalRecordAttachments.sandboxCommands);
export const attemptRunnerActivitiesRecordFamily = fixedFamily(
  NiceEvalRecordAttachments.runnerActivities.attempt,
);
export const runRunnerActivitiesRecordFamily = fixedFamily(
  NiceEvalRecordAttachments.runnerActivities.run,
);
export const attemptRunnerDiagnosticsRecordFamily = fixedFamily(
  NiceEvalRecordAttachments.runnerDiagnostics.attempt,
);
export const runRunnerDiagnosticsRecordFamily = fixedFamily(
  NiceEvalRecordAttachments.runnerDiagnostics.run,
);
export const fileChangesRecordFamily = fixedFamily(NiceEvalRecordAttachments.fileChanges);
export const sourcesRecordFamily = fixedFamily(NiceEvalRecordAttachments.sources);
export const attemptArtifactsRecordFamily = fixedFamily(NiceEvalRecordAttachments.artifacts.attempt);
export const runArtifactsRecordFamily = fixedFamily(NiceEvalRecordAttachments.artifacts.run);

/** @internal Existing Host view; every member is derived from the SPI catalog above. */
export const NiceEvalRecordFamilyCatalog = Object.freeze({
  assertions: assertionsRecordFamily,
  agentTurns: agentTurnsRecordFamily,
  turnContexts: turnContextsRecordFamily,
  sandboxCommands: sandboxCommandsRecordFamily,
  runnerActivities: Object.freeze({
    attempt: attemptRunnerActivitiesRecordFamily,
    run: runRunnerActivitiesRecordFamily,
  }),
  runnerDiagnostics: Object.freeze({
    attempt: attemptRunnerDiagnosticsRecordFamily,
    run: runRunnerDiagnosticsRecordFamily,
  }),
  fileChanges: fileChangesRecordFamily,
  sources: sourcesRecordFamily,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordFamily,
    run: runArtifactsRecordFamily,
  }),
});

export const NiceEvalRecordFamilyDescriptorsByOwner = Object.freeze({
  attempt: Object.freeze([
    assertionsRecordFamily,
    agentTurnsRecordFamily,
    turnContextsRecordFamily,
    sandboxCommandsRecordFamily,
    attemptRunnerActivitiesRecordFamily,
    attemptRunnerDiagnosticsRecordFamily,
    fileChangesRecordFamily,
    attemptArtifactsRecordFamily,
  ]),
  run: Object.freeze([
    runRunnerActivitiesRecordFamily,
    runRunnerDiagnosticsRecordFamily,
    sourcesRecordFamily,
    runArtifactsRecordFamily,
  ]),
});

export const FixedRecordAttachmentEnvelopeSchema: Schema.Schema<{
  readonly family: string;
  readonly schemaVersion: number;
}> = Schema.Struct({
  family: Schema.String.pipe(Schema.filter(isRecordAttachmentName)),
  schemaVersion: Schema.Int.pipe(Schema.positive()),
});

export function decodeFixedRecordAttachmentEnvelope(input: unknown): Either.Either<
  { readonly family: string; readonly schemaVersion: number },
  { readonly code: "record-fixed-family-envelope-invalid" }
> {
  const decoded = Schema.decodeUnknownEither(FixedRecordAttachmentEnvelopeSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "record-fixed-family-envelope-invalid" as const }))
    : Either.right(decoded.right);
}

export function encodeFixedRecordAttachmentEnvelope(
  envelope: { readonly family: string; readonly schemaVersion: number },
): Either.Either<
  { readonly family: string; readonly schemaVersion: number },
  { readonly code: "record-fixed-family-envelope-invalid" }
> {
  const encoded = Schema.encodeUnknownEither(FixedRecordAttachmentEnvelopeSchema, RecordExactParseOptions)(envelope);
  return Either.isLeft(encoded)
    ? Either.left(Object.freeze({ code: "record-fixed-family-envelope-invalid" as const }))
    : Either.right(encoded.right);
}

type DescriptorPayload<Descriptor> =
  Descriptor extends FixedRecordFamilyDescriptor<
    NiceEvalFamily,
    FixedRecordAttachmentOwner,
    infer Payload
  >
    ? Payload
    : never;

export type FixedRecordFamilyPayload =
  | DescriptorPayload<typeof assertionsRecordFamily>
  | DescriptorPayload<typeof agentTurnsRecordFamily>
  | DescriptorPayload<typeof turnContextsRecordFamily>
  | DescriptorPayload<typeof sandboxCommandsRecordFamily>
  | DescriptorPayload<typeof attemptRunnerActivitiesRecordFamily>
  | DescriptorPayload<typeof runRunnerActivitiesRecordFamily>
  | DescriptorPayload<typeof attemptRunnerDiagnosticsRecordFamily>
  | DescriptorPayload<typeof runRunnerDiagnosticsRecordFamily>
  | DescriptorPayload<typeof fileChangesRecordFamily>
  | DescriptorPayload<typeof sourcesRecordFamily>
  | DescriptorPayload<typeof attemptArtifactsRecordFamily>
  | DescriptorPayload<typeof runArtifactsRecordFamily>;

export type FixedRecordFamilyWrite<
  Owner extends FixedRecordAttachmentOwner,
  Error = never,
  Requirements = never,
> = RecordAttachmentWrite<Owner, Error, Requirements>;
