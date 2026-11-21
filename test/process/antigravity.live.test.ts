// 跨进程保证：外部程序与 Provider——在全新的 Docker Sandbox 中安装 agy 并使用 Gemini API 鉴权完成一轮。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, test } from "vitest";

const CLI = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const GEMINI_KEY_AVAILABLE = Boolean(process.env.GEMINI_API_KEY);
const NODE_IMAGE = "node@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f";

// @feature docs/feature/adapters/library/sdk/agy/README.md#鉴权
test.skipIf(!GEMINI_KEY_AVAILABLE)(
  GEMINI_KEY_AVAILABLE
    ? "runs the pinned agy through Docker with Gemini API authentication"
    : "runs the pinned agy through Docker (skipped: GEMINI_API_KEY is unavailable)",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "niceeval-agy-live-"));
    try {
      await Promise.all(["evals", "experiments"].map((directory) => mkdir(join(cwd, directory))));
      await Promise.all([
        writeFile(
          join(cwd, "niceeval.config.ts"),
          'import { defineConfig } from "niceeval";\nexport default defineConfig({ timeoutMs: 90_000 });\n',
        ),
        writeFile(
          join(cwd, "experiments", "agy.ts"),
          `import { defineExperiment } from "niceeval";
import { antigravityAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";
export default defineExperiment({
  adapter: antigravityAgent(),
  sandbox: dockerSandbox({ source: { type: "image", image: ${JSON.stringify(NODE_IMAGE)} }, user: "node" }),
  model: "gemini-3.8-flash-low",
  attempts: 1,
  evals: ["prompt"],
});
`,
        ),
        writeFile(
          join(cwd, "evals", "prompt.eval.ts"),
          `import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
export default defineEval({
  async test(t) {
    const turn = await t.send("Reply with just the marker indigo-731. Do not use tools.");
    await turn.succeeded().orStop();
    t.check(turn.reply, includes("indigo-731"));
  },
});
`,
        ),
      ]);
      const result = await execa(process.execPath, [...process.execArgv, CLI, "exp", "agy", "--json"], {
        cwd,
        reject: false,
        timeout: 170_000,
        env: { NO_COLOR: "1" },
      });
      const documents: { event?: string; evalId?: string; verdict?: string }[] = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(documents.find((document) => document.event === "eval")).toMatchObject({
        evalId: "prompt",
        verdict: "passed",
      });
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
  180_000,
);
