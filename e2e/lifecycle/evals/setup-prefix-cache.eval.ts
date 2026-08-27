import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { actionRef, changeFrequency, sandboxLayer, shell } from "niceeval/sandbox";
import { setupPrefixResumeGate } from "../fixtures/setup-prefix/resume-gate.ts";

// The lifecycle owner rewrites this literal in its private project copy between
// independent CLI Invocations. The Sandbox before inputs remain unchanged.
const DEMAND = "v1";
const publicEnv = process.env.NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV ?? "PUBLIC_MODE=default\n";
if (!/^PUBLIC_MODE=[a-z]+\n$/u.test(publicEnv)) {
  throw new Error("NICEEVAL_E2E_SETUP_PREFIX_PUBLIC_ENV must be a public PUBLIC_MODE assignment");
}

export default defineEval({
  description: "SetupPrefix restores preparation while the current Eval still runs",
  sandbox: sandboxLayer().before(shell({
    id: "env-execution-probe",
    command: [
      "set -eu",
      ...setupPrefixResumeGate(2),
      `printf '%s\\n' '${publicEnv.trim()}' > .env`,
      "grep -q '^PUBLIC_MODE=[a-z][a-z]*$' .env",
      "mkdir -p .setup-prefix",
      "node -e 'process.stdout.write(require(\"node:crypto\").randomUUID())' > .setup-prefix/env-token",
    ].join("\n"),
    changeFrequency: changeFrequency.frequent + 10,
    dependsOn: [actionRef("middle-execution-probe")],
  })),
  async test(t) {
    const turn = await t.send(`setup-prefix-demand:${DEMAND}`);
    await turn.succeeded().orStop();
    t.check(turn.message, includes(`setup-prefix-demand:${DEMAND}`));
    t.check(turn.message, includes("setup-prefix-evidence:"));
  },
});
