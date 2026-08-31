import { defineEvalGroup } from "niceeval";
import only from "./01-only.eval.ts";

export default defineEvalGroup({ evals: [only], onUnavailable: "stop-group" });
