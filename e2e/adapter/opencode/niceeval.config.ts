import { defineConfig } from "niceeval";
import { dockerImageSandbox } from "niceeval/sandbox";
import { IMAGE_TAG } from "./docker/image.ts";

export default defineConfig({
  name: { "zh-CN": "opencode E2E", en: "opencode E2E" },
  timeoutMs: 600_000,
  sandbox: dockerImageSandbox({ image: IMAGE_TAG }),
  maxConcurrency: 1,
});
