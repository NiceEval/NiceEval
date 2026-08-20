import { defineExperiment } from "niceeval";
import { groupWaveAgent, groupWaveSandbox } from "../agents/group-wave-gap.ts";

export default defineExperiment({
  agent: groupWaveAgent,
  sandbox: groupWaveSandbox,
  evals: ["group-wave-"],
  maxConcurrency: 3,
});
