import { defineAdapter, defineExperiment, type AdapterCreateContext, type AdapterUsageInput } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

function readSelection(ctx: AdapterCreateContext) {
  const model: string | null = ctx.models.planner.model;
  const effort: string | null = ctx.models.planner.reasoningEffort;
  // @ts-expect-error An unspecified configured model may be null.
  const required: string = ctx.models.planner.model;
  // @ts-expect-error The canonical map is read-only.
  ctx.models.planner = { model: "other", reasoningEffort: null };
  // @ts-expect-error Canonical selections are deeply read-only.
  ctx.models.planner.model = "other";
  return [model, effort, required];
}

const adapter = defineAdapter({ name: "slot-types", create: (ctx) => ({ read: () => readSelection(ctx) }) });
defineExperiment({ adapter, models: { planner: { model: "fixture/planner", reasoningEffort: "high" }, reviewer: { model: "fixture/reviewer" }, unused: { model: "fixture/unused" } } });
defineExperiment({ adapter, model: "fixture/default", reasoningEffort: "high" });
defineExperiment({ adapter, reasoningEffort: "high" });
// @ts-expect-error Named application slots do not imply Agent multi-model execution.
defineExperiment({ adapter: deterministicAgent, models: { planner: { model: "fixture/planner" } } });
// @ts-expect-error Named slots and the single-model shorthand are mutually exclusive.
defineExperiment({ adapter, models: { default: { model: "fixture/default" } }, model: "fixture/default" });
// @ts-expect-error Named slots also exclude a top-level effort.
defineExperiment({ adapter, models: { default: { model: "fixture/default" } }, reasoningEffort: "high" });
// @ts-expect-error Explicit slots require a model.
defineExperiment({ adapter, models: { planner: { reasoningEffort: "high" } } });
// @ts-expect-error A slot model must be a string.
defineExperiment({ adapter, models: { planner: { model: 123 } } });
const linked: AdapterUsageInput = { callId: "linked", modelSlot: "planner", provider: null, model: "fixture/fallback", status: "succeeded", inputTokens: null, outputTokens: null };
const unknown: AdapterUsageInput = { ...linked, callId: "unknown", modelSlot: null };
const omitted: AdapterUsageInput = { callId: "omitted", provider: null, model: null, status: "unknown", inputTokens: null, outputTokens: null };
// @ts-expect-error Usage references are nullable strings.
const invalid: AdapterUsageInput = { ...linked, modelSlot: 123 };
void [unknown, omitted, invalid];
