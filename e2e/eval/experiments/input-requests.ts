import { defineExperiment } from "niceeval";
import { inputRequestsAgent } from "../agents/input-requests.ts";
export default defineExperiment({ adapter: inputRequestsAgent, evals: ["input-requests"] });
