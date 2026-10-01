import { defineExperiment } from "niceeval";
import { customHostInterruption } from "../fixtures/custom-applications.ts";

export default defineExperiment({ adapter: customHostInterruption, evals: ["custom-host-interruption"], attempts: 1 });
