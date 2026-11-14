import { execFileSync } from "node:child_process";
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const id = execFileSync("docker", ["ps", "-q", "--filter", `label=niceeval.pid=${process.pid}`], { encoding: "utf8" }).trim();
    const labels = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", id], { encoding: "utf8" }));
    const runOnly = process.env.NICEEVAL_LABEL_MODE === "run-only";
    t.check(typeof labels["niceeval.run_id"], equals("string"));
    t.check(typeof labels["niceeval.created_for_attempt"], equals(runOnly ? "undefined" : "string"));
    t.check(labels["niceeval.created_for_eval"], equals(runOnly ? undefined : "creation-labels"));
  },
});
