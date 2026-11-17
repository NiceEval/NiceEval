import { defineExperiment } from "niceeval";
import { largeTurnsAgent } from "../agents/large-turns.ts";
export default defineExperiment({ adapter: largeTurnsAgent, evals: ["large-turns"] });
