import { defineEval } from "niceeval";
import { definePlugin } from "niceeval/plugin";
import { dockerSandbox, sandboxLayer } from "niceeval/sandbox";

const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";

function rejects(factory, pattern) {
  try {
    factory();
    return false;
  } catch (error) {
    return pattern.test(String(error));
  }
}

const sandboxOnly = definePlugin({
  name: "e2e.dynamic.sandbox-only",
  behaviorRevision: "1",
  sandbox: () => sandboxLayer(),
});

const templateBearing = definePlugin({
  name: "e2e.dynamic.template-bearing",
  behaviorRevision: "1",
  eval: () => ({ setup() {} }),
  sandbox: () => dockerSandbox({ source: { type: "image", image: NODE_IMAGE } }),
});

const unbranded = definePlugin({
  name: "e2e.dynamic.unbranded-sandbox",
  behaviorRevision: "1",
  eval: () => ({ setup() {} }),
  sandbox: () => ({ before() {}, after() {} }),
});

const groupScoped = definePlugin({
  name: "e2e.dynamic.group-scoped",
  behaviorRevision: "1",
  group: () => ({ setup() {} }),
  sandbox: () => sandboxLayer(),
});

process.stdout.write(JSON.stringify({
  sandboxOnlyCreated: sandboxOnly() !== undefined,
  emptyRejected: rejects(
    () => definePlugin({ name: "e2e.dynamic.empty", behaviorRevision: "1" }),
    /at least one scope callback/u,
  ),
  hostOwnersNotWidened: rejects(
    () => defineEval({ plugins: [groupScoped()], test() {} }),
    /does not support eval attachment/u,
  ),
  templateRejected: rejects(() => templateBearing(), /command-only/u),
  unbrandedRejected: rejects(() => unbranded(), /SandboxLayer/u),
}));
