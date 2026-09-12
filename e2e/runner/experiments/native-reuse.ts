import { defineExperiment } from "niceeval";
import { nativeReuse } from "../applications/native-reuse.ts";

export default defineExperiment({ adapter: nativeReuse, evals: ["native-reuse"], attempts: 1 });
