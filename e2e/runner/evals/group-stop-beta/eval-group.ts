import { defineEvalGroup } from "niceeval"; import first from "./first.eval.ts"; import next from "./next.eval.ts";
export default defineEvalGroup({ onUnavailable: "stop-group", evals: [first, next] });
