import { strictEqual, match } from "node:assert";
import { defineEval } from "niceeval";
export default defineEval({ async test(t) {
  const found = await t.sandbox.runCommandOrThrow("bash", ["-lc", "command -v apply_patch"]);
  match(found.stdout.trim(), /^\//u);
  const applied = await t.sandbox.runCommandOrThrow("bash", ["-lc", "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: patch-proof.txt\n+native Codex patch\n*** End Patch\nPATCH"]);
  strictEqual(applied.exitCode, 0);
  strictEqual(await t.sandbox.readText("patch-proof.txt"), "native Codex patch\n");
} });
