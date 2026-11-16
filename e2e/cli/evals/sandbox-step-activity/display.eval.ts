import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import { command, sandboxLayer, shell, uploadFile, writeText } from "niceeval/sandbox";

export default defineEval({
  description: "Sandbox preparation reports each concrete declarative step safely",
  sandbox: sandboxLayer()
    .before(
      shell({
        id: "activity-shell",
        label: "Prepare runtime marker",
        script: new URL("../../fixtures/sandbox-step-activity/prepare.sh", import.meta.url),
      }),
    )
    .before(
      command("/bin/sh", ["-c", "sleep 2", "activity-arg\tvalue"], {
        id: "activity-exec",
        env: { ACTIVITY_VISIBLE_KEY: "activity-env-private-value" },
      }),
    )
    .before(
      writeText({
        id: "activity-write-text",
        path: "/tmp/runtime-note.txt",
        text: "sandbox-write-private-body\n",
      }),
    )
    .before(
      uploadFile({
        id: "activity-upload-file",
        source: new URL("../../fixtures/sandbox-step-activity/upload.txt", import.meta.url),
        to: "/tmp/runtime-upload.txt",
      }),
    ),
  async test(t) {
    t.check(await t.sandbox.readText("/tmp/sandbox-shell-ready"), includes("sandbox-shell-ready"));
    const turn = await t.send("Confirm that the declared Sandbox preparation completed.");
    await turn.succeeded().orStop();
    t.check(turn.reply, includes("sandbox steps completed"));
  },
});
