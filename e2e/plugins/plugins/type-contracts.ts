import { definePlugin, type PluginInstance, type PluginOwner } from "niceeval/plugin";
import { sandboxLayer } from "niceeval/sandbox";

const sandboxOnly = definePlugin({ name: "e2e.types.sandbox-only", identity: {}, sandbox: { before() {} } });
const anyAttachment: PluginInstance<"experiment" | "group" | "eval"> = sandboxOnly;
void anyAttachment;
// @ts-expect-error Sandbox is timing, not an attachment owner.
const standaloneSandboxOwner: PluginOwner = "sandbox";
void standaloneSandboxOwner;
const groupAndSandbox = definePlugin(({ marker }: { readonly marker: string }) => ({
  name: "e2e.types.group-and-sandbox",
  key: marker,
  identity: { marker },
  group: { before() {} },
  sandbox: { before() {} },
}));
const groupAttachment: PluginInstance<"group"> = groupAndSandbox({ marker: "group" });
const experimentAttachment: PluginInstance<"experiment"> = groupAndSandbox({ marker: "group" });
void groupAttachment;
void experimentAttachment;
// @ts-expect-error Eval cannot declare Group timing.
const evalAttachment: PluginInstance<"eval"> = groupAndSandbox({ marker: "group" });
void evalAttachment;
// @ts-expect-error One behavior field is required.
definePlugin({ name: "e2e.types.empty", identity: {} });
// @ts-expect-error A SandboxLayer is not a Plugin sandbox declaration.
definePlugin({ name: "e2e.types.layer", identity: {}, sandbox: sandboxLayer() });
// @ts-expect-error identity is required.
definePlugin({ name: "e2e.types.identity", attempt: { before() {} } });

// @ts-expect-error Plugin versions belong in identity.
definePlugin({ name: "e2e.types.legacy", identity: {}, behaviorRevision: "1", attempt: { before() {} } });
