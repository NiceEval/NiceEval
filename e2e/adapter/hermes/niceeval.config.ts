import { defineConfig } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { IMAGE_TAG } from "./scripts/build-docker-env.ts";

export default defineConfig({
  name: { "zh-CN": "hermes E2E", en: "hermes E2E" },
  timeoutMs: 600_000,
  sandbox: dockerSandbox({ image: IMAGE_TAG }),
  maxConcurrency: 1,
});
