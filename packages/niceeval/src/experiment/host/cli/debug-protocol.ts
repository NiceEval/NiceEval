import { Schema } from "effect";
import type {
  CommandPlan,
  CommandPlanStep,
  SetupPrefixPlan,
} from "../../../runner/command-plan.ts";
import { isJsonValue } from "../../../shared/json-value.ts";
import type { JsonValue } from "../../../shared/types.ts";

const OwnerSchema = Schema.Struct({
  kind: Schema.Literals(["eval", "eval-group", "experiment", "agent", "provider"]),
  id: Schema.String,
  index: Schema.optional(Schema.Number),
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
  "snapshotId",
  "dir",
]);
const LocatorFieldSchema = Schema.Struct({ name: LocatorFieldNameSchema, value: Schema.String });
const LocatorSchema = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Exact"), fields: Schema.NonEmptyArray(LocatorFieldSchema) }),
  Schema.Struct({
    _tag: Schema.Literal("Redacted"),
    fields: Schema.NonEmptyArray(LocatorFieldSchema),
    redactions: Schema.Array(Schema.Struct({
      field: LocatorFieldNameSchema,
      parts: Schema.Array(Schema.Literals(["userinfo", "query", "fragment"])),
    })),
  }),
  Schema.Struct({ _tag: Schema.Literal("Opaque"), reason: ReasonSchema }),
]);

const CommandSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("argv"),
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.optional(Schema.String),
    user: Schema.optional(Schema.String),
    timeoutMs: Schema.optional(Schema.Number),
    envKeys: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal("shell"),
    script: Schema.String,
    cwd: Schema.optional(Schema.String),
    user: Schema.optional(Schema.String),
    timeoutMs: Schema.optional(Schema.Number),
    envKeys: Schema.optional(Schema.Array(Schema.String)),
  }),
]);

const ActionStepSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("exec"),
    executable: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.optional(Schema.String),
    user: Schema.optional(Schema.String),
    timeoutMs: Schema.optional(Schema.Number),
    envKeys: Schema.optional(Schema.Array(Schema.String)),
    stdinDigest: Schema.optional(Schema.String),
    stdinBytes: Schema.optional(Schema.Number),
  }),
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
    sparse: Schema.optional(Schema.Struct({ include: Schema.Array(Schema.String), exclude: Schema.Array(Schema.String) })),
  }),
]);

const ActionSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    family: Schema.String,
    state: ActionStateSchema,
    input: JsonValueSchema,
    steps: Schema.Array(ActionStepSchema),
    fingerprint: Schema.Struct({ automatic: Schema.String, supplemental: Schema.String, combined: Schema.String }),
    kind: Schema.optional(Schema.Literals(["action", "command"])),
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
  capability: Schema.Literals(["persistent", "invocation-local", "unsupported"]),
  prefixIdentity: Schema.optional(Schema.String),
  capabilityReason: Schema.optional(Schema.String),
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
    barrierActionId: Schema.optional(Schema.String),
  }),
});

const CommandPlanStepSchema: Schema.Codec<CommandPlanStep> = Schema.suspend(() => Schema.Struct({
  phase: Schema.String,
  label: Schema.optional(Schema.String),
  owner: Schema.optional(OwnerSchema),
  truth: Schema.Literals(["exact", "conditional", "opaque", "known-no-command"]),
  condition: Schema.optional(ConditionSchema),
  reason: Schema.optional(ReasonSchema),
  template: Schema.optional(Schema.Struct({
    owner: OwnerSchema,
    provider: Schema.String,
    kind: Schema.String,
    locator: LocatorSchema,
  })),
  redactions: Schema.optional(Schema.Array(Schema.Literals([
    "env-values",
    "header-values",
    "stdin",
    "sensitive-values",
    "command",
  ]))),
  command: Schema.optional(CommandSchema),
  children: Schema.optional(Schema.Array(CommandPlanStepSchema)),
  action: Schema.optional(ActionSchema),
  declarationOrder: Schema.optional(Schema.Struct({ owner: ScheduleOwnerSchema, ordinal: Schema.Number })),
  executionOrder: Schema.optional(Schema.Struct({
    topologicalOrdinal: Schema.Number,
    occurrencePath: Schema.Array(Schema.String),
  })),
  changeFrequency: Schema.optional(Schema.Struct({
    value: Schema.Number,
    source: Schema.Literals(["explicit", "defaulted"]),
    preset: Schema.optional(Schema.Literals(["rare", "normal", "frequent"])),
  })),
  schedulingReason: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Array(Schema.Struct({
    id: Schema.String,
    source: Schema.Literals(["explicit", "capability"]),
    capability: Schema.optional(Schema.String),
  }))),
  occurrence: Schema.optional(Schema.Struct({ kind: Schema.Literal("attempt") })),
  cache: Schema.optional(CacheSchema),
}));

const SlotSchema = Schema.Struct({
  evalId: Schema.String,
  attempt: Schema.Number,
  action: Schema.Literals(["carried", "dispatch"]),
  activation: Schema.optional(ConditionSchema),
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
    physicalLifecycleTemplate: Schema.optional(PhysicalLifecycleTemplateSchema),
    slots: Schema.Array(SlotSchema),
  }),
  Schema.Struct({
    id: Schema.String,
    kind: Schema.Literal("eval-group"),
    ordering: Schema.Literal("serial-normalized-eval-id"),
    beforeSlots: Schema.Array(CommandPlanStepSchema),
    afterSlots: Schema.Array(CommandPlanStepSchema),
    physicalLifecycleTemplate: Schema.optional(PhysicalLifecycleTemplateSchema),
    slots: Schema.Array(SlotSchema),
  }),
]);

const CommandPlanSchema: Schema.Codec<CommandPlan> = Schema.Struct({
  completeness: Schema.Literals(["complete", "partial"]),
  opaqueCount: Schema.Number,
  redactedCount: Schema.Number,
  experiments: Schema.Array(Schema.Struct({
    experimentId: Schema.String,
    activation: Schema.Literals(["conditional", "inactive"]),
    beforeLanes: Schema.Array(CommandPlanStepSchema),
    lanes: Schema.Array(LaneSchema),
    afterLanes: Schema.Array(CommandPlanStepSchema),
  })),
});

const SetupPrefixPlanSchema: Schema.Codec<SetupPrefixPlan> = Schema.Struct({
  lookup: Schema.Literal("not-probed"),
  nodes: Schema.Array(Schema.Struct({
    prefixIdentity: Schema.String,
    lookup: Schema.Literal("not-probed"),
    capability: Schema.Literals(["persistent", "invocation-local", "unsupported"]),
    eligibility: CacheEligibilitySchema,
    consumers: Schema.Array(Schema.Struct({ experimentId: Schema.String, evalId: Schema.String })),
  })),
});

/** Current-candidate machine document emitted by `niceeval debug --json`; it intentionally has no version envelope. */
export const DebugPlanDocumentSchema = Schema.Struct({
  experimentId: Schema.String,
  evalId: Schema.optional(Schema.String),
  evalIds: Schema.Array(Schema.String),
  setupPrefixPlan: SetupPrefixPlanSchema,
  commandPlan: CommandPlanSchema,
});

export type DebugPlanDocument = Schema.Schema.Type<typeof DebugPlanDocumentSchema>;

/** Strictly decode the current candidate's sole `niceeval debug --json` document. */
export function decodeDebugPlanDocument(input: unknown): DebugPlanDocument {
  return Schema.decodeUnknownSync(DebugPlanDocumentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
