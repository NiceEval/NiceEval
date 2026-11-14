import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent.each([
  { id: "bounded", name: "bounded[default]", timeoutMs: 60_000, lifetimeMs: undefined, seconds: 180 },
  { id: "unlimited", name: "unlimited+default", timeoutMs: undefined, lifetimeMs: undefined, seconds: 900 },
  { id: "explicit", name: "explicit(sandbox)", timeoutMs: 60_000, lifetimeMs: 600_000, seconds: 600 },
])(
  "cloud creation sends a hard deadline and the Record Run identity ($name)",
  async ({ id, timeoutMs, lifetimeMs, seconds }) => {
    await cliE2E.case(`cloud-lifetime-${id}`, {}, async ({ commands: { niceeval }, paths }) => {
      await writeFile(
        join(paths.projectRoot, "niceeval.config.ts"),
        `import { defineConfig } from "niceeval";
export default defineConfig({ name: { en: "cloud-lifetime", "zh-CN": "cloud-lifetime" }, sandboxCache: { before: "bypass" } });\n`,
      );
      await writeFile(
        join(paths.projectRoot, "experiments", "cloud-lifetime.ts"),
        `
import { defineExperiment } from "niceeval";
import { instaboxSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../agents/deterministic.ts";
export default defineExperiment({
  adapter: preContextErrorAgent,
  sandbox: instaboxSandbox(${JSON.stringify(lifetimeMs === undefined ? {} : { lifetimeMs })}),
  ${timeoutMs === undefined ? "" : `timeoutMs: ${timeoutMs},`}
  evals: ["greet/hello"],
});\n`,
      );
      const requests = join(paths.projectRoot, "cloud-create.jsonl");
      const preload = pathToFileURL(join(paths.projectRoot, "fixtures/cloud-lifetime/capture-instabox.mjs")).href;
      const startedAt = Date.now();
      const result = await niceeval.run(["exp", "cloud-lifetime", "--rerun", "all"], {
        env: {
          INSTABOX_API_KEY: "fixture-not-a-real-key",
          NICEEVAL_TEST_CREATE_REQUESTS: requests,
          NODE_OPTIONS: `--import=${preload}`,
        },
      });
      expect(result.exitCode, result.diagnostic()).toBe(1);
      const bodies = (await readFile(requests, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(bodies).toHaveLength(1);
      expect(bodies[0].deleteAfterSeconds).toBe(seconds);
      expect(bodies[0].autoSuspendAfterSeconds).toBe(0);
      const createdAt = bodies[0].metadata["niceeval.created_at"];
      expect(new Date(createdAt).toISOString()).toBe(createdAt);
      expect(Date.parse(createdAt)).toBeGreaterThanOrEqual(startedAt);
      expect(Date.parse(createdAt)).toBeLessThanOrEqual(Date.now());

      const listed = await niceeval.run(["show", "runs", "--json"]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      expect(listed.runsList().selection.selectedRunIds).toEqual([bodies[0].metadata["niceeval.run_id"]]);
    });
  },
);
