import { defineExperiment } from "niceeval";
import { customHostSuccess } from "../fixtures/custom-applications.ts";

export default defineExperiment({ adapter: customHostSuccess, evals: ["custom-host-success"], attempts: 1 });
