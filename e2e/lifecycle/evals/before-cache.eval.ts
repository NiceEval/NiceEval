import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { actionRef, changeFrequency, sandboxLayer, shell } from "niceeval/sandbox";
import { beforeCacheResumeGate } from "../fixtures/before-cache/resume-gate.ts";

// The lifecycle owner rewrites this literal in its private project copy between
// independent CLI Invocations. The Sandbox before inputs remain unchanged.
const DEMAND = "v1";
const publicEnv = process.env.NICEEVAL_E2E_BEFORE_CACHE_PUBLIC_ENV ?? "PUBLIC_MODE=default\n";
if (!/^PUBLIC_MODE=[a-z]+\n$/u.test(publicEnv)) {
  throw new Error("NICEEVAL_E2E_BEFORE_CACHE_PUBLIC_ENV must be a public PUBLIC_MODE assignment");
}

export default defineEval({
  description: "BeforeCache restores preparation while the current Eval still runs",
  sandbox: sandboxLayer().before(
    shell({
      id: "env-execution-probe",
      command: [
        "set -eu",
        ...beforeCacheResumeGate(2),
        `printf '%s\\n' '${publicEnv.trim()}' > .env`,
        "grep -q '^PUBLIC_MODE=[a-z][a-z]*$' .env",
        "mkdir -p .before-cache",
        "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' > .before-cache/env-token",
      ].join("\n"),
      changeFrequency: changeFrequency.frequent + 10,
      dependsOn: [actionRef("middle-execution-probe")],
    }),
  ),
  async test(t) {
    const turn = await t.send(`before-cache-demand:${DEMAND}`);
    await turn.succeeded().orStop();
    t.check(turn.reply, includes(`before-cache-demand:${DEMAND}`));
    t.check(turn.reply, includes("before-cache-evidence:"));
  },
});
