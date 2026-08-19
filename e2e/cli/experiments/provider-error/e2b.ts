import { Effect } from "effect";
import { defineExperiment } from "niceeval";
import { CustomSandboxMaterializationError, defineSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../../agents/deterministic.ts";

const message = `401 Unauthorized — E2B 返回了一段需要按 UTF-8 bytes 而不是 JavaScript 字符数截断的多字节诊断：${"沙箱凭据无效🔐".repeat(10)} request req_e2b_feedback_123`;

export default defineExperiment({
  description: "provider-error/e2b:保留 E2B provider message 与 Attempt 下钻",
  agent: preContextErrorAgent,
  sandbox: defineSandbox({
    name: "e2b-feedback-fixture",
    targetPlatform: { _tag: "Linux", os: "linux", arch: "amd64", libc: "gnu" },
    create: () => Effect.fail(new CustomSandboxMaterializationError({
      code: "provider-request-failed",
      message,
      cause: new Error("e2b-cause-secret-must-not-reach-human"),
    })),
  }),
  evals: ["greet/hello"],
});
