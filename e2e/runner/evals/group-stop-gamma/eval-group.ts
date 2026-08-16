import { defineEvalGroup } from "niceeval"; import hold from "./hold.eval.ts";
export default defineEvalGroup({ onUnavailable: "stop-group", evals: [hold] });
