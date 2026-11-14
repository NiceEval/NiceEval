import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { defineExperiment } from "niceeval";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import { dockerSandbox, shell } from "niceeval/sandbox";

export default defineExperiment({
  adapter: defineSandboxAgent({
    name: "invocation-active-fixture",
    evidenceCoverage: completeEvidenceCoverage,
    install: { identity: { agent: "invocation-active-fixture", version: "1", revision: "1" }, probe: shell("true") },
    async send(_input, ctx) {
      for (let index = 0; index < 100; index++) ctx.progress({ message: `Activity ${index}` });
      ctx.progress({ message: "Waiting for inspection release" });
      await writeFile("invocation-active-ready", "ready");
      while (!existsSync("invocation-active-release")) {
        ctx.signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { status: "completed", events: [] };
    },
  }),
  sandbox: dockerSandbox({
    source: {
      type: "image",
      image: "niceeval/codex@sha256:e0b8c9b08058a30843537ca9cef7e3508e880edc0f5aba704e29636a2e7d5cd5",
    },
  }),
  evals: ["invocation-active"],
});
