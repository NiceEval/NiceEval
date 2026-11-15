import { Effect, Schema } from "effect";
import type { CommandPlan, CommandPlanStep, BeforeCachePlan } from "../../../runner/command-plan.ts";
import { isJsonValue } from "../../../shared/json-value.ts";
import type { JsonValue } from "../../../shared/types.ts";

function optionalFact<S extends Schema.Constraint>(schema: S) {
  return Schema.UndefinedOr(schema).pipe(Schema.withDecodingDefault(Effect.succeed(undefined)));
}

const OwnerSchema = Schema.Struct({
  kind: Schema.Literals(["eval", "eval-group", "experiment", "adapter", "agent", "provider"]),
  id: Schema.String,
  index: optionalFact(Schema.Number),
});
const ScheduleOwnerSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["eval", "eval-group", "experiment"]), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("agent"), id: Schema.String }),
]);

const ReasonSchema = Schema.Struct({ code: Schema.String, summary: Schema.String });
const ConditionSchema = ReasonSchema;
const ActionStateSchema = Schema.Literals(["all", "dockerData"]);
const JsonValueSchema = Schema.declare<JsonValue>(isJsonValue);

const LocatorFieldNameSchema = Schema.Literals([
  "image",
  "context",
  "file",
  "target",
  "workspaceService",
  "template",
  "templateId",
  "snapshotId",
  "dir",
]);
const LocatorFieldSchema = Schema.Struct({ name: LocatorFieldNameSchema, value: Schema.String });
const LocatorSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Exact"), fields: Schema.NonEmptyArray(LocatorFieldSchema) }),
  Schema.Struct({
    _tag: Schema.Literal("Redacted"),
    fields: Schema.NonEmptyArray(LocatorFieldSchema),
    redactions: Schema.Array(
      Schema.Struct({
        field: LocatorFieldNameSchema,
        parts: Schema.Array(Schema.Literals(["userinfo", "query", "fragment"])),
      }),
    ),
  }),
  Schema.Struct({ _tag: Schema.Literal("Opaque"), reason: ReasonSchema }),
]);

const CommandSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("argv"),
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: optionalFact(Schema.String),
    user: optionalFact(Schema.String),
    timeoutMs: optionalFact(Schema.Number),
    envKeys: optionalFact(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal("shell"),
    script: Schema.String,
    cwd: optionalFact(Schema.String),
    user: optionalFact(Schema.String),
    timeoutMs: optionalFact(Schema.Number),
    envKeys: optionalFact(Schema.Array(Schema.String)),
  }),
]);

const ExecStepFields = {
  kind: Schema.Literal("exec"),
  executable: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: optionalFact(Schema.String),
  user: optionalFact(Schema.String),
  timeoutMs: optionalFact(Schema.Number),
  envKeys: optionalFact(Schema.Array(Schema.String)),
};
const ActionStepSchema = Schema.Union([
  Schema.Union([
    Schema.Struct({
      ...ExecStepFields,
      stdinDigest: optionalFact(Schema.Undefined),
      stdinBytes: optionalFact(Schema.Undefined),
    }),
    Schema.Struct({ ...ExecStepFields, stdinDigest: Schema.String, stdinBytes: Schema.Number }),
  ]),
  Schema.Struct({ kind: Schema.Literal("putText"), path: Schema.String, digest: Schema.String, bytes: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("putBytes"), path: Schema.String, digest: Schema.String, bytes: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literals(["transferFile", "transferDirectory"]),
    source: Schema.Struct({ kind: Schema.Literal("content"), digest: Schema.String }),
    to: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("checkoutGit"),
    repository: Schema.String,
    ref: Schema.String,
    to: Schema.String,
    sparse: optionalFact(Schema.Struct({ include: Schema.Array(Schema.String), exclude: Schema.Array(Schema.String) })),
  }),
]);

const ActionSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    label: optionalFact(Schema.String),
    family: Schema.String,
    state: ActionStateSchema,
    input: JsonValueSchema,
    steps: Schema.Array(ActionStepSchema),
    fingerprint: Schema.Struct({ automatic: Schema.String, supplemental: Schema.String, combined: Schema.String }),
    kind: Schema.Literal("action"),
  }),
  Schema.Struct({ id: Schema.String, kind: Schema.Literals(["command", "callback"]) }),
]);

const CacheEligibilitySchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("eligible") }),
  Schema.Struct({
    status: Schema.Literal("ineligible"),
    reason: Schema.Struct({
      code: Schema.Literals([
        "opaque-action",
        "opaque-ancestor",
        "provider-unsupported",
        "unsupported-state",
        "unsupported-state-ancestor",
      ]),
    }),
  }),
]);

const CacheSchema = Schema.Struct({
  lookup: Schema.Literal("not-probed"),
  capability: Schema.Literals(["run-prepared", "attempt-captured", "unsupported"]),
  prefixIdentity: optionalFact(Schema.String),
  capabilityReason: optionalFact(Schema.String),
  runtime: Schema.Struct({ status: Schema.Literal("pending"), finalKey: Schema.Literal("not-probed") }),
  eligibility: CacheEligibilitySchema,
  state: Schema.Struct({
    declared: Schema.Union([ActionStateSchema, Schema.Literal("opaque")]),
    cumulative: Schema.Union([ActionStateSchema, Schema.Literal("opaque")]),
    providerCoverage: Schema.Union([ActionStateSchema, Schema.Literal("unsupported")]),
    barrier: Schema.Literals([
      "none",
      "opaque-action",
      "opaque-ancestor",
      "provider-unsupported",
      "unsupported-state",
      "unsupported-state-ancestor",
    ]),
    barrierActionId: optionalFact(Schema.String),
  }),
});

const CommandPlanStepSchema: Schema.Codec<CommandPlanStep, unknown> = Schema.suspend(() => {
  const common = {
    phase: Schema.String,
    label: optionalFact(Schema.String),
    owner: optionalFact(OwnerSchema),
    condition: optionalFact(ConditionSchema),
  };
  const scheduled = {
    action: ActionSchema,
    declarationOrder: Schema.Struct({ owner: ScheduleOwnerSchema, ordinal: Schema.Number }),
    executionOrder: Schema.Struct({
      topologicalOrdinal: Schema.Number,
      occurrencePath: Schema.Array(Schema.String),
    }),
    changeFrequency: Schema.Struct({
      value: Schema.Number,
      source: Schema.Literals(["explicit", "defaulted"]),
      preset: optionalFact(Schema.Literals(["rare", "normal", "frequent"])),
    }),
    schedulingReason: Schema.String,
    dependencies: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        source: Schema.Literals(["explicit", "capability", "same-layer"]),
        capability: optionalFact(Schema.String),
      }),
    ),
    occurrence: Schema.Struct({ kind: Schema.Literal("attempt") }),
    cache: CacheSchema,
  };
  function operation<const F extends Schema.Struct.Fields>(fields: F) {
    return Schema.Union([
      Schema.Struct({ ...common, ...fields }),
      Schema.Struct({ ...common, ...fields, ...scheduled }),
    ]);
  }
  return Schema.Union([
    operation({
      truth: Schema.Literal("exact"),
      command: CommandSchema,
      redactions: optionalFact(
        Schema.Array(Schema.Literals(["env-values", "header-values", "stdin", "sensitive-values", "command"])),
      ),
    }),
    operation({
      truth: Schema.Literal("exact"),
      action: ActionSchema,
      scriptSource: optionalFact(Schema.Struct({ path: Schema.String, digest: Schema.String, bytes: Schema.Number })),
    }),
    operation({ truth: Schema.Literal("conditional"), children: Schema.Array(CommandPlanStepSchema) }),
    operation({ truth: Schema.Literal("opaque"), reason: ReasonSchema }),
    operation({
      truth: Schema.Literal("opaque"),
      reason: ReasonSchema,
      template: Schema.Struct({
        owner: OwnerSchema,
        provider: Schema.String,
        kind: Schema.String,
        locator: LocatorSchema,
      }),
    }),
    operation({ truth: Schema.Literal("known-no-command"), reason: optionalFact(ReasonSchema) }),
  ]);
});

const SlotSchema = Schema.Struct({
  evalId: Schema.String,
  attempt: Schema.Number,
  action: Schema.Literals(["carried", "dispatch"]),
  activation: optionalFact(ConditionSchema),
  steps: Schema.Array(CommandPlanStepSchema),
});
const PhysicalLifecycleTemplateSchema = Schema.Struct({
  appliesTo: Schema.Literal("each-physical-instance"),
  enter: Schema.Array(CommandPlanStepSchema),
  exit: Schema.Array(CommandPlanStepSchema),
});
const LaneSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("eval"),
    ordering: Schema.Literal("independent"),
    slots: Schema.Array(SlotSchema),
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("sandbox-reuse"),
    ordering: Schema.Literal("independent"),
    scope: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("shared") }),
      Schema.Struct({ kind: Schema.Literal("eval"), evalId: Schema.String }),
    ]),
    physicalLifecycleTemplate: optionalFact(PhysicalLifecycleTemplateSchema),
    slots: Schema.Array(SlotSchema),
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("eval-group"),
    ordering: Schema.Literal("serial-normalized-eval-id"),
    beforeSlots: Schema.Array(CommandPlanStepSchema),
    afterSlots: Schema.Array(CommandPlanStepSchema),
    physicalLifecycleTemplate: optionalFact(PhysicalLifecycleTemplateSchema),
    slots: Schema.Array(SlotSchema),
  }),
]);

const CommandPlanSchema: Schema.Codec<CommandPlan, unknown> = Schema.Struct({
  completeness: Schema.Literals(["complete", "partial"]),
  opaqueCount: Schema.Number,
  redactedCount: Schema.Number,
  experiments: Schema.Array(
    Schema.Struct({
      experimentId: Schema.String,
      activation: Schema.Literals(["conditional", "inactive"]),
      beforeLanes: Schema.Array(CommandPlanStepSchema),
      lanes: Schema.Array(LaneSchema),
      afterLanes: Schema.Array(CommandPlanStepSchema),
    }),
  ),
});

const BeforeCachePlanSchema: Schema.Codec<BeforeCachePlan> = Schema.Struct({
  lookup: Schema.Literal("not-probed"),
  nodes: Schema.Array(
    Schema.Struct({
      prefixIdentity: Schema.String,
      lookup: Schema.Literal("not-probed"),
      capability: Schema.Literals(["run-prepared", "attempt-captured", "unsupported"]),
      eligibility: CacheEligibilitySchema,
      consumers: Schema.Array(Schema.Struct({ experimentId: Schema.String, evalId: Schema.String })),
    }),
  ),
});

/** Current-candidate machine document emitted by `niceeval debug --json`; it intentionally has no version envelope. */
export const DebugPlanDocumentSchema = Schema.Struct({
  experimentId: Schema.String,
  evalId: Schema.optional(Schema.String),
  evalIds: Schema.Array(Schema.String),
  beforeCachePlan: BeforeCachePlanSchema,
  commandPlan: CommandPlanSchema,
});

/** Describes the readonly debug plan before Sandbox creation; planned commands and cache eligibility are declarations rather than proof of execution or a cache hit. */
export type DebugPlanDocument = Schema.Schema.Type<typeof DebugPlanDocumentSchema>;

/** Strictly decode the current candidate's sole `niceeval debug --json` document. */
export function decodeDebugPlanDocument(input: unknown): DebugPlanDocument {
  return Schema.decodeUnknownSync(DebugPlanDocumentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
