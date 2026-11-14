import { Effect } from "effect";
import { hostSandboxTargetPlatform } from "@niceeval/testkit";
import { defineExperiment } from "niceeval";
import { defineSandbox } from "niceeval/sandbox";
import { inDiffAgent } from "../agents/in-diff.ts";
import { createReadLimitedSandbox } from "../agents/read-limited-sandbox.ts";
const sandbox = defineSandbox({
  name: "in-diff-e2e",
  targetPlatform: hostSandboxTargetPlatform(),
  exclusive: true,
  create: () =>
    Effect.promise(async () => {
      const provider = await createReadLimitedSandbox();
      await provider.runShellOrThrow("rm -f fixture/fail-reads");
      return {
        ...provider,
        async readBytes(path: string) {
          if (await provider.pathExists("fixture/fail-reads")) throw new Error("Fixture Provider read failure");
          return provider.readBytes(path);
        },
      };
    }),
});
export default defineExperiment({
  adapter: inDiffAgent,
  sandbox,
  evals: ["in-diff", "in-diff-elided", "in-diff-unavailable"],
});
