import { isTrue } from "niceeval/expect";
import { defineAdapter, defineExperiment, defineScoreEval, defineModelRoles, type AdapterCreateContext, type AdapterUsageInput, type ResolvedModelRole } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

function readSelection(ctx: AdapterCreateContext) {
  const model: string | undefined = ctx.models.planner.model;
  const effort: string | undefined = ctx.models.planner.reasoningEffort;
  // @ts-expect-error An unspecified configured model may be undefined.
  const required: string = ctx.models.planner.model;
  // @ts-expect-error Callback selections cannot be received as nullable wire values.
  const nullable: string | null = ctx.models.planner.model;
  // @ts-expect-error The canonical map is read-only.
  ctx.models.planner = { model: "other", reasoningEffort: undefined };
  // @ts-expect-error Canonical selections are deeply read-only.
  ctx.models.planner.model = "other";
  return [model, effort, required, nullable];
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
const linked: AdapterUsageInput = { callId: "linked", modelRole: "planner", provider: null, model: "fixture/fallback", status: "succeeded", inputTokens: null, outputTokens: null };
const unknown: AdapterUsageInput = { ...linked, callId: "unknown", modelRole: null };
const omitted = { callId: "omitted", provider: null, model: null, status: "unknown", inputTokens: null, outputTokens: null } satisfies AdapterUsageInput;
// @ts-expect-error Usage references are nullable strings.
const invalid: AdapterUsageInput = { ...linked, modelRole: 123 };
void [unknown, omitted, invalid];


const purposes = defineModelRoles({ mind: { model: "fixture/mind" }, speech: { model: "fixture/speech" } });
const requiredAdapter = defineAdapter({
  name: "required-slot-types",
  requires: { models: purposes },
  create(ctx) {
    const model: string | undefined = ctx.models.mind.model;
    // @ts-expect-error Only declared purposes can be read.
    ctx.models.mimd;
    ctx.recordUsage({ ...linked, modelRole: "mind" });
    ctx.recordUsage({ ...linked, modelRole: null });
    ctx.recordUsage(omitted);
    // @ts-expect-error Unknown purposes cannot be recorded.
    ctx.recordUsage({ ...linked, modelRole: "mimd" });
    return { configuredModel: () => model };
  },
});
defineExperiment({ adapter: requiredAdapter, models: purposes });
defineExperiment({ adapter: requiredAdapter, models: { mind: { model: "fixture/other" }, speech: { model: "fixture/other-speech" } } });
requiredAdapter.defineScoreEval({ test(t) { t.usage.cacheRead.rate("unbound-migration-window"); } });
// @ts-expect-error Shared model selections are deeply immutable.
purposes.mind.model = "fixture/mutated";

requiredAdapter.defineScoreEval({
  requires: { models: purposes },
  test(t) {
    const configured: string | undefined = t.configuredModel();
    t.usage.cacheRead.rate();
    t.usage.cacheRead.rate("mind");
    // @ts-expect-error Bound Score Eval must reject a misspelled purpose.
    t.usage.cacheRead.rate("mimd");
    const dynamic: string = "mind";
    // @ts-expect-error A broad string is not proof of a declared purpose.
    t.usage.cacheRead.rate(dynamic);
    void configured;
  },
});
requiredAdapter.defineEval({
  requires: { models: purposes },
  test(t) {
    t.configuredModel();
    t.usage.cacheRead.rate("speech");
    // @ts-expect-error Bound Pass Eval preserves exact requirements too.
    t.usage.cacheRead.rate("other");
  },
});
const flagsAndAssertions = defineAdapter({
  name: "required-slots-with-sugar",
  requires: { models: purposes },
  parseFlags: (_input: unknown) => ({ enabled: true }),
  create(ctx) {
    const enabled: boolean = ctx.flags.enabled;
    ctx.recordUsage({ ...linked, modelRole: "speech" });
    // @ts-expect-error Assertions overload cannot erase model purpose checking.
    ctx.recordUsage({ ...linked, modelRole: "other" });
    return { enabled: () => enabled };
  },
  assertions: ({ app, check }) => ({ active() { return check(app.enabled(), isTrue()); } }),
});
flagsAndAssertions.defineScoreEval({
  requires: { models: purposes },
  test(t) {
    const enabled: boolean = t.flags.enabled;
    t.enabled();
    t.active().score(1);
    t.usage.cacheRead.rate("mind");
    // @ts-expect-error Sugar and flags must not reintroduce the broad rate signature.
    t.usage.cacheRead.rate("other");
    void enabled;
  },
});
flagsAndAssertions.defineEval({
  requires: { models: purposes },
  test(t) {
    t.active().gate();
    // @ts-expect-error Pass sugar must not acquire Score capabilities.
    t.active().score(1);
    // @ts-expect-error Pass sugar cannot widen purpose keys.
    t.usage.cacheRead.rate("other");
  },
});

// @ts-expect-error Removed purpose factory is not exported.
import { defineModelSlots } from "niceeval";
// @ts-expect-error Removed purpose type is not exported.
import type { ModelSlotSelection } from "niceeval";
// @ts-expect-error Old usage property is not accepted.
const oldUsage: AdapterUsageInput = { ...linked, modelSlot: "mind" };
void oldUsage;

const internalSelection: ResolvedModelRole = { model: undefined, reasoningEffort: undefined };
const adapterSelection: import("niceeval/adapter").ResolvedModelRole = internalSelection;
// @ts-expect-error Internal selection cannot contain wire null.
const nullSelection: ResolvedModelRole = { model: null, reasoningEffort: undefined };
// @ts-expect-error Both callback keys must be present.
const missingModel: ResolvedModelRole = { reasoningEffort: undefined };
// @ts-expect-error Both callback keys must be present.
const missingEffort: ResolvedModelRole = { model: undefined };
void [adapterSelection, nullSelection, missingModel, missingEffort];
