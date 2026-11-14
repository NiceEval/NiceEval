import { defineExperiment } from "niceeval";
import { snapshotAgent, snapshotSandbox } from "../agents/remote-snapshot.ts";
export default defineExperiment({ adapter: snapshotAgent, sandbox: snapshotSandbox, evals: ["snapshot-shared"] });
