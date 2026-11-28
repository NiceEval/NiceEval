import * as Schema from "effect/Schema";

const AgentInstallIdentitySchema = Schema.Struct({
  agent: Schema.String,
  version: Schema.String,
  revision: Schema.String,
});

const AgentInstallFactSchema = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("hit"),
    identity: AgentInstallIdentitySchema,
  }),
  Schema.Struct({
    outcome: Schema.Literal("repaired"),
    identity: AgentInstallIdentitySchema,
    probeMissReason: Schema.String,
  }),
  Schema.Struct({
    outcome: Schema.Literal("installed"),
    identity: AgentInstallIdentitySchema,
    probeMissReason: Schema.String,
    repairFailureReason: Schema.optionalKey(Schema.String),
  }),
]);

export type AgentInstallFact = Schema.Schema.Type<typeof AgentInstallFactSchema>;
export const AgentInstallFactsSchema = Schema.Array(AgentInstallFactSchema);
