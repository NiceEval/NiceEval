import { definePlugin, type PluginInstance, type PluginOwner } from "niceeval/plugin";
import {
  sandboxLayer,
  type SandboxLayer,
} from "niceeval/sandbox";

const sandboxOnly = definePlugin({
  name: "e2e.types.sandbox-only",
  behaviorRevision: "1",
  sandbox: () => sandboxLayer(),
});

const sandboxOnlyAttachment: PluginInstance<"experiment" | "group" | "eval"> = sandboxOnly();
void sandboxOnlyAttachment;

// Sandbox is an automatic projection, never an independent attachment owner.
// @ts-expect-error "sandbox" is a fragment scope, not a Plugin owner.
const standaloneSandboxOwner: PluginOwner = "sandbox";
void standaloneSandboxOwner;
// @ts-expect-error "sandbox" is not a PluginInstance owner.
const independentSandboxOwner: PluginInstance<"sandbox"> = sandboxOnly();
void independentSandboxOwner;

const groupAndSandbox = definePlugin<{ readonly marker: string }>({
  name: "e2e.types.group-and-sandbox",
  behaviorRevision: "1",
  instanceKey: ({ marker }) => marker,
  group: () => ({ setup() {} }),
  sandbox: () => sandboxLayer(),
});
const groupAttachment: PluginInstance<"group"> = groupAndSandbox({ marker: "group" });
void groupAttachment;
// A sandbox fragment does not widen the eligible owners declared by host fragments.
// @ts-expect-error This attachment only declares a Group host fragment.
const experimentAttachment: PluginInstance<"experiment"> = groupAndSandbox({ marker: "group" });
void experimentAttachment;

// @ts-expect-error A Plugin must declare at least one host or sandbox fragment.
definePlugin({ name: "e2e.types.empty", behaviorRevision: "1" });

declare const templateBearing: SandboxLayer<"template-bearing">;
definePlugin({
  name: "e2e.types.template-bearing",
  behaviorRevision: "1",
  eval: () => ({ setup() {} }),
  // @ts-expect-error Plugin sandbox fragments must be command-only layers.
  sandbox: () => templateBearing,
});

definePlugin({
  name: "e2e.types.public-sandbox-lifecycle",
  behaviorRevision: "1",
  eval: () => ({ setup() {} }),
  // @ts-expect-error SandboxLayer exposes before/after as its only lifecycle DSL.
  sandbox: () => sandboxLayer().setup(() => {}),
});
