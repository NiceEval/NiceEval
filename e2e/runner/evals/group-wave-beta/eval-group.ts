import { defineEvalGroup } from "niceeval";
import first from "./01-first.eval.ts";
import next from "./02-next.eval.ts";
import after from "./03-after.eval.ts";

export default defineEvalGroup({ evals: [first, next, after], onUnavailable: "stop-group" });
