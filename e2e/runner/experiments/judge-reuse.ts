import { defineExperiment } from "niceeval";
import { nativeReuse } from "../applications/native-reuse.ts";

export default defineExperiment({ adapter: nativeReuse, evals: ["judge-reuse"], attempts: 1 });
