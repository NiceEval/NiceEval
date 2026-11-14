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
import { beforeCacheAgent } from "../agents/before-cache.ts";
import { beforeCacheResumeGate } from "../fixtures/before-cache/resume-gate.ts";

const floatingImage = process.env.NICEEVAL_E2E_BEFORE_CACHE_IMAGE;
const beforeCacheMode = process.env.NICEEVAL_E2E_BEFORE_CACHE_MODE ?? "default";
if (
  ![
    "default",
    "dynamic-tools",
    "external-tmpfs",
    "contention",
    "capture-cancellation",
    "layer-resume",
    "canonical-json",
  ].includes(beforeCacheMode)
) {
  throw new Error(`unsupported NICEEVAL_E2E_BEFORE_CACHE_MODE ${JSON.stringify(beforeCacheMode)}`);
}
const cancellation = beforeCacheMode === "capture-cancellation";
const contention = beforeCacheMode === "contention";
const canonicalJsonProbe = beforeCacheMode === "canonical-json";
const middleVersion = process.env.NICEEVAL_E2E_BEFORE_CACHE_MIDDLE_VERSION ?? "alpha";
if (middleVersion !== "alpha" && middleVersion !== "beta") {
  throw new Error("NICEEVAL_E2E_BEFORE_CACHE_MIDDLE_VERSION must be alpha or beta");
}

let beforeCacheSandbox = dockerSandbox({
  source:
    floatingImage === undefined
      ? {
          type: "dockerfile",
          context: new URL("../fixtures/before-cache/image/", import.meta.url),
        }
      : { type: "image", image: floatingImage },
  user: "node",
  resources: {
    cpus: 1,
    memoryBytes: 512 * 1024 ** 2,
    pidsLimit: 128,
    ...(beforeCacheMode === "external-tmpfs"
      ? { tmpfs: { "/tmp/before-cache-external": { sizeBytes: 16 * 1024 ** 2, mode: 0o700, uid: 1000, gid: 1000 } } }
      : {}),
  },
});

if (cancellation) {
  beforeCacheSandbox = beforeCacheSandbox.before(
    shell({
      id: "capture-cancellation-payload",
      command: [
        "set -eu",
        "mkdir -p .before-cache",
        "dd if=/dev/urandom of=.before-cache/capture-payload.bin bs=1M count=256 status=none",
      ].join("\n"),
      changeFrequency: 15,
    }),
  );
}

if (canonicalJsonProbe) {
  type DangerousMetadata = Readonly<Record<string, JsonValue>>;
  type DangerousMetadataSchema = SandboxActionDefinition<DangerousMetadata, DangerousMetadata>["input"];

  // The scenario intentionally avoids adding a shared fixture dependency:
  // Effect is already a declared runtime dependency of the installed NiceEval
  // candidate. Resolve from that package, then use Schema.Unknown so decoding
  // preserves JSON.parse-created own `__proto__` and `constructor` keys.
  const scenarioRequire = createRequire(import.meta.url);
  const niceevalRequire = createRequire(scenarioRequire.resolve("niceeval"));
  const unknownSchema = (
    niceevalRequire("effect") as {
      readonly Schema: { readonly Unknown: unknown };
    }
  ).Schema.Unknown as DangerousMetadataSchema;
  const variant = process.env.NICEEVAL_E2E_BEFORE_CACHE_CANONICAL_VARIANT ?? "alpha";
  if (variant !== "alpha" && variant !== "beta") {
    throw new Error(`unsupported canonical metadata variant ${JSON.stringify(variant)}`);
  }
  const encoded =
    variant === "alpha"
      ? '{"__proto__":{"variant":"alpha"},"constructor":{"variant":"alpha"}}'
      : '{"__proto__":{"variant":"beta"},"constructor":{"variant":"beta"}}';
  const metadata = JSON.parse(encoded) as DangerousMetadata;
  if (!Object.hasOwn(metadata, "__proto__") || !Object.hasOwn(metadata, "constructor")) {
    throw new Error("canonical metadata fixture must retain dangerous names as own JSON keys");
  }
  const canonicalMetadataAction = defineSandboxAction<DangerousMetadata, DangerousMetadata>({
    id: "niceeval.e2e.before-cache-canonical-json",
    input: unknownSchema,
    steps: () =>
      [
        sandboxStep.exec({
          executable: "sh",
          args: [
            "-lc",
            "mkdir -p .before-cache && " +
              "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' " +
              "> .before-cache/canonical-token",
          ],
        }),
      ] as const,
  });
  beforeCacheSandbox = beforeCacheSandbox.before(
    canonicalMetadataAction(metadata, {
      id: "canonical-metadata-probe",
      changeFrequency: 12,
    }),
  );
}

beforeCacheSandbox = beforeCacheSandbox
  .before(
    uploadDirectory({
      id: "stable-fixture",
      source: new URL("../fixtures/before-cache/visible/", import.meta.url),
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
    }),
  )
  // These two nonce files are E2E execution probes, not domain inputs or an
  // authoring recommendation. The deterministic contract under test is the
  // adjacent fixture/.env state; a retained nonce makes restore distinguishable
  // from replay without reading NiceEval's private cache registry.
  .before(
    shell({
      id: "fixture-execution-probe",
      command: [
        "set -eu",
        'test "$(cat fixture/input.txt)" = "stable before-cache fixture"',
        "mkdir -p .before-cache",
        "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' > .before-cache/fixture-token",
        ...(contention ? ["sleep 3"] : []),
      ].join("\n"),
      changeFrequency: 20,
      dependsOn: [actionRef("stable-fixture")],
    }),
  )
  .before(
    shell({
      id: "middle-execution-probe",
      command: [
        "set -eu",
        ...beforeCacheResumeGate(1),
        'test "$(cat fixture/input.txt)" = "stable before-cache fixture"',
        "mkdir -p .before-cache",
        `printf '%s\\n' '${middleVersion}' > .before-cache/middle-version`,
        "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' > .before-cache/middle-token",
      ].join("\n"),
      changeFrequency: 25,
      dependsOn: [actionRef("fixture-execution-probe")],
    }),
  );

export default defineExperiment({
  description: "persistent Docker BeforeCache restore and private writable clones",
  adapter: beforeCacheAgent,
  sandbox: beforeCacheSandbox,
  evals: ["before-cache"],
  attempts: 1,
  // This owner intentionally overlaps several cold Docker journeys. Preserve
  // the functional deadline under the default CI parallel load without
  // throttling unrelated Lifecycle cases.
  timeoutMs: 300_000,
  maxConcurrency: 1,
});
