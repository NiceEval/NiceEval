import { createRequire } from "node:module";
import { defineExperiment, type JsonValue } from "niceeval";
import {
  actionRef,
  changeFrequency,
  defineSandboxAction,
  dockerSandbox,
  sandboxStep,
  shell,
  uploadDirectory,
  type SandboxActionDefinition,
} from "niceeval/sandbox";
import { setupPrefixAgent } from "../agents/setup-prefix.ts";

const floatingImage = process.env.NICEEVAL_E2E_SETUP_PREFIX_IMAGE;
const setupPrefixMode = process.env.NICEEVAL_E2E_SETUP_PREFIX_MODE ?? "default";
if (![
  "default",
  "dynamic-tools",
  "external-tmpfs",
  "contention",
  "capture-cancellation",
  "canonical-json",
].includes(setupPrefixMode)) {
  throw new Error(`unsupported NICEEVAL_E2E_SETUP_PREFIX_MODE ${JSON.stringify(setupPrefixMode)}`);
}
const cancellation = setupPrefixMode === "capture-cancellation";
const contention = setupPrefixMode === "contention";
const canonicalJsonProbe = setupPrefixMode === "canonical-json";

let setupPrefixSandbox = dockerSandbox({
  source: floatingImage === undefined
    ? {
        type: "dockerfile",
        context: new URL("../fixtures/setup-prefix/image/", import.meta.url),
      }
    : { type: "image", image: floatingImage },
  user: "node",
  resources: {
    cpus: 1,
    memoryBytes: 512 * 1024 ** 2,
    pidsLimit: 128,
    ...(setupPrefixMode === "external-tmpfs"
      ? { tmpfs: { "/tmp/setup-prefix-external": { sizeBytes: 16 * 1024 ** 2, mode: 0o700, uid: 1000, gid: 1000 } } }
      : {}),
  },
});

if (cancellation) {
  setupPrefixSandbox = setupPrefixSandbox.before(shell({
    id: "capture-cancellation-payload",
    command: [
      "set -eu",
      "mkdir -p .setup-prefix",
      "dd if=/dev/urandom of=.setup-prefix/capture-payload.bin bs=1M count=256 status=none",
    ].join("\n"),
    changeFrequency: 15,
  }));
}

if (canonicalJsonProbe) {
  type DangerousMetadata = Readonly<Record<string, JsonValue>>;
  type DangerousMetadataSchema = SandboxActionDefinition<
    DangerousMetadata,
    DangerousMetadata
  >["input"];

  // The scenario intentionally avoids adding a shared fixture dependency:
  // Effect is already a declared runtime dependency of the installed NiceEval
  // candidate. Resolve from that package, then use Schema.Unknown so decoding
  // preserves JSON.parse-created own `__proto__` and `constructor` keys.
  const scenarioRequire = createRequire(import.meta.url);
  const niceevalRequire = createRequire(scenarioRequire.resolve("niceeval"));
  const unknownSchema = (niceevalRequire("effect") as {
    readonly Schema: { readonly Unknown: unknown };
  }).Schema.Unknown as DangerousMetadataSchema;
  const variant = process.env.NICEEVAL_E2E_SETUP_PREFIX_CANONICAL_VARIANT ?? "alpha";
  if (variant !== "alpha" && variant !== "beta") {
    throw new Error(`unsupported canonical metadata variant ${JSON.stringify(variant)}`);
  }
  const encoded = variant === "alpha"
    ? '{"__proto__":{"variant":"alpha"},"constructor":{"variant":"alpha"}}'
    : '{"__proto__":{"variant":"beta"},"constructor":{"variant":"beta"}}';
  const metadata = JSON.parse(encoded) as DangerousMetadata;
  if (!Object.hasOwn(metadata, "__proto__") || !Object.hasOwn(metadata, "constructor")) {
    throw new Error("canonical metadata fixture must retain dangerous names as own JSON keys");
  }
  const canonicalMetadataAction = defineSandboxAction<DangerousMetadata, DangerousMetadata>({
    id: "niceeval.e2e.setup-prefix-canonical-json",
    input: unknownSchema,
    steps: () => [sandboxStep.exec({
      executable: "sh",
      args: [
        "-lc",
        "mkdir -p .setup-prefix && " +
          "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' " +
          "> .setup-prefix/canonical-token",
      ],
    })] as const,
  });
  setupPrefixSandbox = setupPrefixSandbox.before(canonicalMetadataAction(metadata, {
    id: "canonical-metadata-probe",
    changeFrequency: 12,
  }));
}

setupPrefixSandbox = setupPrefixSandbox.before(uploadDirectory({
  id: "stable-fixture",
  source: new URL("../fixtures/setup-prefix/visible/", import.meta.url),
  to: "fixture",
  changeFrequency: changeFrequency.rare,
  ...(cancellation || canonicalJsonProbe
    ? {
        dependsOn: [
          ...(cancellation ? [actionRef("capture-cancellation-payload")] : []),
          ...(canonicalJsonProbe ? [actionRef("canonical-metadata-probe")] : []),
        ],
      }
    : {}),
}))
  // These two nonce files are E2E execution probes, not domain inputs or an
  // authoring recommendation. The deterministic contract under test is the
  // adjacent fixture/.env state; a retained nonce makes restore distinguishable
  // from replay without reading NiceEval's private cache registry.
  .before(shell({
    id: "fixture-execution-probe",
    command: [
      "set -eu",
      "test \"$(cat fixture/input.txt)\" = \"stable setup-prefix fixture\"",
      "mkdir -p .setup-prefix",
      "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' > .setup-prefix/fixture-token",
      ...(contention ? ["sleep 3"] : []),
    ].join("\n"),
    changeFrequency: 20,
    dependsOn: [actionRef("stable-fixture")],
  }));

export default defineExperiment({
  description: "persistent Docker SetupPrefix restore and private writable clones",
  agent: setupPrefixAgent,
  sandbox: setupPrefixSandbox,
  evals: ["setup-prefix-cache"],
  attempts: 1,
  maxConcurrency: 1,
});
