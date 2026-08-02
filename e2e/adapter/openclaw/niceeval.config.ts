import { defineConfig } from "niceeval";
import { dockerImageSandbox } from "niceeval/sandbox";
import { IMAGE_TAG } from "./scripts/build-docker-env.ts";

export default defineConfig({
  name: { "zh-CN": "openclaw E2E", en: "openclaw E2E" },
  timeoutMs: 900_000,
  sandbox: dockerImageSandbox({ image: IMAGE_TAG }),
  maxConcurrency: 1,
});
