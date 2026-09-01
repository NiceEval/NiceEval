import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { command, sandboxLayer, shell, uploadFile, writeText } from "niceeval/sandbox";

const SHELL_COMMAND = "printf 'sandbox-shell-ready\\n' > /tmp/sandbox-shell-ready && sleep 2";

export default defineEval({
  description: "Sandbox preparation reports each concrete declarative step safely",
  sandbox: sandboxLayer()
    .before(shell({
      id: "activity-shell",
      command: SHELL_COMMAND,
    }))
    .before(command("/bin/sh", ["-c", "sleep 2", "activity-arg\tvalue"], {
      id: "activity-exec",
      env: { ACTIVITY_VISIBLE_KEY: "activity-env-private-value" },
    }))
    .before(writeText({
      id: "activity-write-text",
      path: "/tmp/runtime-note.txt",
      text: "sandbox-write-private-body\n",
    }))
    .before(uploadFile({
      id: "activity-upload-file",
      source: new URL("../../fixtures/sandbox-step-activity/upload.txt", import.meta.url),
      to: "/tmp/runtime-upload.txt",
    })),
  async test(t) {
    const turn = await t.send("Confirm that the declared Sandbox preparation completed.");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("sandbox steps completed"));
  },
});
