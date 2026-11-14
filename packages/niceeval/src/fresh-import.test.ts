// cases: docs/engineering/testing/architecture/unit/experiments-runner.md
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { defineAdapter, adapterAcceptsEval } from "./adapter.ts";
import { defineExperiment } from "./define.ts";
import { freshImportModule as freshImportModuleEffect } from "./fresh-import.ts";
import { prepareRuns } from "./experiment/host/operations.ts";

const freshImportModule = (path: string) => Effect.runPromise(freshImportModuleEffect(path));

describe("fresh project imports", () => {
  it("reloads project source while retaining a node_modules dependency instance", async () => {
    const root = mkdtempSync(join(tmpdir(), "niceeval-fresh-import-"));
    try {
      const dependency = join(root, "node_modules", "stable-dependency");
      mkdirSync(dependency, { recursive: true });
      writeFileSync(join(dependency, "package.json"), JSON.stringify({ name: "stable-dependency", main: "index.js" }));
      writeFileSync(join(dependency, "index.js"), "module.exports = { identity: {} };\n");
      const source = join(root, "source.ts");
      const writeSource = (revision: string) =>
        writeFileSync(
          source,
          `const dependency = require("stable-dependency");\nexport const instance = dependency;\nexport const revision = "${revision}";\n`,
        );

      writeSource("first");
      const first = (await freshImportModule(source)) as { readonly instance: object; readonly revision: string };
      writeSource("second");
      const second = (await freshImportModule(source)) as { readonly instance: object; readonly revision: string };

      expect(first.revision).toBe("first");
      expect(second.revision).toBe("second");
      expect(second.instance).toBe(first.instance);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shares a project helper across eval and experiment discovery in one generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "niceeval-shared-discovery-"));
    const factoriesKey = "__niceevalFreshDiscoveryTestFactories";
    try {
      Object.assign(globalThis, { [factoriesKey]: Object.freeze({ defineAdapter, defineExperiment }) });
      mkdirSync(join(root, "adapters"));
      mkdirSync(join(root, "evals"));
      mkdirSync(join(root, "experiments"));
      writeFileSync(
        join(root, "adapters", "shared.ts"),
        `const { defineAdapter, defineExperiment } = globalThis[${JSON.stringify(factoriesKey)}];\n` +
          `export { defineExperiment };\n` +
          `export const shared = defineAdapter({ name: "shared", behaviorRevision: "1", create() { return {}; } });\n`,
      );
      writeFileSync(
        join(root, "evals", "shared.eval.ts"),
        `import { shared } from "../adapters/shared.ts";\n` +
          `const test = async () => {};\nObject.assign(test, { helper: shared });\n` +
          `export default shared.defineEval({ test });\n`,
      );
      writeFileSync(
        join(root, "experiments", "shared.ts"),
        `import { defineExperiment, shared } from "../adapters/shared.ts";\n` +
          `export default defineExperiment({ adapter: shared, evals: ["shared"] });\n`,
      );

      const prepared = await Effect.runPromise(prepareRuns({ cwd: root, config: {} }, { freshImport: true }));
      expect(prepared.status).toBe("ready");
      if (prepared.status !== "ready") return;
      expect(prepared.selected.evals).toHaveLength(1);
      expect(prepared.runs).toHaveLength(1);
      const evalDefinition = prepared.selected.evals[0]!;
      const adapter = prepared.runs[0]!.adapter;
      expect((evalDefinition.test as typeof evalDefinition.test & { helper: object }).helper).toBe(adapter);
      expect(adapterAcceptsEval(adapter, evalDefinition.definition)).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis, factoriesKey);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
