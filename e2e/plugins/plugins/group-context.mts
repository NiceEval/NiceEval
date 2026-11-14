import { definePlugin, type PluginInstance } from "niceeval/plugin";

definePlugin({
  name: "required",
  identity: {},
  requires: { evalGroup: true },
  sandbox: {
    before(_sandbox, ctx) {
      ctx.evalGroup.id;
    },
    after(_sandbox, ctx) {
      ctx.evalGroup.id;
    },
  },
  attempt: {
    before(ctx) {
      ctx.evalGroup.id;
    },
    after(ctx) {
      ctx.evalGroup.id;
    },
  },
});
definePlugin((options: { version: string }) => ({
  name: "required-factory",
  identity: { version: options.version },
  requires: { evalGroup: true },
  sandbox: {
    before(_sandbox, ctx) {
      ctx.evalGroup.id;
    },
  },
  attempt: {
    before(ctx) {
      ctx.evalGroup.id;
    },
  },
}));
definePlugin({
  name: "optional",
  identity: {},
  attempt: {
    before(ctx) {
      // @ts-expect-error Ungrouped Evals have no evalGroup.
      ctx.evalGroup.id;
    },
  },
  sandbox: {
    before(_sandbox, ctx) {
      // @ts-expect-error Ungrouped Evals have no evalGroup.
      ctx.evalGroup.id;
    },
  },
});
const experimentOnly = definePlugin({ name: "agent", identity: {}, agent: { skills: [] } });
// @ts-expect-error Agent extensions are Experiment-only.
const group: PluginInstance<"group"> = experimentOnly;
// @ts-expect-error Agent extensions are Experiment-only.
const evalPlugin: PluginInstance<"eval"> = experimentOnly;
void group;
void evalPlugin;

definePlugin((options: { version: string }) => ({
  name: "optional-factory",
  identity: { version: options.version },
  attempt: {
    before(ctx) {
      // @ts-expect-error Optional factory context must guard evalGroup.
      ctx.evalGroup.id;
    },
  },
}));
