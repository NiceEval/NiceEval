import { readFileSync, writeFileSync } from "node:fs";
import { decodeExpPlanDocument, type ExpPlanDocument } from "niceeval/experiment/host";
import { command } from "@niceeval/testkit";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/eval/README.md
// @issue docs/issues/loaders-without-host.md
test.concurrent("无宿主读取后同进程发现仍登记共享文件，发现结束后具名拒绝运行期读取", async () => {
  await evalE2E.case("loader-timing", async ({ paths: { projectRoot } }) => {
    for (const dir of ["evals", "experiments"]) {
      await rm(join(projectRoot, dir), { recursive: true });
      await mkdir(join(projectRoot, dir));
    }
    await writeFile(join(projectRoot, "input.txt"), "first");
    await writeFile(join(projectRoot, "input.json"), '{"ok":true}');
    await writeFile(join(projectRoot, "input.yaml"), "ok: true\n");
    await writeFile(
      join(projectRoot, "shared.mjs"),
      `import { loadText } from "niceeval/loaders";\nexport const text = await loadText(new URL("./input.txt", import.meta.url));\n`,
    );
    for (const id of ["a", "b"]) {
      await writeFile(
        join(projectRoot, `evals/${id}.eval.ts`),
        `
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
import { text } from "../shared.mjs";
export default defineEval({ test(t) { t.check(text, equals("first")); } });
`,
      );
    }
    await writeFile(
      join(projectRoot, "experiments/loaders.ts"),
      `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ["a", "b"], adapter: defineAgent({ name: "loaders", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });
`,
    );
    await writeFile(
      join(projectRoot, "loader-consumer.mjs"),
      `
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { loadText, loadJson, loadYaml, loadCriteria } from "niceeval/loaders";
import { experimentHost } from "niceeval/experiment/host";
const shared = await import("./shared.mjs");
assert.equal(shared.text, "first");
const decode = value => { assert.deepEqual(value, { ok: true }); return value.ok; };
assert.equal(await loadJson("input.json", decode), true);
assert.equal(await loadYaml("input.yaml", decode), true);
assert.deepEqual(await loadCriteria("input.txt"), ["input.txt"]);
const plan = async () => {
  const result = await Effect.runPromise(experimentHost.invocation.plan({ cwd: process.cwd(), experimentSelector: "loaders", config: {}, preview: true }));
  assert.equal(result.status, "ready");
  assert.equal(result.dry.slots.length, 2);
  return result.dry.slots.map(slot => ({ id: slot.target.evalId, digest: slot.target.executionIdentityDigest }));
};
const first = await plan();
assert.deepEqual(first.map(slot => slot.id).sort(), ["a", "b"]);
for (const [loader, path, args] of [[loadText, "missing.txt", []], [loadJson, "missing.json", [decode]], [loadYaml, "missing.yaml", [decode]], [loadCriteria, "missing/**", []]]) {
  await assert.rejects(() => loader(path, ...args), error => {
    assert.equal(error.name, "LoaderOutsideDiscoveryError");
    assert.ok(error.message.includes(path));
    assert.match(error.message, /module top level/);
    return true;
  });
}
await writeFile("input.txt", "second");
const second = await plan();
for (const slot of first) assert.notEqual(second.find(next => next.id === slot.id).digest, slot.digest, slot.id + " must register its shared loader input");
console.log("loader timing and shared fingerprints verified");
`,
    );
    const result = await command([process.execPath]).run(["loader-consumer.mjs"], { cwd: projectRoot });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stdout).toContain("loader timing and shared fingerprints verified");
  });
});

function expectLoaderChange(plan: ExpPlanDocument, path: string): void {
  expect(plan).toMatchObject({ reused: 0 });
  expect(plan.matrix).toHaveLength(2);
  for (const row of plan.matrix) {
    expect(row.slots).toMatchObject([{ state: "gap", reason: "identity-mismatch" }]);
    const explanation = row.slots[0]?.comparisons.find(
      ({ recordedClaim }) => recordedClaim === "execution-identity",
    )?.explanation;
    expect(explanation?.kind === "changed" ? explanation.deltas : []).toContainEqual(
      expect.objectContaining({ selector: `data:${path}`, kind: "changed" }),
    );
  }
}

// @use-case docs/feature/experiments/use-case/cache-modify-eval-source.md
test.concurrent("Experiment Adapter 与项目配置读入的文件决定对应结果能否沿用", async () => {
  await evalE2E.case("carry-experiment-loader", async ({ commands: { niceeval }, paths: { projectRoot } }) => {
    for (const dir of ["evals", "experiments", "agents"]) {
      await rm(join(projectRoot, dir), { recursive: true, force: true });
      await mkdir(join(projectRoot, dir));
    }
    for (const id of ["a", "b"]) {
      writeFileSync(
        join(projectRoot, "evals", `${id}.eval.ts`),
        `import assert from "node:assert/strict";
import { defineEval } from "niceeval";
import { loadText } from "niceeval/loaders";
export default defineEval({
  async test(t) {
    await assert.rejects(loadText("not-at-test.txt"), {
      name: "LoaderOutsideDiscoveryError",
      message: /not-at-test\\.txt.*during test\\(t\\).*module top level of an Eval, an Experiment/
    });
    await t.send("begin");
  }
});
`,
      );
    }
    writeFileSync(
      join(projectRoot, "agents", "deterministic.ts"),
      `import assert from "node:assert/strict";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
import { loadText } from "niceeval/loaders";
export const deterministicAgent = defineAgent({
  name: "loader-test",
  evidenceCoverage: completeEvidenceCoverage,
  async send() {
    await assert.rejects(loadText("not-at-send.txt"), {
      name: "LoaderOutsideDiscoveryError",
      message: /not-at-send\\.txt.*during Adapter send.*module top level of an Eval, an Experiment/
    });
    return { status: "completed", events: [] };
  }
});
`,
    );
    const experimentPath = join(projectRoot, "experiments", "carry.ts");
    writeFileSync(
      experimentPath,
      `import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";
export default defineExperiment({ adapter: deterministicAgent, evals: ["a", "b"] });
`,
    );
    writeFileSync(join(projectRoot, "adapter-prompt.txt"), "prompt v1");
    writeFileSync(join(projectRoot, "project-input.txt"), "config v1");
    writeFileSync(
      join(projectRoot, "agents", "with-prompt.ts"),
      `import { loadText } from "niceeval/loaders";
import { deterministicAgent } from "./deterministic.ts";
const prompt = await loadText(new URL("../adapter-prompt.txt", import.meta.url));
if (!prompt) throw new Error("Empty adapter prompt");
export { deterministicAgent };
`,
    );
    writeFileSync(
      join(projectRoot, "experiments", "with-prompt.ts"),
      readFileSync(experimentPath, "utf8").replace("../agents/deterministic.ts", "../agents/with-prompt.ts"),
    );
    const plan = async (id: string) => {
      const result = await niceeval.run(["exp", id, "--dry", "--json"]);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      return decodeExpPlanDocument(result.json());
    };
    await plan("with-prompt");

    const configPath = join(projectRoot, "niceeval.config.ts");
    writeFileSync(
      configPath,
      `import { loadText } from "niceeval/loaders";
await loadText(new URL("./project-input.txt", import.meta.url));
import { defineConfig } from "niceeval";
export default defineConfig({});`,
    );
    for (const id of ["carry", "with-prompt"]) {
      const result = await niceeval.run(["exp", id, "--rerun", "all", "--json"]);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(await plan(id)).toMatchObject({ reused: 2 });
    }

    writeFileSync(join(projectRoot, "adapter-prompt.txt"), "prompt v2");
    expectLoaderChange(await plan("with-prompt"), "adapter-prompt.txt");
    expect(await plan("carry")).toMatchObject({ reused: 2 });

    writeFileSync(join(projectRoot, "adapter-prompt.txt"), "prompt v1");
    writeFileSync(join(projectRoot, "project-input.txt"), "config v2");
    expectLoaderChange(await plan("carry"), "project-input.txt");
    expectLoaderChange(await plan("with-prompt"), "project-input.txt");
  });
});
