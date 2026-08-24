import type { Schema } from "effect";

import {
  defineRecordAttachment,
  defineRecordAttachmentPersistence,
  isRecordAttachmentPersistence,
  registerRecordAttachmentDefinitionAlias,
  type RecordAttachmentDefinition,
  type RecordAttachmentPersistence,
} from "./attachment/protocol.ts";
import type { RecordAttachmentIssue } from "./attachment/errors.ts";
import type { RecordAttachmentOwner } from "./model/core.ts";
import type {
  AttachedContentError,
  AttachedContentRequirements,
  RecordAttachmentSessionBuilder,
} from "./writer/current-attachment.ts";

const recordContributionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordContribution",
);
const recordDefinitionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordDefinition",
);
const recordWriteCommandTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordWriteCommand",
);

type AnySchema = Schema.Schema.AnyNoContext;
type AnyAttachmentDefinition<Owner extends RecordAttachmentOwner = RecordAttachmentOwner> =
  RecordAttachmentDefinition<Owner, string, AnySchema>;
type AnyAttachmentPersistence = RecordAttachmentPersistence<AnyAttachmentDefinition, number>;

interface RecordContributionRuntime {
  readonly attachment: AnyAttachmentDefinition;
  readonly persistence: AnyAttachmentPersistence;
}

interface RecordCommandRuntime {
  readonly definition: object;
  readonly owner: RecordAttachmentOwner;
  readonly input: unknown;
}

const contributions = new WeakMap<object, RecordContributionRuntime>();
const commands = new WeakMap<object, RecordCommandRuntime>();

/** One exact, immutable Record family contribution accepted by a Record Host. */
export interface RecordContribution {
  readonly family: string;
  readonly owner: RecordAttachmentOwner;
  readonly [recordContributionTypeId]: () => void;
}

/** A lazy create-once write command. Constructing it performs no Effect or I/O. */
export interface RecordWriteCommand<
  out Owner extends RecordAttachmentOwner,
  out Value,
  out Error,
  out Requirements,
> {
  readonly [recordWriteCommandTypeId]: () => {
    readonly owner: Owner;
    readonly value: Value;
    readonly error: Error;
    readonly requirements: Requirements;
  };
}

export type AnyRecordDefinition<
  Owner extends RecordAttachmentOwner = RecordAttachmentOwner,
> = RecordDefinition<Owner, string, AnySchema>;

export type RecordDefinitionValue<Definition extends AnyRecordDefinition> =
  Schema.Schema.Type<Definition["schema"]>;

export interface RecordWriteCommandPayload<
  Owner extends RecordAttachmentOwner,
  Value,
> {
  readonly definition: RecordAttachmentDefinition<Owner, string, AnySchema>;
  readonly input: Value | ((build: RecordAttachmentSessionBuilder) => Value);
}

export interface RecordDefinition<
  out Owner extends RecordAttachmentOwner,
  out Family extends string,
  ValueSchema extends AnySchema,
> extends RecordContribution {
  readonly owner: Owner;
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly [recordDefinitionTypeId]: () => { readonly owner: Owner; readonly family: Family };
  <Value extends Schema.Schema.Type<ValueSchema>>(
    input: Value | ((build: RecordAttachmentSessionBuilder) => Value),
  ): RecordWriteCommand<
    Owner,
    Value,
    AttachedContentError<Value>,
    AttachedContentRequirements<Value>
  >;
}

export type AttemptRecordDefinition<
  Family extends string,
  ValueSchema extends AnySchema,
> = RecordDefinition<"attempt", Family, ValueSchema>;

export type RunRecordDefinition<
  Family extends string,
  ValueSchema extends AnySchema,
> = RecordDefinition<"run", Family, ValueSchema>;

function defineRecord<
  const Owner extends RecordAttachmentOwner,
  const Family extends string,
  const ValueSchema extends AnySchema,
>(owner: Owner, input: {
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (
    value: Schema.Schema.Type<ValueSchema>,
  ) => readonly RecordAttachmentIssue[];
}): RecordDefinition<Owner, Family, ValueSchema> {
  const attachment = defineRecordAttachment({ owner, ...input });
  const persistence = defineRecordAttachmentPersistence({
    attachment,
    revision: 1,
    migrations: [],
  });
  const definition = Object.assign(
    (commandInput: unknown) => {
      const command = Object.freeze({
        [recordWriteCommandTypeId]: () => ({
          owner,
          value: undefined,
          error: undefined,
          requirements: undefined,
        }),
      });
      commands.set(command, Object.freeze({
        definition,
        owner,
        input: commandInput,
      }));
      return command;
    },
    {
      owner,
      family: input.family,
      schema: input.schema,
      [recordContributionTypeId]: () => undefined,
      [recordDefinitionTypeId]: () => ({ owner, family: input.family }),
    },
  ) as RecordDefinition<Owner, Family, ValueSchema>;
  Object.freeze(definition);
  registerRecordAttachmentDefinitionAlias(definition, attachment);
  contributions.set(definition, Object.freeze({
    attachment,
    persistence,
  }) as RecordContributionRuntime);
  return definition;
}

export function defineAttemptRecord<
  const Family extends string,
  const ValueSchema extends AnySchema,
>(input: {
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (
    value: Schema.Schema.Type<ValueSchema>,
  ) => readonly RecordAttachmentIssue[];
}): AttemptRecordDefinition<Family, ValueSchema> {
  return defineRecord("attempt", input);
}

export function defineRunRecord<
  const Family extends string,
  const ValueSchema extends AnySchema,
>(input: {
  readonly family: Family;
  readonly schema: ValueSchema;
  readonly validate?: (
    value: Schema.Schema.Type<ValueSchema>,
  ) => readonly RecordAttachmentIssue[];
}): RunRecordDefinition<Family, ValueSchema> {
  return defineRecord("run", input);
}

/** Explicitly adapts the low-level Attachment persistence SPI to Host composition. */
export function recordContributionFromAttachmentPersistence<
  const Definition extends AnyAttachmentDefinition,
  const Revision extends number,
>(
  persistence: RecordAttachmentPersistence<Definition, Revision>,
): RecordContribution {
  if (!isRecordAttachmentPersistence(persistence)) {
    throw new TypeError("Record contribution requires an exact Attachment persistence");
  }
  const contribution = Object.freeze({
    owner: persistence.attachment.owner,
    family: persistence.attachment.family,
    [recordContributionTypeId]: () => undefined,
  });
  contributions.set(contribution, Object.freeze({
    attachment: persistence.attachment,
    persistence,
  }) as RecordContributionRuntime);
  return contribution;
}

/** @internal Host boundary: structural lookalikes never unwrap. */
export function recordContributionRuntime(
  contribution: unknown,
): RecordContributionRuntime | undefined {
  return typeof contribution === "object" || typeof contribution === "function"
    ? contribution !== null ? contributions.get(contribution) : undefined
    : undefined;
}

/** @internal Reader boundary: returns only the private exact Attachment definition. */
export function recordDefinitionAttachment(
  definition: unknown,
): AnyAttachmentDefinition | undefined {
  const runtime = recordContributionRuntime(definition);
  return typeof definition === "function" ? runtime?.attachment : undefined;
}

/** @internal Writer boundary: structural lookalikes never unwrap. */
export function recordWriteCommandRuntime(
  command: unknown,
): RecordCommandRuntime | undefined {
  return typeof command === "object" && command !== null
    ? commands.get(command)
    : undefined;
}

/** @internal Writer boundary: validates command and exact originating definition together. */
export function recordWriteCommandPayload<
  Owner extends RecordAttachmentOwner,
  Value,
  Error,
  Requirements,
>(
  command: RecordWriteCommand<Owner, Value, Error, Requirements>,
  expectedOwner: Owner,
): RecordWriteCommandPayload<Owner, Value> | undefined {
  const runtime = recordWriteCommandRuntime(command);
  const definition = runtime === undefined
    ? undefined
    : recordDefinitionAttachment(runtime.definition);
  if (
    runtime === undefined ||
    definition === undefined ||
    runtime.owner !== expectedOwner ||
    definition.owner !== expectedOwner
  ) return undefined;
  return Object.freeze({
    definition: definition as RecordAttachmentDefinition<Owner, string, AnySchema>,
    input: runtime.input as Value | ((build: RecordAttachmentSessionBuilder) => Value),
  });
}
