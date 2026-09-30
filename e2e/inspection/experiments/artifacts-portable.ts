import { defineExperiment } from "niceeval";
import { artifactAdapter } from "../adapters/artifacts.ts";

export default defineExperiment({ adapter: artifactAdapter, flags: { mode: "portable" }, evals: ["artifacts-portable"] });
