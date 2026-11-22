import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { Effect } = require("effect") as typeof import("../../packages/niceeval/node_modules/effect/dist/index.js");
const { defineEval, defineEvalGroup, defineExperiment } =
  require("niceeval") as typeof import("../../packages/niceeval/src/index.ts");
const { definePlugin } = require("niceeval/plugin") as typeof import("../../packages/niceeval/src/plugin/index.ts");
const { sandboxLayer } = require("niceeval/sandbox") as typeof import("../../packages/niceeval/src/sandbox/index.ts");
const { experimentHost } =
  require("niceeval/experiment/host") as typeof import("../../packages/niceeval/src/experiment/host/index.ts");

const FIXTURE = fileURLToPath(new URL("fixtures/teardown-lifecycle/", import.meta.url));
const PROPERTY_RUNS = Number(process.env.NICEEVAL_PROPERTY_RUNS ?? 20);

type Scope = "experiment" | "group" | "eval";
type Field = "experiment" | "group" | "attempt" | "sandbox" | "agent";

const FIELDS: readonly Field[] = ["experiment", "group", "attempt", "sandbox", "agent"];
/** Fields a Plugin may declare, by mount position (docs/feature/plugins/README.md). */
const ALLOWED: Readonly<Record<Scope, readonly Field[]>> = {
  experiment: FIELDS,
  group: ["group", "sandbox", "attempt"],
  eval: ["sandbox", "attempt"],
};
const SCOPES: readonly Scope[] = ["experiment", "group", "eval"];
const hook = () => undefined;

type Spec = Record<string, unknown>;

const identifier = fc.stringMatching(/^[a-z][a-z0-9.-]{0,11}$/);
const jsonLeaf = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
const identityArbitrary = fc.dictionary(identifier, fc.oneof(jsonLeaf, fc.array(jsonLeaf, { maxLength: 3 })), {
  maxKeys: 3,
});
const hookList = fc.oneof(fc.constant(hook), fc.array(fc.constant(hook), { minLength: 1, maxLength: 2 }));
const lifecycleFragment = fc.oneof(
  fc.record({ before: hookList }),
  fc.record({ after: hookList }),
  fc.record({ before: hookList, after: hookList }),
);
const fragmentFor: Record<Field, fc.Arbitrary<unknown>> = {
  experiment: lifecycleFragment,
  group: lifecycleFragment,
  attempt: lifecycleFragment,
  sandbox: lifecycleFragment,
  agent: fc.constantFrom({}, { mcpServers: [{ name: "memory", command: "memory-server" }] }),
};

interface Definition {
  readonly spec: Spec;
  readonly fields: readonly Field[];
  readonly asFactory: boolean;
}

/** Legal definitions: any non-empty combination of behavior fields with a JSON identity, as an object or a factory. */
const legalDefinition: fc.Arbitrary<Definition> = fc
  .record({
    name: identifier,
    key: fc.option(identifier, { nil: undefined }),
    identity: identityArbitrary,
    fields: fc.subarray([...FIELDS], { minLength: 1 }),
    asFactory: fc.boolean(),
  })
  .chain(({ name, key, identity, fields, asFactory }) =>
    fc.tuple(...fields.map((field) => fragmentFor[field])).map((fragments) => ({
      spec: {
        name: `test.${name}`,
        ...(key === undefined ? {} : { key }),
        identity,
        ...Object.fromEntries(fields.map((field, index) => [field, fragments[index]])),
      },
      fields,
      asFactory,
    })),
  );

function build(definition: Definition, spec: unknown = definition.spec): unknown {
  return definition.asFactory ? (definePlugin as (factory: unknown) => (options: unknown) => unknown)(() => spec)(1) : definePlugin(spec as never);
}

function mount(scope: Scope, plugins: unknown): { readonly plugins?: readonly unknown[] } {
  const evalDefinition = defineEval({ test: hook });
  switch (scope) {
    case "experiment":
      return defineExperiment({ plugins } as never) as never;
    case "group":
      return defineEvalGroup({ evals: [evalDefinition], onUnavailable: "stop-group", plugins } as never) as never;
    case "eval":
      return defineEval({ test: hook, plugins } as never) as never;
  }
}

function rejection(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    expect(error, "rejection must be a TypeError").toBeInstanceOf(TypeError);
    return error as Error;
  }
  throw new Error("expected the definition to be rejected");
}

const regressionDefinitions: readonly Definition[] = [
  { spec: { name: "test.sandbox-only", identity: {}, sandbox: { before: hook } }, fields: ["sandbox"], asFactory: false },
  { spec: { name: "test.group-scoped", identity: {}, group: { before: hook } }, fields: ["group"], asFactory: false },
];

// @feature docs/feature/plugins/README.md#plugin-definition
describe("legal Plugin definitions mount exactly where their fields are allowed", () => {
  test("every legal definition is accepted or rejected by mount position", () => {
    fc.assert(
      fc.property(legalDefinition, fc.constantFrom(...SCOPES), (definition, scope) => {
        const instance = build(definition);
        const forbidden = definition.fields.filter((field) => !ALLOWED[scope].includes(field));
        if (forbidden.length === 0) {
          expect(mount(scope, [instance]).plugins, JSON.stringify(definition.spec)).toEqual([instance]);
          return;
        }
        const error = rejection(() => mount(scope, [instance]));
        // The diagnostic names one offending field and the position that refused it.
        expect(error.message, JSON.stringify(definition.spec)).toMatch(
          new RegExp(`field (${forbidden.join("|")}) is not allowed at ${scope} attachment`),
        );
      }),
      { numRuns: PROPERTY_RUNS, examples: regressionDefinitions.flatMap((definition) => SCOPES.map((scope) => [definition, scope] as [Definition, Scope])) },
    );
  });
});

type Corruption =
  | { readonly kind: "no-behavior" }
  | { readonly kind: "missing-name" | "blank-name" | "non-string-name"; readonly value: unknown }
  | { readonly kind: "missing-identity" }
  | { readonly kind: "bad-identity"; readonly value: unknown }
  | { readonly kind: "bad-key"; readonly value: unknown }
  | { readonly kind: "unknown-field"; readonly field: string }
  | { readonly kind: "non-function-hook"; readonly field: "experiment" | "group" | "attempt"; readonly value: unknown }
  | { readonly kind: "fragment-unknown-key"; readonly field: "experiment" | "group" | "attempt"; readonly extra: string }
  | { readonly kind: "empty-fragment"; readonly field: "experiment" | "group" | "attempt" | "sandbox" }
  | { readonly kind: "sandbox-layer" }
  | { readonly kind: "sandbox-function" }
  | { readonly kind: "bad-requires"; readonly value: unknown };

const hookFields = fc.constantFrom<"experiment" | "group" | "attempt">("experiment", "group", "attempt");
const corruption: fc.Arbitrary<Corruption> = fc.oneof(
  fc.constant<Corruption>({ kind: "no-behavior" }),
  fc.constantFrom<Corruption>(
    { kind: "missing-name", value: undefined },
    { kind: "blank-name", value: "" },
    { kind: "blank-name", value: "  " },
  ),
  fc.oneof(fc.integer(), fc.constant(null), fc.array(fc.string(), { maxLength: 2 })).map<Corruption>((value) => ({ kind: "non-string-name", value })),
  fc.constant<Corruption>({ kind: "missing-identity" }),
  fc
    .oneof(
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.array(jsonLeaf, { maxLength: 2 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, hook),
      fc.constantFrom({ nested: Number.NaN }, { nested: hook }, { nested: undefined }),
    )
    .map<Corruption>((value) => ({ kind: "bad-identity", value })),
  fc.oneof(fc.constant(""), fc.integer(), fc.constant(null)).map<Corruption>((value) => ({ kind: "bad-key", value })),
  identifier
    .filter((field) => !["name", "key", "identity", "requires", "agent", "experiment", "group", "sandbox", "attempt"].includes(field))
    .map<Corruption>((field) => ({ kind: "unknown-field", field })),
  fc.constant<Corruption>({ kind: "unknown-field", field: "eval" }),
  fc.tuple(hookFields, fc.oneof(fc.string(), fc.integer(), fc.constant(null))).map<Corruption>(([field, value]) => ({ kind: "non-function-hook", field, value })),
  fc.tuple(hookFields, identifier).map<Corruption>(([field, extra]) => ({ kind: "fragment-unknown-key", field, extra })),
  fc.constantFrom<"experiment" | "group" | "attempt" | "sandbox">("experiment", "group", "attempt", "sandbox").map<Corruption>((field) => ({ kind: "empty-fragment", field })),
  fc.constant<Corruption>({ kind: "sandbox-layer" }),
  fc.constant<Corruption>({ kind: "sandbox-function" }),
  fc.oneof(fc.string(), fc.constant({ evalGroup: "yes" }), fc.constant({ other: true })).map<Corruption>((value) => ({ kind: "bad-requires", value })),
);

/** Applies one defect to an otherwise legal spec and names the token the diagnostic must carry. */
function corrupt(base: Spec, defect: Corruption): { readonly spec: Spec; readonly token: string } {
  const { name, ...withoutName } = base;
  switch (defect.kind) {
    case "no-behavior": {
      const { experiment: _e, group: _g, attempt: _a, sandbox: _s, agent: _ag, ...bare } = base;
      return { spec: bare, token: "at least one behavior field" };
    }
    case "missing-name":
      return { spec: withoutName, token: "name" };
    case "blank-name":
    case "non-string-name":
      return { spec: { ...base, name: defect.value }, token: "name" };
    case "missing-identity": {
      const { identity: _i, ...rest } = base;
      return { spec: rest, token: "identity" };
    }
    case "bad-identity":
      return { spec: { ...base, identity: defect.value }, token: "identity" };
    case "bad-key":
      return { spec: { ...base, key: defect.value }, token: "key" };
    case "unknown-field":
      return { spec: { ...base, [defect.field]: {} }, token: defect.field };
    case "non-function-hook":
      return { spec: { ...base, [defect.field]: { before: defect.value } }, token: "hooks must be functions" };
    case "fragment-unknown-key":
      return { spec: { ...base, [defect.field]: { before: hook, [defect.extra]: hook } }, token: defect.extra };
    case "empty-fragment":
      return { spec: { ...base, [defect.field]: {} }, token: "before or after" };
    case "sandbox-layer":
      return { spec: { ...base, sandbox: sandboxLayer() }, token: "SandboxLayer" };
    case "sandbox-function":
      return { spec: { ...base, sandbox: () => ({ before: hook }) }, token: "sandbox" };
    case "bad-requires":
      return { spec: { ...base, requires: defect.value }, token: "requires" };
  }
}

const attemptOnly: Definition = {
  spec: { name: "test.saved", identity: {}, attempt: { before: hook } },
  fields: ["attempt"],
  asFactory: false,
};
const savedDefects: readonly Corruption[] = [
  { kind: "no-behavior" },
  { kind: "sandbox-layer" },
  { kind: "sandbox-function" },
  { kind: "missing-name", value: undefined },
  { kind: "blank-name", value: "  " },
  { kind: "non-string-name", value: 7 },
  { kind: "missing-identity" },
  { kind: "bad-identity", value: "not-an-object" },
  { kind: "bad-identity", value: [1] },
  { kind: "bad-identity", value: null },
  { kind: "bad-identity", value: { nested: Number.NaN } },
  { kind: "bad-key", value: "" },
  { kind: "unknown-field", field: "eval" },
  { kind: "non-function-hook", field: "experiment", value: "nope" },
  { kind: "fragment-unknown-key", field: "attempt", extra: "during" },
  { kind: "empty-fragment", field: "group" },
  { kind: "bad-requires", value: { evalGroup: "yes" } },
];

// @feature docs/feature/plugins/README.md#plugin-definition
describe("malformed Plugin definitions are rejected when they are defined", () => {
  test("any single defect on a legal definition is a TypeError naming the defect", () => {
    fc.assert(
      fc.property(legalDefinition, corruption, (definition, defect) => {
        // Start from a definition that carries a behavior and has every optional part present.
        const base: Spec = { ...definition.spec, key: "k", requires: { evalGroup: false } };
        const { spec, token } = corrupt(base, defect);
        const context = `defect ${JSON.stringify(defect)} on ${JSON.stringify(Object.keys(spec))}`;
        expect(rejection(() => build(definition, spec)).message, context).toContain(token);
      }),
      {
        numRuns: PROPERTY_RUNS,
        // One saved example per defect kind, so every rejection is replayed on each run; the first three are
        // the reduced counterexamples of the removed dynamic-validation script.
        examples: savedDefects.map((defect) => [attemptOnly, defect] as [Definition, Corruption]),
      },
    );
  });

  test("a factory that does not return a specification object is rejected when it is called", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom<unknown>(undefined, null, "plugin", 1, true, hook),
          fc.array(fc.string(), { maxLength: 2 }),
        ),
        (returned) => {
          const factory = (definePlugin as (factory: unknown) => (options: unknown) => unknown)(() => returned);
          expect(rejection(() => factory(1)).message).toContain("definePlugin");
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  test("a specification that is not an object, or a factory called without exactly one option, is rejected", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom<unknown>(null, undefined, "plugin", 7, true), fc.array(fc.string(), { maxLength: 2 })),
        fc.constantFrom<readonly unknown[]>([], [1, 2]),
        (notASpec, options) => {
          expect(rejection(() => (definePlugin as (spec: unknown) => unknown)(notASpec)).message).toContain("definePlugin");
          const factory = (definePlugin as (factory: unknown) => (...options: unknown[]) => unknown)(() => ({
            name: "test.arity",
            identity: {},
            attempt: { before: hook },
          }));
          expect(rejection(() => factory(...options)).message).toContain("exactly one options value");
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  test("a value that definePlugin did not create is rejected at every mount position", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom<unknown>({}, "plugin", 3, null, hook),
          fc.record({ name: fc.string(), identity: fc.constant({}), attempt: fc.constant({ before: hook }) }),
        ),
        fc.constantFrom(...SCOPES),
        (impostor, scope) => {
          expect(rejection(() => mount(scope, [impostor])).message, scope).toContain("created by definePlugin()");
          // null and undefined mean "no plugins"; every other non-array is refused.
          if (impostor !== null) expect(rejection(() => mount(scope, impostor)).message, scope).toContain("must be an array");
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

async function arrangeLegalProject() {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), "niceeval-plugin-definition-"));
  try {
    await cp(FIXTURE, cwd, { recursive: true });
    await Promise.all([
      mkdir(join(cwd, "evals"), { recursive: true }),
      mkdir(join(cwd, "experiments"), { recursive: true }),
      ...["events", "agent"].map((name) => rename(join(cwd, `${name}.ts.txt`), join(cwd, `${name}.ts`))),
    ]);
    await writeFile(
      join(cwd, "plugins.ts"),
      `import { definePlugin } from "niceeval/plugin";
       import { appendEvent } from "./events.ts";
       const record = (unit: string) => ({
         before: () => appendEvent({ kind: "before", unit }),
         after: () => appendEvent({ kind: "after", unit }),
       });
       export const asObject = definePlugin({ name: "test.object", identity: { v: 1 }, attempt: record("object") });
       export const asFactory = definePlugin((options: { readonly marker: string }) => ({
         name: "test.factory",
         key: options.marker,
         identity: { marker: options.marker },
         attempt: record("factory"),
       }));
       export const hostScoped = definePlugin({ name: "test.host", identity: {}, experiment: record("experiment") });`,
    );
    await writeFile(
      join(cwd, "evals", "legal.eval.ts"),
      `import { defineEval } from "niceeval";
       import { asFactory, asObject } from "../plugins.ts";
       export default defineEval({
         plugins: [asObject, asFactory({ marker: "one" })],
         async test(t) {
           const turn = await t.send("go");
           await turn.succeeded().orStop();
         },
       });`,
    );
    await writeFile(
      join(cwd, "experiments", "legal.ts"),
      `import { defineExperiment } from "niceeval";
       import agent from "../agent.ts";
       import { hostScoped } from "../plugins.ts";
       export default defineExperiment({ adapter: agent, evals: ["legal"], attempts: 1, maxConcurrency: 1, plugins: [hostScoped] });`,
    );
    await writeFile(
      join(cwd, "scenario.json"),
      JSON.stringify({ holdAt: "none", experimentPlugin: false, evalPlugins: 0, teardown: {} }),
    );
    return cwd;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

// @feature docs/feature/plugins/README.md#plugin-definition
describe("legal definitions run", () => {
  let cwd: string;
  let plan: Awaited<ReturnType<typeof planLegalProject>>;

  async function planLegalProject() {
    const planned = await Effect.runPromise(
      experimentHost.invocation.plan({
        cwd,
        experimentSelector: "legal",
        config: { maxConcurrency: 1 },
        overrides: { earlyExit: false, rerun: "all" },
      }),
    );
    if (planned.status !== "ready") throw new Error(`Expected a ready plan, got ${JSON.stringify(planned)}`);
    return planned.plan;
  }

  beforeAll(async () => {
    cwd = await arrangeLegalProject();
    await Effect.runPromise(experimentHost.invocation.run({ plan: await planLegalProject() }));
    await rm(join(cwd, "teardown-events.ndjson"));
    plan = await planLegalProject();
  }, 20_000);
  afterAll(async () => {
    if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
  });

  test("legal definitions mounted at every position run their hooks once per fresh Attempt", async () => {
    const { receipt, summary } = await Effect.runPromise(experimentHost.invocation.run({ plan }));
    const events = (await readFile(join(cwd, "teardown-events.ndjson"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; unit?: string });
    expect(receipt.completion).toBe("completed");
    expect(summary).toMatchObject({ total: 1, passed: 1, failed: 0, errored: 0 });
    expect(events.filter((event) => event.unit !== "agent" && event.unit !== undefined).map((event) => `${event.kind}:${event.unit}`)).toEqual([
      "before:experiment",
      "before:object",
      "before:factory",
      "after:factory",
      "after:object",
      "after:experiment",
    ]);
  });
});
