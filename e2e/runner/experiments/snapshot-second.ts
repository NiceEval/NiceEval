import { shell } from "niceeval/sandbox";
import { defineExperiment } from "niceeval";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, sandbox: snapshotSandbox.before(shell({ id: process.env.NICEEVAL_SNAPSHOT_COLLISION ? "version" : "second-suffix", command: "printf second > /tmp/version" })), evals: ["snapshot-shared"] });
