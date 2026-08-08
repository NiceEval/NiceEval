import { defineExperiment } from "niceeval";
import { fixtureAgent } from "../../agents/fixture.ts";

export default defineExperiment({ agent: fixtureAgent, evals: ["outcomes/passes"] });
