import { defineEvalGroup } from "niceeval";
import first from "./01-first.eval.ts";
import after from "./02-after.eval.ts";

export default defineEvalGroup({ evals: [first, after], onUnavailable: "stop-group" });
