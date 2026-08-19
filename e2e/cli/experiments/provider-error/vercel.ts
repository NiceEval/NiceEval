import { Effect } from "effect";
import { defineExperiment } from "niceeval";
import { CustomSandboxMaterializationError, defineSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../../agents/deterministic.ts";

const message = "403 Forbidden — Vercel rejected the sandbox request because team access is required for request iad1::feedback-456";

export default defineExperiment({
  description: "provider-error/vercel:保留 Vercel provider message 与 Attempt 下钻",
  agent: preContextErrorAgent,
  sandbox: defineSandbox({
    name: "vercel-feedback-fixture",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "amd64", libc: "gnu" },
    create: () => Effect.fail(new CustomSandboxMaterializationError({
      code: "provider-request-failed",
      message,
      cause: new Error("vercel-cause-secret-must-not-reach-human"),
    })),
  }),
  evals: ["greet/hello"],
});
