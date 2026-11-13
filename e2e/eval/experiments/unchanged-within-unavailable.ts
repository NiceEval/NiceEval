import { hostSandboxTargetPlatform } from "@niceeval/testkit";
import { Effect } from "effect";
import { defineExperiment } from "niceeval";
import { defineSandbox } from "niceeval/sandbox";
import { changeScopeAgent } from "../agents/change-scope.ts";
import { createReadLimitedSandbox } from "../agents/read-limited-sandbox.ts";

const unreadableSandbox = defineSandbox({
  name: "diff-read-failure",
  targetPlatform: hostSandboxTargetPlatform(),
  exclusive: true,
  create: () => Effect.promise(async () => {
    const sandbox = await createReadLimitedSandbox();
    return { ...sandbox, readBytes: async () => { throw new Error("Fixture: Sandbox download unavailable"); } };
  }),
});
export default defineExperiment({ adapter: changeScopeAgent, sandbox: unreadableSandbox, evals: ["unchanged-within-empty"] });
